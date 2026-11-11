# Bounded native smoke, synthetic data only

This is **Android emulator / iOS Simulator** infrastructure, not physical-device testing. No CI run or successful playback is claimed by adding it. Integrate the video/native changes before dispatching. Existing production jobs are unchanged.

## Isolation and dependencies

Only the manual `Native simulator smoke (QA only)` workflow runs this entry. `scripts/native-with-qa-entry.sh` backs up root `index.ts`, temporarily imports `qa/entry`, generates the PDF fixture, executes its command, and restores the exact source on exit. Prebuild and JS bundling must happen inside this wrapper. Production imports stay Expo Router; there is no production QA route or environment-controlled production backdoor. A forced machine termination may prevent the trap, so use a disposable checkout. Never publish this APK or simulator app.

The QA root registers directly with Expo, wraps SafeAreaProvider/GestureHandlerRootView, and injects four typed fixtures into the actual ReviewVideosScreen. It never authenticates or requests a real review list. All videos reference the public Blender Big Buck Bunny positive-control candidate `aqz-KE-bpKQ`; titles/passages/PDF are synthetic. Network access to YouTube, youtube-nocookie, thumbnails and Google media hosts is required. Public sample availability/embed policy/autoplay can change. A timeout or unavailable callback is a failing `network_or_player_*` outcome, never a playback pass. No student/account/admin code/secret is supplied.

Android uses API 36 x86_64 Google APIs emulator (Android version parity with the SM-X930 target only, not Samsung hardware emulation), Linux KVM, Java 17, Node 22, Android SDK and free built-in `adb uiautomator dump` plus coordinate taps derived from accessibility bounds. It builds a release-mode QA bundle with the generated project's local debug signing identity, not the production keystore. No APK is uploaded.

iOS uses macOS 15, Xcode 26.2, its installed iPad simulator runtime, CocoaPods, Node 22, Homebrew XcodeGen and built-in XCTest UI automation. A tiny Swift host/UI runner is generated from `qa/ios/project.yml`; `simctl` installs the unsigned simulator `.app`. No signing certificate, Apple account, paid device/cloud service, IPA export or App Store upload is used. Availability of that Xcode/runtime on the hosted image is an external dependency. Simulator behavior does not establish real-device decode performance, capture resistance, audio routing or lifecycle correctness.

## Commands

From repo root after `npm ci`:

