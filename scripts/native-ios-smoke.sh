#!/usr/bin/env bash
set -euo pipefail
if [[ ( "${CI:-}" != "true" && "${CI:-}" != "1" ) || "${GITHUB_ACTIONS:-}" != "true" || "${NATIVE_SMOKE_QA:-}" != "1" ]]; then echo "ios_qa_signing_failed:requires_ci_qa" >&2; exit 1; fi
mkdir -p qa/output qa/build
command -v xcodegen >/dev/null || brew install xcodegen
UDID=$(xcrun simctl list devices available -j | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const d=Object.values(JSON.parse(s).devices).flat().find(x=>x.isAvailable&&x.name.startsWith("iPad"));if(!d)process.exit(1);console.log(d.udid)})')
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
# QA-only copy: production entitlements and signing settings remain unchanged.
export PAPERLY_IOS_QA_SIGNING=1
QA_ENTITLEMENTS="$PWD/qa/build/simulator.entitlements"
SOURCE_ENTITLEMENTS=$(find ios -maxdepth 2 -name '*.entitlements' -not -path '*/Pods/*' | head -1)
[[ -n "$SOURCE_ENTITLEMENTS" ]] || { echo ios_qa_entitlements_source_missing >&2; exit 1; }
node scripts/native-ios-signing.mjs prepare-xcode "$SOURCE_ENTITLEMENTS" "$QA_ENTITLEMENTS"
build_simulator() {
  xcodebuild -workspace ios/Paperly.xcworkspace -scheme Paperly -configuration Release -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath qa/build/app CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" PROVISIONING_PROFILE_SPECIFIER="" CODE_SIGN_ENTITLEMENTS="$QA_ENTITLEMENTS" build
}
if ! build_simulator > qa/build/ios-build.raw 2>&1; then
  # Retry ONLY a diagnosed SIWA signing/team capability refusal, never a generic build failure.
  if grep -Eiq '(Sign in with Apple|com\.apple\.developer\.applesignin).*(requires|support|provision|team)|(requires|support|provision|team).*(Sign in with Apple|com\.apple\.developer\.applesignin)' qa/build/ios-build.raw; then
    node scripts/native-ios-signing.mjs prepare-xcode "$SOURCE_ENTITLEMENTS" "$QA_ENTITLEMENTS" strip-siwa
    echo ios_qa_only_siwa_entitlement_removed
    build_simulator >> qa/build/ios-build.raw 2>&1 || { echo ios_qa_xcode_build_failed >&2; exit 1; }
  else echo ios_qa_xcode_build_failed >&2; exit 1; fi
fi
APP=qa/build/app/Build/Products/Release-iphonesimulator/Paperly.app
# Keep raw section/signature diagnostics local. The verifier fails closed on missing section/identity.
otool -s __TEXT __entitlements "$APP/Paperly" > qa/build/ios-entitlements-section.raw
# Decoded identifier keys only (bundle-id values, no secrets) so a verifier mismatch can be diagnosed from the job log.
node scripts/native-ios-entitlement-keys.mjs qa/build/ios-entitlements-section.raw || true
codesign -d --entitlements :- "$APP" > qa/build/ios-codesign-entitlements.raw 2>&1
grep -E -o '<key>(application-identifier|keychain-access-groups|get-task-allow)</key>' qa/build/ios-codesign-entitlements.raw | head -5 || true
if ! node scripts/native-ios-signing.mjs verify-xcode "$APP"; then
  # Diagnostic branch only: record the verifier verdict but still probe and run the suite so this run tells us whether
  # the embedded entitlements actually work (PDF keychain). The sanitizer gate is unchanged.
  echo ios_qa_signing_verify_failed_continuing
fi
# One install/probe, no variant matrix and no mutation of Xcode-signed nested frameworks.
node scripts/native-ios-launch-probe.mjs "$UDID" "$APP" qa/output/ios-launch-probe.json
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
