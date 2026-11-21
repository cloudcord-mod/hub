import importlib.util
from pathlib import Path
import unittest
import plistlib
import struct
import tempfile

spec = importlib.util.spec_from_file_location("broadcast_check", Path(__file__).with_name("verify-broadcast-ipa.py"))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class BroadcastCapabilitiesTest(unittest.TestCase):
    def setUp(self):
        self.host = {"com.apple.security.application-groups": [check.packager.DISCORD_APP_GROUP]}
        self.extension = dict(self.host)
        self.info = {"NSExtension": {"NSExtensionPointIdentifier": "com.apple.broadcast-services-upload"}}

    def test_matching_group(self):
        check.verify_capabilities(self.host, self.extension, self.info)

    def test_missing_host_group(self):
        with self.assertRaises(ValueError):
            check.verify_capabilities({}, self.extension, self.info)

    def test_missing_extension_group(self):
        with self.assertRaises(ValueError):
            check.verify_capabilities(self.host, {}, self.info)

    def test_wrong_extension_kind(self):
        with self.assertRaises(ValueError):
            check.verify_capabilities(self.host, self.extension, {})

    def test_different_teams(self):
        self.host["com.apple.developer.team-identifier"] = "HOST"
        self.extension["com.apple.developer.team-identifier"] = "OTHER"
        with self.assertRaises(ValueError):
            check.verify_capabilities(self.host, self.extension, self.info)

    def test_standalone_bundle_identity_ignores_unrelated_plist_values(self):
        discord_id = "com.hammerandchisel.discord"
        cloudcord_id = "app.cloudcord.ios"
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "Discord.app"
            broadcast = app / "PlugIns" / "BroadcastUpload.appex"
            broadcast.mkdir(parents=True)
            (app / "Info.plist").write_bytes(plistlib.dumps({
                "CFBundleIdentifier": discord_id,
                "CFBundleURLTypes": [{"CFBundleURLName": discord_id}],
            }))
            broadcast_info = broadcast / "Info.plist"
            broadcast_info.write_bytes(plistlib.dumps({"CFBundleIdentifier": discord_id + ".BroadcastUpload"}))
            with self.assertRaisesRegex(ValueError, "App CFBundleIdentifier"):
                check.verify_bundle_identity(app, cloudcord_id)

            check.packager.rebrand_bundle_ids(app, cloudcord_id, "CloudCord")
            check.verify_bundle_identity(app, cloudcord_id)
            info = plistlib.loads((app / "Info.plist").read_bytes())
            self.assertEqual(info["CFBundleURLTypes"][0]["CFBundleURLName"], discord_id)

            for wrong_id in (discord_id + ".BroadcastUpload", cloudcord_id + ".", cloudcord_id + "-other.BroadcastUpload"):
                with self.subTest(wrong_id=wrong_id):
                    broadcast_info.write_bytes(plistlib.dumps({"CFBundleIdentifier": wrong_id}))
                    with self.assertRaisesRegex(ValueError, "BroadcastUpload.appex CFBundleIdentifier"):
                        check.verify_bundle_identity(app, cloudcord_id)

    def test_final_signer_must_authorize_group_and_identity(self):
        signed = {**self.host, "com.apple.developer.team-identifier": "TEAM", "application-identifier": "TEAM.example.app"}
        profile = {"TeamIdentifier": ["TEAM"], "Entitlements": {**self.host, "application-identifier": "TEAM.example.*"}}
        check.verify_provisioning(signed, profile, "Host")
        for bad in [
            {**profile, "TeamIdentifier": ["OTHER"]},
            {**profile, "Entitlements": {"application-identifier": "TEAM.example.*"}},
            {**profile, "Entitlements": {**self.host, "application-identifier": "TEAM.different.*"}},
        ]:
            with self.assertRaises(ValueError):
                check.verify_provisioning(signed, bad, "Host")

    def test_windows_reads_embedded_entitlement_metadata(self):
        xml = plistlib.dumps(self.host)
        entitlement = struct.pack(">II", 0xFADE7171, len(xml) + 8) + xml
        signature = struct.pack(">IIIII", 0xFADE0CC0, 20 + len(entitlement), 1, 5, 20) + entitlement
        header = struct.pack("<8I", 0xFEEDFACF, 0x100000C, 0, 2, 1, 16, 0, 0)
        command = struct.pack("<4I", 0x1D, 16, 48, len(signature))
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "BroadcastUpload"
            file.write_bytes(header + command + signature)
            self.assertEqual(plistlib.loads(check.embedded_entitlements(file)), self.host)
            file.write_bytes(b"not a Mach-O")
            self.assertIsNone(check.embedded_entitlements(file))


if __name__ == "__main__":
    unittest.main()
