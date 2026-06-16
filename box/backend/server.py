from __future__ import annotations

import base64
import dataclasses
import hashlib
import json
import os
import socketserver
import struct
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

try:
    from domain import (
        CoachLabel,
        MemberProfile,
        Store,
        TrainingSession,
        can_read_profile,
        can_read_session,
        normalize_username,
        read_token,
        serialize,
        sign_token,
        validate_password,
        verify_password,
    )
    from pose_worker import MMPoseUnavailable, create_pose_worker
except ModuleNotFoundError:
    from backend.domain import (
        CoachLabel,
        MemberProfile,
        Store,
        TrainingSession,
        can_read_profile,
        can_read_session,
        normalize_username,
        read_token,
        serialize,
        sign_token,
        validate_password,
        verify_password,
    )
    from backend.pose_worker import MMPoseUnavailable, create_pose_worker


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "web"
STORE = Store(ROOT / "backend" / "boxing_coach.db")
try:
    POSE_WORKER = create_pose_worker()
    POSE_WORKER_MODE = POSE_WORKER.__class__.__name__
except MMPoseUnavailable as exc:
    print(f"MMPose worker unavailable, falling back to demo worker: {exc}")
    os.environ["POSE_WORKER"] = "demo"
    POSE_WORKER = create_pose_worker()
    POSE_WORKER_MODE = "DemoPoseWorker"


