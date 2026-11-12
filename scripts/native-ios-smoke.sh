#!/usr/bin/env bash
set -euo pipefail
if [[ ( "${CI:-}" != "true" && "${CI:-}" != "1" ) || "${GITHUB_ACTIONS:-}" != "true" || "${NATIVE_SMOKE_QA:-}" != "1" ]]; then echo "ios_qa_signing_failed:requires_ci_qa" >&2; exit 1; fi
mkdir -p qa/output qa/build
command -v xcodegen >/dev/null || brew install xcodegen
UDID=$(xcrun simctl list devices available -j | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const d=Object.values(JSON.parse(s).devices).flat().find(x=>x.isAvailable&&x.name.startsWith("iPad"));if(!d)process.exit(1);console.log(d.udid)})')
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
xcodebuild -workspace ios/Paperly.xcworkspace -scheme Paperly -configuration Release -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath qa/build/app CODE_SIGNING_ALLOWED=NO build
APP=qa/build/app/Build/Products/Release-iphonesimulator/Paperly.app
# CI simulator QA app only: ad-hoc sign with synthetic entitlements, then fail closed unless bundle/signature/entitlements agree.
export PAPERLY_IOS_QA_SIGNING=1
node scripts/native-ios-signing.mjs sign "$APP" qa/build
node scripts/native-ios-signing.mjs verify "$APP"
xcrun simctl install "$UDID" "$APP"
(cd qa/ios && xcodegen generate)
# Raw simulator/XCTest output and xcresult stay local. Never upload them or screenshots.
xcrun simctl spawn "$UDID" log stream --style compact --level debug --predicate 'process == "Paperly"' > qa/build/ios-system.raw 2>&1 &
LOG_PID=$!
trap 'kill "$LOG_PID" 2>/dev/null || true' EXIT
set +e
xcodebuild -project qa/ios/NativeSmoke.xcodeproj -scheme NativeSmoke -configuration Debug -destination "id=$UDID" -derivedDataPath qa/build/runner CODE_SIGNING_ALLOWED=NO -resultBundlePath qa/build/ios-result.xcresult -parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1 -test-timeouts-enabled YES -default-test-execution-time-allowance 720 -maximum-test-execution-time-allowance 780 test > qa/build/ios-test.raw 2>&1
STATUS=$?
kill "$LOG_PID" 2>/dev/null || true
# Classify only after the existing XCTest invocation. This never adds a probe or changes test ordering.
node scripts/native-ios-test-diagnostics.mjs qa/build/ios-test.raw xctest "$STATUS" >> qa/build/ios-test.raw
DIAGNOSTIC=$?
# Post-failure inspection only. Raw xcresult/strings/IDs remain private to this runner.
RESULT_DIAGNOSTIC=0
if [[ "$STATUS" != "0" ]]; then
  node scripts/native-ios-result-diagnostics.mjs qa/build/ios-result.xcresult "$STATUS" >> qa/build/ios-test.raw
  RESULT_DIAGNOSTIC=$?
fi
cat qa/build/ios-test.raw qa/build/ios-system.raw > qa/build/ios.raw
node scripts/native-sanitize.mjs qa/build/ios.raw qa/output/ios.jsonl ios
SANITIZED=$?
exit $(( STATUS != 0 || DIAGNOSTIC != 0 || RESULT_DIAGNOSTIC != 0 || SANITIZED != 0 ))
