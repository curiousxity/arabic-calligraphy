"""
Thuluth review tool: cleans a source sheet, cuts it into numbered pieces,
traces each one, and draws review sheets (the source crop beside the traced
outline). Nothing here writes the app's mark library: a piece moves there
only once the user approves it in REVIEW.md. See .claude/rules/marks.md.

    python3 -I scripts/marks/thuluth/review.py <sheet> <out_dir>

<sheet> is a key of SHEETS below. Writes <out_dir>/<sheet>-review-<n>.png
and <out_dir>/<sheet>-traced.json ({piece: {d, w, h}}).
"""
import json, os, sys
import numpy as np, cv2, potrace
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))

# One entry per sheet. `units`: piece number -> (name, box in source px),
# right to left, top to bottom. `splits`: a component touching two pieces,
# found by its bounding box's top-left, split by a pixel rule.
SHEETS = {
  "t1": {"file": "../thuluth-1.webp", "dot": 16, "units": {
    1: ("ا alif (measuring nuqtas)", (1540,190,1580,362)), 2: ("ا alif, smaller", (1490,190,1535,362)), 3: ("ك", (1330,165,1462,380)),
    4: ("ل lam (measuring nuqtas)", (1172,130,1330,382)), 5: ("لا", (1025,155,1160,384)), 6: ("ن nun, construction of 30 (measuring nuqtas)", (903,258,1072,384)),
    7: ("ر ra (overlaps 8)", (738,255,892,386)), 8: ("ب body of ba (overlaps 7)", (640,280,795,384)), 9: ("لا, large (same form as 14)", (476,170,672,384)),
    10: ("لا, small (same form as 15)", (452,265,512,368)), 11: ("د dal, construction (measuring nuqtas; 26 is the clean shape)", (320,222,418,366)), 12: ("ه ha, construction drawing of 23 (stroke numbers, measuring nuqtas, half nuqta)", (150,245,302,377)),
    13: ("ى", (46,232,150,378)), 14: ("لا, large (same form as 9)", (1412,468,1588,640)), 15: ("لا, small (same form as 10; told by the alif's hat stroke)", (1366,553,1420,645)),
    16: ("صـ", (1176,578,1326,656)), 17: ("ط / ظ ta/za, construction of 19 (measuring nuqtas)", (1034,482,1176,654)), 18: ("ض", (897,560,1014,658)),
    19: ("ط ta, the clean shape (17 is its construction)", (742,475,858,652)), 20: ("ب/ت/ث body, two forms superimposed", (497,530,720,650)), 21: ("ج/ح/خ alternate body", (322,495,470,672)),
    22: ("ق", (163,513,284,642)), 23: ("ه ha, the clean shape (trace this one; 12 is its construction)", (20,527,126,620)), 24: ("ك (small written note to remove)", (1440,755,1566,938)),
    25: ("ل", (1294,750,1420,944)), 26: ("د dal, the clean shape (11 and 27 are its construction)", (1146,808,1244,932)), 27: ("د dal, construction (measuring nuqtas; 26 is the clean shape)", (980,806,1110,932)),
    28: ("و waw tail (body without the head), measuring nuqtas", (866,818,990,930)), 29: ("ر ra body, a different form from 7 (measuring nuqtas)", (694,828,830,936)), 30: ("ن nun, the clean shape (6 is its construction)", (516,818,654,930)),
    31: ("ى/ي ya, three forms", (38,762,482,938)),
  }, "splits": {},
  # Per piece, what to erase from that piece only (leftovers the cleaner
  # can't tell from ink): a source-px box (x0, y0, x1, y1), or a point (x, y)
  # that removes the whole separate bit it lands on. 3: the end of a guide line
  # touching the right side of the kaf's barb (the user, 2026-10-17).
  "erase": {3: [(1444, 205, 1450, 221)]}},
  "t2": {"file": "../thuluth-2.webp", "dot": 15, "units": {
    1: ("ح standalone", (1305,95,1458,258)), 2: ("ح ج خ shared stroke", (1168,100,1300,258)),
    3: ("ك zinadi, standalone", (855,95,1122,245)), 4: ("ب long, standalone and final", (533,175,842,252)),
    5: ("ح almond (with dots?)", (390,123,522,225)), 6: ("ح almond, small", (256,150,366,223)),
    7: ("ح almond, large", (50,75,190,252)), 8: ("مـ start, small", (1505,430,1562,482)),
    9: ("م joined", (1296,402,1470,537)), 10: ("مـ start, joined", (1205,432,1275,492)),
    11: ("م standalone", (1042,405,1195,550)), 12: ("ه", (953,407,1040,502)), 13: ("ه", (852,410,935,490)),
    14: ("هـ tall, start", (738,408,828,515)), 15: ("ـهـ long, middle", (485,413,702,515)),
    16: ("لا", (392,415,442,507)), 17: ("لا", (224,337,400,508)), 18: ("ى", (73,405,202,545)),
    19: ("ح wrapped", (1452,627,1574,800)), 20: ("عـ head, start/join", (1322,700,1430,790)),
    21: ("ع", (1167,598,1314,820)), 22: ("ع wrapped", (1010,620,1145,830)), 23: ("صـ start", (869,693,968,766)),
    24: ("ص standalone", (690,640,840,820)), 25: ("ط", (543,587,690,800)), 26: ("ف fa without dots", (350,675,508,792)),
    27: ("ق without dots", (180,695,325,808)), 28: ("و", (48,694,148,798)),
  },
  # 3: the two blobs above the kaf's start are not part of the letter (the
  # user, 2026-10-17); a point picks out that separate bit. The box is a
  # stray tick rising from the top edge of the lower stroke (the user).
  "erase": {3: [(918, 130), (963, 178, 971, 185)]},
  "splits": {
    # ص's tail runs into ط's base: the loop and the low tail are the ص.
    (542, 586): (24, 25, lambda xs, ys: (xs >= 700) | ((ys >= 768) & (xs >= 595))),
  }},
  # Sheet 3 (mapped 2026-10-17): same pen as sheets 1 and 2 (about 16 px), so
  # the same scale. Names are provisional readings, for the user to confirm
  # in the end-of-tracing sweep. Numbers follow the cluster map
  # (sheet3-numbered.png); 1 is part of a written heading and 4 is the kaf's
  # small sign, traced with 3. 20 is two separate ha forms: 20 the right one,
  # 25 the left one.
  "t3": {"file": "../thuluth-3.webp", "dot": 16, "units": {
    2: ("ا alif", (1630,68,1678,252)), 3: ("ك kaf, upright, with its small kaf sign", (1495,70,1631,276)),
    5: ("ل lam", (1345,68,1484,290)), 6: ("لا two lam-alif forms, overlapping", (1104,46,1333,287)),
    7: ("ط ta", (935,75,1089,276)), 8: ("س seen, extended (stroke numbers 1-4)", (429,86,932,290)),
    9: ("و + ك waw and long kaf, joined (stroke numbers 1-3)", (47,101,432,297)),
    10: ("ر و د ra, waw, dal, joined (wrapped forms)", (1389,406,1671,558)),
    11: ("ر ra, extended", (1202,421,1350,570)), 12: ("و/م (to confirm), extended", (1128,419,1281,570)),
    13: ("م (to confirm), extended", (1021,434,1212,569)), 14: ("ر م ra and meem, raised, joined", (807,430,1048,570)),
    15: ("ص + ش sad with seen/shin teeth and measuring nuqtas", (405,411,819,575)),
    16: ("و ه ة waw, ha, ta marbuta, with measuring marks", (91,398,402,569)),
    17: ("و هـ ه waw, connected and standalone ha", (1307,661,1673,841)),
    18: ("ى ya", (1153,683,1304,842)), 19: ("ح ha, extended", (1001,702,1168,886)),
    20: ("ح ha (right of the pair)", (857,704,996,901)), 25: ("ح ha (left of the pair)", (705,704,857,901)),
    21: ("ع ain", (538,680,705,907)), 22: ("ـح final ha (stroke numbers, dotted guide)", (378,673,536,899)),
    23: ("ـح final ha (stroke numbers, dotted guide)", (226,664,378,896)),
    24: ("ـد ending dal (the user, 2026-10-17; stroke numbers 1-4)", (74,693,219,860)),
  }, "splits": {}},
  # Sheet 4, the alif (mapped 2026-10-17; sheet4-numbered.png). Numbers follow
  # the cluster map; written notes (6, 9, 12, 20-25) are skipped. The map
  # merged الله with the height-3 alif (now 10 and 26) and the worked line
  # with the second tah-alif (now 18 and 27). Names are provisional.
  "t4": {"file": "../thuluth-4.webp", "dot": 16, "units": {
    1: ("ا alif, standalone, length 1", (1566,99,1612,292)), 2: ("ا alif, standalone, length 2", (1480,97,1529,295)),
    3: ("ا alif, standalone, length 3", (1379,102,1434,314)), 4: ("ا arched alif, from Diwani", (1235,108,1336,308)),
    5: ("ا arched alif, full Diwani form", (1075,110,1190,309)), 7: ("ال the two alifs usable for the lam (الر)", (440,38,679,337)),
    8: ("الحر final alif joined to the first lam", (72,72,355,328)), 10: ("الله the alif in lafz al-jalala (dotted guide)", (767,112,990,335)),
    11: ("ا alif height 4 (heavy composed line)", (765,287,830,548)), 26: ("ا alif height 3 (light composed line)", (880,336,965,548)),
    15: ("ا alif height 2 (medium composed line)", (1009,337,1063,554)), 14: ("ا alif height 1 (single line)", (1111,351,1162,557)),
    13: ("ط tah alif (ألف الطاء)", (1459,387,1620,557)), 27: ("ط tah alif, Diwani-like variant", (1268,413,1410,562)),
    16: ("اعلما ain joined to a final alif (notes written inside)", (161,335,649,570)),
    18: ("يا غالباً غير مغلوب, the worked example line", (286,560,1500,872)),
  }, "splits": {},
  # Bits of the written notes left beside the letters, and on 18 the paired
  # dots under both ya letters and a small mark above the line (letters are
  # traced dotless). Each point removes the separate bit it lands on.
  "erase": {7: [(487,114), (465,150)], 8: [(131,184)], 10: [(856,121), (850,156)],
            16: [(357,406), (345,366), (369,361), (482,472), (493,439)],
            18: [(940,836), (1471,847), (1502,587)]}},
}

