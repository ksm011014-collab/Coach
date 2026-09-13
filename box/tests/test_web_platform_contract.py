import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


class WebPlatformContractTests(unittest.TestCase):
    def test_manifest_and_required_pwa_assets_exist(self):
        manifest = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["display"], "standalone")
        self.assertEqual(manifest["start_url"], "/")
        for icon in manifest["icons"]:
            self.assertTrue((WEB / icon["src"].lstrip("/")).is_file())

    def test_service_worker_does_not_force_update_during_install(self):
        source = (WEB / "service-worker.js").read_text(encoding="utf-8")
        install_body = source[source.index('self.addEventListener("install"'):source.index('self.addEventListener("activate"')]
        self.assertNotIn("skipWaiting", install_body)
        self.assertIn('event.data?.type === "ACTIVATE_UPDATE"', source)
        self.assertNotIn('pathname.startsWith("/api/") return', source)

    def test_update_ui_blocks_activation_during_training(self):
        source = (WEB / "scripts" / "pwa.js").read_text(encoding="utf-8")
        self.assertIn("state.activeSessionId", source)
        self.assertIn("applyButton.disabled = blocked", source)

    def test_platform_console_is_role_gated_and_uses_admin_routes(self):
        source = (WEB / "scripts" / "platform-admin.js").read_text(encoding="utf-8")
        self.assertIn('state.user?.role !== "PLATFORM_ADMIN"', source)
        self.assertIn('api("/admin/centers")', source)
        self.assertIn('api("/admin/audit-logs?limit=100")', source)
        self.assertIn("/subscription", source)
        self.assertIn("/features/", source)

    def test_platform_console_translates_internal_codes_to_korean(self):
        source = (WEB / "scripts" / "platform-admin.js").read_text(encoding="utf-8")
        self.assertIn('PAST_DUE: "결제 연체"', source)
        self.assertIn('STABLE: "정식 배포"', source)
        self.assertIn('FEATURE_FLAG_UPDATED: "기능 설정 변경"', source)
        self.assertIn("platformValueLabel(center.status)", source)
        self.assertIn("platformValueLabel(log.action)", source)

    def test_central_capability_hides_public_owner_signup(self):
        app = (WEB / "app.js").read_text(encoding="utf-8")
        auth = (WEB / "scripts" / "auth-shell.js").read_text(encoding="utf-8")
        self.assertIn('platformApiFetch("/system/health")', app)
        self.assertIn('value !== "OWNER"', auth)

    def test_index_links_manifest_platform_console_and_update_controller(self):
        source = (WEB / "index.html").read_text(encoding="utf-8")
        self.assertIn('rel="manifest"', source)
        self.assertIn('/scripts/platform-admin.js', source)
        self.assertIn('/scripts/pwa.js', source)
        self.assertIn('id="updateBanner"', source)


if __name__ == "__main__":
    unittest.main()
