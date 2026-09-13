import os
import unittest
from unittest.mock import patch

from backend.central_gateway import (
    CentralGatewayConfig,
    CentralGatewayError,
    SupabaseGateway,
    map_session,
)


class FakeGateway(SupabaseGateway):
    def __init__(self, responses):
        super().__init__(CentralGatewayConfig("https://project.supabase.co", "publishable"))
        self.responses = list(responses)
        self.calls = []

    def _request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        return self.responses.pop(0)


class CentralGatewayTests(unittest.TestCase):
    def test_local_mode_does_not_require_supabase_configuration(self):
        with patch.dict(os.environ, {"BOXING_COACH_DATA_MODE": "local"}, clear=True):
            self.assertIsNone(CentralGatewayConfig.from_environment())

    def test_supabase_mode_fails_closed_without_credentials(self):
        with patch.dict(os.environ, {"BOXING_COACH_DATA_MODE": "supabase"}, clear=True):
            with self.assertRaises(RuntimeError):
                CentralGatewayConfig.from_environment()

    def test_local_ai_routes_stay_on_the_desktop_worker(self):
        self.assertFalse(SupabaseGateway.handles("POST", "/api/pose/3d"))
        self.assertFalse(SupabaseGateway.handles("POST", "/api/calibration/human"))
        self.assertTrue(SupabaseGateway.handles("GET", "/api/members"))
        self.assertTrue(SupabaseGateway.handles("GET", "/api/features"))
        self.assertTrue(SupabaseGateway.handles("GET", "/api/admin/centers"))

    def test_public_center_owner_signup_is_rejected_in_central_mode(self):
        gateway = FakeGateway([])

        with self.assertRaises(CentralGatewayError) as context:
            gateway.signup(
                {
                    "username": "owner2",
                    "password": "Owner!123",
                    "password_confirm": "Owner!123",
                    "role": "OWNER",
                }
            )

        self.assertEqual(context.exception.status, 403)
        self.assertEqual(gateway.calls, [])

    def test_login_uses_synthetic_email_and_returns_central_role(self):
        gateway = FakeGateway(
            [
                {"access_token": "access", "refresh_token": "refresh", "expires_in": 3600},
                {"id": "user-id"},
                [
                    {
                        "id": "user-id",
                        "center_id": "center-id",
                        "username": "owner1",
                        "contact_email": "owner@example.com",
                        "display_name": "Owner",
                        "role": "CENTER_OWNER",
                        "status": "ACTIVE",
                        "token_version": 1,
                        "centers": {"name": "Apex", "code": "apex"},
                    }
                ],
                [],
            ]
        )

        payload = gateway.login({"username": "owner1", "password": "Owner!123"})

        self.assertEqual(payload["user"]["role"], "CENTER_OWNER")
        self.assertEqual(payload["refresh_token"], "refresh")
        self.assertEqual(
            gateway.calls[0][2]["body"]["email"],
            "owner1@accounts.boxingcoach.app",
        )

    def test_suspended_account_is_rejected_by_missing_rls_row(self):
        gateway = FakeGateway([{"id": "user-id"}, []])
        with self.assertRaises(CentralGatewayError) as context:
            gateway.actor("access")
        self.assertEqual(context.exception.status, 403)

    def test_session_timestamp_and_report_match_existing_ui_contract(self):
        session = map_session(
            {
                "id": "session-id",
                "user_id": "user-id",
                "center_id": "center-id",
                "started_at": "2026-07-20T12:00:00+00:00",
                "ended_at": "2026-07-20T12:01:00+00:00",
                "feedback_report": {"summary": "good"},
            }
        )
        self.assertEqual(session["ended_at"] - session["started_at"], 60)
        self.assertEqual(session["feedback_report"], '{"summary": "good"}')

    def test_calibration_is_saved_through_guarded_rpc(self):
        gateway = FakeGateway(
            [
                [
                    {
                        "id": "calibration-id",
                        "profile_id": "profile-id",
                        "user_id": "user-id",
                        "center_id": "center-id",
                        "status": "calibrated",
                        "completed": True,
                        "completed_at": "2026-07-20T12:00:00+00:00",
                        "sample_count": 10,
                        "estimated_reach_cm": 178,
                        "camera_config": [],
                        "body_scale": {},
                        "calibration": {},
                    }
                ],
                [
                    {
                        "id": "profile-id",
                        "user_id": "user-id",
                        "center_id": "center-id",
                        "name": "Member",
                        "accounts": {"username": "member1", "role": "MEMBER", "status": "ACTIVE"},
                    }
                ],
            ]
        )

        payload = gateway.save_calibration(
            "access", "profile-id", {"ready": True, "status": "calibrated"}
        )

        self.assertEqual(payload["calibration"]["estimated_reach_cm"], 178)
        self.assertEqual(gateway.calls[0][1], "/rest/v1/rpc/save_member_calibration")

    def test_platform_center_overview_uses_guarded_rpc(self):
        gateway = FakeGateway(
            [
                [
                    {
                        "id": "center-id",
                        "name": "Apex",
                        "code": "apex",
                        "center_status": "ACTIVE",
                        "subscription_status": "TRIAL",
                        "plan_code": "starter",
                        "member_count": 12,
                        "coach_count": 2,
                        "owner_count": 1,
                        "last_login_at": "2026-08-09T01:02:03Z",
                    }
                ]
            ]
        )

        centers = gateway.centers("access")

        self.assertEqual(centers[0]["status"], "ACTIVE")
        self.assertEqual(centers[0]["member_count"], 12)
        self.assertEqual(centers[0]["last_login_at"], "2026-08-09T01:02:03Z")
        self.assertEqual(gateway.calls[0][1], "/rest/v1/rpc/platform_center_overview")
        self.assertEqual(gateway.calls[0][2]["token"], "access")

    def test_platform_center_create_uses_public_client_token(self):
        gateway = FakeGateway(
            [[{"id": "center-id", "name": "Apex", "code": "apex", "status": "ACTIVE"}]]
        )

        result = gateway.create_center(
            "access",
            {
                "name": "Apex",
                "code": "APEX",
                "plan_code": "PRO",
                "subscription_status": "ACTIVE",
            },
        )

        self.assertEqual(result["center"]["code"], "apex")
        request = gateway.calls[0]
        self.assertEqual(request[1], "/rest/v1/rpc/platform_create_center")
        self.assertEqual(request[2]["token"], "access")
        self.assertEqual(request[2]["body"]["p_plan_code"], "pro")

    def test_feature_flag_update_uses_platform_rpc(self):
        gateway = FakeGateway(
            [[{"center_id": "center-id", "flag_key": "web.beta", "enabled": True}]]
        )

        result = gateway.set_feature_flag(
            "access",
            "center-id",
            "web.beta",
            {"enabled": True, "rollout_channel": "beta"},
        )

        self.assertTrue(result["feature_flag"]["enabled"])
        request = gateway.calls[0]
        self.assertEqual(request[1], "/rest/v1/rpc/platform_set_feature_flag")
        self.assertEqual(request[2]["body"]["p_rollout_channel"], "BETA")


if __name__ == "__main__":
    unittest.main()
