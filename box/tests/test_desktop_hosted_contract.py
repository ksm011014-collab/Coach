import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DesktopHostedContractTests(unittest.TestCase):
    def test_example_configuration_preserves_local_default(self):
        config = json.loads(
            (ROOT / "windows" / "appsettings.example.json").read_text(encoding="utf-8-sig")
        )
        self.assertEqual(config["UiMode"], "local")
        self.assertEqual(config["HostedAppUrl"], "")
        self.assertTrue(config["AllowBundledFallback"])

    def test_release_script_requires_https_and_central_credentials(self):
        script = (ROOT / "windows" / "build-release.ps1").read_text(encoding="utf-8-sig")
        self.assertIn('[ValidateSet("local", "hosted")]', script)
        self.assertIn("HostedAppUrl must be an HTTPS URL", script)
        self.assertIn("Hosted UI packages require SupabaseUrl", script)
        self.assertIn("ui_mode = $UiMode", script)

    def test_web_update_banner_does_not_hide_desktop_incompatibility(self):
        bridge = (ROOT / "web" / "scripts" / "desktop-bridge.js").read_text(encoding="utf-8")
        pwa = (ROOT / "web" / "scripts" / "pwa.js").read_text(encoding="utf-8")
        marker = 'banner.dataset.desktopCompatibility = "error"'
        self.assertIn(marker, bridge)
        self.assertIn('banner.dataset.desktopCompatibility === "error"', pwa)

    def test_local_proxy_has_bounded_request_and_response_buffers(self):
        proxy = (
            ROOT / "windows" / "BoxingCoach.Desktop" / "Services" / "LocalApiProxy.cs"
        ).read_text(encoding="utf-8-sig")
        self.assertIn("MaximumRequestBytes = 256L * 1024L * 1024L", proxy)
        self.assertIn("totalBytes > MaximumRequestBytes", proxy)
        self.assertIn("ContentLength > MaximumRequestBytes", proxy)


if __name__ == "__main__":
    unittest.main()
