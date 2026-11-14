// Seeds the simulator app's AsyncStorage (RN RCTAsyncLocalStorage_V1) for the iPhone Duo App Store screenshots:
//   session <code>   admin sign-in (code comes from the ORUN_ADMIN_CODE secret, never logged)
//   ink <materialId> a few handwriting strokes + a highlighter on page 2 of the downloaded material
// Usage: node scripts/duo-seed.mjs <appDataContainer> session|ink <value>
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const [container, mode, value] = process.argv.slice(2);
const dir = path.join(container, 'Library', 'Application Support', 'com.paperly.study', 'RCTAsyncLocalStorage_V1');
fs.mkdirSync(dir, { recursive: true });
const manifestPath = path.join(dir, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const fileFor = (key) => path.join(dir, crypto.createHash('md5').update(key).digest('hex'));
const read = (key) => { if (manifest[key] != null) return manifest[key]; const f = fileFor(key); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
const write = (key, str) => { if (str.length < 1024) { manifest[key] = str; const f = fileFor(key); if (fs.existsSync(f)) fs.unlinkSync(f); } else { manifest[key] = null; fs.writeFileSync(fileFor(key), str); } fs.writeFileSync(manifestPath, JSON.stringify(manifest)); };
if (mode === 'session') {
  write('paperly:session2', JSON.stringify({ state: { adminCode: value, role: 'admin', label: '관리자', email: null, student: null, verifiedAt: new Date().toISOString(), materials: [], materialsAt: null }, version: 0 }));
  console.log('session seeded');
} else if (mode === 'ink') {
  const docs = JSON.parse(read('paperly:docs') ?? '{"state":{"docs":{}}}').state.docs;
  const doc = Object.values(docs).find((d) => d.materialId === value); if (!doc) { console.error('doc for material not found'); process.exit(1); }
  const page = doc.pages?.[1] ?? doc.pages?.[0] ?? { width: 595, height: 842 }; const W = page.width, H = page.height;
  const now = Date.now(); const id = () => Math.random().toString(36).slice(2, 10);
  const line = (x0, y0, x1, y1, n = 40) => Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y: y0 + ((y1 - y0) * i) / (n - 1) }));
  const wave = (x0, y0, len, amp, n = 80) => Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return { x: x0 + len * t, y: y0 + Math.sin(t * Math.PI * 6) * amp * (1 - 0.3 * t) }; });
  const circle = (cx, cy, r, n = 60) => Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }; });
  const strokes = [
    { id: id(), tool: 'highlighter', color: '#FDE68A', width: 10, opacity: 0.35, points: line(W * 0.1, H * 0.195, W * 0.46, H * 0.195, 24), createdAt: now, fixed: true },
    { id: id(), tool: 'pen', color: '#DC2626', width: 1.4, opacity: 1, points: circle(W * 0.09, H * 0.33, W * 0.028), createdAt: now, fixed: true },
    { id: id(), tool: 'pen', color: '#DC2626', width: 1.4, opacity: 1, points: wave(W * 0.52, H * 0.31, W * 0.16, 4), createdAt: now, fixed: true },
    { id: id(), tool: 'pen', color: '#2F6FED', width: 1.2, opacity: 1, points: line(W * 0.1, H * 0.43, W * 0.44, H * 0.432, 30), createdAt: now, fixed: true },
    { id: id(), tool: 'pen', color: '#172033', width: 1.4, opacity: 1, points: [...line(W * 0.76, H * 0.12, W * 0.79, H * 0.15, 12), ...line(W * 0.79, H * 0.15, W * 0.86, H * 0.09, 20)], createdAt: now, fixed: true },
    { id: id(), tool: 'pencil', color: '#1C1C1E', width: 1.4, opacity: 0.8, points: wave(W * 0.1, H * 0.56, W * 0.3, 3, 90).map((p, i) => ({ ...p, p: 0.3 + 0.4 * Math.abs(Math.sin(i / 9)) })), createdAt: now },
  ];
  const ink = JSON.parse(read('paperly:ink') ?? '{"state":{"pages":{}},"version":0}');
  for (const pg of ['0', '1']) ink.state.pages[`${doc.id}:${doc.cycle ?? 1}:${pg}`] = { strokes: strokes.map((st) => ({ ...st, id: id() })), textBoxes: [], versions: [], updatedAt: new Date().toISOString() };
  write('paperly:ink', JSON.stringify(ink));
  console.log('ink seeded for', doc.id, 'pages 1-2');
} else { console.error('mode?'); process.exit(2); }
