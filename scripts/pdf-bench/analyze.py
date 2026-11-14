import re,zlib,sys
b=open(sys.argv[1],'rb').read()
def cnt(p): return len(re.findall(p,b))
print('size',len(b),'pages',cnt(rb'/Type\s*/Page[^s]'),'images',cnt(rb'/Subtype\s*/Image'),'JPX',cnt(rb'/JPXDecode'),'DCT',cnt(rb'/DCTDecode'),'CCITT',cnt(rb'/CCITTFaxDecode'),'JBIG2',cnt(rb'/JBIG2Decode'),'Flate',cnt(rb'/FlateDecode'),'SMask',cnt(rb'/SMask'),'Shading',cnt(rb'/Shading'),'Pattern',cnt(rb'/Pattern'),'Group',cnt(rb'/Group'),'Fonts',cnt(rb'/Type\s*/Font\b'),'ObjStm',cnt(rb'/ObjStm'),'XRefStm',cnt(rb'/XRef'))
ws=[int(x) for x in re.findall(rb'/Width\s+(\d+)',b)]; hs=[int(x) for x in re.findall(rb'/Height\s+(\d+)',b)]
if ws: print('image dims max',max(ws),'x',max(hs),'typical',sorted(ws)[len(ws)//2])
print('BPC',set(re.findall(rb'/BitsPerComponent\s+(\d+)',b)),'CS',set(re.findall(rb'/ColorSpace\s*/(\w+)',b)))
print('producer',re.findall(rb'/Producer\s*\((.*?)\)',b)[:1],re.findall(rb'/Creator\s*\((.*?)\)',b)[:1])
