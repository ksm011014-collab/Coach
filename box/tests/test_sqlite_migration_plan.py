import unittest

from tools.plan_sqlite_migration import build_migration_plan


class SqliteMigrationPlanTests(unittest.TestCase):
    def valid_bundle(self):
        return {
            "format": "boxing-coach-sqlite-export",
            "version": 1,
            "source": "boxing_coach.db",
            "password_migration": "reset_required",
            "tables": {
                "gyms": [{"id": "gym-1", "name": "Apex", "code": "apex"}],
                "users": [
                    {
                        "id": "user-1",
                        "gym_id": "gym-1",
                        "username": "member1",
                        "password_reset_required": True,
                    }
                ],
                "member_profiles": [
                    {"id": "profile-1", "user_id": "user-1", "gym_id": "gym-1"}
                ],
                "member_calibrations": [
                    {
                        "id": "calibration-1",
                        "profile_id": "profile-1",
                        "user_id": "user-1",
                        "gym_id": "gym-1",
                    }
                ],
                "training_sessions": [
                    {"id": "session-1", "user_id": "user-1", "gym_id": "gym-1"}
                ],
                "coach_labels": [
                    {"id": "label-1", "session_id": "session-1", "owner_id": "user-1"}
                ],
            },
        }

    def test_valid_bundle_creates_mapping_templates(self):
        plan = build_migration_plan(self.valid_bundle())
        self.assertTrue(plan["valid"])
        self.assertEqual(plan["counts"]["training_sessions"], 1)
        self.assertEqual(plan["center_mappings"][0]["member_profiles"], 1)
        self.assertIsNone(plan["account_mappings"][0]["supabase_auth_id"])

    def test_password_hash_and_broken_tenant_reference_fail_validation(self):
        bundle = self.valid_bundle()
        bundle["tables"]["users"][0]["password_hash"] = "secret"
        bundle["tables"]["training_sessions"][0]["gym_id"] = "missing-center"
        plan = build_migration_plan(bundle)
        self.assertFalse(plan["valid"])
        self.assertTrue(any("password hash" in error for error in plan["errors"]))
        self.assertTrue(any("missing gyms" in error for error in plan["errors"]))

    def test_duplicate_username_fails_validation(self):
        bundle = self.valid_bundle()
        duplicate = dict(bundle["tables"]["users"][0])
        duplicate["id"] = "user-2"
        bundle["tables"]["users"].append(duplicate)
        plan = build_migration_plan(bundle)
        self.assertFalse(plan["valid"])
        self.assertTrue(any("duplicate usernames" in error for error in plan["errors"]))


if __name__ == "__main__":
    unittest.main()
