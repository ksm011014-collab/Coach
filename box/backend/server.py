from __future__ import annotations

import dataclasses
import json
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
import secrets
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

try:
    from central_gateway import CentralGatewayError, SupabaseGateway
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
    from pose3d import build_human_calibration, build_pose3d_packet, normalize_camera_config, opencv_status
except ModuleNotFoundError:
    from backend.central_gateway import CentralGatewayError, SupabaseGateway
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
    from backend.pose3d import build_human_calibration, build_pose3d_packet, normalize_camera_config, opencv_status


if getattr(sys, "frozen", False):
    RESOURCE_ROOT = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    local_app_data = os.environ.get("LOCALAPPDATA")
    DATA_ROOT = (
        Path(local_app_data) / "BoxingCoach"
        if local_app_data
        else Path.home() / "AppData" / "Local" / "BoxingCoach"
    )
else:
    RESOURCE_ROOT = Path(__file__).resolve().parents[1]
    DATA_ROOT = RESOURCE_ROOT / "backend"
WEB_ROOT = RESOURCE_ROOT / "web"
DATA_ROOT.mkdir(parents=True, exist_ok=True)
STORE = Store(DATA_ROOT / "boxing_coach.db")
CENTRAL_GATEWAY = SupabaseGateway.from_environment()
BRIDGE_SECRET = os.environ.get("BOXING_COACH_BRIDGE_SECRET", "")
LOCAL_BRIDGE_PATHS = {
    "/api/system/pose3d",
    "/api/pose/3d",
    "/api/calibration/human",
    "/api/recordings/convert",
}
MAX_JSON_BODY = 1024 * 1024
MAX_RECORDING_BODY = 256 * 1024 * 1024


