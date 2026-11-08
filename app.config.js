// Android versionCode follows the app version (1.6.9 -> 10609), so the sideload APK and the
// Play bundle of one version share a code and every new version uploads with a higher one.
// Everything else comes from app.json unchanged.
module.exports = ({ config }) => {
  const [major = 0, minor = 0, patch = 0] = String(config.version || '0.0.0')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  return {
    ...config,
    android: { ...config.android, versionCode: major * 10000 + minor * 100 + patch },
  };
};
