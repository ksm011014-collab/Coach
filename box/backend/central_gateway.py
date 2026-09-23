from __future__ import annotations

try:
    from camera import normalize_camera_config
    from profile_input import validate_profile_patch
    from operations_summary import attendance_roster, revenue_months
except ModuleNotFoundError:
    from backend.camera import normalize_camera_config
    from backend.profile_input import validate_profile_patch
    from backend.operations_summary import attendance_roster, revenue_months

import datetime as dt
import json
import os
import re
from dataclasses import dataclass
from http import HTTPStatus
from types import SimpleNamespace
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, parse_qs
from urllib.request import Request, urlopen


class CentralGatewayError(Exception):
    def __init__(self, message: str, status: HTTPStatus, detail: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.detail = detail


@dataclass(frozen=True)
class CentralGatewayConfig:
    url: str
    publishable_key: str
    auth_email_domain: str = "accounts.boxingcoach.app"

    @classmethod
    def from_environment(cls) -> CentralGatewayConfig | None:
        mode = os.environ.get("BOXING_COACH_DATA_MODE", "local").strip().lower()
        if mode != "supabase":
            return None
        url = os.environ.get("BOXING_COACH_SUPABASE_URL", "").strip().rstrip("/")
        key = os.environ.get("BOXING_COACH_SUPABASE_PUBLISHABLE_KEY", "").strip()
        if not url or not key:
            raise RuntimeError(
                "Supabase mode requires BOXING_COACH_SUPABASE_URL and "
                "BOXING_COACH_SUPABASE_PUBLISHABLE_KEY"
            )
        return cls(
            url=url,
            publishable_key=key,
            auth_email_domain=os.environ.get(
                "BOXING_COACH_AUTH_EMAIL_DOMAIN", "accounts.boxingcoach.app"
            ).strip(),
        )


class SupabaseGateway:
    def __init__(self, config: CentralGatewayConfig) -> None:
        self.config = config

    @classmethod
    def from_environment(cls) -> SupabaseGateway | None:
        config = CentralGatewayConfig.from_environment()
        return cls(config) if config else None

    @staticmethod
    def handles(method: str, path: str) -> bool:
        if path in {
            "/api/system/health",
            "/api/recordings/convert",
        }:
            return False
        return path.startswith(
            (
                "/api/auth/",
                "/api/me",
                "/api/members",
                "/api/sessions",
                "/api/features",
                "/api/admin/",
                "/api/operations",
                "/api/coach/",
            )
        )

    def route(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None,
        query: str,
        authorization: str,
    ) -> tuple[dict[str, Any], HTTPStatus]:
        token = self._bearer_token(authorization, required=False)
        body = body or {}
        if path.startswith("/api/coach/"):
            token = self._required_token(token)
            if method == "GET" and path == "/api/coach/models":
                return self._request("POST", "/functions/v1/coach-chat", token=token, body={"action": "config"}), HTTPStatus.OK
            if method == "GET" and path == "/api/coach/usage":
                return self._request("POST", "/rest/v1/rpc/coach_usage", token=token, body={}), HTTPStatus.OK
            if method == "POST" and path == "/api/coach/reply":
                return self._request("POST", "/functions/v1/coach-chat", token=token, body={**body, "action": "reply"}), HTTPStatus.OK
            raise CentralGatewayError("요청한 중앙 API를 찾을 수 없습니다.", HTTPStatus.NOT_FOUND)
        if method == "POST" and path == "/api/auth/login":
            return self.login(body), HTTPStatus.OK
        if method == "POST" and path == "/api/auth/refresh":
            return self.refresh(body), HTTPStatus.OK
        if method == "POST" and path == "/api/auth/logout":
            return self.logout(self._required_token(token)), HTTPStatus.OK
        if method == "POST" and path == "/api/auth/signup":
            return self.signup(body), HTTPStatus.CREATED
        if method == "GET" and path == "/api/auth/check-username":
            return self.check_username(query), HTTPStatus.OK
        if method == "GET" and path == "/api/me":
            return self.me(self._required_token(token)), HTTPStatus.OK
        if path == "/api/operations" and method == "GET":
            return self.operations_snapshot(self._required_token(token), query), HTTPStatus.OK
        if path == "/api/operations" and method == "POST":
            return self.operations_mutate(self._required_token(token), body), HTTPStatus.OK
        if method == "GET" and path == "/api/members":
            return {"members": self.members(self._required_token(token))}, HTTPStatus.OK
        if method == "POST" and path == "/api/members":
            return self.create_member(self._required_token(token), body), HTTPStatus.CREATED
        if path.startswith("/api/members/"):
            return self._route_member(method, path, body, self._required_token(token))
        if method == "GET" and path == "/api/sessions":
            return {"sessions": self.sessions(self._required_token(token))}, HTTPStatus.OK
        if method == "POST" and path == "/api/sessions":
            return self.create_session(self._required_token(token), body), HTTPStatus.CREATED
        if path.startswith("/api/sessions/"):
            return self._route_session(method, path, body, self._required_token(token))
        if method == "GET" and path == "/api/features":
            return {
                "feature_flags": self.feature_flags(self._required_token(token), query)
            }, HTTPStatus.OK
        if path.startswith("/api/admin/centers"):
            return self._route_center_admin(
                method, path, body, query, self._required_token(token)
            )
        if method == "GET" and path == "/api/admin/audit-logs":
            return {
                "audit_logs": self.audit_logs(self._required_token(token), query)
            }, HTTPStatus.OK
        if method == "GET" and path == "/api/admin/accounts":
            return {"accounts": self.accounts(self._required_token(token))}, HTTPStatus.OK
        if method == "POST" and path == "/api/admin/accounts":
            return self.create_account(self._required_token(token), body), HTTPStatus.CREATED
        if method == "PATCH" and path.startswith("/api/admin/accounts/"):
            account_id = path.rsplit("/", 1)[-1]
            return self.update_account(self._required_token(token), account_id, body), HTTPStatus.OK
        raise CentralGatewayError("요청한 중앙 API를 찾을 수 없습니다.", HTTPStatus.NOT_FOUND)

    def login(self, body: dict[str, Any]) -> dict[str, Any]:
        username = normalize_username(body.get("username") or body.get("email"))
        password = str(body.get("password") or "")
        auth = self._request(
            "POST",
            "/auth/v1/token",
            query={"grant_type": "password"},
            body={"email": self._login_email(username), "password": password},
        )
        return self._session_payload(auth)

    def refresh(self, body: dict[str, Any]) -> dict[str, Any]:
        refresh_token = str(body.get("refresh_token") or "")
        if not refresh_token:
            raise CentralGatewayError("로그인 갱신 정보가 없습니다.", HTTPStatus.UNAUTHORIZED)
        auth = self._request(
            "POST",
            "/auth/v1/token",
            query={"grant_type": "refresh_token"},
            body={"refresh_token": refresh_token},
        )
        return self._session_payload(auth)

    def signup(self, body: dict[str, Any]) -> dict[str, Any]:
        username = normalize_username(body.get("username"))
        password = str(body.get("password") or "")
        password_confirm = str(body.get("password_confirm") or "")
        if password != password_confirm:
            raise CentralGatewayError("비밀번호 확인이 일치하지 않습니다.", HTTPStatus.BAD_REQUEST)
        validate_account_input(username, password)
        role = str(body.get("role") or "MEMBER").upper()
        if role == "OWNER":
            role = "CENTER_OWNER"
        if role == "CENTER_OWNER":
            raise CentralGatewayError(
                "센터 관리자 계정은 플랫폼 관리자가 중앙 관제에서 생성해야 합니다.",
                HTTPStatus.FORBIDDEN,
            )
        if role != "MEMBER":
            raise CentralGatewayError("가입할 수 없는 계정 역할입니다.", HTTPStatus.BAD_REQUEST)
        auth = self._request(
            "POST",
            "/auth/v1/signup",
            body={
                "email": self._login_email(username),
                "password": password,
                "data": {
                    "username": username,
                    "role": role,
                    "name": str(body.get("name") or username).strip(),
                    "contact_email": str(body.get("email") or "").strip(),
                    "phone": str(body.get("phone") or "").strip(),
                    "center_name": str(body.get("center_name") or "").strip(),
                    "center_code": str(body.get("center_code") or "").strip().lower(),
                },
            },
        )
        if not auth.get("access_token"):
            raise CentralGatewayError(
                "계정은 생성되었지만 즉시 로그인할 수 없습니다. Supabase 이메일 확인 설정을 점검하세요.",
                HTTPStatus.CONFLICT,
            )
        return self._session_payload(auth)

    def check_username(self, raw_query: str) -> dict[str, Any]:
        values = parse_query(raw_query)
        username = normalize_username(values.get("username"))
        result = self._request(
            "POST", "/rest/v1/rpc/is_username_available", body={"p_username": username}
        )
        return {"username": username, "available": bool(result)}

    def me(self, token: str) -> dict[str, Any]:
        account = self._account_for_token(token)
        profiles = self._request(
            "GET",
            "/rest/v1/member_profiles",
            token=token,
            query={"select": "*", "user_id": f"eq.{account['id']}", "limit": "1"},
        )
        profile = map_profile(profiles[0]) if profiles else None
        return {"user": map_account(account), "profile": profile}

    def actor(self, token: str) -> SimpleNamespace:
        account = self._account_for_token(token)
        return SimpleNamespace(
            id=account["id"],
            gym_id=account.get("center_id") or "",
            role=account["role"],
            name=account["display_name"],
            username=account["username"],
            email=account.get("contact_email") or "",
        )

    def members(self, token: str) -> list[dict[str, Any]]:
        rows = self._request(
            "GET",
            "/rest/v1/member_profiles",
            token=token,
            query={
                "select": "*,accounts!member_profiles_user_id_fkey(username,contact_email,role,status)",
                "order": "name.asc",
            },
        )
        return [map_profile(row) for row in rows]

    def operations_snapshot(self, token: str, query: str = "") -> dict[str, Any]:
        result = self._request("POST", "/rest/v1/rpc/operations_snapshot", token=token, body={})
        if not isinstance(result, dict) or not all(isinstance(result.get(key), list) for key in ('members', 'products', 'passes', 'attendance', 'payments', 'notes')):
            raise CentralGatewayError("업무 조회 응답이 올바르지 않습니다.", HTTPStatus.BAD_GATEWAY)
        today = result['referenceDate']
        selected = parse_qs(query).get('date', [today])[0]
        result['selectedDate'] = selected
        result['roster'] = attendance_roster(result['members'], result['attendance'], selected, today)
        result['revenue'] = revenue_months(result['payments'], today)
        return result

    def operations_mutate(self, token: str, body: dict[str, Any]) -> dict[str, Any]:
        operation, values, request_id = body.get('operation'), body.get('input'), body.get('request_id')
        if not isinstance(operation, str) or not isinstance(values, dict) or not isinstance(request_id, str) or not 1 <= len(request_id.strip()) <= 128:
            raise CentralGatewayError("업무 변경 요청 형식이 올바르지 않습니다.", HTTPStatus.BAD_REQUEST)
        if operation == 'member.create':
            return self._request("POST", "/functions/v1/register-member", token=token, body={'input': values, 'request_id': request_id})
        result = self._request("POST", "/rest/v1/rpc/operations_mutate", token=token,
                               body={'p_operation': operation, 'p_input': values, 'p_request_id': request_id})
        return {'result': result}

    def create_member(self, token: str, body: dict[str, Any]) -> dict[str, Any]:
        password = str(body.get("password") or "")
        if password != str(body.get("password_confirm") or password):
            raise CentralGatewayError("비밀번호 확인이 일치하지 않습니다.", HTTPStatus.BAD_REQUEST)
        payload = dict(body)
        payload["role"] = "MEMBER"
        created = self._request(
            "POST", "/functions/v1/admin-create-user", token=token, body=payload
        )
        account = created["account"]
        profiles = self._request(
            "GET",
            "/rest/v1/member_profiles",
            token=token,
            query={"select": "*", "user_id": f"eq.{account['id']}", "limit": "1"},
        )
        if not profiles:
            raise CentralGatewayError("생성한 회원 프로필을 찾을 수 없습니다.", HTTPStatus.BAD_GATEWAY)
        member = map_profile({**profiles[0], "accounts": account})
        if any(key in body for key in ("phone", "birthdate", "gender", "training_level")):
            member = self.update_member(token, str(member["id"]), body)["member"]
        return {"member": member}

    def member(self, token: str, profile_id: str) -> dict[str, Any]:
        rows = self._request(
            "GET",
            "/rest/v1/member_profiles",
            token=token,
            query={
                "select": "*,accounts!member_profiles_user_id_fkey(username,contact_email,role,status)",
                "id": f"eq.{profile_id}",
                "limit": "1",
            },
        )
        if not rows:
            raise CentralGatewayError("회원 정보를 찾을 수 없습니다.", HTTPStatus.NOT_FOUND)
        return map_profile(rows[0])

    def update_member(self, token: str, profile_id: str, body: dict[str, Any]) -> dict[str, Any]:
        values = validate_profile_patch(body)
        if "birthdate" in values and not values["birthdate"]:
            values["birthdate"] = None
        rows = self._request(
            "POST",
            "/rest/v1/rpc/update_member_profile",
            token=token,
            body={"p_profile_id": profile_id, "p_patch": values},
        )
        if not rows:
            raise CentralGatewayError("회원 정보를 변경할 권한이 없습니다.", HTTPStatus.FORBIDDEN)
        return {"member": self.member(token, profile_id)}


    def sessions(self, token: str) -> list[dict[str, Any]]:
        rows = self._request(
            "GET",
            "/rest/v1/training_sessions",
            token=token,
            query={"select": "*", "order": "started_at.desc"},
        )
        return [map_session(row) for row in rows]

    def create_session(self, token: str, body: dict[str, Any]) -> dict[str, Any]:
        actor = self._account_for_token(token)
        target_user_id = str(body.get("user_id") or actor["id"])
        request_id = body.get("request_id")
        focus = body.get("focus", "free_training")
        if request_id is not None and (not isinstance(request_id, str) or not 1 <= len(request_id) <= 128):
            raise CentralGatewayError("invalid request_id", HTTPStatus.BAD_REQUEST)
        if not isinstance(focus, str) or not 1 <= len(focus) <= 100:
            raise CentralGatewayError("invalid focus", HTTPStatus.BAD_REQUEST)
        rows = self._request(
            "POST",
            "/rest/v1/rpc/start_training_session",
            token=token,
            body={
                "p_user_id": target_user_id,
                "p_camera_config": normalize_camera_config(body.get("camera_config")),
                "p_focus": focus,
                "p_request_id": request_id,
            },
        )
        return {"session": map_session(rows[0])}

    def session(self, token: str, session_id: str) -> dict[str, Any]:
        rows = self._request(
            "GET", "/rest/v1/training_sessions", token=token,
            query={"select": "*", "id": f"eq.{session_id}", "limit": "1"},
        )
        if not rows:
            raise CentralGatewayError("운동 기록을 찾을 수 없습니다.", HTTPStatus.NOT_FOUND)
        labels = self._request(
            "GET", "/rest/v1/coach_labels", token=token,
            query={"select": "*", "session_id": f"eq.{session_id}", "order": "created_at.desc"},
        )
        return {"session": map_session(rows[0]), "labels": [map_label(row) for row in labels]}

    def end_session(self, token: str, session_id: str, body: dict[str, Any]) -> dict[str, Any]:
        motion = 'motion_report' in body
        rows = self._request(
            "POST", "/rest/v1/rpc/finish_motion_round" if motion else "/rest/v1/rpc/end_training_session", token=token,
            body={"p_session_id": session_id, "p_report": body['motion_report']} if motion else {"p_session_id": session_id},
        )
        if not rows:
            raise CentralGatewayError("운동 기록을 종료할 권한이 없습니다.", HTTPStatus.FORBIDDEN)
        return {"session": map_session(rows[0])}

    def delete_session(self, token: str, session_id: str) -> dict[str, Any]:
        self._request(
            "DELETE", "/rest/v1/training_sessions", token=token,
            query={"id": f"eq.{session_id}"}, prefer="return=minimal",
        )
        return {"deleted": True, "session_id": session_id}

    def create_label(self, token: str, session_id: str, body: dict[str, Any]) -> dict[str, Any]:
        actor = self._account_for_token(token)
        session_payload = self.session(token, session_id)["session"]
        rows = self._request(
            "POST", "/rest/v1/coach_labels", token=token, prefer="return=representation",
            body={
                "session_id": session_id,
                "owner_id": actor["id"],
                "center_id": session_payload["gym_id"],
                "label": str(body.get("label") or "needs_fix"),
                "comment": str(body.get("comment") or ""),
                "use_for_training": bool(body.get("use_for_training", True)),
            },
        )
        return {"label": map_label(rows[0])}

    def accounts(self, token: str) -> list[dict[str, Any]]:
        rows = self._request(
            "GET", "/rest/v1/accounts", token=token,
            query={"select": "*,centers!accounts_center_id_fkey(name,code)", "order": "created_at.desc"},
        )
        return [map_account(row) for row in rows]

    def create_account(self, token: str, body: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/functions/v1/admin-create-user", token=token, body=body)

    def update_account(
        self, token: str, account_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        rows = self._request(
            "POST", "/rest/v1/rpc/admin_update_account", token=token,
            body={
                "p_target_id": account_id,
                "p_role": body.get("role"),
                "p_status": body.get("status"),
            },
        )
        if not rows:
            raise CentralGatewayError("계정 권한을 변경하지 못했습니다.", HTTPStatus.BAD_GATEWAY)
        return {"account": map_account(rows[0])}

    def centers(self, token: str) -> list[dict[str, Any]]:
        rows = self._request(
            "POST",
            "/rest/v1/rpc/platform_center_overview",
            token=token,
            body={},
        )
        return [map_center_overview(row) for row in rows]

    def create_center(self, token: str, body: dict[str, Any]) -> dict[str, Any]:
        rows = self._request(
            "POST",
            "/rest/v1/rpc/platform_create_center",
            token=token,
            body={
                "p_name": str(body.get("name") or "").strip(),
                "p_code": str(body.get("code") or "").strip().lower(),
                "p_plan_code": str(body.get("plan_code") or "starter").strip().lower(),
                "p_subscription_status": str(
                    body.get("subscription_status") or "TRIAL"
                ).upper(),
                "p_starts_at": body.get("starts_at") or utc_today_iso(),
                "p_ends_at": body.get("ends_at") or None,
            },
        )
        if not rows:
            raise CentralGatewayError("센터를 생성하지 못했습니다.", HTTPStatus.BAD_GATEWAY)
        return {"center": map_center(rows[0])}

    def update_center(
        self, token: str, center_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        allowed = {"name", "code", "status"}
        patch = {key: value for key, value in body.items() if key in allowed}
        rows = self._request(
            "POST",
            "/rest/v1/rpc/platform_update_center",
            token=token,
            body={"p_center_id": center_id, "p_patch": patch},
        )
        if not rows:
            raise CentralGatewayError("센터를 변경하지 못했습니다.", HTTPStatus.BAD_GATEWAY)
        return {"center": map_center(rows[0])}

    def update_subscription(
        self, token: str, center_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        allowed = {"plan_code", "status", "starts_at", "ends_at", "max_members"}
        patch = {key: value for key, value in body.items() if key in allowed}
        rows = self._request(
            "POST",
            "/rest/v1/rpc/platform_update_subscription",
            token=token,
            body={"p_center_id": center_id, "p_patch": patch},
        )
        if not rows:
            raise CentralGatewayError("계약 정보를 변경하지 못했습니다.", HTTPStatus.BAD_GATEWAY)
        return {"subscription": map_subscription(rows[0])}

    def feature_flags(self, token: str, raw_query: str = "") -> list[dict[str, Any]]:
        values = parse_query(raw_query)
        query = {"select": "*", "order": "flag_key.asc"}
        center_id = str(values.get("center_id") or "").strip()
        if center_id:
            query["center_id"] = f"eq.{center_id}"
        rows = self._request(
            "GET", "/rest/v1/feature_flags", token=token, query=query
        )
        return [map_feature_flag(row) for row in rows]

    def set_feature_flag(
        self, token: str, center_id: str, flag_key: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        rows = self._request(
            "POST",
            "/rest/v1/rpc/platform_set_feature_flag",
            token=token,
            body={
                "p_center_id": center_id,
                "p_flag_key": flag_key,
                "p_enabled": bool(body.get("enabled")),
                "p_config": body.get("config")
                if isinstance(body.get("config"), dict)
                else {},
                "p_rollout_channel": str(
                    body.get("rollout_channel") or "STABLE"
                ).upper(),
            },
        )
        if not rows:
            raise CentralGatewayError("기능 설정을 변경하지 못했습니다.", HTTPStatus.BAD_GATEWAY)
        return {"feature_flag": map_feature_flag(rows[0])}

    def audit_logs(self, token: str, raw_query: str = "") -> list[dict[str, Any]]:
        values = parse_query(raw_query)
        query = {
            "select": "*",
            "order": "created_at.desc",
            "limit": str(max(1, min(200, safe_int(values.get("limit"), 100)))),
        }
        center_id = str(values.get("center_id") or "").strip()
        if center_id:
            query["center_id"] = f"eq.{center_id}"
        rows = self._request("GET", "/rest/v1/audit_logs", token=token, query=query)
        return [map_audit_log(row) for row in rows]

    def _route_center_admin(
        self,
        method: str,
        path: str,
        body: dict[str, Any],
        query: str,
        token: str,
    ) -> tuple[dict[str, Any], HTTPStatus]:
        parts = path.strip("/").split("/")
        if len(parts) == 3:
            if method == "GET":
                return {"centers": self.centers(token)}, HTTPStatus.OK
            if method == "POST":
                return self.create_center(token, body), HTTPStatus.CREATED
        if len(parts) < 4:
            raise CentralGatewayError("센터 관리 API를 찾을 수 없습니다.", HTTPStatus.NOT_FOUND)
        center_id = parts[3]
        if len(parts) == 4 and method == "PATCH":
            return self.update_center(token, center_id, body), HTTPStatus.OK
        if len(parts) == 5 and parts[4] == "subscription" and method == "PATCH":
            return self.update_subscription(token, center_id, body), HTTPStatus.OK
        if (
            len(parts) == 6
            and parts[4] == "features"
            and method in {"PUT", "PATCH"}
        ):
            return self.set_feature_flag(token, center_id, parts[5], body), HTTPStatus.OK
        if len(parts) == 5 and parts[4] == "features" and method == "GET":
            feature_query = urlencode({"center_id": center_id})
            return {"feature_flags": self.feature_flags(token, feature_query)}, HTTPStatus.OK
        raise CentralGatewayError("센터 관리 API를 찾을 수 없습니다.", HTTPStatus.NOT_FOUND)

    def _route_member(
        self, method: str, path: str, body: dict[str, Any], token: str
    ) -> tuple[dict[str, Any], HTTPStatus]:
        parts = path.strip("/").split("/")
        if len(parts) < 3 or not parts[2]:
            raise CentralGatewayError("회원 API를 찾을 수 없습니다.", HTTPStatus.NOT_FOUND)
        profile_id = parts[2]
        if len(parts) == 3 and method == "GET":
            return {"member": self.member(token, profile_id)}, HTTPStatus.OK
        if len(parts) == 3 and method == "PATCH":
            return self.update_member(token, profile_id, body), HTTPStatus.OK
        raise CentralGatewayError("회원 API를 찾을 수 없습니다.", HTTPStatus.NOT_FOUND)

    def _route_session(
        self, method: str, path: str, body: dict[str, Any], token: str
    ) -> tuple[dict[str, Any], HTTPStatus]:
        parts = path.strip("/").split("/")
        if len(parts) < 3 or not parts[2]:
            raise CentralGatewayError("운동 기록 API를 찾을 수 없습니다.", HTTPStatus.NOT_FOUND)
        session_id = parts[2]
        if len(parts) == 4 and parts[3] == "end" and method == "PATCH":
            return self.end_session(token, session_id, body), HTTPStatus.OK
        if len(parts) == 4 and parts[3] == "labels" and method == "POST":
            return self.create_label(token, session_id, body), HTTPStatus.CREATED
        if len(parts) == 3 and method == "GET":
            return self.session(token, session_id), HTTPStatus.OK
        if len(parts) == 3 and method == "DELETE":
            return self.delete_session(token, session_id), HTTPStatus.OK
        raise CentralGatewayError("운동 기록 API를 찾을 수 없습니다.", HTTPStatus.NOT_FOUND)

    def _session_payload(self, auth: dict[str, Any]) -> dict[str, Any]:
        token = str(auth.get("access_token") or "")
        if not token:
            raise CentralGatewayError("로그인에 실패했습니다.", HTTPStatus.UNAUTHORIZED)
        account_payload = self.me(token)
        return {
            "token": token,
            "refresh_token": str(auth.get("refresh_token") or ""),
            "expires_in": safe_int(auth.get("expires_in"), 3600),
            "user": account_payload["user"],
        }

    def logout(self, token: str) -> dict[str, Any]:
        # Auth revokes refresh sessions; RLS additionally invalidates already
        # issued access tokens, which otherwise remain usable until expiry.
        try:
            self._request("POST", "/auth/v1/logout", token=token, query={"scope": "global"})
        except CentralGatewayError as error:
            if error.status not in {HTTPStatus.UNAUTHORIZED, HTTPStatus.NOT_FOUND}:
                raise
        self._request("POST", "/rest/v1/rpc/revoke_own_access_tokens", token=token, body={})
        return {"logged_out": True}

    def _account_for_token(self, token: str) -> dict[str, Any]:
        rows = self._request(
            "GET", "/rest/v1/accounts", token=token,
            query={
                "select": "*,centers!accounts_center_id_fkey(name,code)",
                "id": "eq." + self._auth_user_id(token),
                "limit": "1",
            },
        )
        if not rows:
            raise CentralGatewayError("정지되었거나 사용할 수 없는 계정입니다.", HTTPStatus.FORBIDDEN)
        return rows[0]

    def _auth_user_id(self, token: str) -> str:
        user = self._request("GET", "/auth/v1/user", token=token)
        user_id = str(user.get("id") or "")
        if not user_id:
            raise CentralGatewayError("로그인 세션이 유효하지 않습니다.", HTTPStatus.UNAUTHORIZED)
        return user_id

    def _request(
        self,
        method: str,
        path: str,
        *,
        token: str = "",
        query: dict[str, str] | None = None,
        body: Any = None,
        prefer: str = "",
    ) -> Any:
        url = self.config.url + path
        if query:
            url += "?" + urlencode(query, safe="(),.*!:")
        headers = {
            "apikey": self.config.publishable_key,
            "Authorization": f"Bearer {token or self.config.publishable_key}",
            "Accept": "application/json",
        }
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"
        if prefer:
            headers["Prefer"] = prefer
        request = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=20) as response:
                raw = response.read()
                return json.loads(raw.decode("utf-8")) if raw else None
        except HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {}
            status = error.code
            if path.startswith("/rest/v1/rpc/") and status == 500 and payload.get("code") == "P0002":
                status = HTTPStatus.NOT_FOUND
            message = payload.get("error") if path == "/functions/v1/coach-chat" and str(payload.get("error", "")).startswith("coach_") else translate_remote_error(status, payload)
            raise CentralGatewayError(message, HTTPStatus(status), raw) from error
        except (URLError, TimeoutError) as error:
            raise CentralGatewayError(
                "중앙 서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.",
                HTTPStatus.SERVICE_UNAVAILABLE,
                str(error),
            ) from error

    def _login_email(self, username: str) -> str:
        return username if "@" in username else f"{username}@{self.config.auth_email_domain}"

    @staticmethod
    def _bearer_token(authorization: str, required: bool) -> str:
        if authorization.startswith("Bearer "):
            return authorization.removeprefix("Bearer ").strip()
        if required:
            raise CentralGatewayError("로그인이 필요합니다.", HTTPStatus.UNAUTHORIZED)
        return ""

    @staticmethod
    def _required_token(token: str) -> str:
        if not token:
            raise CentralGatewayError("로그인이 필요합니다.", HTTPStatus.UNAUTHORIZED)
        return token


def normalize_username(value: Any) -> str:
    return str(value or "").strip().lower()


def validate_account_input(username: str, password: str) -> None:
    if not re.fullmatch(r"[a-z0-9_]{4,20}", username):
        raise CentralGatewayError(
            "아이디는 영문 소문자, 숫자, _ 조합 4~20자리여야 합니다.", HTTPStatus.BAD_REQUEST
        )
    if len(password) < 8 or not re.search(r"[^A-Za-z0-9]", password):
        raise CentralGatewayError(
            "비밀번호는 특수문자를 포함한 8자리 이상이어야 합니다.", HTTPStatus.BAD_REQUEST
        )


def parse_query(raw_query: str) -> dict[str, str]:
    from urllib.parse import parse_qs

    return {key: values[0] for key, values in parse_qs(raw_query).items() if values}


def map_center(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row.get("name") or "",
        "code": row.get("code") or "",
        "status": row.get("status") or row.get("center_status") or "ACTIVE",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def map_center_overview(row: dict[str, Any]) -> dict[str, Any]:
    return {
        **map_center(row),
        "subscription_status": row.get("subscription_status") or "",
        "plan_code": row.get("plan_code") or "",
        "starts_at": row.get("starts_at"),
        "ends_at": row.get("ends_at"),
        "max_members": row.get("max_members"),
        "owner_count": safe_int(row.get("owner_count")),
        "coach_count": safe_int(row.get("coach_count")),
        "member_count": safe_int(row.get("member_count")),
        "last_login_at": row.get("last_login_at"),
        "last_session_at": row.get("last_session_at"),
    }


def map_subscription(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "center_id": row["center_id"],
        "plan_code": row.get("plan_code") or "",
        "status": row.get("status") or "",
        "starts_at": row.get("starts_at"),
        "ends_at": row.get("ends_at"),
        "max_members": row.get("max_members"),
        "updated_at": row.get("updated_at"),
    }


def map_feature_flag(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "center_id": row["center_id"],
        "flag_key": row["flag_key"],
        "enabled": bool(row.get("enabled")),
        "rollout_channel": row.get("rollout_channel") or "STABLE",
        "config": row.get("config") or {},
        "updated_at": row.get("updated_at"),
    }


def map_audit_log(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "actor_id": row["actor_id"],
        "center_id": row.get("center_id"),
        "target_type": row.get("target_type") or "",
        "target_id": row.get("target_id") or "",
        "action": row.get("action") or "",
        "before_state": row.get("before_state") or {},
        "after_state": row.get("after_state") or {},
        "request_context": row.get("request_context") or {},
        "created_at": row.get("created_at"),
    }


def map_account(row: dict[str, Any]) -> dict[str, Any]:
    center = row.get("centers") if isinstance(row.get("centers"), dict) else {}
    return {
        "id": row["id"],
        "gym_id": row.get("center_id") or "",
        "center_id": row.get("center_id"),
        "center_name": center.get("name", ""),
        "center_code": center.get("code", ""),
        "username": row["username"],
        "email": row.get("contact_email") or "",
        "name": row.get("display_name") or row["username"],
        "role": row["role"],
        "status": row.get("status", "ACTIVE"),
        "token_version": row.get("token_version", 1),
    }


def map_profile(row: dict[str, Any]) -> dict[str, Any]:
    account = row.get("accounts") if isinstance(row.get("accounts"), dict) else {}
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "gym_id": row["center_id"],
        "name": row.get("name") or account.get("display_name") or account.get("username", ""),
        "phone": row.get("phone") or "",
        "birthdate": row.get("birthdate") or "",
        "gender": row.get("gender") or "",
        "height_cm": row.get("height_cm", 170),
        "weight_kg": row.get("weight_kg", 70),
        "reach_cm": row.get("reach_cm", 0),
        "stance": row.get("stance", "orthodox"),
        "injury_note": row.get("injury_note") or "",
        "training_level": row.get("training_level", 1),
        "username": account.get("username", ""),
        "email": account.get("contact_email", ""),
        "role": account.get("role", "MEMBER"),
        "status": account.get("status", "ACTIVE"),
    }


def map_session(row: dict[str, Any]) -> dict[str, Any]:
    report = row.get("feedback_report") or {}
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "gym_id": row["center_id"],
        "started_at": iso_to_timestamp(row.get("started_at")),
        "ended_at": iso_to_timestamp(row.get("ended_at")) if row.get("ended_at") else None,
        "camera_config": row.get("camera_config") or [],
        "overall_score": row.get("overall_score", 0),
        "focus": row.get("focus") or "free_training",
        "feedback_report": json.dumps(report, ensure_ascii=False) if report else "",
    }


def map_label(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "session_id": row["session_id"],
        "owner_id": row["owner_id"],
        "label": row["label"],
        "comment": row.get("comment") or "",
        "use_for_training": bool(row.get("use_for_training")),
        "created_at": iso_to_timestamp(row.get("created_at")),
    }


def translate_remote_error(status: int, payload: dict[str, Any]) -> str:
    remote = str(payload.get("msg") or payload.get("message") or payload.get("error_description") or "")
    normalized = remote.lower()
    if status == 401 or "invalid login" in normalized:
        return "아이디 또는 비밀번호가 올바르지 않습니다."
    if status == 403:
        return "이 작업을 수행할 권한이 없습니다."
    if "duplicate" in normalized or "unique" in normalized or "already" in normalized:
        return "이미 사용 중인 정보입니다."
    if status == 404:
        return "요청한 정보를 찾을 수 없습니다."
    return remote or "중앙 서버 요청을 처리하지 못했습니다."


def iso_to_timestamp(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if not value:
        return 0.0
    parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.timestamp()


def timestamp_to_iso(value: Any) -> str:
    if not value:
        return utc_now_iso()
    numeric = float(value)
    if numeric > 10_000_000_000:
        numeric /= 1000
    return dt.datetime.fromtimestamp(numeric, tz=dt.timezone.utc).isoformat()


def utc_now_iso() -> str:
    return dt.datetime.now(tz=dt.timezone.utc).isoformat()


def utc_today_iso() -> str:
    return dt.datetime.now(tz=dt.timezone.utc).date().isoformat()


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError, OverflowError):
        return default
