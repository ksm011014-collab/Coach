import json
import math
import secrets
from http import HTTPStatus

try:
    from domain import can_write_training
    from errors import ApiError
    from operations_schema import center_now
except ModuleNotFoundError:
    from backend.domain import can_write_training
    from backend.errors import ApiError
    from backend.operations_schema import center_now


def number(value, minimum, maximum, field, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum or (integer and value != int(value)):
        raise ValueError('Invalid motion ' + field)
    return int(value) if integer else value


def validate_tracking(tracking, duration):
    if not isinstance(tracking, dict) or not isinstance(tracking.get('gaps'), list) or len(tracking['gaps']) > 200 or not isinstance(tracking.get('truncated'), bool):
        raise ValueError('Invalid tracking evidence')
    total = number(tracking.get('total_ms'), 0, duration, 'tracking total', True)
    gaps = []
    previous_end = 0
    recorded = 0
    for gap in tracking['gaps']:
        if not isinstance(gap, dict) or gap.get('reason') not in ('unreliable', 'no_result'):
            raise ValueError('Invalid tracking gap')
        start = number(gap.get('start_ms'), previous_end, duration, 'gap start', True)
        end = number(gap.get('end_ms'), start + 1, duration, 'gap end', True)
        gaps.append({'start_ms': start, 'end_ms': end, 'reason': gap['reason']})
        recorded += end - start
        previous_end = end
    if total < recorded or tracking['truncated'] != (total > recorded) or (tracking['truncated'] and len(gaps) != 200):
        raise ValueError('Inconsistent tracking total')
    return {'gaps': gaps, 'total_ms': total, 'truncated': tracking['truncated']}


def validate_motion_report(report):
    if not isinstance(report, dict) or report.get('version') != 1 or isinstance(report.get('version'), bool):
        raise ValueError('Unsupported motion report version')
    if report.get('status') not in ('experimental', 'unavailable') or report.get('algorithm') != 'rules-v1':
        raise ValueError('Unsupported motion analysis status')
    if report.get('stance') not in ('orthodox', 'southpaw'):
        raise ValueError('Invalid stance')
    duration = number(report.get('duration_ms'), 0, 3600000, 'duration_ms', True)
    events = report.get('events')
    if not isinstance(events, list) or len(events) > 1000 or (report['status'] == 'unavailable' and events):
        raise ValueError('Invalid motion events')
    normalized = []
    identities = set()
    last_end = -1
    previous_events = []
    counts = dict.fromkeys(('jab', 'hook', 'uppercut', 'one_two'), 0)
    for event in events:
        if not isinstance(event, dict):
            raise ValueError('Invalid motion event')
        identifier = event.get('id')
        if not isinstance(identifier, str) or not 1 <= len(identifier) <= 96 or identifier in identities:
            raise ValueError('Duplicate or invalid motion event ID')
        identities.add(identifier)
        label = event.get('label')
        if label not in counts or event.get('hand') not in ('left', 'right', 'both'):
            raise ValueError('Invalid motion label or hand')
        if (label == 'one_two') != (event['hand'] == 'both'):
            raise ValueError('Invalid combination hand')
        if label == 'jab' and event['hand'] != ('left' if report['stance'] == 'orthodox' else 'right'):
            raise ValueError('Jab must use lead hand')
        start = number(event.get('start_ms'), 0, duration, 'start_ms', True)
        end = number(event.get('end_ms'), start, duration, 'end_ms', True)
        if end < last_end or any(start < previous['end_ms'] and (event['hand'] == 'both' or previous['hand'] == 'both' or event['hand'] == previous['hand']) for previous in previous_events):
            raise ValueError('Overlapping same-hand or unordered motion events')
        last_end = end
        previous_events.append({'hand': event['hand'], 'end_ms': end})
        quality = number(event.get('quality'), 0, 100, 'quality', True)
        confidence = number(event.get('confidence'), 0.65, 1, 'confidence')
        strikes = 2 if label == 'one_two' else 1
        points = max(1, math.floor(quality / 10 + 0.5)) * strikes
        normalized.append({'id': identifier, 'label': label, 'hand': event['hand'], 'start_ms': start, 'end_ms': end, 'quality': quality, 'confidence': confidence, 'points': points})
        if 'guard_ratio' in event:
            normalized[-1]['guard_ratio'] = number(event['guard_ratio'], 0, 1, 'guard_ratio')
        counts[label] += 1
    result = {'version': 1, 'status': report['status'], 'algorithm': 'rules-v1', 'source': 'device_estimate', 'stance': report['stance'], 'duration_ms': duration, 'events': normalized, 'counts': counts, 'total_points': sum(event['points'] for event in normalized), 'mean_quality': math.floor(sum(event['quality'] for event in normalized) / len(normalized) + 0.5) if normalized else None}
    if 'tracking' in report:
        result['tracking'] = validate_tracking(report['tracking'], duration)
    return result


def finish_motion_round(store, actor, session_id, report, ended_at):
    normalized = validate_motion_report(report)
    serialized = json.dumps(normalized, sort_keys=True, separators=(',', ':'))
    with store.transaction():
        session = store.get_session(session_id)
        current_actor = store.get_user(actor.id)
        if session is None:
            raise ApiError('session not found', HTTPStatus.NOT_FOUND)
        if current_actor is None or not can_write_training(current_actor, session):
            raise PermissionError('session is outside your access scope')
        end = session.ended_at or ended_at
        if normalized['duration_ms'] > max(0, (end - session.started_at) * 1000) + 1000:
            raise ValueError('Motion duration exceeds recorded session')
        if session.feedback_report:
            if session.feedback_report != serialized:
                raise ApiError('Round result already finalized', HTTPStatus.CONFLICT)
            return session
        store.conn.execute('update training_sessions set ended_at=?, overall_score=?, feedback_report=? where id=?', (end, normalized['mean_quality'] or 0, serialized, session_id))
        store.conn.execute('insert into operation_audit(id,center_id,actor_id,operation,target_id,before_state,after_state,created_at) values(?,?,?,?,?,?,?,?)', (secrets.token_hex(16), session.gym_id, actor.id, 'round.finish', session_id, '{}', json.dumps({'total_points': normalized['total_points'], 'events': len(normalized['events']), 'status': normalized['status']}), center_now(store.conn, session.gym_id)))
    return store.get_session(session_id)
