import argparse
import json
import math
from pathlib import Path


LABELS = ('jab', 'hook', 'uppercut', 'one_two')


def validate_events(events, duration_ms):
    identifiers = set()
    for event in events:
        if not isinstance(event, dict) or event.get('label') not in LABELS:
            raise ValueError('Unknown motion label')
        if not isinstance(event.get('id'), str) or not event['id'] or event['id'] in identifiers:
            raise ValueError('Event IDs must be nonempty and unique')
        identifiers.add(event['id'])
        for field in ('start_ms', 'end_ms'):
            value = event.get(field)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError('Event timestamps must be finite numbers')
        if not 0 <= event['start_ms'] <= event['end_ms'] <= duration_ms:
            raise ValueError('Event outside clip')
        if 'hand' in event and (event['hand'] not in ('left', 'right', 'both') or (event['label'] == 'one_two') != (event['hand'] == 'both')):
            raise ValueError('Invalid anatomical hand label')
    return sorted(events, key=lambda event: (event['end_ms'], event['start_ms'], event['id']))


def evaluate(truth, predictions, tolerance_ms=350):
    duration = truth.get('duration_ms')
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
        raise ValueError('Positive finite clip duration required')
    if not truth.get('clip_id') or predictions.get('clip_id') != truth['clip_id']:
        raise ValueError('Clip IDs must match')
    if truth.get('input_sha256') and predictions.get('input_sha256') != truth['input_sha256']:
        raise ValueError('Video hashes must match')
    if truth.get('split') not in ('development', 'evaluation'):
        raise ValueError('Explicit development/evaluation split required')
    if not math.isfinite(tolerance_ms) or tolerance_ms < 0:
        raise ValueError('Invalid tolerance')
    expected = validate_events(truth['events'], duration)
    actual = validate_events(predictions['events'], duration)
    if len(expected) > 1000 or len(actual) > 1000:
        raise ValueError('Split long recordings into clips of at most 1000 events')
    scores = [[(0, 0.0)] * (len(actual) + 1) for _ in range(len(expected) + 1)]
    steps = {}
    for truth_index in range(1, len(expected) + 1):
        for predicted_index in range(1, len(actual) + 1):
            choices = [(scores[truth_index - 1][predicted_index], 'miss'), (scores[truth_index][predicted_index - 1], 'extra')]
            distance = abs(expected[truth_index - 1]['end_ms'] - actual[predicted_index - 1]['end_ms'])
            if distance <= tolerance_ms:
                previous = scores[truth_index - 1][predicted_index - 1]
                choices.append(((previous[0] + 1, previous[1] - distance), 'match'))
            score, step = max(choices, key=lambda choice: choice[0])
            scores[truth_index][predicted_index] = score
            steps[truth_index, predicted_index] = step
    truth_index, predicted_index = len(expected), len(actual)
    pairs = []
    while truth_index and predicted_index:
        step = steps[truth_index, predicted_index]
        if step == 'match':
            pairs.append((truth_index - 1, predicted_index - 1))
            truth_index -= 1
            predicted_index -= 1
        elif step == 'miss':
            truth_index -= 1
        else:
            predicted_index -= 1
    confusion = {label: {other: 0 for other in (*LABELS, 'missed')} for label in LABELS}
    matched_truth = {pair[0] for pair in pairs}
    matched_predictions = {pair[1] for pair in pairs}
    for expected_index, actual_index in pairs:
        confusion[expected[expected_index]['label']][actual[actual_index]['label']] += 1
    for index, event in enumerate(expected):
        if index not in matched_truth:
            confusion[event['label']]['missed'] += 1
    per_class = {}
    for label in LABELS:
        true_positive = confusion[label][label]
        predicted_count = sum(event['label'] == label for event in actual)
        expected_count = sum(event['label'] == label for event in expected)
        per_class[label] = {'tp': true_positive, 'fp': predicted_count - true_positive, 'fn': expected_count - true_positive, 'precision': true_positive / predicted_count if predicted_count else None, 'recall': true_positive / expected_count if expected_count else None}
    intervals = sorted(truth.get('negative_intervals', []), key=lambda interval: interval['start_ms'])
    previous_end = -1
    for interval in intervals:
        start, end = interval['start_ms'], interval['end_ms']
        if not all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in (start, end)) or not 0 <= start < end <= duration or start < previous_end:
            raise ValueError('Invalid or overlapping negative intervals')
        if any(event['start_ms'] < end and event['end_ms'] > start for event in expected):
            raise ValueError('Negative interval overlaps a labeled motion')
        previous_end = end
    negative_ms = sum(interval['end_ms'] - interval['start_ms'] for interval in intervals)
    negative_detections = sum(any(interval['start_ms'] <= event['end_ms'] < interval['end_ms'] for interval in intervals) for event in actual)
    hand_pairs = [(expected[first]['hand'], actual[second]['hand']) for first, second in pairs if 'hand' in expected[first] and 'hand' in actual[second] and expected[first]['label'] == actual[second]['label']]
    hand_errors = sum(first != second for first, second in hand_pairs)
    publications = {}
    identifiers = {event['id'] for event in actual}
    for publication in predictions.get('score_publications', []):
        identifier, published = publication.get('id'), publication.get('published_ms')
        if identifier not in identifiers or identifier in publications or isinstance(published, bool) or not isinstance(published, (int, float)) or not math.isfinite(published) or published < 0:
            raise ValueError('Invalid score publication')
        publications[identifier] = published
    latencies = sorted(publications[actual[second]['id']] - expected[first]['end_ms'] for first, second in pairs if actual[second]['id'] in publications and expected[first]['label'] == actual[second]['label'])
    percentile = lambda fraction: latencies[min(len(latencies) - 1, math.ceil(len(latencies) * fraction) - 1)] if latencies else None
    return {'clip_id': truth['clip_id'], 'split': truth['split'], 'tolerance_ms': tolerance_ms, 'matching': 'chronological maximum one-to-one timing matches, then minimum time error; labels excluded from matching', 'per_class': per_class, 'confusion': confusion, 'unmatched_predictions': len(actual) - len(matched_predictions), 'negative_minutes': negative_ms / 60000, 'negative_false_positives_per_minute': negative_detections * 60000 / negative_ms if negative_ms else None,
            'hand_comparison': {'matched_labeled_events': len(hand_pairs), 'errors': hand_errors, 'error_rate': hand_errors / len(hand_pairs) if hand_pairs else None},
            'completion_to_score': {'matched_published_events': len(latencies), 'median_ms': percentile(0.5), 'p95_ms': percentile(0.95), 'early_publications': sum(value < 0 for value in latencies), 'meaning': 'score DOM update relative to annotated recovery; not screen paint or 5-second coaching feedback'}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--truth', type=Path, required=True)
    parser.add_argument('--predictions', type=Path, required=True)
    parser.add_argument('--tolerance-ms', type=float, default=350)
    args = parser.parse_args()
    print(json.dumps(evaluate(json.loads(args.truth.read_text(encoding='utf-8-sig')), json.loads(args.predictions.read_text(encoding='utf-8-sig')), args.tolerance_ms), indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
