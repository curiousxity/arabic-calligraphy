"""Centre line, width and nib-angle offset of swept strokes given as vector outlines.

    python -I scripts/pen/ribbon.py PIECES.json PEN_PX OUT.json

PIECES.json is a list of [[a, d, e, f], "svg path d"]: each piece's outline and
its screen transform (x' = a*x + e, y' = d*y + f), e.g. read from the studio's
SVG. A swept stroke's outline is two long sides joined by two short caps; each
point on one side is paired with the nearest on the other, giving the centre
line and the width w. OUT.json holds, per piece, samples
[x, y, w, phi, off] in screen px and degrees: phi the direction of travel, off
= asin(w / pen), so the nib angle is phi +- off on whichever branch continues
smoothly (see docs/calligraphy/stroke-ledger.md). Pieces that are not bands
(stamps, dots) come out null."""
import sys, json, math, re
import numpy as np
ref = json.load(open(sys.argv[1])); PEN = float(sys.argv[2])

def parse(d):
    toks = re.findall(r"[MCZ]|-?\d*\.?\d+", d)
    segs, cur, i = [], None, 0
    while i < len(toks):
        t = toks[i]
        if t == "M": cur = (float(toks[i+1]), float(toks[i+2])); start = cur; i += 3
        elif t == "C":
            p = [float(v) for v in toks[i+1:i+7]]
            segs.append((cur, (p[0], p[1]), (p[2], p[3]), (p[4], p[5]))); cur = (p[4], p[5]); i += 7
        elif t == "Z":
            if math.dist(cur, start) > 1e-6: segs.append((cur, cur, start, start))
            i += 1
        else: i += 1
    return segs

def bez(s, t):
    a, b, c, d = (np.array(p) for p in s); u = 1 - t
    return u**3*a + 3*u*u*t*b + 3*u*t*t*c + t**3*d

def seglen(s): return sum(np.linalg.norm(bez(s, (k+1)/16) - bez(s, k/16)) for k in range(16))

out = []
for (a, dd, e, f), d in ref:
    segs = parse(d)
    L = [seglen(s) for s in segs]
    if len(segs) < 4:
        out.append(None); continue
    caps = sorted(range(len(segs)), key=lambda k: L[k])[:2]
    caps.sort()
    c0, c1 = caps
    sideA = segs[c0+1:c1]; sideB = segs[c1+1:] + segs[:c0]
    if not sideA or not sideB:
        out.append(None); continue
    def sample(side, n):
        pts = [bez(s, t) for s in side for t in np.linspace(0, 1, 40, endpoint=False)] + [np.array(side[-1][3])]
        pts = np.array(pts); dl = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
        tt = np.linspace(0, dl[-1], n)
        return np.c_[np.interp(tt, dl, pts[:, 0]), np.interp(tt, dl, pts[:, 1])]
    A = sample(sideA, 60); Bd = sample(sideB, 400)[::-1]
    res = []
    for p in A:
        j = np.argmin(np.linalg.norm(Bd - p, axis=1)); q = Bd[j]
        m = (p + q) / 2
        res.append([m[0] * a + e, m[1] * dd + f, float(np.linalg.norm(p - q)) * a])
    res = np.array(res)
    # direction of travel along the centre line, and the nib angle that gives this width (two branches)
    pts = []
    for k in range(len(res)):
        k0, k1 = max(0, k - 2), min(len(res) - 1, k + 2)
        dx, dy = res[k1, 0] - res[k0, 0], res[k1, 1] - res[k0, 1]
        phi = math.degrees(math.atan2(-dy, dx))
        r = min(1.0, res[k, 2] / PEN)
        off = math.degrees(math.asin(r))
        pts.append([round(res[k, 0], 2), round(res[k, 1], 2), round(res[k, 2], 2), round(phi, 1), round(off, 1)])
    out.append(pts)
json.dump(out, open(sys.argv[3], "w"))
for i, p in enumerate(out):
    if p: print(i, len(p), "w", min(q[2] for q in p), max(q[2] for q in p), "start", p[0][:2], "end", p[-1][:2])
