import json
import os
import subprocess
import sys
import time
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request
from urllib.request import urlopen
from fixtures import populated_store


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class ServerSafetyContractTests(unittest.TestCase):
    def test_local_request_body_limits_are_explicit(self):
        source = (PROJECT_ROOT / "backend" / "server.py").read_text(encoding="utf-8")
        self.assertIn("MAX_JSON_BODY = 1024 * 1024", source)
        self.assertIn("MAX_RECORDING_BODY = 256 * 1024 * 1024", source)


class ServerRuntimeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.database_path = str(Path(temporary.name) / "test.db")
        store = populated_store(self.database_path)
        store.conn.close()

    def test_server_reports_dynamic_port_and_health(self):
        environment = os.environ.copy()
        environment.update(
            {
                "BOXING_COACH_HOST": "127.0.0.1",
                "BOXING_COACH_PORT": "0",
                "BOXING_COACH_OPEN_BROWSER": "0",
                "PYTHONUNBUFFERED": "1",
                "BOXING_COACH_DB_PATH": self.database_path,
            }
        )
        process = subprocess.Popen(
            [sys.executable, "-u", str(PROJECT_ROOT / "backend" / "server.py")],
            cwd=PROJECT_ROOT,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )
        try:
            deadline = time.monotonic() + 10
            ready = None
            while time.monotonic() < deadline:
                line = process.stdout.readline()
                if line.startswith("BOXING_COACH_READY "):
                    ready = json.loads(line.removeprefix("BOXING_COACH_READY "))
                    break

            if ready is None:
                process.terminate()
                _, stderr = process.communicate(timeout=5)
                self.fail(f"server did not report readiness: {stderr}")
            self.assertNotEqual(ready["url"].rsplit(":", 1)[-1], "0")
            with urlopen(f'{ready["url"]}/api/system/health', timeout=5) as response:
                health = json.load(response)
            self.assertEqual(health["status"], "ok")
            self.assertEqual(health["service"], "boxing-coach-local")
            self.assertTrue(health["public_center_signup"])
            def api(method, path, body=None, token=None):
                headers = {"Content-Type": "application/json"}
                if token:
                    headers["Authorization"] = f"Bearer {token}"
                request = Request(ready["url"] + "/api" + path, method=method, headers=headers,
                                  data=json.dumps(body).encode() if body is not None else None)
                with urlopen(request, timeout=5) as response:
                    return json.load(response)

            token = api("POST", "/auth/login", {"username": "owner", "password": "Owner!123"})["token"]
            profile = api("GET", "/members", token=token)["members"][0]
            for method, path in (("GET", "/system/pose3d"), ("POST", "/pose/3d"),
                                 ("POST", "/calibration/human"),
                                 ("GET", f'/members/{profile["id"]}/calibration'),
                                 ("POST", f'/members/{profile["id"]}/calibration')):
                with self.assertRaises(HTTPError) as context:
                    api(method, path, {} if method == "POST" else None, token)
                self.assertEqual(context.exception.code, 404)
            created = api("POST", "/sessions", {"user_id": profile["user_id"],
                          "camera_config": [{"camera_id": "front", "calibrated": True, "projection_matrix": [1]}]}, token)["session"]
            self.assertNotIn("calibrated", created["camera_config"][0])
            ended = api("PATCH", f'/sessions/{created["id"]}/end',
                        {"overall_score": 99, "feedback_report": "discard this"}, token)["session"]
            self.assertIsNotNone(ended["ended_at"])
            self.assertEqual(ended["overall_score"], 0)
            self.assertEqual(ended["feedback_report"], "")
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            process.communicate(timeout=1)

    def test_desktop_bridge_secret_protects_recording_conversion(self):
        environment = os.environ.copy()
        environment.update(
            {
                "BOXING_COACH_HOST": "127.0.0.1",
                "BOXING_COACH_PORT": "0",
                "BOXING_COACH_OPEN_BROWSER": "0",
                "BOXING_COACH_BRIDGE_SECRET": "desktop-bridge-test-secret",
                "PYTHONUNBUFFERED": "1",
                "BOXING_COACH_DB_PATH": self.database_path,
            }
        )
        process = subprocess.Popen(
            [sys.executable, "-u", str(PROJECT_ROOT / "backend" / "server.py")],
            cwd=PROJECT_ROOT,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )
        try:
            deadline = time.monotonic() + 10
            ready = None
            while time.monotonic() < deadline:
                line = process.stdout.readline()
                if line.startswith("BOXING_COACH_READY "):
                    ready = json.loads(line.removeprefix("BOXING_COACH_READY "))
                    break
            if ready is None:
                self.fail("server did not report readiness")

            login = Request(
                f'{ready["url"]}/api/auth/login',
                data=json.dumps({"username": "owner", "password": "Owner!123"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(login, timeout=5) as response:
                token = json.load(response)["token"]

            protected_url = f'{ready["url"]}/api/recordings/convert'
            for headers in (
                {"Origin": "https://untrusted.example"},
                {"Host": "untrusted.example"},
                {"Sec-Fetch-Site": "cross-site"},
            ):
                request = Request(f'{ready["url"]}/api/system/health', headers=headers)
                with self.assertRaises(HTTPError) as context:
                    urlopen(request, timeout=5)
                self.assertEqual(context.exception.code, 403)
            approved = Request(f'{ready["url"]}/api/system/health',
                               headers={"Origin": ready["url"]})
            with urlopen(approved, timeout=5) as response:
                self.assertEqual(response.status, 200)
                self.assertFalse(json.load(response)["capabilities"]["analysis"]["available"])
            unauthenticated = Request(protected_url, data=b"", method="POST",
                                      headers={"X-BoxingCoach-Bridge": "desktop-bridge-test-secret"})
            with self.assertRaises(HTTPError) as context:
                urlopen(unauthenticated, timeout=5)
            self.assertEqual(context.exception.code, 401)
            without_secret = Request(
                protected_url,
                data=b"", method="POST",
                headers={"Authorization": f"Bearer {token}"},
            )
            with self.assertRaises(HTTPError) as context:
                urlopen(without_secret, timeout=5)
            self.assertEqual(context.exception.code, 403)
            self.assertIn("forbidden local bridge request", context.exception.read().decode("utf-8"))

            with_secret = Request(
                protected_url,
                data=b"", method="POST",
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-BoxingCoach-Bridge": "desktop-bridge-test-secret",
                },
            )
            with self.assertRaises(HTTPError) as context:
                urlopen(with_secret, timeout=5)
            self.assertEqual(context.exception.code, 400)
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            process.communicate(timeout=1)


if __name__ == "__main__":
    unittest.main()
