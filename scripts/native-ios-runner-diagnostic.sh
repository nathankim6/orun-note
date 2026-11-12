#!/usr/bin/env bash
set -euo pipefail
# Synthetic SmokeHost only. Does not build, launch, validate or release Paperly.
if [[ ( "${CI:-}" != true && "${CI:-}" != 1 ) || "${GITHUB_ACTIONS:-}" != true || "${NATIVE_SMOKE_QA:-}" != 1 ]]; then exit 1; fi
mkdir -p qa/build qa/output
command -v xcodegen >/dev/null || brew install xcodegen
UDID=$(xcrun simctl list devices available -j | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const d=Object.values(JSON.parse(s).devices).flat().find(x=>x.isAvailable&&x.name.startsWith("iPad"));if(!d)process.exit(1);console.log(d.udid)})')
xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
(cd qa/ios && xcodegen generate)
set +e
xcodebuild -project qa/ios/NativeSmoke.xcodeproj -scheme NativeSmoke -configuration Debug -destination "id=$UDID" -derivedDataPath qa/build/runner CODE_SIGNING_ALLOWED=NO -parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1 -only-testing:NativeSmokeTests/NativeSmokeTests/testRunnerInfrastructure -test-timeouts-enabled YES -default-test-execution-time-allowance 120 -maximum-test-execution-time-allowance 180 test > qa/build/ios-runner.raw 2>&1
STATUS=$?
node scripts/native-ios-test-diagnostics.mjs qa/build/ios-runner.raw xctest "$STATUS" | sed 's/^QA_JSON //' > qa/output/ios-runner.jsonl
PARSER_STATUS=${PIPESTATUS[0]}
cat qa/output/ios-runner.jsonl
exit $(( STATUS != 0 || PARSER_STATUS != 0 ))