```sh
node scripts/native-generate-pdf.mjs
NATIVE_SMOKE_QA=1 scripts/native-with-qa-entry.sh bash -c 'npx expo prebuild --platform android --no-install && cd android && ./gradlew :app:assembleRelease --no-daemon -PreactNativeArchitectures=x86_64'
# Boot an API36 x86_64 emulator first, then:
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

Driver deadline: Android 12 minutes; iOS XCTest 12-minute allowance/13-minute maximum. Workflow has separate bounded build and emulator steps and job timeouts. No retries hide a failure. Uploaded artifacts contain only sanitized JSONL QA events. Raw logs, accessibility XML, xcresults, PDFs, rendered images, APKs and simulator apps are **not** uploaded. Existing screen protection is retained in the QA root; if FLAG_SECURE makes pixels black, accessibility/status logs remain the evidence. Never weaken production protection to obtain screenshots.

## Failure-only symbol diagnostics

Run the local privacy/process-attribution regression suite without a device:

```sh
node --test qa/native-diagnostics.test.mjs
```

Android snapshots the last 8,000 threadtime logcat lines **before** reporting a missing main PID, including when startup failed before the first UI frame. It retains that snapshot in memory if a later adb read fails. Only failure handling emits diagnostic events; raw logcat is never printed to artifacts. Attribution uses observed app PIDs, app/app-worker Process headers, app-owned native tombstone headers and WebView sandbox launch records attributed to the app. Unrelated process crashes are excluded when identifiable. This is best effort: truncated logs or absent child attribution can prevent recovering a child stack; missing main process and UI/liveness failures still fail the suite, never pass it. Native frame parsing deliberately accepts only Android tombstone PC/library entries; an unparseable frame is omitted, not replaced with raw text.

`crash_java_exception` contains only a strict qualified exception class. `crash_java_frame` contains strict qualified class, method symbol and optional positive source line number, never a source filename. `crash_native_frame` contains only a validated `lib*.so` basename and up to 16 hex PC digits. `crash_ios_exception` contains only an allowlisted EXC/signal enum or fixed NS_EXCEPTION/CPP_TERMINATE enum, not exception text. Export limits per failure are 8 exception classes, 32 Java frames, 16 native frames and 8 iOS enums, deduplicated. The final sanitizer revalidates every field and drops diagnostics on a passing suite. Messages, paths, URLs, IDs, credentials, video identifiers and arbitrary extra JSON fields are never exported. The private-canary tests cover field stripping, invalid symbols, bounds, missing-main-PID startup crashes, worker frames, app-attributed WebView failures, unrelated system crashes and iOS enums. These are local parser/mocked-adb tests, not native playback or simulator pass evidence.

Player-unavailable telemetry retains only numeric YouTube codes 2/5/100/101/150/152/153 or fixed load/http/process/timeout/network enums. JS errors retain only standard exception-name enums and at most 32 fixed-allowlisted function names with bounded bundle line/column numbers. Unknown function names become the fixed `other` enum; paths, bundle names, URLs and messages are omitted. Android caches telemetry from every parsed XML and failure collection can take one XML snapshot without re-running a health check. iOS emits its fixed failure reason/step before XCTest aborts and retains the last telemetry snapshot. These diagnostics do not relax the 20-list-cycle, three-play/pause-cycle or three-PDF-trial requirements.

A bare caught `ReactNativeJS: Error:` console message is retained as a safe Error category only on suite failure; it does not by itself prove app death. Specific JS exception-name lines still trigger the JS error gate, while global uncaught-JS markers, native fatal/uncaught exceptions, missing-PID and actual WebView render-process-death checks remain failing gates. Before raising a detected native/JS fatal, Android makes one best-effort telemetry-only XML snapshot, without re-entering health checks.

### Explicit synthetic Android failure-image exception

Parent approved one additional private debug artifact: only after Android driver failure, inside the fresh API36 CI emulator before runner cleanup, `scripts/native-android-ci.sh` may capture a PNG. It requires GitHub Actions, an explicit synthetic-screenshot flag and `ro.kernel.qemu=1`. FLAG_SECURE and production protection remain fully enabled, so app pixels may be black; a blocking system dialog can still be informative. The workflow recreates the AVD and supplies only the synthetic QA bundle, no account/student content. This PNG is uploaded separately as `Synthetic-QA-failure-only-Android-screenshot`, retention **1 day**, for private diagnostic inspection, not completion proof. No real-user/device screenshot, raw XML or raw logs are uploaded. No dialog is dismissed. Successful runs produce no image. Image-capture failure cannot change the original driver/sanitizer failure result.

On Android failure, `driver_surface` adds fixed foreground (`app/launcher/permission/systemdialog/unknown`), XML package/source categories, bounded total/app/QA node counts, and known UI enums only. OS-dialog enums cover GMS/app crash, ANR, keyguard, debugger, permission, gesture tutorial, unknown or none when evidence exists. Raw node labels, package names, IDs, XML and dumpsys output are never exported. The two dumpsys queries are each bounded to 6 seconds. This report diagnoses the surface without dismissing anything or relaxing failure gates.

### Controlled public-video fixture experiment

For candidate 503, the parent reported that iOS reached boot/list-open/player-ready and then returned YouTube error 150 for `M7lc1UVf-VE`, with no host-process crash. That code indicates an owner/embed restriction; the same video reportedly played on web. The fixture/embed-context difference remains unresolved, and this is not evidence of an app fix. The next controlled experiment replaces all four synthetic list entries with public Blender Big Buck Bunny control `aqz-KE-bpKQ`. This replacement has not yet passed native CI. There is no automatic alternate-video fallback, retry-until-green or expected-error exemption: all unavailable responses still fail, and all 20 list cycles, three actual play/pause cycles and three PDF trials remain required.

### Candidate 229 emulator-environment experiment

The parent inspected the candidate-229 failure PNG and identified the exact OS headline `System UI isn’t responding`, not a Paperly ANR. The resource/GPU cause remains unproven. The next API36 emulator configuration uses 4 cores and 4096MB RAM only on hosts with at least 4 available cores and 6GiB total memory, a physical 1280x800 display at density160 (1280x800 logical tablet, DPR1), and current SwiftShader GLES with Vulkan disabled (`-gpu swiftshader -feature -Vulkan`). A pre-launch AVD-config script sets the physical display before boot rather than merely scaling the host window. App hardware acceleration, FLAG_SECURE, KVM and production source are unchanged. This is an unvalidated CI-environment experiment, not an app fix or a native-pass claim.

`scripts/native-android-preflight.mjs before_install` and `before_start` run inside the CI wrapper. Each check has a 60-second deadline, bounded adb commands (cold UIAutomator dump at most 12 seconds, all other commands at most 6 seconds, each constrained by the shared 60-second deadline), and requires two stable boot-complete/boot-animation-stopped/SystemUI-PID/active app-or-launcher/XML/display observations. Observed ANR/crash/blocking-dialog evidence fails immediately without dismissal or retry-until-green. Exact known OS headline plus ANR controls yields `emulator_system_ui_anr`; other ANRs yield `emulator_app_anr`. Missing readiness, mismatched display and insufficient runner capacity fail with separate fixed enums. A failed preflight prevents install/start as applicable; it never converts an app ANR into an environment pass. The approved synthetic failure-only screenshot can also diagnose a preflight stop. All existing app/video/PDF gates remain required after preflight succeeds.

Reference options: https://developer.android.com/studio/run/emulator-acceleration and https://developer.android.com/studio/run/emulator-troubleshooting document `swiftshader` and `-feature -Vulkan`. The runner's `cores`, `ram-size` and `pre-emulator-launch-script` inputs are documented at https://github.com/ReactiveCircus/android-emulator-runner .

### Readiness visibility and platform-isolated diagnostic runs

The parent observed candidate-204 Android timing out before install while its private failure PNG showed a normal 1280x800 launcher. The earlier scoped `dumpsys window windows` query could omit focus. Preflight now queries full `dumpsys window`, accepts explicit focused-window/display evidence, or uses a resumed-activity fallback only when the full dump contains no explicit window focus. Explicit null/unknown focus is never overridden by a stale activity; ANR, permission, keyguard and dialog checks still block readiness. Every UI dump first removes its own previous XML file so a timed-out dump cannot reuse stale success. No XML or dumpsys content is exported. Failure-only `emulator_readiness` contains fixed boolean boot/animation/PID/XML/focus/display criteria, safe focus source/kind enums and a fixed missing-criteria enum list. This diagnoses the missing criterion without claiming an environment fix before rerun.

Manual workflow input `platform` is `all` by default, with `android` or `ios` for isolated diagnostics:

```sh
gh workflow run native-smoke.yml --ref YOUR_INTEGRATED_BRANCH -f platform=android
gh workflow run native-smoke.yml --ref YOUR_INTEGRATED_BRANCH -f platform=ios
gh workflow run native-smoke.yml --ref YOUR_INTEGRATED_BRANCH -f platform=all
```

Concurrency includes the selected platform and does not cancel in-progress work, allowing a new Android diagnostic alongside an older iOS build. Unselected platform jobs are skipped. A single-platform diagnostic is **not release evidence**: the existing exact-commit release guard still requires both `android` and `ios` jobs to have completed successfully in the verified run and rejects either skipped job. No release-gate implementation was weakened.
