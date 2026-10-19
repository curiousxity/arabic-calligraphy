"""Score pen paths against the reference's own pieces, and fit short pieces (stamps, wedges, knots) to them.

A reference letter is several overlapping pieces (see docs/calligraphy/stroke-ledger.md, method step 0); each
of ours is checked against the piece it copies. Paths are spec nodes (library nuqta, y down) in a frame whose
origin sits at screen px `origin`, `ppn` screen px to the nuqta; reference pieces are [[a, d, e, f], "svg d"]
as ribbon.py reads them. The sweep here mirrors src/lib/penSweep.ts (nib ends, linear angle and width per
segment) closely enough to score and fit by; the app's own sweep is the final check.

    from pieces import score, fit_pull
"""
import math, os, sys
import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build import path as build_path  # noqa: E402
from ribbon import parse, ring_samples  # noqa: E402

SUB = 8  # raster px per screen px


def ref_ring(piece):
    """A reference piece's outline in screen px."""
    (a, d, e, f), dd = piece
    ring, _ = ring_samples(parse(dd))
    return np.c_[ring[:, 0] * a + e, ring[:, 1] * d + f]


def nib_ends(c, angle, width, pen):
    u = np.array([math.cos(math.radians(angle)), -math.sin(math.radians(angle))])
    w = max(0.0, min(1.0, width)) * pen
    return c + u * w / 2, c - u * w / 2


def path_hulls(nodes, origin, ppn, pen_px, step=0.5):
    """The swept nib as small convex quads, screen px."""
    p = build_path(nodes)
    out, prev = [], p["start"]
    for s in p["segs"]:
        P = [np.array(prev["p"]), np.array(s["c1"]), np.array(s["c2"]), np.array(s["to"]["p"])]
        a0, a1 = prev.get("angle", 145), s["to"].get("angle", 145)
        w0, w1 = prev.get("width", 1), s["to"].get("width", 1)
        L = sum(np.linalg.norm(P[k + 1] - P[k]) for k in range(3)) * ppn
        n = max(8, int(L / step))
        ends = []
        for t in np.linspace(0, 1, n + 1):
            u = 1 - t
            c = (u ** 3 * P[0] + 3 * u * u * t * P[1] + 3 * u * t * t * P[2] + t ** 3 * P[3]) * ppn + origin
            ends.append(nib_ends(c, a0 + (a1 - a0) * t, w0 + (w1 - w0) * t, pen_px))
        for k in range(n):
            out.append(np.array([ends[k][0], ends[k][1], ends[k + 1][1], ends[k + 1][0]]))
        prev = s["to"]
    return out


class Window:
    """A raster window over screen px."""
    def __init__(self, pts, margin=20):
        pts = np.asarray(pts)
        self.x1, self.y1 = pts.min(0) - margin
        x2, y2 = pts.max(0) + margin
        self.W, self.H = int((x2 - self.x1) * SUB), int((y2 - self.y1) * SUB)

    def px(self, q):
        return np.round((np.asarray(q) - [self.x1, self.y1]) * SUB * 16).astype(np.int32)

    def poly(self, ring):
        m = np.zeros((self.H, self.W), np.uint8)
        cv2.fillPoly(m, [self.px(ring)], 1, cv2.LINE_8, 4)
        return m

    def hulls(self, hulls):
        m = np.zeros((self.H, self.W), np.uint8)
        for h in hulls:
            cv2.fillConvexPoly(m, cv2.convexHull(self.px(h)), 1, cv2.LINE_8, 4)
        return m