class ApiHandler(SimpleHTTPRequestHandler):
    server_version = "BoxingCoachMVP/0.1"

    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        if parsed.path == "/":
            return str(WEB_ROOT / "index.html")
        requested = Path(unquote(parsed.path).lstrip("/"))
        resolved = (WEB_ROOT / requested).resolve()
        try:
            resolved.relative_to(WEB_ROOT.resolve())
        except ValueError:
            return str(WEB_ROOT / "__not_found__")
        return str(resolved)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.route_api("GET", parsed.path, None)
            return
        return super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/recordings/convert":
            if not self.bridge_request_allowed(path):
                self.respond({"error": "forbidden local bridge request"}, HTTPStatus.FORBIDDEN)
                return
            try:
                self.convert_recording()
            except PermissionError as exc:
                self.respond({"error": str(exc)}, HTTPStatus.FORBIDDEN)
            except ValueError as exc:
                self.respond({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.respond({"error": "server error", "detail": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        try:
            body = self.read_json()
        except ValueError as exc:
            self.respond({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        self.route_api("POST", path, body)

    def do_PATCH(self) -> None:
        try:
            body = self.read_json()
        except ValueError as exc:
            self.respond({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        self.route_api("PATCH", urlparse(self.path).path, body)

    def do_PUT(self) -> None:
        try:
            body = self.read_json()
        except ValueError as exc:
            self.respond({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        self.route_api("PUT", urlparse(self.path).path, body)

    def do_DELETE(self) -> None:
        self.route_api("DELETE", urlparse(self.path).path, None)

    def route_api(self, method: str, path: str, body: dict[str, Any] | None) -> None:
        try:
            if not self.bridge_request_allowed(path):
                self.respond({"error": "forbidden local bridge request"}, HTTPStatus.FORBIDDEN)
                return
            if CENTRAL_GATEWAY is not None and CENTRAL_GATEWAY.handles(method, path):
                payload, status = CENTRAL_GATEWAY.route(
                    method,
                    path,
                    body,
                    urlparse(self.path).query,
                    self.headers.get("Authorization", ""),
                )
                self.respond(payload, status)
            elif method == "GET" and path == "/api/system/health":
                self.respond({
                    "status": "ok",
                    "service": "boxing-coach-local",
                    "version": "0.2.0",
                    "public_center_signup": CENTRAL_GATEWAY is None,
                })
            elif method == "POST" and path == "/api/auth/login":
                self.login(body or {})
            elif method == "POST" and path == "/api/auth/signup":
                self.signup(body or {})
            elif method == "GET" and path == "/api/auth/check-username":
                self.check_username(urlparse(self.path).query)
            elif method == "GET" and path == "/api/me":
                self.me()
            elif method == "GET" and path == "/api/system/pose3d":
                self.pose3d_system()
            elif method == "GET" and path == "/api/members":
                self.members()
            elif method == "POST" and path == "/api/members":
                self.create_member(body or {})
            elif method == "GET" and path.startswith("/api/members/") and path.endswith("/calibration"):
                self.member_calibration(path.split("/")[-2])
            elif method == "POST" and path.startswith("/api/members/") and path.endswith("/calibration"):
                self.save_member_calibration(path.split("/")[-2], body or {})
            elif method == "GET" and path.startswith("/api/members/"):
                self.member_detail(path.rsplit("/", 1)[-1])
            elif method == "PATCH" and path.startswith("/api/members/"):
                self.update_member(path.rsplit("/", 1)[-1], body or {})
            elif method == "POST" and path == "/api/sessions":
                self.create_session(body or {})
            elif method == "GET" and path == "/api/sessions":
                self.sessions()
            elif method == "PATCH" and path.endswith("/end") and path.startswith("/api/sessions/"):
                session_id = path.split("/")[-2]
                self.end_session(session_id, body or {})
            elif method == "GET" and path.startswith("/api/sessions/"):
                self.session_detail(path.rsplit("/", 1)[-1])
            elif method == "DELETE" and path.startswith("/api/sessions/"):
                self.delete_session(path.rsplit("/", 1)[-1])
            elif method == "POST" and path.endswith("/labels") and path.startswith("/api/sessions/"):
                session_id = path.split("/")[-2]
                self.create_label(session_id, body or {})
            elif method == "POST" and path == "/api/pose/3d":
                self.pose_3d(body or {})
            elif method == "POST" and path == "/api/calibration/human":
                self.human_calibration(body or {})
            else:
                self.respond({"error": "not found"}, HTTPStatus.NOT_FOUND)
        except CentralGatewayError as exc:
            payload = {"error": str(exc)}
            if exc.detail and os.environ.get("BOXING_COACH_DEBUG") == "1":
                payload["detail"] = exc.detail
            self.respond(payload, exc.status)
        except PermissionError as exc:
            self.respond({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.respond({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            self.respond({"error": "server error", "detail": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def bridge_request_allowed(self, path: str) -> bool:
        if not BRIDGE_SECRET or path not in LOCAL_BRIDGE_PATHS:
            return True
        supplied = self.headers.get("X-BoxingCoach-Bridge", "")
        return secrets.compare_digest(supplied, BRIDGE_SECRET)

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
        password = str(body["password"])
        password_confirm = str(body.get("password_confirm") or "")
        if password != password_confirm:
            raise ValueError("password confirmation does not match")
        validate_password(password)
        if role == "OWNER":
            center = STORE.create_gym(
                name=str(body.get("center_name") or "").strip(),
                code=str(body.get("center_code") or "").strip(),
            )
            gym_id = center.id
        elif role == "MEMBER":
            center_code = str(body.get("center_code") or "").strip()
            center = STORE.find_gym_by_code(center_code)
            if center is None:
                raise ValueError("valid center code is required")
            gym_id = center.id
        else:
            raise ValueError("role must be OWNER or MEMBER")
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
        members = [member_payload(profile) for profile in STORE.profiles.values() if can_read_profile(user, profile)]
        self.respond({"members": members})

    def require_profile(self, member_id: str) -> MemberProfile:
        user = self.require_user()
        return self.accessible_profile(user, member_id)

    def accessible_profile(self, user: Any, member_id: str) -> MemberProfile:
        profile = STORE.get_profile(member_id)
        if profile is None:
            raise ValueError("member not found")
        if not can_read_profile(user, profile):
            raise PermissionError("member is outside your access scope")
        return profile

    def create_member(self, body: dict[str, Any]) -> None:
        user = self.require_user()
        if user.role != "OWNER":
            raise PermissionError("only administrators can create members")
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
            training_level=body.get("training_level", 1),
        )
        self.respond({"member": member_payload(profile, member)}, HTTPStatus.CREATED)

    def member_calibration(self, member_id: str) -> None:
        profile = self.require_profile(member_id)
        self.respond({"calibration": serialize(STORE.calibration_for_profile(profile.id))})

    def save_member_calibration(self, member_id: str, body: dict[str, Any]) -> None:
        profile = self.require_profile(member_id)
        calibration = body.get("calibration") if isinstance(body.get("calibration"), dict) else body
        if not calibration.get("ready"):
            raise ValueError("only ready calibrations can be saved")
        saved = STORE.save_member_calibration(profile, calibration)
        self.respond({"calibration": serialize(saved), "member": member_payload(STORE.get_profile(profile.id) or profile)})

    def member_detail(self, member_id: str) -> None:
        profile = self.require_profile(member_id)
        self.respond({"member": serialize(profile)})

    def update_member(self, member_id: str, body: dict[str, Any]) -> None:
        user = self.require_user()
        profile = self.accessible_profile(user, member_id)
        allowed = {"phone", "birthdate", "gender", "height_cm", "weight_kg", "reach_cm", "stance", "injury_note", "name"}
        if user.role == "OWNER":
            allowed.add("training_level")
        values = dataclasses.asdict(profile)
        for key in allowed:
            if key in body:
                values[key] = body[key]
        updated = STORE.update_profile(MemberProfile(**values))
        self.respond({"member": member_payload(updated)})

    def create_session(self, body: dict[str, Any]) -> None:
        user = self.require_user()
        target_user_id = str(body.get("user_id") or user.id)
        if user.role != "OWNER" and target_user_id != user.id:
            raise PermissionError("members can only create their own sessions")
        target = STORE.get_user(target_user_id)
        if target is None or target.gym_id != user.gym_id:
            raise PermissionError("target user is outside your center")
        session = TrainingSession(
            id=f"session_{int(time.time() * 1000)}",
            user_id=target_user_id,
            gym_id=user.gym_id,
            started_at=time.time(),
            ended_at=None,
            camera_config=normalize_camera_config(body.get("camera_config")),
            overall_score=0,
            focus=str(body.get("focus") or "guard_and_strikes"),
            feedback_report="",
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

    def end_session(self, session_id: str, body: dict[str, Any]) -> None:
        user = self.require_user()
        session = STORE.get_session(session_id)
        if session is None:
            raise ValueError("session not found")
        if not can_read_session(user, session):
            raise PermissionError("session is outside your access scope")
        score = int(body.get("overall_score") or session.overall_score or 0)
        feedback_report = str(body.get("feedback_report") or session.feedback_report or "")
        updated = STORE.end_session(session_id, time.time(), max(0, min(100, score)), feedback_report)
        self.respond({"session": serialize(updated)})

    def delete_session(self, session_id: str) -> None:
        user = self.require_user()
        session = STORE.get_session(session_id)
        if session is None:
            raise ValueError("session not found")
        if not can_read_session(user, session):
            raise PermissionError("session is outside your access scope")
        STORE.delete_session(session_id)
        self.respond({"deleted": True, "session_id": session_id})

    def create_label(self, session_id: str, body: dict[str, Any]) -> None:
        user = self.require_user()
        if user.role != "OWNER":
            raise PermissionError("only owners can label sessions")
        session = STORE.get_session(session_id)
        if session is None or session.gym_id != user.gym_id:
            raise PermissionError("session is outside your center")
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

    def pose_3d(self, body: dict[str, Any]) -> None:
        self.require_user()
        self.respond({"pose": build_pose3d_packet(body)})

    def human_calibration(self, body: dict[str, Any]) -> None:
        user = self.require_user()
        calibration = build_human_calibration(body)
        member_id = str(body.get("member_id") or body.get("profile_id") or "")
        response: dict[str, Any] = {"calibration": calibration}
        if member_id and calibration.get("ready"):
            if CENTRAL_GATEWAY is not None:
                token = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
                saved = CENTRAL_GATEWAY.save_calibration(token, member_id, calibration)
                response.update({"saved_calibration": saved["calibration"], "member": saved["member"]})
            else:
                profile = self.require_profile(member_id)
                saved = STORE.save_member_calibration(profile, calibration)
                response.update({"saved_calibration": serialize(saved), "member": serialize(STORE.get_profile(profile.id))})
        self.respond(response)

    def pose3d_system(self) -> None:
        self.require_user()
        self.respond(
            {
                "opencv": opencv_status(),
                "python": sys.version.split()[0],
                "max_cameras": 3,
                "pose_space": "world_3d",
            }
        )

    def convert_recording(self) -> None:
        self.require_user()
        ffmpeg = ffmpeg_executable()
        if ffmpeg is None:
            raise ValueError("MP4 conversion requires FFmpeg installed on this computer")
        size = int(self.headers.get("Content-Length") or 0)
        if size == 0:
            raise ValueError("recording is empty")
        if size < 0 or size > MAX_RECORDING_BODY:
            raise ValueError("recording exceeds the 256 MB conversion limit")
        source = self.rfile.read(size)
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "recording.webm"
            output_path = Path(directory) / "recording.mp4"
            input_path.write_bytes(source)
            result = subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-i",
                    str(input_path),
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    str(output_path),
                ],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode != 0 or not output_path.exists():
                raise ValueError("MP4 conversion failed")
            self.respond_bytes(output_path.read_bytes(), "video/mp4", "recording.mp4")

    def require_user(self) -> Any:
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            raise PermissionError("missing bearer token")
        return self.user_from_token(auth.replace("Bearer ", "", 1))

    def user_from_token(self, token: str) -> Any:
        if CENTRAL_GATEWAY is not None:
            return CENTRAL_GATEWAY.actor(token)
        payload = read_token(token)
        user = STORE.get_user(payload["sub"])
        if user is None:
            raise PermissionError("unknown user")
        return user

    def read_json(self) -> dict[str, Any]:
        size = int(self.headers.get("Content-Length") or 0)
        if size == 0:
            return {}
        if size < 0 or size > MAX_JSON_BODY:
            raise ValueError("JSON request exceeds the 1 MB limit")
        try:
            return json.loads(self.rfile.read(size).decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("invalid JSON body") from exc

    def respond(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def respond_bytes(self, data: bytes, content_type: str, filename: str) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(data)


def public_user(user: Any) -> dict[str, Any]:
    center = STORE.gyms.get(user.gym_id)
    return {
        "id": user.id,
        "gym_id": user.gym_id,
        "center_name": center.name if center else "",
        "center_code": center.code if center else "",
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "name": user.name,
    }


def member_payload(profile: MemberProfile, account: Any | None = None) -> dict[str, Any]:
    values = serialize(profile)
    account = account or STORE.get_user(profile.user_id)
    if account:
        values.update({"username": account.username, "email": account.email, "role": account.role})
    return values


def ffmpeg_executable() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def create_server(host: str, port: int) -> ThreadedServer:
    return ThreadedServer((host, port), ApiHandler)


def public_server_url(server: ThreadedServer, configured_host: str) -> str:
    bound_host, bound_port = server.server_address[:2]
    browser_host = "127.0.0.1" if configured_host in {"0.0.0.0", "::"} else str(bound_host)
    return f"http://{browser_host}:{bound_port}"


def main() -> None:
    os.chdir(WEB_ROOT)
    host = os.environ.get("BOXING_COACH_HOST", "127.0.0.1")
    port = int(os.environ.get("BOXING_COACH_PORT", "8000"))
    server = create_server(host, port)
    url = public_server_url(server, host)
    print(f"Boxing AI Coach MVP running at {url}")
    print(
        "BOXING_COACH_READY "
        + json.dumps({"url": url, "pid": os.getpid(), "data_root": str(DATA_ROOT)}, ensure_ascii=False),
        flush=True,
    )
    if os.environ.get("BOXING_COACH_OPEN_BROWSER", "1") != "0":
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
