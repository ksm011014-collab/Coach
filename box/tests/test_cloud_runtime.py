import json
import os
import subprocess
import sys
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class CloudRuntimeTests(unittest.TestCase):
    def setUp(self):
        environment = os.environ.copy()
        environment.update(
            {
                "BOXING_COACH_DATA_MODE": "supabase",
                "BOXING_COACH_SUPABASE_URL": "https://project.invalid",
                "BOXING_COACH_SUPABASE_PUBLISHABLE_KEY": "publishable-test-key",
                "BOXING_COACH_HOST": "127.0.0.1",
                "BOXING_COACH_PORT": "0",
                "PYTHONUNBUFFERED": "1",
            }
        )
        self.process = subprocess.Popen(
            [sys.executable, "-u", str(PROJECT_ROOT / "backend" / "cloud_server.py")],
            cwd=PROJECT_ROOT,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )
        deadline = time.monotonic() + 10
        self.ready = None
        while time.monotonic() < deadline:
            line = self.process.stdout.readline()
            if line.startswith("BOXING_COACH_READY "):
                self.ready = json.loads(line.removeprefix("BOXING_COACH_READY "))
                break
        if self.ready is None:
            self.process.terminate()
            _, stderr = self.process.communicate(timeout=5)
            self.fail(f"cloud server did not report readiness: {stderr}")

    def tearDown(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.process.communicate(timeout=1)

    def test_cloud_health_and_version_are_available(self):
        with urlopen(f'{self.ready["url"]}/api/system/health', timeout=5) as response:
            health = json.load(response)
        with urlopen(f'{self.ready["url"]}/api/system/version', timeout=5) as response:
            version = json.load(response)
        self.assertEqual(health["service"], "boxing-coach-cloud")
        self.assertEqual(health["data_mode"], "supabase")
        self.assertFalse(health["public_center_signup"])
        self.assertGreaterEqual(version["bridge_protocol"], 1)

    def test_local_ai_routes_are_not_exposed_by_cloud_server(self):
        with self.assertRaises(HTTPError) as context:
            urlopen(f'{self.ready["url"]}/api/system/pose3d', timeout=5)
        self.assertEqual(context.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
