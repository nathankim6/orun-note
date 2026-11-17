# Over-the-air JS patches (expo-updates)

Submarine patches: a JavaScript/UI fix reaches installed apps without a new store submission.
One binary carries the update URL, channel and runtime version; after that only the JS is replaced.

## What a patch can and cannot do

- Can: screens, wording, layout, logic, styles, non-native libraries, bug fixes in `src/`, `app/`.
- Cannot: native code, permissions, app icon, splash, native modules (`modules/pdf-renderer`,
  `modules/stylus-shortcut`), SDK/Expo upgrades, anything in `ios/`/`android/` after prebuild.
  Those need a store release, and the patch for the old binary stops applying at that version anyway.
- Apple 3.3.2 and Google Play allow interpreted-code updates that do not change the app's core
  purpose. A patch may not turn the reader into a different product or add paid features.

## Behaviour on the device

- Launch: the native `checkAutomatically: "ON_LOAD"` check runs after the reader is up
  (`fallbackToCacheTimeout: 0`, so `EXUpdatesLaunchWaitMs`/`EXPO_UPDATES_LAUNCH_WAIT_MS` is 0 and a
  patch never delays a lesson). The download continues in the background.
- Foreground resume: `useOtaUpdateResumeCheck()` in `app/_layout.tsx` re-checks quietly, at most once
  per 30 minutes, because a class tablet can stay open for days. It downloads at most one patch at a time.
- Apply: on the next cold start. Nothing in the app calls `reloadAsync()` mid-session, so unsaved ink,
  scroll position and open documents are never thrown away.
- Failure: a missing network, a withdrawn channel or a malformed manifest leaves the running bundle
  in place (`fetchPatchQuietly` returns `failed`). Anti-bricking measures stay on, so a patch that
  crashes before the first render is rolled back by the native module.
- Web, macOS and Windows builds have no OTA runtime and never check.

## runtimeVersion

`runtimeVersion: { policy: "appVersion" }` in `app.config.js`: the runtime version is the app version
from `app.json` (1.6.19 → `1.6.19`). A patch published for 1.6.19 is served only to 1.6.19 builds; a
build with any other version, or any other native code, is never offered it. Every store release
therefore starts from its own embedded bundle.

## Configuration

All of it lives in `app.config.js`; nothing is written into `app.json` so there is one place to read.

| app config | iOS (`Expo.plist`) | Android (`AndroidManifest.xml`) |
| --- | --- | --- |
| `updates.url` | `EXUpdatesURL` | `expo.modules.updates.EXPO_UPDATE_URL` |
| `updates.enabled` | `EXUpdatesEnabled` | `expo.modules.updates.ENABLED` |
| `updates.checkAutomatically: "ON_LOAD"` | `EXUpdatesCheckOnLaunch = ALWAYS` | `EXPO_UPDATES_CHECK_ON_LAUNCH = ALWAYS` |
| `updates.fallbackToCacheTimeout: 0` | `EXUpdatesLaunchWaitMs = 0` | `EXPO_UPDATES_LAUNCH_WAIT_MS = 0` |
| `updates.requestHeaders.expo-channel-name` | `EXUpdatesRequestHeaders` | `UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY` |
| `runtimeVersion` | `EXUpdatesRuntimeVersion` | `EXPO_RUNTIME_VERSION` → `@string/expo_runtime_version` |

The Expo project is resolved from `EXPO_PROJECT_ID` or `extra.eas.projectId`. With neither, the config
writes `enabled: false` and no URL, prints a warning during prebuild, and the build behaves exactly as
before this change (no update checks, embedded bundle only). `EXPO_UPDATES_CHANNEL` (default
`production`) picks the channel for preview builds; `EXPO_UPDATES_URL` overrides the service URL for a
self-hosted implementation of the same protocol.

## Activating it (once)

1. Create or sign in to an Expo account (free) and link this repo as a project:
   `npx eas-cli@latest init` (or paste `"extra": { "eas": { "projectId": "…" } }` into `app.json`,
   which is what `eas update:configure` does).
2. Put the project id in the repo as the `EXPO_PROJECT_ID` variable (Settings → Secrets and variables
   → Actions → Variables) and an access token (expo.dev → Access tokens) as the `EXPO_TOKEN` secret.
3. Create the channel that the binaries listen on: `npx eas-cli@latest channel:create production`.
4. Build and ship one store release after that. **Only a binary that carries the URL can receive
   patches**, so a version submitted before step 1 never updates over the air.
5. First verify with a trivial patch (a wording change), then with the real fix.

Free plan: patches reach 1,000 monthly active users (Starter, $19/month, 3,000). Native build minutes
are irrelevant here — this repo builds with its own GitHub Actions runners.

## Publishing a patch

- GitHub Actions → **OTA JS patch (expo-updates)** → Run workflow: branch (`production`), message,
  platforms, and `ref` = the tag/commit the shipped build was made from. The workflow type-checks,
  runs the OTA gate, prints the runtime version it is about to target, then publishes.
- From a laptop: `EXPO_TOKEN=… npx eas-cli@latest update --branch production --message "…"`.
- Publish from the commit that matches the installed version. Exporting from `main` while `app.json`
  says 1.6.20 publishes to the 1.6.20 runtime and the 1.6.19 installs stay on their bundle.
- `EXPO_UPDATES_CHANNEL=preview npx eas-cli@latest update --branch preview --message "…"` builds a
  trial patch; a binary needs the preview channel baked in (`EXPO_UPDATES_CHANNEL=preview` before
  prebuild) to test it.
- A patch carries the whole JS bundle (the Hermes `.hbc` is ~6 MB here) plus the assets that changed,
  so publish over school Wi-Fi outside lesson time and expect the download to land on the next cold
  start, not instantly.

## Rolling back

- `npx eas-cli@latest update:rollback` (interactive) or `--group <id>` with `--non-interactive`:
  republishes the previous update group so clients receive it instead.
- `npx eas-cli@latest update:republish --group <id>` republishes a chosen group directly.
- `npx eas-cli@latest update:roll-back-to-embedded --branch production --runtime-version 1.6.19`
  tells clients to stop using downloaded updates and run the bundle inside the build.
- `npx eas-cli@latest channel:pause production` stops all deliveries without publishing anything.

## Tests

```
node scripts/test-ota-updates.js
```

Covers: OTA off without a linked project, URL/channel/`ON_LOAD`/no-launch-wait wiring, `appVersion`
runtime version, the throttle matrix, web/no-OTA platforms, fail-open downloads, no mid-session
reload, and unmount cleanup. Prebuild output (`Expo.plist`, `AndroidManifest.xml`,
`strings.xml`) was verified for both the linked and unlinked cases; a device install of a downloaded
patch is still the release operator's check, like `docs/update-policy.md` requires for the
required-update gate.
