"""
Traces the mark library (src/lib/markLibraryData.ts) from a raster sheet of
calligraphic pen pieces. Re-run after changing the sheet or the names:

    pip install potracer opencv-python-headless pillow
    python3 -I scripts/marks/traceMarks.py scripts/marks/source.jpg > src/lib/markLibraryData.ts

Marks are found as clusters of dark pixels (dilated so a mark's separate
dots stay together), keyed row+column ("40" = row 4, first mark), enlarged
8x, cleaned of the sheet's grid lines, and traced with potrace. Output is
in units of 1/10 source pixel, centred on the mark's own ink box.
See .claude/rules/marks.md.
"""
import sys, json, numpy as np, cv2, potrace
from PIL import Image
im = np.array(Image.open(sys.argv[1]).convert('L'))
mask = (im < 140).astype(np.uint8)
dil = cv2.dilate(mask, np.ones((9,9),np.uint8))
n, lab, stats, cent = cv2.connectedComponentsWithStats(dil, 8)
clusters=[]
for i in range(1,n):
    if (mask[lab==i]).sum()<30: continue
    x,y,w,h,_=stats[i]; clusters.append([i,(x,y,w,h)])
clusters.sort(key=lambda c:c[1][1]+c[1][3]/2)
rows=[]
for c in clusters:
    cy=c[1][1]+c[1][3]/2
    if rows and abs(cy-rows[-1][0])<35: rows[-1][1].append(c)
    else: rows.append([cy,[c]])
named={}
for r,(cy,cs) in enumerate(rows):
    cs.sort(key=lambda c:c[1][0])
    for k,c in enumerate(cs): named[f"{r}{k}"]=[c[0]]
named['54']+=named.pop('55')
named['58']=named['58']; named['59']=named.pop('59')
named['60']=named.pop('60')  # row-6 lone item
S=8          # upscale factor
UNIT=10      # output units per source pixel
out={}
for key,labs in named.items():
    sel=np.isin(lab,labs)
    ys,xs=np.where(sel)
    x0,x1,y0,y1=xs.min()-3,xs.max()+4,ys.min()-3,ys.max()+4
    g=im[y0:y1,x0:x1].astype(np.float32)
    g[~sel[y0:y1,x0:x1]]=255
    big=cv2.resize(g,None,fx=S,fy=S,interpolation=cv2.INTER_CUBIC)
    big=cv2.GaussianBlur(big,(0,0),S*0.35)
    bw=(big<170).astype(np.uint8)
    ker=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(S+1,S+1))
    bw=cv2.morphologyEx(bw,cv2.MORPH_CLOSE,ker)>0
    bw=~bw
    bm=potrace.Bitmap(bw)
    pl=bm.trace(turdsize=S*S*4, alphamax=1.1, opticurve=True, opttolerance=0.4)
    f=UNIT/S
    # Measure the traced outline itself (curves sampled), so the stored size
    # and centring match what the app draws, not the pixel mask.
    pts=[]
    for curve in pl:
        a=curve.start_point; pts.append((a.x,a.y))
        for sg in curve.segments:
            if sg.is_corner:
                pts += [(sg.c.x,sg.c.y),(sg.end_point.x,sg.end_point.y)]
            else:
                p1,p2,p3=sg.c1,sg.c2,sg.end_point
                for i in range(1,17):
                    t=i/16; u=1-t
                    pts.append((u**3*a.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t**3*p3.x,
                                u**3*a.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t**3*p3.y))
            a=sg.end_point
    px_=[q[0] for q in pts]; py_=[q[1] for q in pts]
    mx=(min(px_)+max(px_))/2; my=(min(py_)+max(py_))/2
    w=(max(px_)-min(px_))*f; h=(max(py_)-min(py_))*f
    def p(pt): return f"{(pt.x-mx)*f:.0f} {(pt.y-my)*f:.0f}"
    d=[]
    for curve in pl:
        d.append("M"+p(curve.start_point))
        for sg in curve.segments:
            if sg.is_corner: d.append("L"+p(sg.c)+"L"+p(sg.end_point))
            else: d.append("C"+p(sg.c1)+" "+p(sg.c2)+" "+p(sg.end_point))
        d.append("Z")
    out[key]={"d":"".join(d),"w":int(w),"h":int(h)}

GROUPS = [
  ("strokes", "Strokes & tails", [
    ("00","Hooked rising stroke"),("01","Forked head with drop"),("02","Small hooked alif"),
    ("03","Alif with ha loop"),("04","Forked head"),("05","Small hook"),("06","Curled alif"),
    ("07","Wavy alif"),("08","Thick alif"),("10","Short alif"),("11","Long bowl stroke"),
    ("12","Waw tail"),("13","Hairline curled alif"),("14","Forked head on a long tail"),
    ("16","Kaf stroke"),("17","Curved kaf stroke"),("23","Double stroke"),
    ("24","Thin rising stroke"),("25","Thick slanted stroke"),("26","Long straight stroke"),
    ("27","Curved tail stroke")]),
  ("heads", "Heads & loops", [
    ("20","Seen teeth, upright"),("21","Seen teeth, slanted"),("22","Seen teeth, leaning"),
    ("30","Ain head"),("31","Hamza curl"),("32","Open ain head"),("15","Small ha"),
    ("33","Mim and waw loops on a tail"),("34","Waw loop, long tail"),("35","Waw loop, short tail"),
    ("36","Double loop"),("37","Waw loop with hook")]),
  ("dots", "Dots (nuqta)", [
    ("40","Round dot"),("41","Two round dots, stacked"),("42","Two round dots, side by side"),
    ("43","Three round dots"),("44","Nuqta"),("45","Two nuqtas, stacked"),
    ("46","Two nuqtas, side by side"),("47","Three nuqtas, point down"),("48","Three nuqtas, point up")]),
  ("signs", "Small signs", [
    ("50","Small kaf"),("51","Mim ha"),("52","Seen ra"),("53","Ain"),("54","Mim with ha"),
    ("56","Mim with forked head"),("57","Mim"),("58","Sad ra"),("59","Sad ha"),("60","Ta")]),
]
used={k for _,_,items in GROUPS for k,_ in items}
assert used==set(out), (sorted(set(out)-used), sorted(used-set(out)))
print("// Generated by scripts/marks/traceMarks.py — do not edit by hand.")
print("// Paths are centred on the origin, 10 units per source pixel.")
print('import type { MarkGroup } from "./markLibrary";')
print("")
print("export const MARK_GROUPS: MarkGroup[] = [")
for gid,title,items in GROUPS:
    print(f'  {{ id: "{gid}", title: "{title}", items: [')
    for k,name in items:
        v=out[k]
        print(f'    {{ id: "{gid}-{k}", name: "{name}", w: {v["w"]}, h: {v["h"]}, d: "{v["d"]}" }},')
    print("  ] },")
print("];")
