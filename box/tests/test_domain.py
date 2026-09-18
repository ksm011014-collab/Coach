import dataclasses
import unittest
import tempfile
from pathlib import Path

from backend.domain import Store, can_read_profile, can_read_session
from backend.domain import TrainingSession
from fixtures import populated_store
from backend.camera import normalize_camera_config


class AuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.store = populated_store()
        self.addCleanup(self.store.conn.close)
        self.owner = next(user for user in self.store.users.values() if user.role == "OWNER")
        self.member = next(user for user in self.store.users.values() if user.role == "MEMBER")
        self.member_profile = self.store.profile_for_user(self.member.id)

    def test_owner_can_read_member_in_same_gym(self):
        self.assertTrue(can_read_profile(self.owner, self.member_profile))

    def test_member_cannot_read_other_member_profile(self):
        owner_profile = self.store.profile_for_user(self.owner.id)
        self.assertFalse(can_read_profile(self.member, owner_profile))

    def test_center_code_resolves_created_center(self):
        center = self.store.create_gym("Blue Corner Center", "blue-corner")

        self.assertEqual(self.store.find_gym_by_code("BLUE-CORNER").id, center.id)

    def test_admin_cannot_read_member_in_other_center(self):
        center = self.store.create_gym("School Sports Center", "school")
        other_member = self.store.create_user(
            "school_member",
            "Member!123",
            "MEMBER",
            "학교회원",
            center.id,
        )
        other_profile = self.store.create_profile(other_member, "010-9999-9999", "2000-01-01", "other")

        self.assertFalse(can_read_profile(self.owner, other_profile))

    def test_session_scope_matches_role(self):
        session = TrainingSession(
            id="session_test",
            user_id=self.member.id,
            gym_id=self.member.gym_id,
            started_at=0,
            ended_at=None,
            camera_config=[{"camera_id": "cam_front_01", "view_angle": "front"}],
            overall_score=88,
            focus="guard_and_strikes",
        )
        self.assertTrue(can_read_session(self.owner, session))
        self.assertTrue(can_read_session(self.member, session))

    def test_member_training_level_persists_and_clamps(self):
        level_member = self.store.create_user(
            "level_member",
            "Member!123",
            "MEMBER",
            "레벨회원",
            self.owner.gym_id,
        )
        profile = self.store.create_profile(level_member, "", "", "", training_level=4)

        self.assertEqual(self.store.get_profile(profile.id).training_level, 4)

        updated = self.store.update_profile(dataclasses.replace(profile, training_level=9))

        self.assertEqual(updated.training_level, 5)
        self.assertEqual(self.store.get_profile(profile.id).training_level, 5)

    def test_end_session_preserves_legacy_analysis_data(self):
        session = TrainingSession(
            id="session_record",
            user_id=self.member.id,
            gym_id=self.member.gym_id,
            started_at=10,
            ended_at=None,
            camera_config=[{"camera_id": "cam_front_01", "view_angle": "front"}],
            overall_score=86,
            feedback_report='{"summary":"legacy report"}',
            focus="guard_and_strikes",
        )
        self.store.create_session(session)
        updated = self.store.end_session(
            session.id,
            ended_at=70,
        )

        self.assertEqual(updated.ended_at, 70)
        self.assertEqual(updated.overall_score, 86)
        self.assertEqual(updated.feedback_report, '{"summary":"legacy report"}')

    def test_delete_session_removes_record(self):
        session = TrainingSession(
            id="session_delete",
            user_id=self.member.id,
            gym_id=self.member.gym_id,
            started_at=10,
            ended_at=70,
            camera_config=[{"camera_id": "cam_front_01", "view_angle": "front"}],
            overall_score=86,
            focus="guard_and_strikes",
        )
        self.store.create_session(session)
        self.store.delete_session(session.id)

        self.assertIsNone(self.store.get_session(session.id))

    def test_camera_config_keeps_capture_metadata_only(self):
        cameras = normalize_camera_config([{"camera_id": "front", "device_id": "usb", "calibrated": True, "projection_matrix": [1]}])
        self.assertEqual(cameras[0]["device_id"], "usb")
        self.assertNotIn("calibrated", cameras[0])
        self.assertNotIn("projection_matrix", cameras[0])

    def test_reopening_database_preserves_legacy_calibration_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "legacy.db"
            store = populated_store(database)
            profile = next(iter(store.profiles.values()))
            legacy = ("legacy", profile.id, profile.user_id, profile.gym_id, "ready", 1,
                      10.0, 4, 180, "[]", "{}", '{"ready":true}')
            store.conn.execute("insert into member_calibrations values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", legacy)
            store.conn.commit()
            store.conn.close()
            reopened = Store(database)
            try:
                self.assertEqual(tuple(reopened.conn.execute("select * from member_calibrations").fetchone()), legacy)
            finally:
                reopened.conn.close()


if __name__ == "__main__":
    unittest.main()
