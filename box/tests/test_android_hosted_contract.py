import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
JAVA = ROOT / "android" / "app" / "src" / "main" / "java" / "com" / "boxingcoach" / "tablet" / "MainActivity.java"
GRADLE = ROOT / "android" / "app" / "build.gradle"
OFFLINE_ADAPTER = ROOT / "web" / "scripts" / "android-offline.js"


class AndroidHostedContractTests(unittest.TestCase):
    def test_hosted_url_is_build_time_configuration(self):
        gradle = GRADLE.read_text(encoding="utf-8")
        self.assertIn("BOXING_COACH_HOSTED_APP_URL", gradle)
        self.assertIn("buildConfigField 'String', 'HOSTED_APP_URL'", gradle)

    def test_hosted_mode_requires_https_and_exact_origin_navigation(self):
        source = JAVA.read_text(encoding="utf-8")
        self.assertIn('Hosted Android app URL must use HTTPS', source)
        self.assertIn('return !sameOrigin(allowedOrigin, request.getUrl())', source)
        self.assertIn('effectivePort(expected) == effectivePort(candidate)', source)

    def test_offline_adapter_is_disabled_only_in_explicit_hosted_mode(self):
        source = OFFLINE_ADAPTER.read_text(encoding="utf-8")
        self.assertIn('window.BoxingCoachAndroid.offlineMode?.() === false', source)
        java = JAVA.read_text(encoding="utf-8")
        self.assertIn('public boolean offlineMode()', java)
        self.assertIn('return !hostedMode;', java)


if __name__ == "__main__":
    unittest.main()
