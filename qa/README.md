# Bounded native smoke, synthetic data only

This is **Android emulator / iOS Simulator** infrastructure, not physical-device testing. No CI run or successful playback is claimed by adding it. Integrate the video/native changes before dispatching. Existing production jobs are unchanged.

## Isolation and dependencies

Only the manual `Native simulator smoke (QA only)` workflow runs this entry. `scripts/native-with-qa-entry.sh` backs up root `index.ts`, temporarily imports `qa/entry`, generates the PDF fixture, executes its command, and restores the exact source on exit. Prebuild and JS bundling must happen inside this wrapper. Production imports stay Expo Router; there is no production QA route or environment-controlled production backdoor. A forced machine termination may prevent the trap, so use a disposable checkout. Never publish this APK or simulator app.

The QA root registers directly with Expo, wraps SafeAreaProvider/GestureHandlerRootView, and injects four typed fixtures into the actual ReviewVideosScreen. It never authenticates or requests a real review list. All videos reference public YouTube IFrame API sample `M7lc1UVf-VE`; titles/passages/PDF are synthetic. Network access to YouTube, youtube-nocookie, thumbnails and Google media hosts is required. Public sample availability/embed policy/autoplay can change. A timeout or unavailable callback is a failing `network_or_player_*` outcome, never a playback pass. No student/account/admin code/secret is supplied.

Android uses API 35 x86_64 Google APIs emulator, Linux KVM, Java 17, Node 22, Android SDK and free built-in `adb uiautomator dump` plus coordinate taps derived from accessibility bounds. It builds a release-mode QA bundle with the generated project's local debug signing identity, not the production keystore. No APK is uploaded.

iOS uses macOS 15, Xcode 26.2, its installed iPad simulator runtime, CocoaPods, Node 22, Homebrew XcodeGen and built-in XCTest UI automation. A tiny Swift host/UI runner is generated from `qa/ios/project.yml`; `simctl` installs the unsigned simulator `.app`. No signing certificate, Apple account, paid device/cloud service, IPA export or App Store upload is used. Availability of that Xcode/runtime on the hosted image is an external dependency. Simulator behavior does not establish real-device decode performance, capture resistance, audio routing or lifecycle correctness.

## Commands

From repo root after `npm ci`:

```sh
node scripts/native-generate-pdf.mjs
NATIVE_SMOKE_QA=1 scripts/native-with-qa-entry.sh bash -c 'npx expo prebuild --platform android --no-install && cd android && ./gradlew :app:assembleRelease --no-daemon -PreactNativeArchitectures=x86_64'
# Boot an API35 x86_64 emulator first, then:
adb install android/app/build/outputs/apk/release/app-release.apk
mkdir -p qa/build
node scripts/native-android-smoke.mjs > qa/build/android.raw 2>&1
node scripts/native-sanitize.mjs qa/build/android.raw qa/output/android.jsonl android

NATIVE_SMOKE_QA=1 scripts/native-with-qa-entry.sh bash -c 'npx expo prebuild --platform ios --no-install && (cd ios && pod install) && scripts/native-ios-smoke.sh'
# Once integrated and committed by the parent, dispatch explicitly:
gh workflow run native-smoke.yml --ref YOUR_INTEGRATED_BRANCH
```

Both drivers open/close the list 20 times, and load/observe ready, play, pause and close the actual player in the first three cycles. They verify returning to list and root. Controls use existing accessible Korean labels; fixture card is `QA Video 1 재생`. Root has `open-review-videos` label/testID. Visible QA state includes cumulative `qa-ready-N`, `qa-playing-N`, `qa-paused-N`, `qa-unavailable-N`. A very small visible telemetry element provides structured numeric records through accessibility even when release console forwarding is unavailable. Global JS exception handler and React error boundary produce `qa-js-error`; process liveness and Android logcat detect native/process failures. iOS XCTest checks foreground liveness throughout, plus captured app system logs are scanned. OS termination before the first frame is a failure, not classified as network failure.

PDF fixture generator creates a compact, compressed, valid two-page PDF TS base64 string, with exactly 100,000 stroked vector curves on page 0 and simple Helvetica text on page 1. It is generated locally/CI, not committed as a large payload. App writes a local cache PDF via expo-file-system/legacy, imports it through the real native encrypting importFile API, validates page count, and runs three cold imports. Each submits 2400px page-0 detail, then 900px page-1 reading after a 25ms dispatch lead. Log records include request elapsed time, completion order and allowlisted takeRenderTimings values, never image/file paths or pixels. Every trial is bounded at 90 seconds. Native work cannot be cancelled by the JS timeout; the outer driver/job deadline is the final bound.

Scheduling assertion is relative, not a hard speed threshold: all three native detail durations must exceed the reading duration plus dispatch lead, and all three reading completions must precede detail to pass. Repeatable detail-first under that discriminating load fails. Mixed ordering, inadequate load separation or missing telemetry cannot establish independence; they report inconclusive/failure and fail CI for investigation, not a fake success or a guaranteed hardware-speed regression.

Driver deadline: Android 12 minutes; iOS XCTest 12-minute allowance/13-minute maximum. Workflow has separate bounded build and emulator steps and job timeouts. No retries hide a failure. Uploaded artifacts contain only sanitized JSONL QA events. Raw logs, accessibility XML, xcresults, screenshots, PDFs, rendered images, APKs and simulator apps are **not** uploaded. Existing screen protection is retained in the QA root; if FLAG_SECURE makes pixels black, accessibility/status logs remain the evidence. Never weaken production protection to obtain screenshots.
