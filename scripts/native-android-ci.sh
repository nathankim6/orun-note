#!/usr/bin/env bash
set -uo pipefail
# CI-only runner wrapper. Never capture a real device or a non-synthetic app session.
mkdir -p qa/build qa/output
IMAGE=qa/output/android-synthetic-qa-failure.png
rm -f "$IMAGE" "$IMAGE.tmp"
: > qa/build/android.raw
node scripts/native-android-preflight.mjs before_install >> qa/build/android.raw 2>&1
DRIVER_STATUS=$?
if [[ "$DRIVER_STATUS" == 0 ]]; then
  timeout 120s adb install android/app/build/outputs/apk/release/app-release.apk >> qa/build/android.raw 2>&1
  DRIVER_STATUS=$?
  if [[ "$DRIVER_STATUS" != 0 ]]; then printf 'QA_JSON {"event":"suite_result","platform":"android","result":"fail","reason":"apk_install_failed"}\n' >> qa/build/android.raw; fi
fi
if [[ "$DRIVER_STATUS" == 0 ]]; then
  node scripts/native-android-preflight.mjs before_start >> qa/build/android.raw 2>&1
  DRIVER_STATUS=$?
fi
if [[ "$DRIVER_STATUS" == 0 ]]; then
  node scripts/native-android-smoke.mjs >> qa/build/android.raw 2>&1
  DRIVER_STATUS=$?
fi
if [[ "$DRIVER_STATUS" != 0 && "${GITHUB_ACTIONS:-}" == true && "${NATIVE_SMOKE_ALLOW_SYNTHETIC_SCREENSHOT:-}" == 1 ]]; then
  # Fresh AVD is created by the workflow; screenshot protection remains fully on.
  if [[ "$(timeout 5s adb shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r\n')" == 1 ]]; then
    if timeout 15s adb exec-out screencap -p > "$IMAGE.tmp" 2>/dev/null; then
      if node -e 'const f=require("fs");const p=process.argv[1];const s=f.statSync(p);if(s.size<8||s.size>20*1024*1024)process.exit(1);const h=f.openSync(p,"r"),b=Buffer.alloc(8);f.readSync(h,b,0,8,0);f.closeSync(h);if(b.toString("hex")!=="89504e470d0a1a0a")process.exit(1)' "$IMAGE.tmp"; then
        mv "$IMAGE.tmp" "$IMAGE"
      fi
    fi
  fi
fi
rm -f "$IMAGE.tmp"
# Native release console markers can survive when accessibility telemetry is
# truncated/unavailable. Keep raw logcat local; only the sanitizer output uploads.
# Every QA marker the app printed since `logcat -c` (the accessibility telemetry label is clipped by the UI dump on long
# runs); the bounded recent dump below stays for crash evidence.
timeout 25s adb logcat -d -v threadtime -s ReactNativeJS:V >> qa/build/android.raw 2>/dev/null || true
timeout 15s adb logcat -d -v threadtime -t 8000 >> qa/build/android.raw 2>/dev/null || true
node scripts/native-sanitize.mjs qa/build/android.raw qa/output/android.jsonl android
SANITIZER_STATUS=$?
# Never turn a failed driver or sanitizer into a pass because diagnostic capture worked.
exit $(( DRIVER_STATUS != 0 || SANITIZER_STATUS != 0 ))
