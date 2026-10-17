"""
Traces the mark library (src/lib/markLibraryData.ts) from raster sheets of
calligraphic pen pieces (SHEETS, below). Re-run after changing the sheet or the names:

    pip install potracer opencv-python-headless pillow
    python3 -I scripts/marks/traceMarks.py > src/lib/markLibraryData.ts

Marks are found as clusters of dark pixels (dilated so a mark's separate
dots stay together), keyed row+column ("40" = row 4, first mark), enlarged
8x, cleaned of the sheet's grid lines, and traced with potrace. Output is
in library units (see SHEETS for the per-sheet scale), centred on the mark's own ink box.
See .claude/rules/marks.md.
"""
import os, sys, json, numpy as np, cv2, potrace
from PIL import Image

def trace_sheet(path, unit, dilate, row_gap, merges, seeds=None):
    """Every mark on one sheet, keyed row+column: {key: {d, w, h}}.
    With `seeds` ({key: (x, y)} in source px) only the cluster nearest each
    seed point is traced, keyed as given: for a crowded sheet whose rows don't
    sort cleanly and which mostly repeats marks already in the library.
    `unit` is library units per source pixel, chosen per sheet so marks from
    different sheets come out at one scale (an alif about 500 units tall)."""
    UNIT=unit
    img = Image.open(path)
    if img.mode in ("RGBA","LA"):   # transparent background reads as white
        bg = Image.new("RGB", img.size, "white"); bg.paste(img, mask=img.getchannel("A")); img = bg
    im = np.array(img.convert('L'))
    mask = (im < 140).astype(np.uint8)
    dil = cv2.dilate(mask, np.ones((dilate,dilate),np.uint8))
    n, lab, stats, cent = cv2.connectedComponentsWithStats(dil, 8)
    clusters=[]
    for i in range(1,n):
        if (mask[lab==i]).sum()<30: continue
        x,y,w,h,_=stats[i]; clusters.append([i,(x,y,w,h)])
    clusters.sort(key=lambda c:c[1][1]+c[1][3]/2)
    rows=[]
    for c in clusters:
        cy=c[1][1]+c[1][3]/2
        if rows and abs(cy-rows[-1][0])<row_gap: rows[-1][1].append(c)
        else: rows.append([cy,[c]])
    named={}
    if seeds:
        ys,xs=np.nonzero(lab)
        for key,(sx,sy) in seeds.items():
            i=np.argmin((xs-sx)**2+(ys-sy)**2); named[key]=[lab[ys[i],xs[i]]]
        rows=[]
    for r,(cy,cs) in enumerate(rows):
        cs.sort(key=lambda c:c[1][0])
        for k,c in enumerate(cs): named[f"{r}{k}"]=[c[0]]
    for into,frm in merges: named[into]+=named.pop(frm)
    S=8          # upscale factor
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

    return out

# One entry per source sheet. `unit` brings each sheet to one scale (an alif
# about 500 units tall); `skip` lists marks a sheet repeats from an earlier
# one; `prefix` keeps ids from different sheets apart (sheet "a" has none,
# so ids saved before sheet "b" was added still resolve).
SHEETS = {
  "a": {"file": "source.jpg", "unit": 10, "dilate": 9, "row_gap": 35, "prefix": "",
        "merges": [("54","55")], "skip": []},
  "b": {"file": "source-2.webp", "unit": 5, "dilate": 15, "row_gap": 70, "prefix": "b",
        "merges": [], "skip": ["01","02","03","05","06","13","14","15","16","24","25","26","27"]},
  # A crowded sheet that mostly repeats a and b, so its new marks are picked
  # by a seed point each (source px) rather than named row by row. Its three
  # drop shapes on the left are the "frames" group.
  "c": {"file": "source-3.png", "unit": 10, "dilate": 5, "row_gap": 20, "prefix": "c",
        "merges": [], "skip": [], "seeds": {
          "00": (80,160), "01": (80,380), "02": (80,630),
          "10": (372,238), "11": (430,305), "12": (480,670),
          "20": (420,465), "21": (650,575), "22": (375,465), "23": (585,375),
          "30": (330,680), "31": (812,645)}},
}

