# Required updates (1.6.14+)

- The gate is in the app root, before sign-in is required. It rechecks on launch and foreground resume.
- Builds older than 1.6.14 have no gate and need one manual update. A newer app is never forced to downgrade.
- iOS uses the publicly available Korean App Store version, never TestFlight or App Store Connect review builds.
- Direct APK, Windows and Mac installs use published, non-prerelease GitHub releases with an uploaded installer asset for that platform.
- Public-source results have a shared five-minute database cache and an atomic refresh lease to avoid class-wide launch bursts exhausting upstream rate limits.
- Google Play installations are detected through Android's installer package. They must update through Google Play, never through a direct APK.
- Google Play has no public version API. Once a production release is **actually available to all intended users (100% rollout)**, the release operator must update `app_update_releases` using service-role/management access: `channel='android-play'`, numeric three-part `version`, exact URL `https://play.google.com/store/apps/details?id=com.paperly.study`, the real `published_at`, `enabled=true`. Then clear that channel's `app_update_cache.checked_at` and reset `refresh_after` to force refresh. Do not activate after only building/uploading an AAB, submitting review, or releasing to a closed test. Until a verified production policy exists, no Play gate is enforced.
- These tables have RLS enabled and no anon/authenticated grants; only the public `app.update` action returns a sanitized release record. No student information is sent to release sources.
- An unreachable update service alone does not lock an offline reader. A previously verified required update stays enforced from device storage, and an explicit valid policy withdrawal clears it.
- The required-update screen has no dismiss action; Android back is ignored. The OS/store still controls download and installation consent. Never silently install or delete the app/notes.

## Tests

```
node scripts/test-app-updates.js
node scripts/test-update-server.js
node scripts/test-pdf-scheduler.js
```

`test-app-updates` covers semantic version comparisons, platform/store separation, URL allowlists, modal/back behavior, offline fallback, cached enforcement and explicit withdrawal. `test-update-server` covers published-only discovery and persistent cache reuse. `test-pdf-scheduler` covers stale-work cancellation, shared leases, priority, bounded prefetch/LRU, errors and retries. Web tests do not replace device latency or native installation testing.
