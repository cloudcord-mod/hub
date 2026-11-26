#!/usr/bin/env python3
"""Check packaged ReplayKit capabilities, not device/provisioning compatibility."""
import argparse
import importlib.util
import plistlib
import tempfile
import zipfile
import struct
import fnmatch
from pathlib import Path, PurePosixPath

spec = importlib.util.spec_from_file_location("cloudcord_packager", Path(__file__).with_name("package-cloudcord-ipa.py"))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


def verify_capabilities(host, extension, info):
    group_key = "com.apple.security.application-groups"
    for label, entitlements in (("Discord", host), ("BroadcastUpload", extension)):
        groups = entitlements.get(group_key)
        if not isinstance(groups, list) or packager.DISCORD_APP_GROUP not in groups:
            raise ValueError(f"{label} is missing Discord's shared App Group")
    if info.get("NSExtension", {}).get("NSExtensionPointIdentifier") != "com.apple.broadcast-services-upload":
        raise ValueError("BroadcastUpload is not a ReplayKit upload extension")
    team_key = "com.apple.developer.team-identifier"
    if host.get(team_key) and extension.get(team_key) and host[team_key] != extension[team_key]:
        raise ValueError("Host and broadcast extension have different signing teams")


def embedded_entitlements(executable):
    """Read XML entitlement metadata; this does not validate the signature chain."""
    raw = executable.read_bytes()
    if raw[:4] != b"\xcf\xfa\xed\xfe" or len(raw) < 32:
        return None
    position = 32
    for _ in range(struct.unpack_from("<I", raw, 16)[0]):
        command, size = struct.unpack_from("<II", raw, position)
        if size < 8 or position + size > len(raw):
            raise ValueError("Malformed Mach-O load command")
        if command == 0x1D:
            offset, length = struct.unpack_from("<II", raw, position + 8)
            block = raw[offset:offset + length]
            if len(block) < 12 or struct.unpack_from(">I", block)[0] != 0xFADE0CC0:
                raise ValueError("Invalid embedded code signature")
            for index in range(struct.unpack_from(">I", block, 8)[0]):
                kind, start = struct.unpack_from(">II", block, 12 + index * 8)
                if kind != 5:
                    continue
                magic, end = struct.unpack_from(">II", block, start)
                if magic != 0xFADE7171 or end < 8 or start + end > len(block):
                    raise ValueError("Invalid XML entitlement blob")
                return block[start + 8:start + end]
        position += size
    return None


def provisioning_metadata(bundle):
    path = bundle / "embedded.mobileprovision"
    if not path.is_file():
        raise ValueError(f"{bundle.name} has no embedded provisioning profile")
    raw = path.read_bytes()
    start, end = raw.find(b"<?xml"), raw.find(b"</plist>")
    if start < 0 or end < start:
        raise ValueError("Cannot read provisioning profile metadata")
    return plistlib.loads(raw[start:end + len(b"</plist>")])


def verify_provisioning(entitlements, profile, label, bundle_id):
    permitted = profile.get("Entitlements", {})
    groups = permitted.get("com.apple.security.application-groups", [])
    for group in entitlements.get("com.apple.security.application-groups", []):
        if not any(fnmatch.fnmatchcase(group, allowed) for allowed in groups):
            raise ValueError(f"{label} provisioning profile does not authorize its shared App Group")
    team = entitlements.get("com.apple.developer.team-identifier")
    if not team or team not in profile.get("TeamIdentifier", []):
        raise ValueError(f"{label} signing team does not match its provisioning profile")
    app_id = entitlements.get("application-identifier", "")
    if not app_id or not fnmatch.fnmatchcase(app_id, permitted.get("application-identifier", "")):
        raise ValueError(f"{label} application identifier is not authorized by its provisioning profile")
    if app_id.partition(".")[2] != bundle_id:
        raise ValueError(f"{label} signed application identifier does not match its bundle ID")


def verify_bundle_identity(app, expected_id):
    app_id = plistlib.loads((app / "Info.plist").read_bytes()).get("CFBundleIdentifier")
    if app_id != expected_id:
        raise ValueError(f"App CFBundleIdentifier is {app_id!r}, expected {expected_id!r}")

    prefix = expected_id + "."
    for extension in sorted((app / "PlugIns").glob("*.appex")):
        identifier = plistlib.loads((extension / "Info.plist").read_bytes()).get("CFBundleIdentifier")
        if not isinstance(identifier, str) or not identifier.startswith(prefix) or identifier == prefix:
            raise ValueError(f"{extension.name} CFBundleIdentifier {identifier!r} must start with {prefix!r} and include an extension name")


def verify_ipa(ipa, signed=False, bundle_id=None):
    with tempfile.TemporaryDirectory(prefix="cloudcord-broadcast-check-") as directory:
        root = Path(directory)
        with zipfile.ZipFile(ipa) as archive:
            for name in archive.namelist():
                path = PurePosixPath(name)
                if path.is_absolute() or ".." in path.parts or "\\" in name:
                    raise ValueError("Unsafe IPA archive path")
            archive.extractall(root)
        apps = list((root / "Payload").glob("*.app"))
        if len(apps) != 1:
            raise ValueError("IPA must contain one app")
        app = apps[0]
        if bundle_id is not None:
            verify_bundle_identity(app, bundle_id)
        broadcast = app / "PlugIns" / "BroadcastUpload.appex"
        info = plistlib.loads((broadcast / "Info.plist").read_bytes())
        host_executable, extension_executable = packager.bundle_executable(app), packager.bundle_executable(broadcast)
        host_bytes = packager.read_entitlements(host_executable) or embedded_entitlements(host_executable)
        extension_bytes = packager.read_entitlements(extension_executable) or embedded_entitlements(extension_executable)
        if not host_bytes or not extension_bytes:
            raise ValueError("Unable to inspect packaged host/broadcast entitlements")
        verify_capabilities(plistlib.loads(host_bytes), plistlib.loads(extension_bytes), info)
        if signed:
            host_info = plistlib.loads((app / "Info.plist").read_bytes())
            verify_provisioning(plistlib.loads(host_bytes), provisioning_metadata(app), "Discord", host_info.get("CFBundleIdentifier"))
            verify_provisioning(plistlib.loads(extension_bytes), provisioning_metadata(broadcast), "BroadcastUpload", info.get("CFBundleIdentifier"))
        print("PASS: ReplayKit/shared-group metadata" + (" and provisioning authorization" if signed else "") + "; signature-chain validation and device testing still required")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("ipa", type=Path)
    parser.add_argument("--signed", action="store_true", help="Also audit the final ESign/KSign provisioning profiles")
    parser.add_argument("--bundle-id", help="Verify the app uses this bundle ID and each extension uses it as a prefix")
    args = parser.parse_args()
    verify_ipa(args.ipa, signed=args.signed, bundle_id=args.bundle_id)
