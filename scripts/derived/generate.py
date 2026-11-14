"""Pre-render server materials into page images + word boxes (docs/derived-pages.md).

Usage: python3 scripts/derived/generate.py [--only MATERIAL_ID] [--force] [--dry]
Env:   ORUN_ADMIN_CODE (required), DOCS_FN (optional), ANON_KEY (optional; read from src/lib/config.ts)
Nothing is written to the repository. Signed URLs are masked in Actions logs.
"""
import argparse, io, json, math, os, re, sys, tempfile, time, urllib.request, urllib.error
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VERSION = 1
WIDTHS = [1200, 2400]
JPEG_Q = {1200: 82, 2400: 80}

def cfg():
    src = (ROOT / 'src/lib/config.ts').read_text()
    anon = os.environ.get('ANON_KEY') or re.search(r"SUPABASE_ANON_KEY\s*=\s*'([^']+)'", src).group(1)
    fn = os.environ.get('DOCS_FN') or 'https://waywqmxmruhxcpsnnwbr.supabase.co/functions/v1/docs'
    return fn, anon

def mask(s):
    if os.environ.get('GITHUB_ACTIONS') and s: print(f'::add-mask::{s}', flush=True)

def call(action, **payload):
    fn, anon = cfg(); code = os.environ['ORUN_ADMIN_CODE']
    body = json.dumps({'action': action, 'code': code, **payload}).encode()
    req = urllib.request.Request(fn, data=body, headers={'Content-Type': 'application/json', 'apikey': anon, 'Authorization': 'Bearer ' + anon})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r: j = json.loads(r.read())
            if not j.get('ok'): raise RuntimeError(f'{action}: {j.get("error")}')
            return j
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 3: raise
            time.sleep(2 * (attempt + 1))

def http(method, url, data=None, headers=None, timeout=300):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == 3: raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3: raise
        time.sleep(2 * (attempt + 1))

# ---------- rendering (runs in worker processes) ----------
def words_for(page):
    """Word boxes normalised to the displayed page (0..1, top-left origin), same contract as PdfRenderer.getWords."""
    import pypdfium2 as pdfium
    tp = page.get_textpage(); n = tp.count_chars()
    W, H = page.get_width(), page.get_height(); rot = page.get_rotation()
    out = []; cur = ''; box = None
    def flush():
        nonlocal cur, box
        if cur and box and re.search(r'[A-Za-z\u00C0-\u024F\uAC00-\uD7A3]', cur):
            l, b, r, t = box
            nx, ny, nw, nh = l / W, 1 - t / H, (r - l) / W, (t - b) / H
            if rot == 90: nx, ny, nw, nh = 1 - ny - nh, nx, nh, nw
            elif rot == 180: nx, ny = 1 - nx - nw, 1 - ny - nh
            elif rot == 270: nx, ny, nw, nh = ny, 1 - nx - nw, nh, nw
            if nw > 0 and nh > 0 and len(out) < 4000: out.append({'t': cur, 'x': round(nx, 5), 'y': round(ny, 5), 'w': round(nw, 5), 'h': round(nh, 5)})
        cur = ''; box = None
    for i in range(n):
        ch = tp.get_text_range(i, 1)
        if not ch or ch.isspace() or ch in '\ufffe\uffff': flush(); continue
        try: l, b, r, t = tp.get_charbox(i, loose=False)
        except Exception: flush(); continue
        if r <= l or t <= b: flush(); continue
        if box and (l - box[2] > (t - b) * 0.45 or abs(((t + b) / 2) - ((box[3] + box[1]) / 2)) > (t - b) * 0.6): flush()  # gap or new line
        cur += ch; box = (l, b, r, t) if not box else (min(box[0], l), min(box[1], b), max(box[2], r), max(box[3], t))
    flush(); tp.close(); return out

