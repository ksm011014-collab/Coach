import json
import os
import subprocess
import sys
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request
from urllib.request import urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class ServerSafetyContractTests(unittest.TestCase):
    def test_local_request_body_limits_are_explicit(self):
        source = (PROJECT_ROOT / "backend" / "server.py").read_text(encoding="utf-8")
        self.assertIn("MAX_JSON_BODY = 1024 * 1024", source)
        self.assertIn("MAX_RECORDING_BODY = 256 * 1024 * 1024", source)


class ServerRuntimeTests(unittest.TestCase):
    def test_server_reports_dynamic_port_and_health(self):
        environment = os.environ.copy()
        environment.update(
            {
                "BOXING_COACH_HOST": "127.0.0.1",
                "BOXING_COACH_PORT": "0",
                "BOXING_COACH_OPEN_BROWSER": "0",
                "PYTHONUNBUFFERED": "1",
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
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            process.communicate(timeout=1)

    def test_desktop_bridge_secret_protects_local_ai_routes(self):
        environment = os.environ.copy()
        environment.update(
            {
                "BOXING_COACH_HOST": "127.0.0.1",
                "BOXING_COACH_PORT": "0",
                "BOXING_COACH_OPEN_BROWSER": "0",
                "BOXING_COACH_BRIDGE_SECRET": "desktop-bridge-test-secret",
                "PYTHONUNBUFFERED": "1",
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

            protected_url = f'{ready["url"]}/api/system/pose3d'
            without_secret = Request(
                protected_url,
                headers={"Authorization": f"Bearer {token}"},
            )
            with self.assertRaises(HTTPError) as context:
                urlopen(without_secret, timeout=5)
            self.assertEqual(context.exception.code, 403)
            self.assertIn("forbidden local bridge request", context.exception.read().decode("utf-8"))

            with_secret = Request(
                protected_url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-BoxingCoach-Bridge": "desktop-bridge-test-secret",
                },
            )
            with urlopen(with_secret, timeout=5) as response:
                payload = json.load(response)
            self.assertIn("opencv", payload)
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