def clean_sheet(path, dot):
    im = np.array(Image.open(path).convert("L"))
    mask = (im < 140).astype(np.uint8)
    # Guide lines: long straight runs of the very thinnest ink. A pen hairline
    # is thicker (3-5 px) and survives; so do the letters' curves.
    thin = (mask & ~cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))).astype(np.uint8)
    lines = cv2.HoughLinesP(thin * 255, 1, np.pi / 360, threshold=30, minLineLength=40, maxLineGap=3)
    erase = np.zeros_like(mask)
    for l in (lines.reshape(-1, 4) if lines is not None else []):
        cv2.line(erase, (int(l[0]), int(l[1])), (int(l[2]), int(l[3])), 1, 3)
    clean = (mask & ~(erase & thin)).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(clean, 8)
    dt = cv2.distanceTransform(clean, cv2.DIST_L2, 5)
    for i in range(1, n):
        comp = lab == i
        x, y, w, h, a = st[i]
        if a < 60 or dt[comp].max() < 3.0: clean[comp] = 0                     # numbers, arrows, line ends
        elif max(w, h) < 2.2 * dot and a < 2.2 * dot * dot: clean[comp] = 0      # every loose dot
    return im, clean

def assign(clean, units, splits, erase=None):
    sel = _assign(clean, units, splits)
    for k, items in (erase or {}).items():
        if k not in sel: continue
        for it in items:
            if len(it) == 2:   # a point: drop the separate bit of this piece that holds it
                n, lab = cv2.connectedComponents(sel[k].astype(np.uint8), connectivity=8)
                i = lab[it[1], it[0]]
                assert i > 0, (k, it, "point is not on the piece")
                sel[k][lab == i] = False
            else:              # a box: clear every pixel of this piece inside it
                x0, y0, x1, y1 = it; sel[k][y0:y1, x0:x1] = False
    return sel

