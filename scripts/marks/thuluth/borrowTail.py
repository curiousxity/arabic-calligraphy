"""Borrow a cut-off tail from a vector piece, into a piece's touch-up image.
usage: borrowTail.py TOUCHUP VECTOR_JSON KEY PX_PER_UNIT BOX OUT_PNG [write]

TOUCHUP is touchup/<sheet>-<n>.png (the cleaned piece, 4x). The vector
piece (VECTOR_JSON's KEY, library units) is drawn at PX_PER_UNIT and fitted
onto the piece's ink: scale (+-15%), turn (+-8 deg) and position searched for
the most shared ink. Only the vector's ink that the piece lacks, inside BOX
(x0,y0,x1,y1 in touch-up px: where the tail was cut) and touching the
piece's ink, is painted in. OUT_PNG shows piece / fitted vector / result;
with `write`, the result replaces the touch-up file (the old one is kept as
<file>.before.png), and tracePieces.py then traces it as a hand touch-up."""
import sys, os, json, re, shutil
import numpy as np, cv2
from PIL import Image, ImageDraw

tpath, vjson, key, ppu, box, out_png = sys.argv[1:7]
ppu = float(ppu); bx0, by0, bx1, by1 = (int(v) for v in box.split(","))
g = np.array(Image.open(tpath).convert("L"))
A = g < 140
d = json.load(open(vjson, encoding="utf-8"))[key]["d"]

def polys(d):
    toks = re.findall(r"[MCLZ]|-?\d+\.?\d*", d); subs, i, p = [], 0, None
    while i < len(toks):
        t = toks[i]; i += 1
        if t == "M": p = (float(toks[i]), float(toks[i + 1])); i += 2; subs.append([p])
        elif t == "L": p = (float(toks[i]), float(toks[i + 1])); i += 2; subs[-1].append(p)
        elif t == "C":
            a = [float(v) for v in toks[i:i + 6]]; i += 6
            for s in np.linspace(0, 1, 9)[1:]:
                u = 1 - s; subs[-1].append(tuple(u**3 * p[j] + 3 * u * u * s * a[j] + 3 * u * s * s * a[2 + j] + s**3 * a[4 + j] for j in (0, 1)))
            p = (a[4], a[5])
    return subs
P = polys(d)

def render(scale, ang):
    c, s = np.cos(np.radians(ang)), np.sin(np.radians(ang))
    pts = [[(scale * (c * x - s * y), scale * (s * x + c * y)) for x, y in q] for q in P]
    xs = [x for q in pts for x, _ in q]; ys = [y for q in pts for _, y in q]
    W, H = int(max(xs) - min(xs)) + 4, int(max(ys) - min(ys)) + 4
    m = np.zeros((H, W), np.uint8)
    for q in pts:   # nonzero would need winding; even-odd per subpath, OR'd, matches the vector sheets
        one = np.zeros_like(m)
        cv2.fillPoly(one, [np.round([(x - min(xs) + 2, y - min(ys) + 2) for x, y in q]).astype(np.int32)], 1)
        m ^= one
    return m

pad = 400
Ap = np.pad(A.astype(np.float32), pad)
best = None
for sc in np.linspace(0.85, 1.15, 13):
    for ang in np.arange(-8, 8.1, 2):
        B = render(ppu * sc, ang).astype(np.float32)
        if B.shape[0] >= Ap.shape[0] or B.shape[1] >= Ap.shape[1]: continue
        r = cv2.matchTemplate(Ap, B, cv2.TM_CCORR)
        _, v, _, loc = cv2.minMaxLoc(r)
        # shared ink, less the vector ink that lands on paper (so it can't just grow)
        score = v - 0.5 * (B.sum() - v)
        if best is None or score > best[0]: best = (score, sc, ang, loc, B)
_, sc, ang, (lx, ly), B = best
full = np.zeros_like(Ap, bool); full[ly:ly + B.shape[0], lx:lx + B.shape[1]] = B > 0
full = full[pad:-pad, pad:-pad]
extra = full & ~A
inbox = np.zeros_like(A); inbox[by0:by1, bx0:bx1] = True
extra &= inbox
n, lab, st, _ = cv2.connectedComponentsWithStats(extra.astype(np.uint8), 8)
touch = cv2.dilate(A.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
add = np.zeros_like(A)
for i in range(1, n):
    if st[i][4] > 30 and (touch & (lab == i)).any(): add |= lab == i
ink = int(np.median(g[A])) if A.any() else 40
res = np.where(add, ink, g).astype(np.uint8)
print(f"fit: scale {sc:.2f} turn {ang:+.0f} deg, shared {int((full & A).sum())} px, added {int(add.sum())} px")
view = np.stack([np.where(A, 0, 255)] * 3, -1).astype(np.uint8)
ov = view.copy(); ov[full & ~A] = (120, 170, 255); ov[full & A] = (60, 60, 160)
rv = np.stack([res] * 3, -1); rv[add] = (200, 40, 40)
page = Image.fromarray(np.vstack([view, ov, rv]))
ImageDraw.Draw(page).rectangle((bx0, by0 + 2 * A.shape[0], bx1, by1 + 2 * A.shape[0]), outline=(0, 160, 0), width=3)
page.save(out_png)
if "write" in sys.argv[7:]:
    before = tpath[:-4] + ".before.png"
    if not os.path.exists(before): shutil.copy(tpath, before)
    Image.fromarray(res).save(tpath)
    print("written", tpath)