GROUPS = [
  ("strokes", "Strokes & tails", [
    ("a","00","Hooked rising stroke"),("a","01","Forked head with drop"),("a","02","Small hooked alif"),
    ("a","03","Alif with ha loop"),("a","04","Forked head"),("a","05","Small hook"),("a","06","Curled alif"),
    ("a","07","Wavy alif"),("a","08","Thick alif"),("a","10","Short alif"),("a","11","Long bowl stroke"),
    ("a","12","Waw tail"),("a","13","Hairline curled alif"),("a","14","Forked head on a long tail"),
    ("a","16","Kaf stroke"),("a","17","Curved kaf stroke"),("a","23","Double stroke"),
    ("a","24","Thin rising stroke"),("a","25","Thick slanted stroke"),("a","26","Long straight stroke"),
    ("a","27","Curved tail stroke"),
    ("b","04","Hooked downstroke"),("b","30","Long curved downstroke"),("b","31","Twisted stroke"),
    ("b","10","Long seen stroke"),("b","12","Alif on a bowl"),("b","11","Alif with madda"),
    ("b","32","Hooked bowl"),("b","33","Long flat base"),("b","34","Short flat base"),
    ("c","10","Long double stroke"),("c","11","Long tapered stroke"),("c","12","Long yaa tail"),
  ]),
  ("heads", "Heads & loops", [
    ("a","20","Seen teeth, upright"),("a","21","Seen teeth, slanted"),("a","22","Seen teeth, leaning"),
    ("a","30","Ain head"),("a","31","Hamza curl"),("a","32","Open ain head"),("a","15","Small ha"),
    ("a","33","Mim and waw loops on a tail"),("a","34","Waw loop, long tail"),("a","35","Waw loop, short tail"),
    ("a","36","Double loop"),("a","37","Waw loop with hook"),
    ("b","00","Two-eyed ha"),("b","20","Ha over waw"),("b","22","Alif and waw loop"),
    ("b","07","Waw loops on a long tail"),("b","21","Kaf head"),
    ("c","20","Kaf body"),("c","21","Ha on a long tail"),("c","22","Bold two-eyed ha"),("c","23","Medial ha"),
  ]),
  ("dots", "Dots (nuqta)", [
    ("a","40","Round dot"),("a","41","Two round dots, stacked"),("a","42","Two round dots, side by side"),
    ("a","43","Three round dots"),("a","44","Nuqta"),("a","45","Two nuqtas, stacked"),
    ("a","46","Two nuqtas, side by side"),("a","47","Three nuqtas, point down"),("a","48","Three nuqtas, point up")]),
  ("signs", "Small signs", [
    ("a","50","Small kaf"),("a","51","Mim ha"),("a","52","Seen ra"),("a","53","Ain"),("a","54","Mim with ha"),
    ("a","56","Mim with forked head"),("a","57","Mim"),("a","58","Sad ra"),("a","59","Sad ha"),("a","60","Ta"),
    ("b","23","Small hah"),("c","30","Bold sad"),("c","31","Stacked hamza"),
  ]),
  ("thuluth", "Thuluth", [
    ("t1","23","Ha (ه)"),("t1","25","Lam (ل)"),("t1","19","Ta (ط)"),
    ("t1","2","Small alif (ا)"),("t1","15","Small lam-alif (لا)"),("t1","26","Dal (د)"),("t1","30","Nun (ن)"),
    ("t2","2","Ha body, shared by ha, jim and kha (ح)"),("t2","10","Joined starting meem (مـ)"),
    ("t2","12","Ha, round (ه)"),("t2","13","Ha, round, second form (ه)"),
    ("t2","16","Small lam-alif, second form (لا)"),("t2","17","Lam-alif, open (لا)"),
    ("t2","18","Ya (ى)"),("t2","19","Wrapped ha (ح)"),("t2","23","Starting sad (صـ)"),("t2","28","Waw (و)"),
    ("t3","2","Alif (ا)"),("t3","3","Kaf, upright (ك)"),("t3","5","Lam, second form (ل)"),
    ("t3","6","Two lam-alifs, overlapping (لا لا)"),("t3","7","Ta, second form (ط)"),
    ("t3","8","Extended seen (س)"),("t3","9","Waw and long kaf (و ك)"),("t3","10","Ra, waw, dal (ر و د)"),
    ("t3","11","Ra, extended (ر)"),("t3","12","Waw, extended (و)"),("t3","13","Meem, extended (م)"),
    ("t3","14","Ra and meem, raised (ر م)"),("t3","17","Waw with connected and standalone ha (و هـ ه)"),
    ("t3","18","Ya, second form (ى)"),("t3","19","Ha, extended (ح)"),("t3","20","Ha, wrapped (ح)"),
    ("t3","25","Ha, wrapped, second form (ح)"),("t3","21","Ain (ع)"),("t3","22","Final ha (ـح)"),
    ("t3","23","Final ha, second form (ـح)"),("t3","24","Ending dal (ـد)"),
    ("t4","1","Alif, standalone (ا)"),("t4","2","Alif, standalone, second form (ا)"),("t4","3","Free alif (ا)"),
    ("t4","14","Alif, height 1: single line (ا)"),("t4","15","Alif, height 2: medium composed line (ا)"),
    ("t4","26","Alif, height 3: light composed line (ا)"),("t4","11","Alif, height 4: heavy composed line (ا)"),
    ("t4","4","Arched alif, from Diwani (ا)"),("t4","5","Arched alif, full Diwani form (ا)"),
    ("t4","13","Ta's alif (ط)"),("t4","27","Ta's alif, close to Diwani (ط)"),
    ("t4","7","Two alifs for the lam (الر)"),("t4","8","Last alif joined to the first lam (الحر)"),
    ("t4","10","Allah (الله)"),("t4","16","Ain joined to a final alif (اعلما)"),
    ("t4","18","Ya ghaliban ghayra maghlub (يا غالباً غير مغلوب)")]),
  ("frames", "Frames", [
    ("c","00","Drop frame"),("c","01","Double drop frame"),("c","02","Drop frame with curls")]),
]
# Thuluth pieces are not traced here: scripts/marks/thuluth/ cleans the scanned
# lesson sheets and traces each piece for review (thuluth/REVIEW.md). Only a
# piece the user has approved is listed in GROUPS; its outline is read from the
# review's saved trace, already in library units and centred.
# A user-supplied clean outline ("o") is one piece per file, keyed by its number.
TRACED = {"t1": ("thuluth/traces/t1/t1-traced.json", "thuluth-t1-"),
          "t2": ("thuluth/traces/t2/t2-traced.json", "thuluth-t2-"),
          "t3": ("thuluth/traces/t3/t3-traced.json", "thuluth-t3-"),
          "t4": ("thuluth/traces/t4/t4-traced.json", "thuluth-t4-"),
          "o": ("thuluth/outlines/outline-{}.json", "thuluth-outline-")}
