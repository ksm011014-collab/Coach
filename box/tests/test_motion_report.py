import json
import unittest

from backend.domain import TrainingSession
from backend.errors import ApiError
from backend.motion_report import finish_motion_round, validate_motion_report
from fixtures import populated_store


class MotionReportTests(unittest.TestCase):
    def setUp(self):
        self.store = populated_store()
        self.owner = self.store.find_user_by_username('owner')
        self.member = self.store.find_user_by_username('member')
        self.store.create_session(TrainingSession('round', self.member.id, self.member.gym_id, 100, None, [], 0, 'free_training'))
        self.report = {'version': 1, 'status': 'experimental', 'algorithm': 'rules-v1', 'stance': 'orthodox', 'duration_ms': 2000, 'events': [{'id': 'event1', 'label': 'jab', 'hand': 'left', 'start_ms': 500, 'end_ms': 900, 'quality': 85, 'confidence': 0.9, 'points': 99999}]}

    def tearDown(self):
        self.store.conn.close()

    def test_recomputes_totals_preserves_quality_and_retry_is_immutable(self):
        result = finish_motion_round(self.store, self.member, 'round', self.report, 103)
        self.assertEqual(result.overall_score, 85)
        self.assertEqual(json.loads(result.feedback_report)['total_points'], 9)
        retry = finish_motion_round(self.store, self.member, 'round', self.report, 110)
        self.assertEqual(retry.ended_at, 103)
        self.assertEqual(self.store.conn.execute("select count(*) from operation_audit where operation='round.finish'").fetchone()[0], 1)
        with self.assertRaises(ApiError):
            finish_motion_round(self.store, self.member, 'round', {**self.report, 'events': []}, 110)

    def test_cross_center_platform_and_suspended_actor_denied(self):
        other_center = self.store.create_gym('Other', 'other')
        other = self.store.create_user('other', 'Test!12345', 'OWNER', 'Other', other_center.id)
        platform = self.store.create_user('platform', 'Test!12345', 'PLATFORM_ADMIN', 'Platform', self.owner.gym_id)
        for actor in (other, platform):
            with self.assertRaises(PermissionError):
                finish_motion_round(self.store, actor, 'round', self.report, 103)
        self.store.conn.execute("update users set status='SUSPENDED' where id=?", (self.member.id,))
        self.store.conn.commit()
        with self.assertRaises(PermissionError):
            finish_motion_round(self.store, self.member, 'round', self.report, 103)
        self.assertIsNone(self.store.get_session('round').ended_at)

    def test_guard_evidence_validation_and_persistence(self):
        event = self.report['events'][0]
        for value in (None, True, '0.5', -0.1, 1.1, float('nan')):
            with self.assertRaises(ValueError):
                validate_motion_report({**self.report, 'events': [{**event, 'guard_ratio': value}]})
        self.assertNotIn('guard_ratio', validate_motion_report(self.report)['events'][0])
        event['guard_ratio'] = 0.25
        saved = finish_motion_round(self.store, self.member, 'round', self.report, 103)
        self.assertEqual(json.loads(saved.feedback_report)['events'][0]['guard_ratio'], 0.25)
        self.assertEqual(finish_motion_round(self.store, self.member, 'round', self.report, 110).feedback_report, saved.feedback_report)
        event['guard_ratio'] = 0.9
        with self.assertRaises(ApiError):
            finish_motion_round(self.store, self.member, 'round', self.report, 110)

    def test_tracking_bounds_and_round_trip(self):
        tracking = {'gaps': [{'start_ms': 0, 'end_ms': 100, 'reason': 'no_result'}], 'total_ms': 100, 'truncated': False}
        for invalid in ({**tracking, 'total_ms': 99}, {**tracking, 'truncated': True}, {**tracking, 'gaps': tracking['gaps'] * 2}, {**tracking, 'gaps': [{'start_ms': 0, 'end_ms': 2001, 'reason': 'no_result'}]}):
            with self.assertRaises(ValueError):
                validate_motion_report({**self.report, 'tracking': invalid})
        report = {**self.report, 'tracking': tracking}
        saved = finish_motion_round(self.store, self.member, 'round', report, 103)
        self.assertEqual(json.loads(saved.feedback_report)['tracking'], tracking)
        self.assertEqual(finish_motion_round(self.store, self.member, 'round', report, 110).feedback_report, saved.feedback_report)

    def test_invalid_events_cannot_end_session(self):
        invalid = [
            {**self.report, 'events': self.report['events'] * 2},
            {**self.report, 'status': 'unavailable'},
            {**self.report, 'duration_ms': 999999},
            {**self.report, 'events': [{**self.report['events'][0], 'quality': float('nan')}]},
            {**self.report, 'events': [{**self.report['events'][0], 'hand': 'right'}]},
        ]
        for report in invalid:
            with self.assertRaises(ValueError):
                finish_motion_round(self.store, self.owner, 'round', report, 103)
        self.assertIsNone(self.store.get_session('round').ended_at)

    def test_empty_unavailable_report_does_not_claim_quality(self):
        report = validate_motion_report({**self.report, 'status': 'unavailable', 'events': []})
        self.assertIsNone(report['mean_quality'])
        self.assertEqual(report['total_points'], 0)

    def test_opposite_hand_overlap_allowed_but_duplicate_hand_rejected(self):
        first = self.report['events'][0]
        second = {**first, 'id': 'event2', 'label': 'hook', 'hand': 'right', 'start_ms': 800, 'end_ms': 1200}
        result = validate_motion_report({**self.report, 'events': [first, second]})
        self.assertEqual(result['counts']['hook'], 1)
        with self.assertRaises(ValueError):
            validate_motion_report({**self.report, 'events': [first, {**second, 'hand': 'left'}]})