def _assign(clean, units, splits):
    n, lab, st, _ = cv2.connectedComponentsWithStats(clean, 8)
    sel = {k: np.zeros_like(clean, bool) for k in units}
    for i in range(1, n):
        comp = lab == i
        ys, xs = np.nonzero(comp)
        key = (int(st[i][0]), int(st[i][1]))
        if key in splits:
            a, b, rule = splits[key]; r = rule(xs, ys)
            if a in sel: sel[a][ys[r], xs[r]] = True       # either piece may not be chosen
            if b in sel: sel[b][ys[~r], xs[~r]] = True
            continue
        best, bestc = None, 0
        for k, (_, (x0, y0, x1, y1)) in units.items():
            c = int(((xs >= x0) & (xs < x1) & (ys >= y0) & (ys < y1)).sum())
            if c > bestc: best, bestc = k, c
        if best is not None and bestc > 0.5 * len(xs): sel[best] |= comp
    return sel

def trace(sel, unit=3.0, S=8, blur=0.35, alphamax=1.1, opttolerance=0.4, gray=None):
    """Potrace one piece; returns {d, w, h} in library units centred on the ink,
    plus the sampled contours (for the review drawing). `blur` is the smoothing
    before tracing, in source px; more of it irons out the scan's ragged edge.
    With `gray` (the scan, 0-255) the piece's own grey edge shading is traced
    instead of its black-and-white mask, which places each edge to a fraction
    of a pixel: inside one pixel of the piece the scan is used, white elsewhere."""
    ys, xs = np.nonzero(sel)
    x0, x1, y0, y1 = xs.min() - 3, xs.max() + 4, ys.min() - 3, ys.max() + 4
    if gray is None:
        g = np.where(sel[y0:y1, x0:x1], 0, 255).astype(np.float32)
    else:
        near = cv2.dilate(sel[y0:y1, x0:x1].astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        g = np.where(near, gray[y0:y1, x0:x1], 255).astype(np.float32)
        # the scan's ink is dark grey, not black: stretch so its threshold sits at 128
        g = np.clip((g - 0) * (128 / 140), 0, 255)
    big = cv2.GaussianBlur(cv2.resize(g, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC), (0, 0), S * blur)
    bw = cv2.morphologyEx((big < 128).astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (S + 1, S + 1))) > 0
    pl = potrace.Bitmap(~bw).trace(turdsize=S * S * 4, alphamax=alphamax, opticurve=True, opttolerance=opttolerance)
    contours = []
    for curve in pl:
        a = curve.start_point; pts = [(a.x, a.y)]
        for sg in curve.segments:
            if sg.is_corner: pts += [(sg.c.x, sg.c.y), (sg.end_point.x, sg.end_point.y)]
            else:
                for i in range(1, 17):
                    t = i / 16; u = 1 - t
                    pts.append((u**3*a.x + 3*u*u*t*sg.c1.x + 3*u*t*t*sg.c2.x + t**3*sg.end_point.x,
                                u**3*a.y + 3*u*u*t*sg.c1.y + 3*u*t*t*sg.c2.y + t**3*sg.end_point.y))
            a = sg.end_point
        contours.append(pts)
    allp = [q for c in contours for q in c]
    mx = (min(q[0] for q in allp) + max(q[0] for q in allp)) / 2; my = (min(q[1] for q in allp) + max(q[1] for q in allp)) / 2
    f = unit / S
    P = lambda pt: f"{(pt.x - mx) * f:.0f} {(pt.y - my) * f:.0f}"
    d = []
    for curve in pl:
        d.append("M" + P(curve.start_point))
        for sg in curve.segments:
            d.append(("L" + P(sg.c) + "L" + P(sg.end_point)) if sg.is_corner else ("C" + P(sg.c1) + " " + P(sg.c2) + " " + P(sg.end_point)))
        d.append("Z")
    w = (max(q[0] for q in allp) - min(q[0] for q in allp)) * f; h = (max(q[1] for q in allp) - min(q[1] for q in allp)) * f
    return {"d": "".join(d), "w": round(w), "h": round(h)}, contours, (x0, y0, S)

