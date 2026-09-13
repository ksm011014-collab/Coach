import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGING = ROOT / "windows" / "packaging"
APPINSTALLER_NAMESPACE = "http://schemas.microsoft.com/appx/appinstaller/2021"
MANIFEST_NAMESPACE = "http://schemas.microsoft.com/appx/manifest/foundation/windows10"


class WindowsPackagingTests(unittest.TestCase):
    def test_manifest_targets_full_trust_x64_desktop(self):
        template = (PACKAGING / "AppxManifest.template.xml").read_text(encoding="utf-8")
        document = template.replace("@@PACKAGE_ID@@", "BoxingCoach.Apex")
        document = document.replace("@@PUBLISHER@@", "CN=BoxingCoach Development")
        document = document.replace("@@VERSION@@", "1.2.3.0")
        document = document.replace("@@DISPLAY_NAME@@", "APEX Boxing AI Coach")
        self.assertNotIn("@@", document)

        root = ET.fromstring(document)
        identity = root.find(f"{{{MANIFEST_NAMESPACE}}}Identity")
        application = root.find(
            f"{{{MANIFEST_NAMESPACE}}}Applications/{{{MANIFEST_NAMESPACE}}}Application"
        )
        self.assertEqual(identity.attrib["Name"], "BoxingCoach.Apex")
        self.assertEqual(identity.attrib["Version"], "1.2.3.0")
        self.assertEqual(identity.attrib["ProcessorArchitecture"], "x64")
        self.assertEqual(application.attrib["Executable"], "BoxingCoach.Desktop.exe")
        self.assertEqual(application.attrib["EntryPoint"], "Windows.FullTrustApplication")

    def test_appinstaller_supports_channels_and_forced_updates(self):
        template = (PACKAGING / "BoxingCoach.appinstaller.template.xml").read_text(
            encoding="utf-8"
        )
        for channel, package_id in (
            ("stable", "BoxingCoach.Apex"),
            ("beta", "BoxingCoach.Apex.Beta"),
        ):
            for forced in (False, True):
                document = template.replace(
                    "@@APPINSTALLER_URI@@",
                    f"https://download.example/boxingcoach/{channel}/BoxingCoach-{channel}.appinstaller",
                )
                document = document.replace(
                    "@@PACKAGE_URI@@",
                    f"https://download.example/boxingcoach/{channel}/1.2.3.0/{package_id}-1.2.3.0-x64.msix",
                )
                document = document.replace("@@PACKAGE_ID@@", package_id)
                document = document.replace("@@PUBLISHER@@", "CN=BoxingCoach")
                document = document.replace("@@VERSION@@", "1.2.3.0")
                document = document.replace(
                    "@@BLOCKS_ACTIVATION@@", str(forced).lower()
                )
                self.assertNotIn("@@", document)

                root = ET.fromstring(document)
                main_package = root.find(f"{{{APPINSTALLER_NAMESPACE}}}MainPackage")
                on_launch = root.find(
                    f"{{{APPINSTALLER_NAMESPACE}}}UpdateSettings/"
                    f"{{{APPINSTALLER_NAMESPACE}}}OnLaunch"
                )
                background = root.find(
                    f"{{{APPINSTALLER_NAMESPACE}}}UpdateSettings/"
                    f"{{{APPINSTALLER_NAMESPACE}}}AutomaticBackgroundTask"
                )
                self.assertEqual(main_package.attrib["Name"], package_id)
                self.assertEqual(on_launch.attrib["HoursBetweenUpdateChecks"], "0")
                self.assertEqual(on_launch.attrib["ShowPrompt"], "true")
                self.assertEqual(
                    on_launch.attrib["UpdateBlocksActivation"], str(forced).lower()
                )
                self.assertIsNotNone(background)


if __name__ == "__main__":
    unittest.main()
