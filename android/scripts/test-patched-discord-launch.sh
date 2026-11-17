#!/usr/bin/env bash
set -euo pipefail
signer="$(find "$ANDROID_HOME/build-tools" -name apksigner -type f | sort -V | tail -n 1)"
"$(dirname "$signer")/aapt" dump badging patched/patched-base.apk > patched-package.txt
package="$(sed -n "s/^package: name='\(com\.getcloudcord\.[^']*\)' versionCode='354012'.*/\1/p" patched-package.txt)"
test -n "$package"
attempts="${FRESH_INSTALL_ATTEMPTS:-1}"
[[ "$attempts" =~ ^[1-5]$ ]]
phase=fresh
trap 'adb logcat -b crash -d > "$phase-crash-buffer.txt"; adb shell dumpsys activity exit-info "$package" > "$phase-exit-info.txt"; adb logcat -d > "$phase-launch-logcat.txt"; adb exec-out screencap -p > discord.png' EXIT
observe_launch() {
  local first_pid iteration process_id
  adb shell am start -W -n "$package/com.discord.main.MainDefault" | tee "$phase-launch.txt" || return 1
  grep -qx 'Status: ok' "$phase-launch.txt" || return 1
  first_pid="$(adb shell pidof "$package" | tr -d '\r')" || return 1
  test -n "$first_pid" || return 1
  for iteration in $(seq 1 14); do
    sleep 5
    process_id="$(adb shell pidof "$package" | tr -d '\r' || true)"
    printf '%s %ss %s\n' "$phase" "$((iteration * 5))" "$process_id" | tee -a process.txt
    if [[ "$process_id" != "$first_pid" ]]; then
      echo "CloudCord exited or restarted during the $phase launch" >&2
      return 1
    fi
  done
  adb logcat -d --pid="$first_pid" > "$phase-client-logcat.txt" || return 1
  grep -q 'CloudCord is ready!' "$phase-client-logcat.txt" || return 1
  if grep -Eq 'FATAL EXCEPTION|Failed to load CloudCord' "$phase-client-logcat.txt"; then
    echo "CloudCord reported a startup failure during the $phase launch" >&2
    return 1
  fi
}

for attempt in $(seq 1 "$attempts"); do
  phase="fresh-$attempt"
  if adb shell pm path "$package" | grep -q '^package:'; then
    adb uninstall "$package" | tee "$phase-uninstall.txt"
    grep -qx Success "$phase-uninstall.txt"
  fi
  adb logcat -c
  adb install-multiple --no-streaming patched/*.apk | tee "$phase-install.txt"
  grep -qx Success "$phase-install.txt"
  if ! observe_launch; then
    adb logcat -b crash -d > "$phase-crash-buffer.txt"
    adb shell dumpsys activity exit-info "$package" > "$phase-exit-info.txt"
    adb logcat -d > "$phase-launch-logcat.txt"
    adb shell am force-stop "$package"
    sleep 5
    phase="relaunch-$attempt"
    observe_launch && echo 'Relaunch passed after the fresh-install failure'
    exit 1
  fi
  adb logcat -b crash -d > "$phase-crash-buffer.txt"
  adb shell dumpsys activity exit-info "$package" > "$phase-exit-info.txt"
done