def draw_traced(contours, size, S, scale=1):
    """The traced outline, filled even-odd, at `scale` times source size.
    Drawn 4x larger and shrunk, so its edges are smooth like the app's."""
    k = 4 * scale
    acc = np.zeros((size[1] * k, size[0] * k), np.uint8)
    for c in contours:
        m = np.zeros_like(acc)
        cv2.fillPoly(m, [np.array([(x * k / S * 16, y * k / S * 16) for x, y in c], np.int32)], 1, lineType=cv2.LINE_8, shift=4)
        acc ^= m
    return Image.fromarray(np.where(acc > 0, 0, 255).astype(np.uint8)).resize((size[0] * scale, size[1] * scale), Image.LANCZOS)

def main(sheet, out_dir):
    cfg = SHEETS[sheet]
    src = os.path.join(HERE, cfg["file"])
    im, clean = clean_sheet(src, cfg["dot"])
    sel = assign(clean, cfg["units"], cfg["splits"], cfg.get("erase"))
    color = Image.open(src).convert("RGB")
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
    traced, tiles = {}, []
    for k, (name, box) in cfg["units"].items():
        if not sel[k].any(): continue
        data, contours, (x0, y0, S) = trace(sel[k])
        traced[k] = {"name": name, **data}
        ys, xs = np.nonzero(sel[k])
        bx0, by0, bx1, by1 = xs.min() - 3, ys.min() - 3, xs.max() + 4, ys.max() + 4
        left = color.crop((bx0, by0, bx1, by1))
        right = draw_traced(contours, (bx1 - bx0, by1 - by0), S)
        tiles.append((k, left, right))
    cell = 260
    per = 12
    for page in range(0, len(tiles), per):
        chunk = tiles[page:page + per]
        cols = 3
        rows = (len(chunk) + cols - 1) // cols
        sheet_img = Image.new("RGB", (cols * (2 * cell + 30), rows * (cell + 34)), "white")
        d = ImageDraw.Draw(sheet_img)
        for j, (k, left, right) in enumerate(chunk):
            cx, cy = (j % cols) * (2 * cell + 30), (j // cols) * (cell + 34)
            for t, ox in ((left, 0), (right, cell)):
                t = t.copy(); t.thumbnail((cell - 12, cell - 12))
                sheet_img.paste(t, (cx + ox + 6, cy + 30))
            d.rectangle([cx + 2, cy + 26, cx + 2 * cell + 2, cy + cell + 30], outline=(210, 210, 210))
            d.line([cx + cell + 2, cy + 26, cx + cell + 2, cy + cell + 30], fill=(210, 210, 210))
            d.text((cx + 6, cy + 4), f"#{k}", fill=(40, 120, 255), font=font)
        sheet_img.save(os.path.join(out_dir, f"{sheet}-review-{page // per + 1}.png"))
    json.dump(traced, open(os.path.join(out_dir, f"{sheet}-traced.json"), "w"), ensure_ascii=False, indent=1)
    print(f"{sheet}: traced {len(traced)} pieces")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
