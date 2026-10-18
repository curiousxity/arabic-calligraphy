"""Smooth a traced piece's edges without rounding its pen corners.

The scans leave a fine ripple on every traced edge (the scan's pixel steps,
a fraction of a pen wide). Blurring before tracing irons it out but also
rounds the nib's sharp corners and thins hairlines, so the smoothing is done
on the outline instead: each contour is resampled evenly along its length,
corners (a sharp turn within a short stretch) are found and held, and the
rest is smoothed along the contour with a Gaussian of SIGMA library units
(48 units = one pen width), easing in near each corner. The smoothed
polygons are rasterised at 2 px per unit and traced once more with potrace,
which turns them back into a few clean curves.

`smooth_d(d)` is used by traceMarks.py on every scanned Thuluth piece (the
vector set is already clean). Run on its own to preview:
    smoothEdges.py TRACED_JSON KEY OUT_PNG"""
import re, sys
import numpy as np, cv2, potrace

SIGMA = 9.0        # units: the ripple runs 1-3 scan px (3-10 units); a pen is 48
STEP = 1.5         # resample spacing, units
CORNER_DEG = 55    # a turn sharper than this over CORNER_SPAN units is a corner
CORNER_SPAN = 9.0
PX = 2.0           # raster px per unit for the re-trace

def contours(d):
    toks = re.findall(r"[MCLZ]|-?\d+\.?\d*(?:e-?\d+)?", d); subs, i, p = [], 0, None
    while i < len(toks):
        t = toks[i]; i += 1
        if t == "M": p = (float(toks[i]), float(toks[i + 1])); i += 2; subs.append([p])
        elif t == "L": p = (float(toks[i]), float(toks[i + 1])); i += 2; subs[-1].append(p)
        elif t == "C":
            a = [float(v) for v in toks[i:i + 6]]; i += 6
            for s in np.linspace(0, 1, 13)[1:]:
                u = 1 - s; subs[-1].append(tuple(u**3 * p[j] + 3 * u * u * s * a[j] + 3 * u * s * s * a[2 + j] + s**3 * a[4 + j] for j in (0, 1)))
            p = (a[4], a[5])
    return [np.array(s) for s in subs if len(s) > 2]

def resample(c):
    c = np.vstack([c, c[:1]])
    seg = np.hypot(*np.diff(c, axis=0).T); L = np.concatenate([[0], np.cumsum(seg)])
    n = max(8, int(L[-1] / STEP))
    t = np.linspace(0, L[-1], n, endpoint=False)
    return np.stack([np.interp(t, L, c[:, 0]), np.interp(t, L, c[:, 1])], 1)

def smooth_contour(c):
    c = resample(c); n = len(c)
    if n < 12: return c
    k = max(1, int(round(CORNER_SPAN / 2 / STEP)))
    a = np.roll(c, k, 0) - c; b = np.roll(c, -k, 0) - c
    cosang = (a * b).sum(1) / (np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1) + 1e-9)
    turn = 180 - np.degrees(np.arccos(np.clip(cosang, -1, 1)))
    corner = turn > CORNER_DEG
    # keep only the sharpest point of each run of corner samples
    keep = np.zeros(n, bool)
    for i in np.nonzero(corner)[0]:
        if turn[i] >= turn[(i - 1) % n] and turn[i] >= turn[(i + 1) % n]: keep[i] = True
    # distance (in samples) to the nearest kept corner, around the loop
    idx = np.nonzero(keep)[0]
    if len(idx):
        ar = np.arange(n)[:, None]; dist = np.abs(ar - idx[None, :]); dist = np.minimum(dist, n - dist).min(1)
    else:
        dist = np.full(n, n)
    s = SIGMA / STEP; r = int(3 * s) + 1
    if n <= 2 * r: return c        # a contour shorter than the window (a dot): leave it
    w = np.exp(-0.5 * (np.arange(-r, r + 1) / s) ** 2); w /= w.sum()
    pad = np.vstack([c[-r:], c, c[:r]])
    sm = np.stack([np.convolve(pad[:, j], w, "valid") for j in (0, 1)], 1)
    # ease from the original at a corner to fully smoothed 3 sigma away
    ease = np.clip(dist * STEP / (3 * SIGMA), 0, 1)[:, None] ** 2
    return c * (1 - ease) + sm * ease

