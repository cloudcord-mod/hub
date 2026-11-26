#!/usr/bin/env python3
"""Create or inspect a non-executable CloudCord build provenance resource."""
import argparse
import hashlib
import io
import json
import os
import subprocess
import uuid
import zipfile
from pathlib import Path

RESOURCE = "cloudcord-build.json"

def create(target, variant):
    commit = os.environ.get("GITHUB_SHA")
    if not commit:
        result = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True)
        commit = result.stdout.strip() if result.returncode == 0 else "unknown"
    record = {
        "schema": 1, "project": "CloudCord", "variant": variant,
        "build_id": uuid.uuid4().hex, "commit": commit,
        "repository": os.environ.get("GITHUB_REPOSITORY", ""),
        "run_id": os.environ.get("GITHUB_RUN_ID", ""),
        "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT", ""),
    }
    data = (json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n").encode()
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    print("CloudCord provenance:", data.decode().strip(), "sha256=" + hashlib.sha256(data).hexdigest())

def inspect_archive(source, depth=0):
    with zipfile.ZipFile(source) as archive:
        for entry in archive.infolist():
            if entry.filename.rsplit("/", 1)[-1] == RESOURCE and entry.file_size <= 8192:
                data = archive.read(entry)
                print(entry.filename, data.decode("utf-8", errors="replace").strip(),
                      "sha256=" + hashlib.sha256(data).hexdigest())
            elif depth < 2 and entry.filename.endswith(".apk") and entry.file_size <= 100 * 1024 * 1024:
                with io.BytesIO(archive.read(entry)) as nested:
                    if zipfile.is_zipfile(nested):
                        inspect_archive(nested, depth + 1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    write = sub.add_parser("write")
    write.add_argument("target", type=Path)
    write.add_argument("variant")
    scan = sub.add_parser("inspect")
    scan.add_argument("archive", type=Path)
    args = parser.parse_args()
    if args.command == "write":
        create(args.target, args.variant)
    else:
        inspect_archive(args.archive)