HERE=os.path.dirname(os.path.abspath(__file__))
outs={name:trace_sheet(os.path.join(HERE,cfg["file"]),cfg["unit"],cfg["dilate"],cfg["row_gap"],cfg["merges"],cfg.get("seeds"))
      for name,cfg in SHEETS.items()}
for name,(rel,_) in TRACED.items():
    if "{}" in rel:
        keys={k for _,_,items in GROUPS for sh,k,_ in items if sh==name}
        outs[name]={}
        for k in keys:
            with open(os.path.join(HERE,rel.format(k)),encoding="utf-8") as fh: outs[name][k]=json.load(fh)
    else:
        with open(os.path.join(HERE,rel),encoding="utf-8") as fh: outs[name]=json.load(fh)
    SHEETS[name]={"prefix":None}
for name in SHEETS:
    if name in TRACED: continue   # a review trace holds unapproved pieces too
    used={k for _,_,items in GROUPS for sh,k,_ in items if sh==name}
    skip=set(SHEETS[name]["skip"])
    assert used|skip==set(outs[name]) and not used&skip, (name, sorted(set(outs[name])-used-skip), sorted((used|skip)-set(outs[name])))
print("// Generated by scripts/marks/traceMarks.py — do not edit by hand.")
print("// Paths are centred on the origin; an alif is about 500 units tall.")
print('import type { MarkGroup } from "./markLibrary";')
print("")
print("export const MARK_GROUPS: MarkGroup[] = [")
for gid,title,items in GROUPS:
    print(f'  {{ id: "{gid}", title: "{title}", items: [')
    for sh,k,name in items:
        v=outs[sh][k]
        mid=f"{TRACED[sh][1]}{k}" if sh in TRACED else f"{gid}-{SHEETS[sh]['prefix']}{k}"
        print(f'    {{ id: "{mid}", name: "{name}", w: {v["w"]}, h: {v["h"]}, d: "{v["d"]}" }},')
    print("  ] },")
print("];")