def outline_gap(a, b):
    """Distances (raster px) from each outline pixel of mask a to the outline of mask b."""
    edge = lambda m: cv2.morphologyEx(m, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0
    eb = edge(b)
    dist = cv2.distanceTransform((~eb).astype(np.uint8), cv2.DIST_L2, 5)
    return dist[edge(a)]


def score(mine, refs, origin, ppn, pen_px):
    """How closely a list of our paths (spec node lists) covers a list of reference pieces: overlap (intersection
    over union) and the outline gap both ways, in nuqta (largest, and the 95th percentile)."""
    rings = [ref_ring(r) for r in refs]
    hulls = [h for nodes in mine for h in path_hulls(nodes, origin, ppn, pen_px)]
    win = Window(np.concatenate([np.concatenate(rings), np.concatenate(hulls)]))
    A = win.hulls(hulls)
    B = np.zeros_like(A)
    for r in rings:
        B |= win.poly(r)
    iou = (A & B).sum() / max(1, (A | B).sum())
    g = np.r_[outline_gap(A, B), outline_gap(B, A)] / SUB / ppn
    return {"iou": round(float(iou), 3), "gap_max": round(float(g.max()), 3), "gap95": round(float(np.percentile(g, 95)), 3)}


def fit_pull(piece, origin, ppn, pen_px, start, free_width=True):
    """A short pull fitted to a reference piece: two nodes, one nib angle, a width at each end (a wedge falls to
    nothing). `start` is [x0, y0, x1, y1, angle, w0, w1] in library nuqta and degrees; returns spec nodes."""
    from scipy.optimize import minimize
    ring = ref_ring(piece)
    win = Window(ring, margin=pen_px)
    B = win.poly(ring)

    def nodes(v):
        x0, y0, x1, y1, ang, w0, w1 = v
        return [{"p": [x0, y0], "angle": ang, "width": float(np.clip(w0, 0.01, 1))},
                {"p": [x1, y1], "angle": ang, "width": float(np.clip(w1, 0.01, 1))}]

    def cost(v):
        A = win.hulls(path_hulls(nodes(v), origin, ppn, pen_px))
        return 1 - (A & B).sum() / max(1, (A | B).sum())

    r = minimize(cost, np.array(start, float), method="Nelder-Mead",
                 options={"xatol": 1e-3, "fatol": 1e-5, "maxiter": 4000, "initial_simplex": None})
    v = r.x
    out = nodes(v)
    for n in out:
        n["p"] = [round(n["p"][0], 3), round(n["p"][1], 3)]
        n["angle"] = round(n["angle"], 1)
        n["width"] = round(n["width"], 3)
    return out, round(1 - r.fun, 3)


def refine(nodes, pieces, origin, ppn, pen_px, rough=0.02, edge=1.0, iters=3, fixed=(), others=()):
    """Nudge a band's nodes (positions and nib angles; end widths stay) to cover its reference pieces, smoothly:
    cost = 1 - overlap + edge * (mean outline gap both ways, nuqta) + rough * (changes of bend along the centre
    line, and of the nib's rate of turning). A steady curve costs nothing; a wiggle does. The outline term is what holds thin ends: a hair overshooting a pointed end, or
    stopping short of it, hardly changes the overlap. Powell's method, a few sweeps. Returns new spec nodes and
    their score. `fixed`: indices of nodes that stay put (a node shared with another letter's stroke);
    `others`: paths already drawn over the same pieces (spec node lists), counted as ink but not moved."""
    from scipy.optimize import minimize
    rings = [ref_ring(r) for r in pieces]
    win = Window(np.concatenate(rings), margin=pen_px)
    win.W, win.H = win.W // 2, win.H // 2
    sub = SUB / 2
    px = lambda q: np.round((np.asarray(q) - [win.x1, win.y1]) * sub * 16).astype(np.int32)
    B = np.zeros((win.H, win.W), np.uint8)
    for r in rings:
        cv2.fillPoly(B, [px(r)], 1, cv2.LINE_8, 4)
    n = len(nodes)
    base = np.array([[q["p"][0], q["p"][1], q["angle"]] for q in nodes], float)
    free = [i for i in range(n) if i not in fixed and i - n not in fixed]
    O = np.zeros_like(B)
    for h in [h for p in others for h in path_hulls(p, origin, ppn, pen_px, step=1.0)]:
        cv2.fillConvexPoly(O, cv2.convexHull(px(h)), 1, cv2.LINE_8, 4)

    def unpack(v):
        a = base.copy()
        a[free] += v.reshape(-1, 3) * [1, 1, 10]
        return a

    def make(a):
        return [{**q, "p": [float(a[i, 0]), float(a[i, 1])], "angle": float(a[i, 2])} for i, q in enumerate(nodes)]

    def cost(v):
        a = unpack(v)
        A = O.copy()
        for h in path_hulls(make(a), origin, ppn, pen_px, step=1.0):
            cv2.fillConvexPoly(A, cv2.convexHull(px(h)), 1, cv2.LINE_8, 4)
        iou = (A & B).sum() / max(1, (A | B).sum())
        gap = (outline_gap(A, B).mean() + outline_gap(B, A).mean()) / sub / ppn
        bend = np.diff(a[:, :2], 3, axis=0) / 0.1 if n > 3 else np.zeros((1, 2))
        turn = np.diff(a[:, 2], 2) / 30 if n > 2 else np.zeros(1)
        # a stroke doubling back on itself can hide under ink already drawn and cost nothing in overlap
        ch = np.diff(a[:, :2], axis=0)
        cos = np.sum(ch[1:] * ch[:-1], 1) / (np.linalg.norm(ch[1:], axis=1) * np.linalg.norm(ch[:-1], axis=1) + 1e-9)
        fold = np.sum(np.maximum(0, -cos)) * 10
        return 1 - iou + edge * gap + rough * (np.sum(bend ** 2) + np.sum(turn ** 2)) + fold

    v = np.zeros((len(free) * 3,))
    for _ in range(iters):
        r = minimize(cost, v, method="Powell", options={"xtol": 1e-3, "ftol": 1e-5, "maxfev": 20000})
        v = r.x
    a = unpack(v)
    outn = make(a)
    for q in outn:
        q["p"] = [round(q["p"][0], 3), round(q["p"][1], 3)]
        q["angle"] = round(q["angle"], 1)
    return outn, score([outn, *others], pieces, origin, ppn, pen_px)
