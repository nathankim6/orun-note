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

Android snapshots the last 8,000 threadtime logcat lines **before** reporting a missing main PID, including when startup failed before the first UI frame. It retains that snapshot in memory if a later adb read fails. Only failure handling emits diagnostic events; raw logcat is never printed to artifacts. Attribution uses chronological app/app-worker Process headers, app-owned named native tombstones and WebView sandbox launch records attributed to the app. A currently observed PID alone is uncertain, not historical ownership. Unrelated process crashes are excluded when identifiable. This is best effort: truncated logs or absent child attribution can prevent recovering a child stack; missing main process and UI/liveness failures still fail the suite, never pass it. Native frame parsing deliberately accepts only Android tombstone PC/library entries; an unparseable frame is omitted, not replaced with raw text.

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

### PDF-first failure-stage diagnostics only

The parent reported that candidate-204 iOS reached boot then failed the PDF-first step before any render-completion/timing records. The failing operation and cause remain unknown. QA now records fixed `pdf_stage` events with trial1–3 before `write_source`, `import`, `info`, `render_detail`, `render_reading`, `await_render`, `timings` and `cleanup`. `pdf_failure` and the root `pdf_result` retain the original safe stage/trial/reason; a later cleanup failure is secondary and cannot replace the first failure. Async detail/reading rejection preserves its own lane-stage rather than being mislabeled as the await stage.

Reason enums map exact QA-owned failures (`reading_api_missing`, `fixture_pages`, `render_timeout`, `missing_native_timings`, `reading_serialized`), or an observed native `keychain -34018` / `keychain -25308` phrase to `keychain_entitlement` / `keychain_locked`. These are bounded diagnostic categories, not an entitlement/locked-device causal conclusion. Unknown errors/status codes become `operation_failed`. Raw messages, unknown status values, paths, URIs, imported IDs and credentials are never copied into markers or rethrown QA failure objects. The sanitizer independently validates stage, trial and reason, strips private fields and rejects any attempt to pass after a PDF failure. The existing three-trial relative-order requirement and 90-second render deadline are unchanged.

The parent reported the workflow as manually disabled; this diagnostic change does not re-enable it, dispatch it, alter signing or work around platform keychain/crypto behavior. Any decision to resume the workflow remains with the user. No native success or cause is claimed from local mocked tests.

### Region JPEG loadability and dimensions on both native platforms

Each of the three PDF trials now retains the actual 900px reading URI, then calls the real native `renderRegion` on page1 at page width2400 with crop x300/y100/width900/height600. React Native `Image.getSize` must successfully load both returned URIs. Region dimensions must be exactly900x600; reading dimensions must be900px wide and `900 * info.pages[1].height / info.pages[1].width` high within1px. The generated fixture is612x792 points, so expected reading height is approximately1164.706px (1164 or1165 accepted), **not1200px from a mistaken600x800 assumption**. Invalid metadata, unreadable images or wrong dimensions fail the gate.

New fixed stages are `region` and `image_load`; fixed reasons include `fixture_dimensions`, `image_load_failed` and `raster_dimensions`. `pdf_raster` payloads contain numbers only: raster0=reading/1=region, status1=accepted/0=failed, trial, measured/expected dimensions and tolerance0or1px when known. No URI or native image error text is logged. Parallel detail+reading, region render and both image loads share **one90-second deadline from detail start per trial**, with decreasing remaining timers and a post-await deadline check; it is not90seconds per operation. Native work still cannot be cancelled by a JS timeout. This verifies actual native-region URI loadability and dimensions, not physical-pixel appearance, iPad sharpness, physical-device behavior or a speed claim. Both platforms retain all three trials,20list cycles and three content-progress/play/pause cycles.

### Explicit no-boot-animation CI mode (main QA only)

The parent’s v2 API36 diagnostic recorded an awake device, successful empty `init.svc.bootanim`, normal launcher and expected display; a first `null_root` UIA result was followed later by fresh nodes after wake plus elapsed time. API35’s first UIA was already fresh. These observations do **not** establish sleep or waking as the cause of the XML difference.

The Android native-smoke emulator launch explicitly uses `-no-boot-anim`. Only that action step now sets `NATIVE_SMOKE_BOOT_ANIMATION_DISABLED=1`. Preflight may classify a **successful empty** boot-animation property as disabled only when the explicit flag is true, `GITHUB_ACTIONS=true`, and a successful `ro.kernel.qemu` query returns exactly1. It reports boolean `bootAnimationDisabled` separately from `bootAnimationStopped`; empty is never relabeled stopped. Without any prerequisite, or for a running/other/failed property, the animation criterion remains unsatisfied. Normal successful `stopped` remains valid without this special mode.

