#!/usr/bin/env bash
set -uo pipefail
# CI-only runner wrapper. Never capture a real device or a non-synthetic app session.
mkdir -p qa/build qa/output
IMAGE=qa/output/android-synthetic-qa-failure.png
rm -f "$IMAGE" "$IMAGE.tmp"
node scripts/native-android-smoke.mjs > qa/build/android.raw 2>&1
DRIVER_STATUS=$?
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
node scripts/native-sanitize.mjs qa/build/android.raw qa/output/android.jsonl android
SANITIZER_STATUS=$?
# Never turn a failed driver or sanitizer into a pass because diagnostic capture worked.
exit $(( DRIVER_STATUS != 0 || SANITIZER_STATUS != 0 ))
