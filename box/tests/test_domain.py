import unittest

from backend.domain import Store, can_read_profile, can_read_session
from backend.domain import TrainingSession


class AuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.store = Store()
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

    def test_end_session_persists_record_summary(self):
        session = TrainingSession(
            id="session_record",
            user_id=self.member.id,
            gym_id=self.member.gym_id,
            started_at=10,
            ended_at=None,
            camera_config=[{"camera_id": "cam_front_01", "view_angle": "front"}],
            overall_score=0,
            focus="guard_and_strikes",
        )
        self.store.create_session(session)
        updated = self.store.end_session(session.id, ended_at=70, overall_score=86)

        self.assertEqual(updated.ended_at, 70)
        self.assertEqual(updated.overall_score, 86)

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


if __name__ == "__main__":
    unittest.main()
