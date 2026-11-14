import sys, time, subprocess, pypdfium2 as pdfium
f = sys.argv[1]; pages = [int(x) for x in sys.argv[2:]] or [1, 2, 3]
pdf = pdfium.PdfDocument(f); print('pdfium pages', len(pdf))
for pi in pages:
    if pi >= len(pdf): continue
    for w in [900, 1800, 2732]:
        page = pdf[pi]; scale = w / page.get_width()
        t = time.time(); page.render(scale=scale); t1 = time.time()
        page.render(scale=scale); t2 = time.time()
        # progressive/partial: render only a viewport crop (top-left 60%)
        t3 = time.time(); page.render(scale=scale, crop=(0, 0, page.get_width()*0.4, page.get_height()*0.4)); t4 = time.time()
        print(f'p{pi} w={w} pdfium cold {1000*(t1-t):.0f} ms warm {1000*(t2-t1):.0f} ms crop60% {1000*(t4-t3):.0f} ms', flush=True)
        page.close()
for pi in pages[:2]:
    for r in [108, 216]:
        t = time.time(); subprocess.run(['mutool', 'draw', '-r', str(r), '-o', '/tmp/mu.png', f, str(pi+1)], check=False, capture_output=True); t1 = time.time()
        subprocess.run(['pdftoppm', '-r', str(r), '-f', str(pi+1), '-l', str(pi+1), f, '/tmp/pp'], check=False, capture_output=True); t2 = time.time()
        print(f'p{pi} dpi={r} mupdf {1000*(t1-t):.0f} ms (process)  poppler {1000*(t2-t1):.0f} ms (process)', flush=True)
