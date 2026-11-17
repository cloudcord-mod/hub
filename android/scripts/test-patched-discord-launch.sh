#!/usr/bin/env bash
set -euo pipefail
signer="$(find "$ANDROID_HOME/build-tools" -name apksigner -type f | sort -V | tail -n 1)"
"$(dirname "$signer")/aapt" dump badging patched/patched-base.apk > patched-package.txt
package="$(sed -n "s/^package: name='\(com\.getcloudcord\.[^']*\)' versionCode='354012'.*/\1/p" patched-package.txt)"
test -n "$package"
trap 'adb logcat -b crash -d > crash-buffer.txt; adb shell dumpsys activity exit-info "$package" > exit-info.txt; adb logcat -d > launch-logcat.txt; adb exec-out screencap -p > discord.png' EXIT
adb install-multiple --no-streaming patched/*.apk | tee install.txt
grep -qx Success install.txt
adb shell am start -W -n "$package/com.discord.main.MainDefault" | tee launch.txt
grep -qx 'Status: ok' launch.txt
first_pid="$(adb shell pidof "$package" | tr -d '\r')"
test -n "$first_pid"
for iteration in $(seq 1 14); do
  sleep 5
  process_id="$(adb shell pidof "$package" | tr -d '\r' || true)"
  printf '%ss %s\n' "$((iteration * 5))" "$process_id" | tee -a process.txt
  if [[ "$process_id" != "$first_pid" ]]; then
    echo 'CloudCord exited or restarted during the 70-second observation' >&2
    exit 1
  fi
done
adb logcat -d --pid="$first_pid" > client-logcat.txt
grep -q 'CloudCord is ready!' client-logcat.txt
if grep -Eq 'FATAL EXCEPTION|Failed to load CloudCord' client-logcat.txt; then
  echo 'CloudCord reported a startup failure' >&2
  exit 1
fi