class ApiHandler(SimpleHTTPRequestHandler):
    server_version = "BoxingCoachMVP/0.1"

    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        if parsed.path == "/":
            return str(WEB_ROOT / "index.html")
        return str(WEB_ROOT / parsed.path.lstrip("/"))

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.route_api("GET", parsed.path, None)
            return
        if parsed.path.startswith("/realtime/session/"):
            self.handle_websocket(parsed)
            return
        return super().do_GET()

    def do_POST(self) -> None:
        self.route_api("POST", urlparse(self.path).path, self.read_json())

    def do_PATCH(self) -> None:
        self.route_api("PATCH", urlparse(self.path).path, self.read_json())

    def route_api(self, method: str, path: str, body: dict[str, Any] | None) -> None:
        try:
            if method == "POST" and path == "/api/auth/login":
                self.login(body or {})
            elif method == "POST" and path == "/api/auth/signup":
                self.signup(body or {})
            elif method == "GET" and path == "/api/auth/check-username":
                self.check_username(urlparse(self.path).query)
            elif method == "GET" and path == "/api/me":
                self.me()
            elif method == "GET" and path == "/api/members":
                self.members()
            elif method == "POST" and path == "/api/members":
                self.create_member(body or {})
            elif method == "GET" and path.startswith("/api/members/"):
                self.member_detail(path.rsplit("/", 1)[-1])
            elif method == "PATCH" and path.startswith("/api/members/"):
                self.update_member(path.rsplit("/", 1)[-1], body or {})
            elif method == "POST" and path == "/api/sessions":
                self.create_session(body or {})
            elif method == "GET" and path == "/api/sessions":
                self.sessions()
            elif method == "GET" and path.startswith("/api/sessions/"):
                self.session_detail(path.rsplit("/", 1)[-1])
            elif method == "POST" and path.endswith("/labels") and path.startswith("/api/sessions/"):
                session_id = path.split("/")[-2]
                self.create_label(session_id, body or {})
            else:
                self.respond({"error": "not found"}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.respond({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.respond({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            self.respond({"error": "server error", "detail": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def login(self, body: dict[str, Any]) -> None:
        username = str(body.get("username") or body.get("email") or "")
        password = str(body.get("password", ""))
        user = STORE.find_user_by_username(username)
        if user is None or not verify_password(password, user.password_hash):
            raise PermissionError("invalid username or password")
        self.respond({"token": sign_token(user), "user": public_user(user)})

    def check_username(self, query: str) -> None:
        username = normalize_username(parse_qs(query).get("username", [""])[0])
        available = bool(username) and STORE.find_user_by_username(username) is None
        self.respond({"username": username, "available": available})

    def signup(self, body: dict[str, Any]) -> None:
        role = str(body.get("role", "MEMBER")).upper()
        gym_id = str(body.get("gym_id") or "gym_apex")
        password = str(body["password"])
        password_confirm = str(body.get("password_confirm") or "")
        if password != password_confirm:
            raise ValueError("password confirmation does not match")
        validate_password(password)
        user = STORE.create_user(
            username=str(body["username"]),
            password=password,
            role=role,
            name=str(body.get("name") or body["username"]).strip(),
            gym_id=gym_id,
            email=str(body.get("email") or ""),
        )
        STORE.create_profile(
            user=user,
            phone=str(body.get("phone") or ""),
            birthdate=str(body.get("birthdate") or ""),
            gender=str(body.get("gender") or ""),
        )
        self.respond({"token": sign_token(user), "user": public_user(user)}, HTTPStatus.CREATED)

    def me(self) -> None:
        user = self.require_user()
        profile = STORE.profile_for_user(user.id)
        self.respond({"user": public_user(user), "profile": serialize(profile)})

    def members(self) -> None:
        user = self.require_user()
        members = []
        for profile in STORE.profiles.values():
            if not can_read_profile(user, profile):
                continue
            values = serialize(profile)
            account = STORE.get_user(profile.user_id)
            if account:
                values.update({"username": account.username, "email": account.email, "role": account.role})
            members.append(values)
        self.respond({"members": members})

    def create_member(self, body: dict[str, Any]) -> None:
        user = self.require_user()
        if user.role != "OWNER":
            raise PermissionError("only owners can create members")
        password = str(body.get("password") or "")
        password_confirm = str(body.get("password_confirm") or password)
        if password != password_confirm:
            raise ValueError("password confirmation does not match")
        member = STORE.create_user(
            username=str(body["username"]),
            password=password,
            role="MEMBER",
            name=str(body.get("name") or body["username"]).strip(),
            gym_id=user.gym_id,
            email=str(body.get("email") or ""),
        )
        profile = STORE.create_profile(
            user=member,
            phone=str(body.get("phone") or ""),
            birthdate=str(body.get("birthdate") or ""),
            gender=str(body.get("gender") or ""),
        )
        values = serialize(profile)
        values.update({"username": member.username, "email": member.email, "role": member.role})
        self.respond({"member": values}, HTTPStatus.CREATED)

    def member_detail(self, member_id: str) -> None:
        user = self.require_user()
        profile = STORE.get_profile(member_id)
        if profile is None:
            raise ValueError("member not found")
        if not can_read_profile(user, profile):
            raise PermissionError("member is outside your access scope")
        self.respond({"member": serialize(profile)})

    def update_member(self, member_id: str, body: dict[str, Any]) -> None:
        user = self.require_user()
        profile = STORE.profiles.get(member_id)
        if profile is None:
            raise ValueError("member not found")
        if user.role != "OWNER" and user.id != profile.user_id:
            raise PermissionError("cannot update this member")
        if user.gym_id != profile.gym_id:
            raise PermissionError("member is outside your gym")
        allowed = {"phone", "birthdate", "gender", "height_cm", "weight_kg", "reach_cm", "stance", "injury_note", "name"}
        values = dataclasses.asdict(profile)
        for key in allowed:
            if key in body:
                values[key] = body[key]
        updated = STORE.update_profile(MemberProfile(**values))
        self.respond({"member": serialize(updated)})

    def create_session(self, body: dict[str, Any]) -> None:
        user = self.require_user()
        target_user_id = str(body.get("user_id") or user.id)
        if user.role != "OWNER" and target_user_id != user.id:
            raise PermissionError("members can only create their own sessions")
        target = STORE.get_user(target_user_id)
        if target is None or target.gym_id != user.gym_id:
            raise PermissionError("target user is outside your gym")
        session = TrainingSession(
            id=f"session_{int(time.time() * 1000)}",
            user_id=target_user_id,
            gym_id=user.gym_id,
            started_at=time.time(),
            ended_at=None,
            camera_config=body.get("camera_config")
            or [{"camera_id": "cam_front_01", "view_angle": "front", "enabled": True}],
            overall_score=0,
            focus=str(body.get("focus") or "guard_and_strikes"),
        )
        STORE.create_session(session)
        self.respond({"session": serialize(session)}, HTTPStatus.CREATED)

    def sessions(self) -> None:
        user = self.require_user()
        sessions = [session for session in STORE.sessions.values() if can_read_session(user, session)]
        self.respond({"sessions": serialize(sessions)})

    def session_detail(self, session_id: str) -> None:
        user = self.require_user()
        session = STORE.get_session(session_id)
        if session is None:
            raise ValueError("session not found")
        if not can_read_session(user, session):
            raise PermissionError("session is outside your access scope")
        labels = STORE.labels_for_session(session_id)
        self.respond({"session": serialize(session), "labels": serialize(labels)})

    def create_label(self, session_id: str, body: dict[str, Any]) -> None:
        user = self.require_user()
        if user.role != "OWNER":
            raise PermissionError("only owners can label sessions")
        session = STORE.get_session(session_id)
        if session is None or session.gym_id != user.gym_id:
            raise PermissionError("session is outside your gym")
        label = CoachLabel(
            id=f"label_{int(time.time() * 1000)}",
            session_id=session_id,
            owner_id=user.id,
            label=str(body.get("label") or "needs_fix"),
            comment=str(body.get("comment") or ""),
            use_for_training=bool(body.get("use_for_training", True)),
            created_at=time.time(),
        )
        STORE.create_label(label)
        self.respond({"label": serialize(label)}, HTTPStatus.CREATED)

    def handle_websocket(self, parsed: Any) -> None:
        token = parse_qs(parsed.query).get("token", [""])[0]
        user = self.user_from_token(token)
        session_id = parsed.path.rsplit("/", 1)[-1]
        session = STORE.get_session(session_id)
        if session is None or not can_read_session(user, session):
            self.send_error(HTTPStatus.FORBIDDEN, "session is outside your access scope")
            return

        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self.send_error(HTTPStatus.BAD_REQUEST, "missing websocket key")
            return
        accept = base64.b64encode(
            hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
        ).decode()
        self.send_response(HTTPStatus.SWITCHING_PROTOCOLS)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()

        for frame_index in range(10_000):
            try:
                packet = POSE_WORKER.packet(session_id, frame_index)
            except MMPoseUnavailable as exc:
                self.write_ws_text(json.dumps({"error": str(exc), "status": "mmpose_unavailable"}, ensure_ascii=False))
                break
            self.write_ws_text(json.dumps(dataclasses.asdict(packet), ensure_ascii=False))
            time.sleep(0.08)

    def write_ws_text(self, text: str) -> None:
        payload = text.encode("utf-8")
        header = bytearray([0x81])
        if len(payload) < 126:
            header.append(len(payload))
        elif len(payload) < 65536:
            header.extend([126])
            header.extend(struct.pack("!H", len(payload)))
        else:
            header.extend([127])
            header.extend(struct.pack("!Q", len(payload)))
        self.wfile.write(header + payload)
        self.wfile.flush()

    def require_user(self) -> Any:
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            raise PermissionError("missing bearer token")
        return self.user_from_token(auth.replace("Bearer ", "", 1))

    def user_from_token(self, token: str) -> Any:
        payload = read_token(token)
        user = STORE.get_user(payload["sub"])
        if user is None:
            raise PermissionError("unknown user")
        return user

    def read_json(self) -> dict[str, Any]:
        size = int(self.headers.get("Content-Length") or 0)
        if size == 0:
            return {}
        return json.loads(self.rfile.read(size).decode("utf-8"))

    def respond(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def public_user(user: Any) -> dict[str, Any]:
    return {
        "id": user.id,
        "gym_id": user.gym_id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "name": user.name,
    }


class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True


def main() -> None:
    os.chdir(WEB_ROOT)
    server = ThreadedServer(("127.0.0.1", 8000), ApiHandler)
    print("Boxing AI Coach MVP running at http://127.0.0.1:8000")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
