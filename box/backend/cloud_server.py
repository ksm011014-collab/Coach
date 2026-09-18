from __future__ import annotations

import json
import os
import sys
import socketserver
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

try:
    from runtime_contract import capabilities, request_origin_allowed
    from central_gateway import CentralGatewayError, SupabaseGateway
except ModuleNotFoundError:
    from backend.runtime_contract import capabilities, request_origin_allowed
    from backend.central_gateway import CentralGatewayError, SupabaseGateway


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "web"
MAX_JSON_BODY = 1024 * 1024


class CloudApiHandler(SimpleHTTPRequestHandler):
    server_version = "BoxingCoachCloud/0.3"
    gateway: SupabaseGateway

    def parse_request(self) -> bool:
        if not super().parse_request():
            return False
        if not request_origin_allowed(self.headers, self.server.server_address[1]):
            self.respond({"error": "unapproved request origin"}, HTTPStatus.FORBIDDEN)
            return False
        return True

    def log_request(self, code="-", size="-") -> None:
        sys.stderr.write(f"HTTP {self.command} {code}\n")

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

    def end_headers(self) -> None:
        path = urlparse(self.path).path
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(self), microphone=()")
        self.send_header("Content-Security-Policy", "frame-ancestors 'self'")
        if path in {"/service-worker.js", "/version.json"} or path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        elif path.startswith(("/scripts/", "/icons/")):
            self.send_header("Cache-Control", "public, max-age=300")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.route_api("GET", parsed.path, None)
            return
        super().do_GET()

    def do_POST(self) -> None:
        self.route_with_json("POST")

    def do_PATCH(self) -> None:
        self.route_with_json("PATCH")

    def do_PUT(self) -> None:
        self.route_with_json("PUT")

    def do_DELETE(self) -> None:
        self.route_api("DELETE", urlparse(self.path).path, None)

    def route_with_json(self, method: str) -> None:
        try:
            body = self.read_json()
        except ValueError as error:
            self.respond({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return
        self.route_api(method, urlparse(self.path).path, body)

    def route_api(self, method: str, path: str, body: dict[str, Any] | None) -> None:
        if method == "GET" and path == "/api/system/health":
            self.respond(
                {
                    "status": "ok",
                    "service": "boxing-coach-cloud",
                    "data_mode": "supabase",
                    "public_center_signup": False,
                    "capabilities": capabilities("supabase", local=False),
                },
                HTTPStatus.OK,
            )
            return
        if method == "GET" and path == "/api/system/version":
            self.respond(load_web_version(), HTTPStatus.OK)
            return
        if not self.gateway.handles(method, path):
            self.respond(
                {"error": "이 기능은 승인된 Windows 로컬 엔진에서만 사용할 수 있습니다."},
                HTTPStatus.NOT_FOUND,
            )
            return
        try:
            payload, status = self.gateway.route(
                method,
                path,
                body,
                urlparse(self.path).query,
                self.headers.get("Authorization", ""),
            )
            self.respond(payload, status)
        except CentralGatewayError as error:
            payload = {"error": str(error)}
            self.respond(payload, error.status)
        except (ValueError, TypeError, KeyError):
            self.respond({"error": "invalid request fields"}, HTTPStatus.BAD_REQUEST)
        except Exception:
            payload = {"error": "중앙 서버 요청을 처리하지 못했습니다."}
            self.respond(payload, HTTPStatus.INTERNAL_SERVER_ERROR)

    def read_json(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0") or 0)
        if content_length < 0 or content_length > MAX_JSON_BODY:
            raise ValueError("요청 본문이 너무 큽니다.")
        if content_length == 0:
            return {}
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("JSON 요청 형식이 올바르지 않습니다.") from error
        if not isinstance(payload, dict):
            raise ValueError("JSON 객체만 허용됩니다.")
        return payload

    def respond(self, payload: dict[str, Any], status: HTTPStatus) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        if os.environ.get("BOXING_COACH_HTTP_LOG") == "1":
            super().log_message(format, *args)


class ThreadingServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def load_web_version() -> dict[str, Any]:
    try:
        payload = json.loads((WEB_ROOT / "version.json").read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {"web_version": "unknown", "bridge_protocol": 1}


def create_server(host: str, port: int, gateway: SupabaseGateway) -> ThreadingServer:
    handler = type("ConfiguredCloudApiHandler", (CloudApiHandler,), {"gateway": gateway})
    return ThreadingServer((host, port), handler)


def main() -> None:
    gateway = SupabaseGateway.from_environment()
    if gateway is None:
        raise RuntimeError("Cloud mode requires BOXING_COACH_DATA_MODE=supabase")
    host = os.environ.get("BOXING_COACH_HOST", "127.0.0.1")
    port = int(os.environ.get("BOXING_COACH_PORT", "8080"))
    with create_server(host, port, gateway) as server:
        address, active_port = server.server_address[:2]
        ready = {"url": f"http://{address}:{active_port}", "service": "boxing-coach-cloud"}
        print("BOXING_COACH_READY " + json.dumps(ready), flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
