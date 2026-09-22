import os
import io
import json
import unittest
from urllib.error import HTTPError
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
    def test_motion_round_uses_guarded_rpc(self):
        report = {"version": 1, "events": [], "status": "unavailable"}
        gateway = FakeGateway([[{"id": "session-id", "user_id": "member", "center_id": "center", "feedback_report": report}]])
        gateway.end_session("access", "session-id", {"motion_report": report})
        self.assertEqual(gateway.calls[0][1], "/rest/v1/rpc/finish_motion_round")
        self.assertEqual(gateway.calls[0][2]["body"], {"p_session_id": "session-id", "p_report": report})
        self.assertEqual(gateway.calls[0][2]["token"], "access")

    def test_rpc_missing_row_maps_to_not_found_without_hiding_server_failures(self):
        gateway = SupabaseGateway(CentralGatewayConfig("https://project.supabase.co", "publishable"))
        for code, expected in (("P0002", 404), ("XX000", 500)):
            with self.subTest(code=code):
                error = HTTPError("https://project.supabase.co/rest/v1/rpc/operations_mutate", 500, "Error", {}, io.BytesIO(json.dumps({'code': code, 'message': 'member not found'}).encode()))
                with patch('backend.central_gateway.urlopen', side_effect=error):
                    with self.assertRaises(CentralGatewayError) as caught:
                        gateway.operations_mutate('access', {'operation': 'member.update', 'input': {'id': 'foreign-member'}, 'request_id': 'test'})
                self.assertEqual(caught.exception.status, expected)
                if expected == 404:
                    self.assertEqual(str(caught.exception), '요청한 정보를 찾을 수 없습니다.')

    def test_operations_rpc_route_and_occurrence_month_summary(self):
        gateway = FakeGateway([{'referenceDate': '2026-01-15', 'members': [{'id': 'member', 'joined_on': '2025-01-01'}],
            'products': [], 'passes': [], 'attendance': [], 'notes': [],
            'payments': [{'paid_on': '2025-12-01', 'amount': 100, 'adjustments': [{'action': 'REFUND', 'on': '2026-01-01', 'amount': 20}]}]}])
        payload, status = gateway.route('GET', '/api/operations', None, 'date=2026-01-14', 'Bearer access')
        self.assertEqual(status, 200)
        self.assertEqual(payload['roster']['absent'], 1)
        self.assertEqual(payload['revenue'][-1]['net'], -20)
        self.assertEqual(gateway.calls[0][1], '/rest/v1/rpc/operations_snapshot')
        self.assertEqual(gateway.calls[0][2]['token'], 'access')
        gateway = FakeGateway([{'id': 'product'}])
        payload, status = gateway.route('POST', '/api/operations', {'operation': 'product.save', 'input': {'name': 'Product'}, 'request_id': 'stable'}, '', 'Bearer access')
        self.assertEqual(payload['result']['id'], 'product')
        self.assertEqual(gateway.calls[0][2]['body']['p_request_id'], 'stable')
        self.assertTrue(SupabaseGateway.handles('POST', '/api/operations'))
        gateway = FakeGateway([{'result': {'id': 'registered-member'}}])
        result = gateway.operations_mutate('access', {'operation': 'member.create', 'input': {'name': 'Synthetic'}, 'request_id': 'registration-key'})
        self.assertEqual(result['result']['id'], 'registered-member')
        self.assertEqual(gateway.calls[0][1], '/functions/v1/register-member')
        self.assertEqual(gateway.calls[0][2]['body']['request_id'], 'registration-key')

    def test_missing_resource_ids_return_not_found_without_remote_calls(self):
        gateway = FakeGateway([])
        for path in ("/api/members/", "/api/sessions/", "/api/sessions//end"):
            with self.assertRaises(CentralGatewayError) as caught:
                gateway.route("GET", path, {}, "", "Bearer access")
            self.assertEqual(caught.exception.status, 404)
        self.assertEqual(gateway.calls, [])

    def test_logout_revokes_refresh_sessions_then_access_tokens(self):
        gateway = FakeGateway([None, None])
        self.assertEqual(gateway.logout("access"), {"logged_out": True})
        self.assertEqual([call[1] for call in gateway.calls], ["/auth/v1/logout", "/rest/v1/rpc/revoke_own_access_tokens"])
        self.assertEqual(gateway.calls[0][2]["query"], {"scope": "global"})
        self.assertTrue(all(call[2]["token"] == "access" for call in gateway.calls))

    def test_local_mode_does_not_require_supabase_configuration(self):
        with patch.dict(os.environ, {"BOXING_COACH_DATA_MODE": "local"}, clear=True):
            self.assertIsNone(CentralGatewayConfig.from_environment())

    def test_supabase_mode_fails_closed_without_credentials(self):
        with patch.dict(os.environ, {"BOXING_COACH_DATA_MODE": "supabase"}, clear=True):
            with self.assertRaises(RuntimeError):
                CentralGatewayConfig.from_environment()

    def test_retired_analysis_routes_are_not_handled(self):
        self.assertFalse(SupabaseGateway.handles("POST", "/api/pose/3d"))
        self.assertFalse(SupabaseGateway.handles("POST", "/api/calibration/human"))
        self.assertTrue(SupabaseGateway.handles("GET", "/api/members"))
        self.assertTrue(SupabaseGateway.handles("GET", "/api/features"))
        self.assertTrue(SupabaseGateway.handles("GET", "/api/admin/centers"))

    def test_session_end_uses_idempotent_rpc_and_ignores_analysis(self):
        gateway = FakeGateway([[{"id": "session-id", "user_id": "user-id", "center_id": "center-id", "feedback_report": {"summary": "legacy"}, "overall_score": 82}]])
        gateway.end_session("access", "session-id", {"overall_score": 99, "feedback_report": "new feedback"})
        self.assertEqual(gateway.calls[0][1], "/rest/v1/rpc/end_training_session")
        self.assertEqual(gateway.calls[0][2]["body"], {"p_session_id": "session-id"})

    def test_session_start_passes_stable_request_key_to_rls_rpc(self):
        gateway = FakeGateway([[{"id": "session-id", "user_id": "user-id", "center_id": "center-id"}]])
        with patch.object(gateway, "_account_for_token", return_value={"id": "user-id"}):
            result = gateway.create_session("access", {"request_id": "stable-key", "camera_config": [], "overall_score": 99})
        self.assertEqual(result["session"]["id"], "session-id")
        self.assertEqual(gateway.calls[0][1], "/rest/v1/rpc/start_training_session")
        self.assertEqual(gateway.calls[0][2]["body"], {
            "p_user_id": "user-id", "p_camera_config": [{"camera_id": "cam_front_01", "label": "", "view_angle": "front", "device_id": "", "enabled": True}],
            "p_focus": "free_training", "p_request_id": "stable-key",
        })

    def test_session_request_validation_does_not_send_invalid_writes(self):
        for body in ({"request_id": []}, {"request_id": ""}, {"focus": 123}):
            gateway = FakeGateway([])
            with patch.object(gateway, "_account_for_token", return_value={"id": "user-id"}):
                with self.assertRaises(CentralGatewayError) as context:
                    gateway.create_session("access", body)
            self.assertEqual(context.exception.status, 400)
            self.assertEqual(gateway.calls, [])

    def test_member_calibration_route_is_removed(self):
        gateway = FakeGateway([])
        for method in ("GET", "POST"):
            with self.assertRaises(CentralGatewayError) as context:
                gateway._route_member(method, "/api/members/profile-id/calibration", {}, "access")
            self.assertEqual(context.exception.status, 404)
        self.assertEqual(gateway.calls, [])

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
