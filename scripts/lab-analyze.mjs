// Reads viewer-lab screenshots (PNG) and reports, per resolution grating, how much of the black/white modulation
// survives on screen. A grating whose bars are >= ~2 device px wide keeps a modulation near 1 when the page is shown
// from a raster with enough pixels (or a vector tile); a stretched low-resolution raster flattens it towards 0.
// Usage: node scripts/lab-analyze.mjs <dir>   (pairs <name>.png with <name>.json written by the lab driver)
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw Error('not png');
  let p = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), kind = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len); p += 12 + len;
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; } else if (kind === 'IDAT') idat.push(data); else if (kind === 'IEND') break; }
  if (interlace || ![8, 16].includes(depth) || ![0, 2, 4, 6].includes(type)) throw Error(`unsupported png depth=${depth} type=${type} interlace=${interlace}`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type], bps = depth / 8, bpp = ch * bps, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), out = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) { const a = i >= bpp ? out[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0; let v = row[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[i] = v & 255; } }
  const lum = (x, y) => { const o = y * stride + x * bpp; if (ch < 3) return px[o]; return 0.2126 * px[o] + 0.7152 * px[o + bps] + 0.0722 * px[o + 2 * bps]; };
  return { width: w, height: h, lum };
}
/** Modulation of the column profile inside a grating rect: (P90 − P10) / 255 over the middle band. */
export function modulation(img, r) {
  const x0 = Math.max(0, Math.ceil(r.x + r.w * 0.08)), x1 = Math.min(img.width - 1, Math.floor(r.x + r.w * 0.92)), y0 = Math.max(0, Math.ceil(r.y + r.h * 0.3)), y1 = Math.min(img.height - 1, Math.floor(r.y + r.h * 0.7));
  if (x1 - x0 < 6 || y1 - y0 < 2) return null;
  const cols = []; for (let x = x0; x <= x1; x++) { let s = 0; for (let y = y0; y <= y1; y++) s += img.lum(x, y); cols.push(s / (y1 - y0 + 1)); }
  const sorted = [...cols].sort((a, b) => a - b), q = f => sorted[Math.min(sorted.length - 1, Math.floor(f * (sorted.length - 1)))];
  return (q(0.9) - q(0.1)) / 255;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2]; const rows = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.png')).sort()) {
    const meta = path.join(dir, f.replace(/\.png$/, '.json')); if (!fs.existsSync(meta)) continue;
    try { const st = JSON.parse(fs.readFileSync(meta, 'utf8')); const img = decodePng(fs.readFileSync(path.join(dir, f))); const shot = f.replace(/\.png$/, '');
      const measure = rects => rects.map(r => ({ barPt: r.bar, barPx: +r.barPx.toFixed(2), modulation: (m => m == null ? null : +m.toFixed(2))(modulation(img, r)) }));
      // a compositing-matrix shot carries one set of gratings per cell; any other shot the page's own target
      if (Array.isArray(st.matrix) && shot.startsWith('matrix')) for (const cell of st.matrix) rows.push({ shot: `${shot}:${cell.name}`, size: `${img.width}x${img.height}`, gratings: measure(cell.rects ?? []) });
      else rows.push({ shot, size: `${img.width}x${img.height}`, gratings: measure(st.target?.rects ?? []) }); }
    catch (e) { rows.push({ shot: f, error: String(e.message ?? e) }); }
  }
  fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(rows, null, 1));
  for (const r of rows) console.log(r.error ? `${r.shot}: ${r.error}` : `${r.shot.padEnd(34)} ${r.gratings.map(g => `${g.barPx}px:${g.modulation}`).join('  ')}`);
  // ---- acceptance (iOS document surface). Bars at least `minBar` screen px wide must keep `min` of their contrast. ----
  const failures = []; const need = (re, minBar, min, what) => { for (const r of rows) { if (r.error || !re.test(r.shot)) continue; const weak = r.gratings.filter(g => g.barPx >= minBar && !(g.modulation >= min)); if (!r.gratings.some(g => g.barPx >= minBar) || weak.length) failures.push(`${r.shot}: ${what} (${r.gratings.map(g => `${g.barPx}px:${g.modulation}`).join(' ')})`); } };
  need(/^(paper-native-z1\.0-t(3\.5|9)|paper-native-back-z1\.0|paper-native-page1-again|layered-(native|derived|derived-nozoom)-z1\.0-t3\.5)$/, 2.2, 0.8, 'the un-magnified page must be visible');
  need(/^layered-(native|derived|derived-nozoom)-z(2\.2|3\.6)-t7$/, 3, 0.9, 'the magnified page must be sharp at rest');
  need(/^layered-(native|derived-nozoom)-z1\.5-t7$/, 2, 0.9, 'the slightly magnified page must be sharp at rest');
  need(/^matrix:(plain|sharp-frame)$/, 2, 0.9, 'a bitmap shown 1:1 must be sharp');
  if (failures.length) { console.log('LAB ACCEPTANCE FAILED\n' + failures.join('\n')); process.exitCode = 1; } else if (rows.length) console.log('lab acceptance ok');
}