def smooth_d(d):
    cs = [smooth_contour(c) for c in contours(d)]
    pts = np.vstack(cs); x0, y0 = pts.min(0) - 6; x1, y1 = pts.max(0) + 6
    W, H = int((x1 - x0) * PX) + 1, int((y1 - y0) * PX) + 1
    # even-odd per contour, as the review tracer's outlines are nested holes
    m = np.zeros((H, W), np.uint8)
    for c in cs:
        one = np.zeros_like(m)
        cv2.fillPoly(one, [np.round((c - [x0, y0]) * PX * 16).astype(np.int32)], 1, lineType=cv2.LINE_8, shift=4)
        m ^= one
    # this potrace binding traces the False pixels as ink (review.py passes ~ink too)
    pl = potrace.Bitmap(m == 0).trace(turdsize=int(4 * PX * PX), alphamax=1.0, opticurve=True, opttolerance=0.3)
    f = lambda p: f"{p.x / PX + x0:.0f} {p.y / PX + y0:.0f}"
    out = []
    for curve in pl:
        out.append("M" + f(curve.start_point))
        for sg in curve.segments:
            if sg.is_corner: out.append("L" + f(sg.c) + "L" + f(sg.end_point))
            else: out.append("C" + f(sg.c1) + " " + f(sg.c2) + " " + f(sg.end_point))
        out.append("Z")
    return "".join(out)

def union_piece(d, px=4.0):
    """The vector set's pieces are several overlapping shapes that the app
    fills together (nonzero). Merged into one outline per stroke, so a join
    cut crosses one contour (splitAtCut refuses two): filled by winding
    number at `px` per unit, traced once with tight tolerances so the
    designer's flat cut edges stay straight. Recentred: {d, w, h}."""
    cs = contours(d)
    pts = np.vstack(cs); x0, y0 = pts.min(0) - 4; x1, y1 = pts.max(0) + 4
    W, H = int((x1 - x0) * px) + 1, int((y1 - y0) * px) + 1
    acc = np.zeros((H, W), np.int32)
    for c in cs:
        one = np.zeros((H, W), np.uint8)
        cv2.fillPoly(one, [np.round((c - [x0, y0]) * px * 16).astype(np.int32)], 1, lineType=cv2.LINE_8, shift=4)
        area = 0.5 * np.sum(c[:-1, 0] * c[1:, 1] - c[1:, 0] * c[:-1, 1])
        acc += one.astype(np.int32) * (1 if area > 0 else -1)
    m = acc != 0
    pl = potrace.Bitmap(~m).trace(turdsize=int(2 * px * px), alphamax=0.9, opticurve=True, opttolerance=0.2)
    f = lambda p: f"{p.x / px + x0:.1f} {p.y / px + y0:.1f}"
    out = []
    for curve in pl:
        out.append("M" + f(curve.start_point))
        for sg in curve.segments:
            if sg.is_corner: out.append("L" + f(sg.c) + "L" + f(sg.end_point))
            else: out.append("C" + f(sg.c1) + " " + f(sg.c2) + " " + f(sg.end_point))
        out.append("Z")
    return recentre("".join(out))

def recentre(sd):
    pts = np.vstack(contours(sd)); x0, y0 = pts.min(0); x1, y1 = pts.max(0)
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    shifted = re.sub(r"(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)",
                     lambda m: f"{float(m.group(1)) - mx:.0f} {float(m.group(2)) - my:.0f}", sd)
    return {"d": shifted, "w": round(x1 - x0), "h": round(y1 - y0)}

def smooth_piece(d):
    """smooth_d, recentred on the new outline's box: {d, w, h}."""
    return recentre(smooth_d(d))

if __name__ == "__main__":
    import json
    from PIL import Image, ImageDraw
    v = json.load(open(sys.argv[1], encoding="utf-8"))[sys.argv[2]]
    tiles = []
    for d in (v["d"], smooth_d(v["d"])):
        sc = 1000 / max(v["w"], v["h"]); W, H = int(v["w"] * sc) + 40, int(v["h"] * sc) + 40
        m = np.zeros((H, W), bool)
        for c in contours(d):
            one = Image.new("1", (W, H), 0); ImageDraw.Draw(one).polygon([(x * sc + W / 2, y * sc + H / 2) for x, y in c], fill=1); m ^= np.array(one)
        tiles.append(np.where(m, 0, 255).astype(np.uint8))
    Image.fromarray(np.hstack(tiles)).save(sys.argv[3])
    print("chars", len(v["d"]), "->", len(smooth_d(v["d"])))
