// Android versionCode follows the app version (1.6.9 -> 10609), so the sideload APK and the
// Play bundle of one version share a code and every new version uploads with a higher one.
// Everything else comes from app.json unchanged.
//
// Over-the-air JS patches (expo-updates) switch on only when an Expo project is linked, because a
// binary has to carry its update URL and channel from build time. Link it with either
// `extra.eas.projectId` in app.json (`eas update:configure` writes it) or EXPO_PROJECT_ID in the
// build environment (a repository variable, so no secret leaks into a fork's build log).
// Without one, `updates.enabled` is false and the app runs the bundle inside the build only.
// runtimeVersion uses the `appVersion` policy: a patch reaches exactly the version it was exported
// for, never a build whose native code changed. See docs/ota-updates.md.
const CHANNEL = process.env.EXPO_UPDATES_CHANNEL || 'production';

module.exports = ({ config }) => {
  const [major = 0, minor = 0, patch = 0] = String(config.version || '0.0.0')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const projectId = String(process.env.EXPO_PROJECT_ID || (config.extra && config.extra.eas && config.extra.eas.projectId) || '').trim();
  const updatesUrl = (process.env.EXPO_UPDATES_URL || (projectId ? `https://u.expo.dev/${projectId}` : '')).trim();
  if (!updatesUrl) {
    console.warn('expo-updates: no Expo project linked (EXPO_PROJECT_ID or extra.eas.projectId); OTA patches are off in this build.');
  }
  return {
    ...config,
    android: { ...config.android, versionCode: major * 10000 + minor * 100 + patch },
    runtimeVersion: { policy: 'appVersion' },
    updates: updatesUrl
      ? {
          url: updatesUrl,
          enabled: true,
          // Download after the reader is up, never in front of it; the patch applies on the next launch.
          checkAutomatically: 'ON_LOAD',
          fallbackToCacheTimeout: 0,
          // Builds made outside Expo Build carry no channel, so the channel travels as a request header
          // (applied by `npx expo prebuild` to Expo.plist / AndroidManifest.xml).
          requestHeaders: { 'expo-channel-name': CHANNEL },
        }
      : { enabled: false },
    extra: { ...(config.extra || {}), ...(projectId ? { eas: { ...((config.extra && config.extra.eas) || {}), projectId } } : {}) },
  };
};