def render_page(args):
    path, index, outdir = args
    import pypdfium2 as pdfium
    from PIL import Image
    pdf = pdfium.PdfDocument(path); page = pdf[index]
    w_pt, h_pt = page.get_width(), page.get_height()
    t0 = time.time()
    big = page.render(scale=WIDTHS[-1] / w_pt, draw_annots=True, rev_byteorder=True).to_pil().convert('RGB')
    t1 = time.time()
    files = {}
    for w in sorted(WIDTHS, reverse=True):
        im = big if w == big.width else big.resize((w, round(big.height * w / big.width)), Image.LANCZOS)
        p = Path(outdir) / f'p{index}-{w}.jpg'; im.save(p, 'JPEG', quality=JPEG_Q[w], optimize=True, progressive=False); files[p.name] = p.stat().st_size
    ws = words_for(page)
    p = Path(outdir) / f'p{index}-words.json'; p.write_text(json.dumps(ws, ensure_ascii=False, separators=(',', ':'))); files[p.name] = p.stat().st_size
    page.close(); pdf.close()
    return index, [round(w_pt, 2), round(h_pt, 2)], files, round(t1 - t0, 3), len(ws)

# ---------- pipeline ----------
def process(material, force, dry, workers):
    import pypdfium2 as pdfium
    mid = material['id']; title = material['title']
    d = material.get('derived') or {}
    if not force and d.get('version', 0) >= VERSION: print(f'skip {mid} ({title}): derived v{d.get("version")}'); return
    dl = call('download', materialId=mid); mask(dl['url'])
    with tempfile.TemporaryDirectory() as tmp:
        pdf_path = os.path.join(tmp, 'in.pdf'); t = time.time(); st, data = http('GET', dl['url'], timeout=600); Path(pdf_path).write_bytes(data)
        print(f'{mid} ({title}): downloaded {len(data)/1048576:.1f} MB in {time.time()-t:.1f}s', flush=True)
        pdf = pdfium.PdfDocument(pdf_path); n = len(pdf); pdf.close()
        outdir = os.path.join(tmp, 'out'); os.makedirs(outdir)
        t = time.time(); results = []
        with ProcessPoolExecutor(max_workers=workers) as ex:
            for r in ex.map(render_page, [(pdf_path, i, outdir) for i in range(n)]): results.append(r); print(f'  p{r[0]} render {r[3]}s words {r[4]} sizes {list(r[2].values())}', flush=True)
        results.sort(key=lambda r: r[0]); render_s = time.time() - t
        files = {}; sizes = []
        for idx, size, fl, _, _ in results: sizes.append(size); files.update(fl)
        total = sum(files.values())
        manifest = {'version': VERSION, 'materialId': mid, 'pages': n, 'widths': WIDTHS, 'words': True, 'sizes': sizes, 'bytes': total, 'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'engine': f'pdfium {pdfium.raw.FPDF_GetVersion() if hasattr(pdfium.raw, "FPDF_GetVersion") else ""} pypdfium2 {pdfium.V_PYPDFIUM2}'.strip()}
        Path(outdir, 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
        print(f'{mid}: {n} pages rendered in {render_s:.0f}s, {total/1048576:.1f} MB total ({total/n/1024:.0f} KB/page)', flush=True)
        if dry: return
        names = sorted(os.listdir(outdir)); t = time.time()
        for i in range(0, len(names), 250):
            batch = names[i:i + 250]; up = call('materials.derivedUploadUrl', materialId=mid, files=batch)
            for u in up['uploads']:
                mask(u['url']); name = u['path'].rsplit('/', 1)[1]; body = Path(outdir, name).read_bytes()
                ctype = 'application/json' if name.endswith('.json') else 'image/jpeg'
                http('PUT', u['url'], data=body, headers={'Content-Type': ctype, 'x-upsert': 'true'})
        print(f'{mid}: uploaded {len(names)} files in {time.time()-t:.0f}s', flush=True)
        done = call('materials.derivedComplete', materialId=mid, manifest=manifest)
        print(f'{mid}: derived = {json.dumps(done["material"].get("derived"))}', flush=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--only'); ap.add_argument('--force', action='store_true'); ap.add_argument('--dry', action='store_true'); ap.add_argument('--workers', type=int, default=max(1, (os.cpu_count() or 2)))
    a = ap.parse_args()
    mask(os.environ.get('ORUN_ADMIN_CODE'))
    mats = [m for m in call('list')['materials'] if m.get('ready')]
    if a.only: mats = [m for m in mats if m['id'] == a.only]
    print(f'{len(mats)} ready materials', flush=True)
    for m in mats:
        try: process(m, a.force, a.dry, a.workers)
        except Exception as e: print(f'::error::{m["id"]} failed: {type(e).__name__}: {e}', flush=True)

if __name__ == '__main__': main()
