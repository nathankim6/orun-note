// Drives the viewer lab on an Android emulator with REAL input events, never synthetic JS calls:
//  - a virtual stylus registered through `uinput` (evdev: BTN_TOOL_PEN / BTN_TOUCH / BTN_STYLUS), i.e. the same
//    InputReader path a hardware pen takes, including hover and the barrel button;
//  - `input stylus swipe` (TOOL_TYPE_STYLUS motion events) as the fallback for plain strokes.
// It checks what a stylus contact does while the pen card or the pen palette is open, that fingers never write, and
// that a barrel-button press opens the palette through the native bridge. Synthetic page only.
// Usage: node scripts/lab-drive-android.mjs <outDir>
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync, spawn } from 'node:child_process';
const out = process.argv[2] ?? 'lab-out/android'; fs.mkdirSync(out, { recursive: true }); const pkg = 'com.paperly.study';
const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 60000 });
const sh = (...a) => adb('shell', ...a); const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; let failed = false;
/** soft checks describe what this emulator delivered; only hard checks fail the job */
const check = (name, ok, detail = '', soft = false) => { results.push({ name, ok: !!ok, soft, detail }); if (!ok && !soft) failed = true; console.log(`${ok ? 'PASS' : soft ? 'INFO(not delivered)' : 'FAIL'} ${name} ${detail}`); };
function state() { let last = null; for (const line of adb('logcat', '-d', '-v', 'raw', '-s', 'ReactNativeJS:V').split('\n')) { const i = line.indexOf('LAB_JSON '); if (i >= 0) { try { last = JSON.parse(line.slice(i + 9).replace(/'\s*$/, '')); } catch { /* partial line */ } } } return last; }
const logHas = text => adb('logcat', '-d', '-v', 'raw', '-s', 'ReactNativeJS:V').includes(text);
async function until(test, ms) { const end = Date.now() + ms; for (;;) { const s = state(); if (s && test(s)) return s; if (Date.now() > end) return null; await sleep(350); } }
const link = q => sh('am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'orunnote://lab?${q}'`, pkg); // quoted: adb joins the arguments into one device shell line
function dump() { for (let i = 0; i < 6; i++) { try { sh('uiautomator', 'dump', '/data/local/tmp/lab.xml'); return sh('cat', '/data/local/tmp/lab.xml'); } catch { /* not idle yet */ } } return ''; }
function bounds(xml, desc) { for (const node of xml.split('<node ')) { if (!node.includes(`content-desc="${desc}"`)) continue; const m = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node); if (m) return { x: (+m[1] + +m[3]) / 2, y: (+m[2] + +m[4]) / 2 }; } return null; }
const shot = async name => { await sleep(900); /* the software-rendered emulator composites a frame late */ try { fs.writeFileSync(path.join(out, name + '.png'), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20, timeout: 30000 })); } catch { /* optional evidence */ } };

// ---- virtual stylus (evdev codes) ----
const EV_SYN = 0, EV_KEY = 1, EV_ABS = 3, SYN_REPORT = 0, ABS_X = 0, ABS_Y = 1, ABS_PRESSURE = 24, BTN_TOOL_PEN = 320, BTN_TOUCH = 330, BTN_STYLUS = 331;
function virtualStylus(width, height) {
  const child = spawn('adb', ['shell', 'uinput', '-'], { stdio: ['pipe', 'pipe', 'pipe'] }); let err = '';
  child.stderr.on('data', d => { err += d; }); child.stdout.on('data', () => {});
  const send = o => child.stdin.write(JSON.stringify(o) + '\n');
  const abs = (code, max) => ({ code, info: { value: 0, minimum: 0, maximum: max, fuzz: 0, flat: 0, resolution: 0 } });
  send({ id: 1, command: 'register', name: 'Viewer Lab Stylus', vid: 0x18d1, pid: 0x4f81, bus: 'usb',
    configuration: [{ type: 100, data: [EV_KEY, EV_ABS] }, { type: 101, data: [BTN_TOOL_PEN, BTN_TOUCH, BTN_STYLUS] }, { type: 103, data: [ABS_X, ABS_Y, ABS_PRESSURE] }, { type: 110, data: [1 /* INPUT_PROP_DIRECT */] }],
    abs_info: [abs(ABS_X, width - 1), abs(ABS_Y, height - 1), abs(ABS_PRESSURE, 255)] });
  const inject = (...events) => send({ id: 1, command: 'inject', events: [...events, EV_SYN, SYN_REPORT, 0] });
  const at = (x, y) => [EV_ABS, ABS_X, Math.round(x), EV_ABS, ABS_Y, Math.round(y)];
  return {
    error: () => err.trim().slice(0, 300),
    hover: async (x, y) => { inject(EV_KEY, BTN_TOOL_PEN, 1, ...at(x, y)); await sleep(120); inject(...at(x + 2, y + 1)); await sleep(120); },
    leave: async () => { inject(EV_KEY, BTN_TOOL_PEN, 0); await sleep(150); },
    button: async down => { inject(EV_KEY, BTN_STYLUS, down ? 1 : 0); await sleep(250); },
    stroke: async (x0, y0, x1, y1) => {
      inject(EV_KEY, BTN_TOOL_PEN, 1, ...at(x0, y0)); await sleep(100);
      inject(EV_KEY, BTN_TOUCH, 1, EV_ABS, ABS_PRESSURE, 140, ...at(x0, y0)); await sleep(40);
      for (let i = 1; i <= 12; i++) { inject(EV_ABS, ABS_PRESSURE, 150, ...at(x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12)); await sleep(25); }
      inject(EV_KEY, BTN_TOUCH, 0, EV_ABS, ABS_PRESSURE, 0); await sleep(120); inject(EV_KEY, BTN_TOOL_PEN, 0); await sleep(200);
    },
    close: () => { try { child.stdin.end(); } catch { /* already gone */ } setTimeout(() => child.kill(), 500); },
  };
}

try {
adb('logcat', '-c'); sh('am', 'force-stop', pkg); sh('monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1');
const ready = await until(s => s.ready === true, 150000);
check('lab ready', !!ready, ready ? `pdf=${ready.pdf !== false} window=${JSON.stringify(ready.window)} dpr=${ready.dpr}` : JSON.stringify(state())?.slice(0, 600));
if (ready) {
  const d = ready.dpr, vp = ready.viewport, W = Math.round(ready.window.w * d), H = Math.round(ready.window.h * d);
  const size = /(\d+)x(\d+)/.exec(sh('wm', 'size')) ?? [0, W, H]; const dispW = +size[1], dispH = +size[2];
  const xml = dump(); const pen = bounds(xml, '펜'); check('pen tool button found', !!pen, JSON.stringify(pen));
  // strokes go well below the tool card (it reaches ~340 dp under the bar) and away from the palette next to the bar
  const line = n => { const y = (vp.y + vp.h * 0.74 + n * 12) * d; return [vp.w * 0.25 * d, y, vp.w * 0.6 * d, y + 24 * d]; };
  const expect = async (name, test, soft = false) => { const s = await until(test, 6000); const now = s ?? state(); check(name, !!s, `strokes=${now?.strokes} panel=${now?.panel} dial=${now?.dial}`, soft); return s; };
  const count = () => state()?.strokes ?? -1;

  // fingers never write
  { const [x0, y0, x1, y1] = line(0).map(v => String(Math.round(v))); sh('input', 'touchscreen', 'swipe', x0, y0, x1, y1, '350'); await sleep(900); check('finger never writes', count() === 0, `strokes=${count()}`); }

  // the virtual stylus; fall back to `input stylus` when uinput is unavailable on this image
  const pencil = virtualStylus(dispW, dispH); await sleep(3500);
  let n = 0; const viaUinput = async () => { n++; await pencil.stroke(...line(n)); }; const viaInput = async () => { n++; const [x0, y0, x1, y1] = line(n).map(v => String(Math.round(v))); sh('input', 'stylus', 'swipe', x0, y0, x1, y1, '350'); };
  await viaUinput(); const uinputWorks = !!(await until(s => s.strokes === 1, 5000));
  check('virtual stylus (uinput evdev) writes', uinputWorks, uinputWorks ? '' : `stderr=${pencil.error()}`, true);
  const stroke = uinputWorks ? viaUinput : viaInput;
  if (!uinputWorks) { await viaInput(); await expect('stylus (input stylus) writes', s => s.strokes === 1); }
  let expected = 1;

  if (pen) {
    // pen card: long-press the pen tool button, then write with the card still open
    sh('input', 'touchscreen', 'swipe', String(Math.round(pen.x)), String(Math.round(pen.y)), String(Math.round(pen.x)), String(Math.round(pen.y)), '900');
    const opened = await expect('long press opens the pen card', s => s.panel === true); await shot('card-open');
    if (opened) { await stroke(); expected++; await expect('first stylus contact writes AND closes the pen card', s => s.strokes === expected && s.panel === false); }
    // pen palette: tap the pen tool button, then write with the palette open
    sh('input', 'touchscreen', 'tap', String(Math.round(pen.x)), String(Math.round(pen.y)));
    const dial = await expect('a tap on the pen button after the long press opens the palette', s => s.dial === true); await shot('dial-open');
    if (dial) { await stroke(); expected++; await expect('first stylus contact writes AND closes the palette', s => s.strokes === expected && s.dial === false); }
  }

  // barrel button through the native bridge (hover + BTN_STYLUS = MotionEvent buttonState BUTTON_STYLUS_PRIMARY)
  if (uinputWorks) {
    const hx = vp.w * 0.55 * d, hy = (vp.y + vp.h * 0.5) * d;
    await pencil.hover(hx, hy); await pencil.button(true);
    const diagNow = async label => { const mark = state()?.at ?? 0; link('cmd=diag'); const s = await until(x => x.stylusDiagnostics != null && x.at > mark, 6000); console.log('  bridge after ' + label + ': ' + JSON.stringify(s?.stylusDiagnostics)); return s?.stylusDiagnostics; };
    await diagNow('strokes');
    const opened = await expect('barrel button while hovering opens the palette (native bridge)', s => s.dial === true); await shot('button-dial');
    await diagNow('press 1');
    await pencil.button(false); await sleep(300); check('releasing the button keeps the palette', state()?.dial === true, `dial=${state()?.dial}`); await diagNow('release 1');
    // a real pen never rests perfectly still: hover a little, as hardware does between two presses
    await pencil.hover(hx + 6, hy + 4); await pencil.button(true); await expect('second press closes the palette', s => s.dial === false); await diagNow('press 2'); await pencil.button(false); await pencil.leave();
    // button held while the tip touches: opens the palette, never deposits ink
    const before = count(); await pencil.hover(hx, hy); await pencil.button(true);
    { const [x0, y0, x1, y1] = line(9); await pencil.stroke(x0, y0, x1, y1); } await sleep(600);
    check('a contact with the button held leaves no ink', count() === before, `strokes ${before} -> ${count()}`); await pencil.button(false); await pencil.leave();
    if (state()?.dial) { link('cmd=dial'); await until(s => s.dial === false, 4000); }
    check('bridge reported the event to JS', logHas('LAB_LOG shortcut stylus-button'), '', !opened);
  }
  // key form of a stylus button: informational (AOSP keeps these keys for the system on most builds)
  { const was = !!state()?.dial; sh('input', 'keyevent', '308'); const s = await until(x => !!x.dial !== was, 4000); check('stylus button key (308) reaches the app', !!s, '', true); if (state()?.dial) { link('cmd=dial'); await until(x => x.dial === false, 4000); } }
  const mark = state()?.at ?? 0; link('cmd=diag'); const diag = await until(s => s.stylusDiagnostics != null && s.at > mark, 8000);
  check('bridge diagnostics', !!diag?.stylusDiagnostics, JSON.stringify(diag?.stylusDiagnostics), true);
  if (uinputWorks) check('diagnostics saw the stylus button bit (32)', Array.isArray(diag?.stylusDiagnostics?.buttonStates) && diag.stylusDiagnostics.buttonStates.includes(32) && diag.stylusDiagnostics.emitted >= 1, JSON.stringify(diag?.stylusDiagnostics)); // counters restart at every read
  // magnification through the same pipeline (Android keeps its vector tile path): evidence screenshots only
  link('cmd=zoom&z=2.2'); await sleep(6000); await shot('zoom-2.2'); link('cmd=zoom&z=1'); await sleep(1200);
  pencil.close();
}
} catch (e) { check('driver completed', false, String(e?.message ?? e).slice(0, 300)); }
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ results, final: state() }, null, 1));
fs.writeFileSync(path.join(out, 'lab-log.txt'), adb('logcat', '-d', '-v', 'raw', '-s', 'ReactNativeJS:V').split('\n').filter(l => /LAB_LOG|LAB_JSON/.test(l)).slice(-400).join('\n'));
await sleep(700); process.exit(failed ? 1 : 0);
