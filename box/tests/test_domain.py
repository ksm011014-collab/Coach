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


if __name__ == "__main__":
    unittest.main()