A normal `KEYCODE_WAKEUP` setup call is allowed only after confirmed CI+qemu identity, inside the unchanged60-second budget. It does not unlock, dismiss dialogs, toggle power, root the guest or change security/protection. Two consecutive fresh XML observations with normal focus, correct display, completed boot and live SystemUI are still required; a failed/stale/no XML, app/SystemUI ANR, keyguard, permission dialog or other blocked state still fails. All native app/video/PDF/release gates remain unchanged. This is an expected emulator-mode correction, not native-app success or proof of a runtime fix.

### Temporal Android attribution and immutable trigger evidence

Android log ownership is chronological: an explicit app/worker process header or an app-attributed WebView launch owns only its subsequent lifetime. A Java `FATAL EXCEPTION` immediately preceding its matching process header is retained; a later reused numeric PID cannot retroactively own earlier history. Named tombstones recover dead main/worker crashes without a live PID, but reporter PIDs are never process ownership. New tombstone headers reset reporter context. Current PID matches without explicit historical ownership remain uncertain and fail the driver as `native_evidence_uncertain`, not a claimed app root cause. Truncated logs and absent child ownership can still prevent attribution; PID loss, genuine fatal/ANR, UI and timeout gates are not waived.

The driver freezes the exact triggering log snapshot/report in memory before failure collection. Later logcat is separately labelled `collection` and cannot substitute trigger frames/category or its failure reason. Raw snapshots, process names/PIDs, messages, URIs and timestamps are not exported. New `driver_evidence`, `driver_milestones` and `driver_telemetry` metadata use fixed enums/booleans and bounded numeric counters only, retained only on failure by the sanitizer. Existing separately validated code-symbol diagnostics remain failure-only. Milestones record fresh observations during this invocation, not inferred progress or native success.

Every regular and failure-only UI read removes `qa.xml`, requires successful dump and nonempty recreated file, then validates hierarchy/nodes. Failed recreation cannot advance a wait or milestone. Cached telemetry/surface summaries are explicitly labelled cached, including when new XML lacks valid telemetry. A matching actionable snapshot may still serve one tap for at most 500ms; actions invalidate it. Post-ready reads use `ready_controls` and post-progress reads `progress_controls`, never a stale `wait_ready` stage. All 20 list cycles, three real content-progress plays, three native PDF region/decoded-image trials and existing 90s PDF/60s content/15s initial-PID bounds remain unchanged. Local tests do not establish native success, startup crash or root cause; release still requires genuine same-SHA Android and iOS validation.

## Isolated Android provider-context diagnostic

Branch `qa/android-player-context-1616` instruments only the existing provider onError path. It records booleans for the enclosing origin/base, iframe origin parameter, secure context, ready state and document-referrer presence, an allowlisted iframe host kind and bounded viewport dimensions. No URLs, IDs, headers or messages leave the runtime. These values do NOT prove the actual HTTP Referer header or the provider's underlying policy decision. Error 150 remains an immediate full-suite failure, with no alternate video/host/identity/retry or external playback. The original fixture, API options, native drivers, PDF trials and suite gates are unchanged. The Android job is renamed `android-diagnostic-player-context`, so this branch cannot satisfy the release gate. Dispatch Android only; main stays unchanged.

### Public provider metadata observation (no playback or gate result)

`native-provider-diagnostic.yml` runs a single ordinary, unauthenticated public watch-page request for the existing fixture, without cookies, auth, custom headers, alternate videos or retries. It extracts JSON without evaluation and emits only allowlisted provider status/reason enums and `playableInEmbed` when explicitly present. No page text, IDs, URLs, arbitrary reasons or metadata are uploaded. Requests have a 20-second timeout and 8MiB response bound. A redirect, consent/network failure or missing JSON remains unavailable, not evidence of embedding permission. Collection success is NOT video playback, native validation, or a release gate. Provider metadata on a different hosted runner cannot establish the exact Android request's server decision; it only distinguishes public availability/policy evidence from app-embed observations. The same full native tests and provider failure handling remain required.

The prior Android request-map observation recorded embed Referer presence with matching app origin while the API returned error150. This is Android header-map evidence, not packet/wire proof. Official IFrame API docs define150 as the101 embedding-refusal error;153 is the separate missing Referer/equivalent-client-ID error. Do not substitute one for the other or change the fixture/gates to get green: https://developers.google.com/youtube/iframe_api_reference#onError .
