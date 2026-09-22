import unittest

from tools.evaluate_motion import evaluate


def event(identifier, label, end):
    return {'id': identifier, 'label': label, 'start_ms': end - 300, 'end_ms': end}


class MotionEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.truth = {'clip_id': 'synthetic', 'split': 'evaluation', 'duration_ms': 60000, 'events': [event('truth1', 'jab', 1000), event('truth2', 'uppercut', 2000)], 'negative_intervals': [{'start_ms': 3000, 'end_ms': 60000}]}

    def test_confusion_and_duplicates_do_not_improve_accuracy(self):
        result = evaluate(self.truth, {'clip_id': 'synthetic', 'events': [event('prediction1', 'hook', 1000), event('prediction2', 'uppercut', 2000), event('duplicate', 'uppercut', 2020), event('idle', 'jab', 10000)]})
        self.assertEqual(result['confusion']['jab']['hook'], 1)
        self.assertEqual(result['per_class']['uppercut']['precision'], 0.5)
        self.assertEqual(result['per_class']['jab']['recall'], 0)
        self.assertEqual(result['unmatched_predictions'], 2)
        self.assertAlmostEqual(result['negative_false_positives_per_minute'], 60 / 57)

    def test_no_predictions_is_missed_not_perfect_precision(self):
        result = evaluate(self.truth, {'clip_id': 'synthetic', 'events': []})
        self.assertIsNone(result['per_class']['jab']['precision'])
        self.assertEqual(result['per_class']['jab']['recall'], 0)
        self.assertIsNone(result['per_class']['one_two']['recall'])
        self.assertIsNone(result['hand_comparison']['error_rate'])
        self.assertIsNone(result['completion_to_score']['p95_ms'])

    def test_anatomical_hand_and_annotated_completion_latency(self):
        self.truth['events'][0]['hand'] = 'left'
        self.truth['events'][1]['hand'] = 'right'
        prediction = {'clip_id': 'synthetic', 'events': [{**event('first', 'jab', 1020), 'hand': 'right'}, {**event('second', 'uppercut', 2020), 'hand': 'right'}],
                      'score_publications': [{'id': 'first', 'published_ms': 950}, {'id': 'second', 'published_ms': 2400}]}
        result = evaluate(self.truth, prediction)
        self.assertEqual(result['hand_comparison']['error_rate'], 0.5)
        self.assertEqual(result['completion_to_score']['p95_ms'], 400)
        self.assertEqual(result['completion_to_score']['early_publications'], 1)
        prediction['score_publications'].append({'id': 'first', 'published_ms': 1000})
        with self.assertRaises(ValueError):
            evaluate(self.truth, prediction)

    def test_one_two_does_not_match_two_component_events(self):
        self.truth['events'] = [event('combo', 'one_two', 2000)]
        result = evaluate(self.truth, {'clip_id': 'synthetic', 'events': [event('jab', 'jab', 1850), event('combo', 'one_two', 2000)]})
        self.assertEqual(result['per_class']['one_two']['tp'], 1)
        self.assertEqual(result['per_class']['jab']['fp'], 1)

    def test_clip_mismatch_invalid_ids_and_negative_overlap_rejected(self):
        for prediction in ({'clip_id': 'other', 'events': []}, {'clip_id': 'synthetic', 'events': [event('same', 'jab', 1000), event('same', 'jab', 2000)]}):
            with self.assertRaises(ValueError):
                evaluate(self.truth, prediction)
        self.truth['negative_intervals'] = [{'start_ms': 500, 'end_ms': 1500}]
        with self.assertRaises(ValueError):
            evaluate(self.truth, {'clip_id': 'synthetic', 'events': []})
