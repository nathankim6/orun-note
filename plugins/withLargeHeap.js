// Big textbooks: PdfBox text extraction and v1 file decryption run on the Java heap. largeHeap raises the per-app limit
// (typically 256 -> 512 MB on tablets) so a heavy page can't run the app out of memory.
const { withAndroidManifest } = require('expo/config-plugins');
module.exports = function withLargeHeap(config) {
  return withAndroidManifest(config, (c) => { const app = c.modResults.manifest.application?.[0]; if (app) app.$['android:largeHeap'] = 'true'; return c; });
};
