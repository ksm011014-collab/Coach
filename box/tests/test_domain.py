import dataclasses
import unittest

from backend.domain import Store, can_read_profile, can_read_session
from backend.domain import TrainingSession
from backend.pose3d import (
    build_human_calibration,
    build_pose3d_packet,
    calibration_summary,
    median_value,
    normalize_camera_config,
    normalized_primary_projection,
)


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
        updated = self.store.end_session(
            session.id,
            ended_at=70,
            overall_score=86,
            feedback_report='{"summary":"good round"}',
        )

        self.assertEqual(updated.ended_at, 70)
        self.assertEqual(updated.overall_score, 86)
        self.assertEqual(updated.feedback_report, '{"summary":"good round"}')

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

    def test_camera_config_defaults_to_single_camera(self):
        cameras = normalize_camera_config(None)
        summary = calibration_summary(cameras)

        self.assertEqual(cameras[0]["camera_id"], "cam_front_01")
        self.assertEqual(summary["mode"], "2d")
        self.assertTrue(summary["ready"])

    def test_multicamera_requires_calibration(self):
        cameras = normalize_camera_config(
            [
                {"camera_id": "front", "view_angle": "front", "enabled": True},
                {"camera_id": "side", "view_angle": "side_90", "enabled": True},
            ]
        )
        summary = calibration_summary(cameras)

        self.assertEqual(summary["mode"], "3d_pending")
        self.assertFalse(summary["ready"])
        self.assertEqual(summary["missing_calibration"], ["front", "side"])

    def test_multicamera_calibrated_flag_requires_projection_matrix(self):
        cameras = normalize_camera_config(
            [
                {"camera_id": "front", "view_angle": "front", "enabled": True, "calibrated": True},
                {"camera_id": "side", "view_angle": "side_90", "enabled": True, "calibrated": True},
            ]
        )
        summary = calibration_summary(cameras)

        self.assertEqual(summary["mode"], "3d_pending")
        self.assertFalse(summary["ready"])
        self.assertEqual(summary["missing_calibration"], ["front", "side"])

    def test_multicamera_ready_with_projection_matrices(self):
        cameras = normalize_camera_config(
            [
                {
                    "camera_id": "front",
                    "view_angle": "front",
                    "enabled": True,
                    "calibrated": True,
                    "projection_matrix": normalized_primary_projection(),
                },
                {
                    "camera_id": "side",
                    "view_angle": "side_90",
                    "enabled": True,
                    "calibrated": True,
                    "projection_matrix": [[1.0, 0.0, 0.5, 0.25], [0.0, 1.0, 0.5, 0.0], [0.0, 0.0, 1.0, 0.0]],
                },
            ]
        )
        summary = calibration_summary(cameras)

        self.assertEqual(summary["mode"], "3d")
        self.assertTrue(summary["ready"])
        self.assertEqual(summary["missing_calibration"], [])

    def test_pose3d_packet_reports_missing_calibration(self):
        packet = build_pose3d_packet(
            {
                "session_id": "session_pose",
                "camera_config": [
                    {"camera_id": "front", "view_angle": "front", "enabled": True},
                    {"camera_id": "side", "view_angle": "side_90", "enabled": True},
                ],
                "observations": [],
            }
        )

        self.assertEqual(packet["status"], "calibration_required")
        self.assertEqual(packet["pose_space"], "world_3d")

    def test_human_calibration_single_camera_returns_2d_ready(self):
        result = build_human_calibration(
            {
                "camera_config": [{"camera_id": "front", "view_angle": "front", "enabled": True}],
                "body_profile": {"height_cm": 180},
                "samples": [human_calibration_sample("front")],
            }
        )

        self.assertEqual(result["status"], "single_camera_2d")
        self.assertTrue(result["ready"])
        self.assertTrue(result["cameras"][0]["calibrated"])
        self.assertEqual(len(result["cameras"][0]["projection_matrix"]), 3)
        self.assertGreater(result["body_scale"]["estimated_reach_cm"], 0)

    def test_member_calibration_persists_and_updates_reach(self):
        result = build_human_calibration(
            {
                "camera_config": [{"camera_id": "front", "view_angle": "front", "enabled": True}],
                "body_profile": {"height_cm": 180},
                "samples": [human_calibration_sample("front")],
            }
        )
        saved = self.store.save_member_calibration(self.member_profile, result)
        loaded = self.store.calibration_for_profile(self.member_profile.id)
        updated_profile = self.store.get_profile(self.member_profile.id)

        self.assertTrue(saved.completed)
        self.assertTrue(loaded.completed)
        self.assertEqual(loaded.status, "single_camera_2d")
        self.assertEqual(updated_profile.reach_cm, saved.estimated_reach_cm)

    def test_human_calibration_requires_multi_camera_samples(self):
        result = build_human_calibration(
            {
                "camera_config": [
                    {"camera_id": "front", "view_angle": "front", "enabled": True},
                    {"camera_id": "side", "view_angle": "side_90", "enabled": True},
                ],
                "samples": [],
            }
        )

        self.assertEqual(result["status"], "insufficient_samples")
        self.assertFalse(result["ready"])

    def test_member_calibration_coerces_malformed_optional_values(self):
        saved = self.store.save_member_calibration(
            self.member_profile,
            {
                "ready": True,
                "status": "calibrated",
                "cameras": "not-a-list",
                "sample_count": "not-a-number",
                "completed_at": "not-a-number",
                "body_scale": {"estimated_reach_cm": "not-a-number"},
            },
        )

        self.assertEqual(saved.camera_config, [])
        self.assertEqual(saved.sample_count, 0)
        self.assertEqual(saved.estimated_reach_cm, 0)
        self.assertGreater(saved.completed_at, 0)

    def test_median_value_returns_zero_when_no_positive_values(self):
        self.assertEqual(median_value([0, -1, 0]), 0.0)


def human_calibration_sample(camera_id: str) -> dict:
    points = {
        "nose": (0.50, 0.08),
        "left_shoulder": (0.38, 0.24),
        "right_shoulder": (0.62, 0.24),
        "left_elbow": (0.28, 0.42),
        "right_elbow": (0.72, 0.42),
        "left_wrist": (0.20, 0.60),
        "right_wrist": (0.80, 0.60),
        "left_hip": (0.43, 0.52),
        "right_hip": (0.57, 0.52),
        "left_knee": (0.43, 0.74),
        "right_knee": (0.57, 0.74),
        "left_ankle": (0.43, 0.92),
        "right_ankle": (0.57, 0.92),
    }
    return {
        "sample_id": "sample_1",
        "observations": [
            {
                "camera_id": camera_id,
                "keypoints": [
                    {"name": name, "x": x, "y": y, "score": 0.95}
                    for name, (x, y) in points.items()
                ],
            }
        ],
    }


if __name__ == "__main__":
    unittest.main()
