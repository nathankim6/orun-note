// Android: all ink is persisted as ONE AsyncStorage value (paperly:ink). AsyncStorage's SQLite store is capped at 6 MB
// (writes beyond it fail silently: new ink is not saved) and Android reads a row through a 2 MB CursorWindow (a larger
// value cannot be read back at start-up: the app starts with no ink and the next save overwrites the old ink).
// A student with a lot of handwriting (plus page versions) reaches both. This raises the database cap and the
// CursorWindow size so the existing value can always be written and read back.
const { withGradleProperties, withMainApplication } = require('expo/config-plugins');
const MARK = '// orun-note: large CursorWindow (ink storage)';
module.exports = function withInkStorageLimits(config) {
  config = withGradleProperties(config, (c) => {
    const props = c.modResults.filter((p) => !(p.type === 'property' && p.key === 'AsyncStorage_db_size_in_MB'));
    props.push({ type: 'property', key: 'AsyncStorage_db_size_in_MB', value: '1024' });
    c.modResults = props; return c;
  });
  return withMainApplication(config, (c) => {
    let src = c.modResults.contents; if (src.includes(MARK)) return c;
    const kotlin = c.modResults.language === 'kt';
    const snippet = kotlin
      ? `\n    ${MARK}\n    try { val f = android.database.CursorWindow::class.java.getDeclaredField("sCursorWindowSize"); f.isAccessible = true; f.set(null, 64 * 1024 * 1024) } catch (e: Throwable) { }\n`
      : `\n    ${MARK}\n    try { java.lang.reflect.Field f = android.database.CursorWindow.class.getDeclaredField("sCursorWindowSize"); f.setAccessible(true); f.set(null, 64 * 1024 * 1024); } catch (Throwable e) { }\n`;
    const re = kotlin ? /(override fun onCreate\(\)\s*\{\s*\n\s*super\.onCreate\(\)\s*\n)/ : /(public void onCreate\(\)\s*\{\s*\n\s*super\.onCreate\(\);\s*\n)/;
    if (!re.test(src)) throw new Error('withInkStorageLimits: MainApplication.onCreate not found');
    c.modResults.contents = src.replace(re, `$1${snippet}`); return c;
  });
};
