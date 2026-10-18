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
    # Thuluth's two hamzas: never one in place of the other (sheet 15's notes)
    ("t15r3","10","Alif's hamza (ع-shaped)"),("t15r3","11","Kaf's hamza (ء)"),
  ]),
  ("thuluth", "Thuluth", [
    ("t1","15","Small lam-alif (لا)"),("t2","16","Small lam-alif, second form (لا)"),("t2","17","Lam-alif, open (لا)"),
    ("t2","19","Wrapped ha (ح)"),("t2","23","Starting sad (صـ)"),("t2","3","Kaf, zinadi (ك)"),
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
    ("t4","18","Ya ghaliban ghayra maghlub (يا غالباً غير مغلوب)"),
    ("t5","1","Alif, third form (ا)"),("t5","3","Dal, second form (د)"),("t5","5","Nun body, dotless (ں)"),
    ("t5","6","Nun, with its head (ن)"),("t5","7","Ra body, short (ر)"),("t5","8","Ra, joined, flag head (ـر)"),
    ("t5","9","Ra joined to a letter before it (ـر)"),("t5","10","Waw, third form (و)"),("t5","11","Waw, fourth form (و)"),
    ("t5","13","Dal, form 1 (د)"),("t5","14","Dal, form 2 (د)"),("t5","15","Dal, form 3 (د)"),("t5","16","Dal, form 4 (د)"),
    ("t5","17","Dal, extended end: lines not composed (د)"),("t5","18","Dal inside a nun (ن د)"),
    ("t5","23","Ra, rihaniya (ر)"),("t5","19","Ra, multawiya (ر)"),("t5","20","Ra, mursala (ر)"),
    ("t5","21","Ra made small inside a nun (ن ر)"),("t5","22","Ra made small after a lam (ل ر)"),
    ("t6","2","Lam-alif (لا)"),("t6","3","Lam-alif, crooked start with zulf (لا)"),
    ("t6","7","Lam-alif, cut short for panels (لا)"),("t6","8","Lam-alif, cut short, small (لا)"),
    ("t6","14","Braided lam-alif (لا)"),("t6","13","Joined lam-alif, for tight panels (ـلا)"),
    ("t6","1","Lam, alif with a bowl (ل)"),("t6","15","Lam-alif, forced cases and line ends (لا)"),
    ("t6","16","Lam-alif, forced cases, second form (لا)"),("t6","17","Joined lam-alif after a seen, forced case (سلا)"),
    ("t6","21","Lam, old rule: Muhaqqaq and uncomposed Thuluth (صلى)"),
    ("t7r1","10","Joined meem, sloping tail (بم)"),("t7r1","15","Joined waw, straight tail (بو)"),
    ("t6","18","Lam-alif with a ha body, edge case (حلا)"),
    ("t6","19","Lam ending, incomplete body, edge case (هول)"),("t6","20","Lam ending, mostly cut off, edge case (حل)"),
    ("t8r1","2","Joined ending ha body (ـح)"),("t8r1","3","Joined ending ha body, second form (ـح)"),
    ("t8r1","4","Joined ending meem into a joined ending ya (ـمى)"),("t8r1","6","Joined ending nun body (ـن)"),
    ("t8r1","1","Ba, starting, first alternate, head (بـ)"),("t8r1","7","Ha, terminal (ـه)"),
    ("t9r1","2","Starting jeem, head angle 1 (جـ)"),
    ("t9r2","5","Ha before an extension: six nuqtas (حم)"),("t9r2","2","Ha before a low letter: six nuqtas (حسا)"),
    ("t9r2","6","Ha, the rule for al-Rahman (حمل)"),("t9r2","7","Ha with meem, second (حم)"),
    ("t9r3","1","Ha joined after and before, two words (لحم لحم)"),("t9r3","2","Ha with meem (حم)"),
    ("t9r3","3","Ha before kaf and meem (حكم)"),("t9r3","4","Open ha, two words (حمر حر)"),
    ("t10r1","2","Seen with meem (سمد سملا)"),("t10r2","1","Seen with meem and ra (سمر)"),
    ("t10r2","2","Seen joined to ra, a run (سرسرس)"),("t10r2","3","Seen with meem and ra, second (سمر)"),
    ("t10r2","4","Seen, meem, ra, seen (سمرس)")]),
  ("frames", "Frames", [
    ("c","00","Drop frame"),("c","01","Double drop frame"),("c","02","Drop frame with curls")]),
]
# The Thuluth vector set (bought by the user; thuluth/REVIEW.md, "Every form
# of every letter"): every piece of its three sheets joins the Thuluth group,
# named from its cell's letter and its position. Part 2's ba, nun and ya cells
# are one drawing (the dotless tooth), so only the ba cell's pieces are kept.
# Where a scanned piece showed the same plain form, the vector one replaced it
# (the user, 2026-10-18: "use the cleaner piece").
VECTOR_LETTERS = {(0,0):("Alif","ا"),(0,1):("Ba","ب"),(0,2):("Jeem","ح"),(0,3):("Dal","د"),(0,4):("Ra","ر"),
    (1,0):("Seen","س"),(1,1):("Sad","ص"),(1,2):("Ta","ط"),(1,3):("Ain","ع"),(1,4):("Fa","ف"),
    (2,0):("Qaf","ق"),(2,1):("Kaf","ك"),(2,2):("Lam","ل"),(2,3):("Meem","م"),(2,4):("Nun","ن"),
    (3,0):("Ha","ه"),(3,1):("Waw","و"),(3,2):("Ya","ى")}
