const { withMainApplication } = require('expo/config-plugins');
const guard = 'if (android.os.Process.myUid() % 100000 in 90000..99999) return';
/** The isolated FD-only PDF service must not start RN/Expo, storage or account listeners. */
function protectIsolatedApplication(source) {
  const points = [
    ['PDF_DETAIL_ISOLATED_CREATE', /(override fun onCreate\(\)\s*\{\s*super\.onCreate\(\))/g],
    ['PDF_DETAIL_ISOLATED_CONFIG', /(override fun onConfigurationChanged\(newConfig: Configuration\)\s*\{\s*super\.onConfigurationChanged\(newConfig\))/g],
  ];
  for (const [marker, pattern] of points) {
    const addition = `// ${marker}\n    ${guard}`;
    if (source.includes(marker)) {
      if (!source.includes(addition)) throw new Error('Invalid existing isolated PDF Application guard: ' + marker);
      continue;
    }
    if ([...source.matchAll(pattern)].length !== 1) throw new Error('Unsupported Kotlin MainApplication anchor: ' + marker);
    source = source.replace(pattern, match => `${match}\n    ${addition}`);
  }
  return source;
}
module.exports = function withPdfDetailProcess(config) {
  return withMainApplication(config, mod => {
    if (mod.modResults.language !== 'kt') throw new Error('Isolated PDF Application guard requires the Kotlin template.');
    mod.modResults.contents = protectIsolatedApplication(mod.modResults.contents);
    return mod;
  });
};
module.exports.protectIsolatedApplication = protectIsolatedApplication;
