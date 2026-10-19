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

def ring_samples(segs):
    """Points round the outline, about a pixel apart, and the index where each segment starts."""
    pts, starts = [], []
    for sg in segs:
        starts.append(len(pts))
        n = max(2, int(seglen(sg)))
        pts += [bez(sg, t) for t in np.linspace(0, 1, n, endpoint=False)]
    return np.array(pts), starts

def smooth_path(samples, pen_px, origin, ppn, spacing=0.9, hint=145.0, sigma_pos=2.0, sigma_angle=4.0):
    """A pen path (build.py nodes, library nuqta) through a band's centre samples [x, y, w, phi, off]:
    the nib angle on the branch continuous from `hint` and unwrapped, positions and angles smoothed along the
    band, nodes `spacing` nuqta apart by arc length. Few nodes and an evenly turning nib give clean outlines."""
    from scipy.ndimage import gaussian_filter1d
    S = np.array([s[:3] for s in samples], float)
    th, prev = [], hint
    for x, y, w, phi, off in samples:
        cands = [b + k * 180 for b in (phi - off, phi + off) for k in range(-3, 4)]
        prev = min(cands, key=lambda c: abs(c - prev)); th.append(prev)
    th = gaussian_filter1d(np.array(th), sigma_angle, mode="nearest")
    xy = np.c_[gaussian_filter1d(S[:, 0], sigma_pos, mode="nearest"), gaussian_filter1d(S[:, 1], sigma_pos, mode="nearest")]
    xy[0], xy[-1] = S[0, :2], S[-1, :2]
    dl = np.r_[0, np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1))]
    k = max(2, int(math.ceil(dl[-1] / ppn / spacing)) + 1)
    tt = np.linspace(0, dl[-1], k)
    nodes = []
    for t in tt:
        x, y = np.interp(t, dl, xy[:, 0]), np.interp(t, dl, xy[:, 1])
        nodes.append({"p": [round((x - origin[0]) / ppn, 3), round((y - origin[1]) / ppn, 3)], "angle": round(float(np.interp(t, dl, th)), 1)})
    return nodes


def bands(ref, PEN):
    """Centre samples [x, y, w, phi, off] of every band in the pieces (None for stamps and dots)."""
    out = []
    for (a, dd, e, f), d in ref:
        segs = parse(d)
        if len(segs) < 3:
            out.append(None); continue
        L = [seglen(s) for s in segs]
        ring, starts = ring_samples(segs)
        n = len(ring)
        # one end of the band is its shortest segment (the nib's cap where the stroke began or ended);
        # the other end is the outline point farthest from it (a second cap's corner, or a pointed tip)
        c0 = int(np.argmin(L))
        i0, i1 = starts[c0], (starts[c0 + 1] if c0 + 1 < len(segs) else n)
        mid = ring[(i0 + i1) // 2 % n]
        far = int(np.argmax(np.linalg.norm(ring - mid, axis=1)))
        idx = lambda a_, b_: [k % n for k in range(a_, b_ + (n if b_ < a_ else 0) + 1)]
        sideA = ring[idx(i1 % n, far)]
        sideB = ring[idx(far, i0)][::-1]
        if len(sideA) < 8 or len(sideB) < 8:
            out.append(None); continue
        def resample(P, m):
            dl = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
            tt = np.linspace(0, dl[-1], m)
            return np.c_[np.interp(tt, dl, P[:, 0]), np.interp(tt, dl, P[:, 1])]
        A = resample(sideA, 60); Bd = resample(sideB, 400)
        res = []
        for p in A:
            j = np.argmin(np.linalg.norm(Bd - p, axis=1)); q = Bd[j]
            m_ = (p + q) / 2
            res.append([m_[0] * a + e, m_[1] * dd + f, float(np.linalg.norm(p - q)) * a])
        res = np.array(res)
        pts = []
        for k in range(len(res)):
            k0, k1 = max(0, k - 2), min(len(res) - 1, k + 2)
            dx, dy = res[k1, 0] - res[k0, 0], res[k1, 1] - res[k0, 1]
            phi = math.degrees(math.atan2(-dy, dx))
            off = math.degrees(math.asin(min(1.0, res[k, 2] / PEN)))
            pts.append([round(res[k, 0], 2), round(res[k, 1], 2), round(res[k, 2], 2), round(phi, 1), round(off, 1)])
        out.append(pts)
    return out


if __name__ == "__main__":
    out = bands(json.load(open(sys.argv[1])), float(sys.argv[2]))
    json.dump(out, open(sys.argv[3], "w"))
    for i, p in enumerate(out):
        if p: print(i, len(p), "w", min(q[2] for q in p), max(q[2] for q in p), "start", p[0][:2], "end", p[-1][:2])