def vector_items():
    here=os.path.dirname(os.path.abspath(__file__)); items=[]
    with open(os.path.join(here,"thuluth/traces/t36/t36r1-forms.json"),encoding="utf-8") as fh: forms=json.load(fh)
    for sheet,pos in (("t35","standalone"),("t36",None),("t34","finishing")):
        with open(os.path.join(here,f"thuluth/traces/{sheet}/{sheet}r1-traced.json"),encoding="utf-8") as fh: tr=json.load(fh)
        count={}
        for k in sorted(tr,key=int):
            cell=tuple(tr[k]["cell"])
            if sheet=="t36" and cell in ((2,4),(3,2)): continue
            name,ch=VECTOR_LETTERS[cell]
            p=pos or ("starting" if forms.get(k)=="@" else "middle")
            if sheet=="t36" and cell==(0,1): name="Ba, nun or ya tooth"
            glyph={"standalone":ch,"starting":ch+"ـ","middle":"ـ"+ch+"ـ","finishing":"ـ"+ch}[p]
            count[(name,p)]=count.get((name,p),0)+1
            items.append(((list(VECTOR_LETTERS).index(cell),["standalone","starting","middle","finishing"].index(p),int(k)),
                          (f"{sheet}r1",k,f"{name}, {p}, {count[(name,p)]} ({glyph})")))
    # in the picker: by letter (alphabet order), then standalone, starting, middle, finishing
    return [it for _,it in sorted(items)]

# Thuluth pieces are not traced here: scripts/marks/thuluth/ cleans the scanned
# lesson sheets and traces each piece for review (thuluth/REVIEW.md). Only a
# piece the user has approved is listed in GROUPS; its outline is read from the
# review's saved trace, already in library units and centred.
# A user-supplied clean outline ("o") is one piece per file, keyed by its number.
TRACED = {"t1": ("thuluth/traces/t1/t1-traced.json", "thuluth-t1-"),
          "t2": ("thuluth/traces/t2/t2-traced.json", "thuluth-t2-"),
          "t3": ("thuluth/traces/t3/t3-traced.json", "thuluth-t3-"),
          "t4": ("thuluth/traces/t4/t4-traced.json", "thuluth-t4-"),
          "t5": ("thuluth/traces/t5/t5-traced.json", "thuluth-t5-"),
          "t6": ("thuluth/traces/t6/t6-traced.json", "thuluth-t6-"),
          "t7r1": ("thuluth/traces/t7/t7r1-traced.json", "thuluth-t7r1-"),
          "t8r1": ("thuluth/traces/t8/t8r1-traced.json", "thuluth-t8r1-"),
          "t9r1": ("thuluth/traces/t9/t9r1-traced.json", "thuluth-t9r1-"),
          "t9r2": ("thuluth/traces/t9/t9r2-traced.json", "thuluth-t9r2-"),
          "t9r3": ("thuluth/traces/t9/t9r3-traced.json", "thuluth-t9r3-"),
          "t10r1": ("thuluth/traces/t10/t10r1-traced.json", "thuluth-t10r1-"),
          "t10r2": ("thuluth/traces/t10/t10r2-traced.json", "thuluth-t10r2-"),
          "t15r3": ("thuluth/traces/t15/t15r3-traced.json", "thuluth-t15r3-"),
          "t34r1": ("thuluth/traces/t34/t34r1-traced.json", "thuluth-v3-"),
          "t35r1": ("thuluth/traces/t35/t35r1-traced.json", "thuluth-v1-"),
          "t36r1": ("thuluth/traces/t36/t36r1-traced.json", "thuluth-v2-"),
          "o": ("thuluth/outlines/outline-{}.json", "thuluth-outline-")}
for _g in GROUPS:
    if _g[0]=="thuluth": _g[2].extend(vector_items())
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
