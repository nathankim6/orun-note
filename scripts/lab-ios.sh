#!/usr/bin/env bash
# Viewer lab on the iOS simulator (QA only, synthetic page). Builds the app with the lab entry, runs the scripted
# magnification steps and leaves screenshots + analysis in lab-out/ios. Same simulator signing as native-ios-smoke.sh.
set -euo pipefail
if [[ ( "${CI:-}" != "true" && "${CI:-}" != "1" ) || "${GITHUB_ACTIONS:-}" != "true" || "${NATIVE_SMOKE_QA:-}" != "1" ]]; then echo "lab requires CI QA" >&2; exit 1; fi
mkdir -p lab-out/ios qa/build
UDID=$(xcrun simctl list devices available -j | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const d=Object.values(JSON.parse(s).devices).flat().find(x=>x.isAvailable&&x.name.startsWith("iPad"));if(!d)process.exit(1);console.error("device",d.name);console.log(d.udid)})')
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
export PAPERLY_IOS_QA_SIGNING=1
QA_ENTITLEMENTS="$PWD/qa/build/simulator.entitlements"
SOURCE_ENTITLEMENTS=$(find ios -maxdepth 2 -name '*.entitlements' -not -path '*/Pods/*' | head -1)
[[ -n "$SOURCE_ENTITLEMENTS" ]] || { echo lab_entitlements_source_missing >&2; exit 1; }
node scripts/native-ios-signing.mjs prepare-xcode "$SOURCE_ENTITLEMENTS" "$QA_ENTITLEMENTS"
build_simulator() {
  xcodebuild -workspace ios/Paperly.xcworkspace -scheme Paperly -configuration Release -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath qa/build/app CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" PROVISIONING_PROFILE_SPECIFIER="" CODE_SIGN_ENTITLEMENTS="$QA_ENTITLEMENTS" build
}
if ! build_simulator > qa/build/ios-build.raw 2>&1; then
  if grep -Eiq '(Sign in with Apple|com\.apple\.developer\.applesignin).*(requires|support|provision|team)|(requires|support|provision|team).*(Sign in with Apple|com\.apple\.developer\.applesignin)' qa/build/ios-build.raw; then
    node scripts/native-ios-signing.mjs prepare-xcode "$SOURCE_ENTITLEMENTS" "$QA_ENTITLEMENTS" strip-siwa
    build_simulator >> qa/build/ios-build.raw 2>&1 || { grep -E "error:" qa/build/ios-build.raw | head -40; echo lab_build_failed >&2; exit 1; }
  else grep -E "error:" qa/build/ios-build.raw | head -40; echo lab_build_failed >&2; exit 1; fi
fi
APP=qa/build/app/Build/Products/Release-iphonesimulator/Paperly.app
mkdir -p lab-out/ios-app && cp "$QA_ENTITLEMENTS" "$(dirname "$APP")/simulator.entitlements" && tar -czf lab-out/ios-app/Paperly.app.tgz -C "$(dirname "$APP")" Paperly.app simulator.entitlements || echo "app archive skipped"
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch "$UDID" com.paperly.study
CONTAINER=$(xcrun simctl get_app_container "$UDID" com.paperly.study data)
set +e
node scripts/lab-drive-ios.mjs "$UDID" "$CONTAINER" lab-out/ios
STATUS=$?
cp "$CONTAINER/Documents/lab-state.json" lab-out/ios/final-state.json 2>/dev/null
node scripts/lab-analyze.mjs lab-out/ios
exit $STATUS
