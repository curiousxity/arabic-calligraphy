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
RUNAWAY = 20  # nuqta: ink this far beyond the reference is a fit that has run off, scored without rastering
WIDEST = 1.5  # a node's width above 1: the stroke is written with a wider pen (penSweep.ts WIDEST)


def ref_ring(piece):
    """A reference piece's outline in screen px."""
    (a, d, e, f), dd = piece
    ring, _ = ring_samples(parse(dd))
    return np.c_[ring[:, 0] * a + e, ring[:, 1] * d + f]


def nib_ends(c, angle, width, pen):
    u = np.array([math.cos(math.radians(angle)), -math.sin(math.radians(angle))])
    w = max(0.0, min(WIDEST, width)) * pen
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


def runaway(rings, hulls, ppn):
    """How far (nuqta) our ink reaches beyond the reference's box. A diverged fit once asked numpy for a 238 GiB
    window (184.s5, 2026-10-20); a smaller one could fill a worker's memory and stall the machine instead."""
    pts, ink = np.concatenate(rings), np.concatenate(hulls)
    return float(max(0.0, *(pts.min(0) - ink.min(0)), *(ink.max(0) - pts.max(0)))) / ppn


def outline_gap(a, b):
    """Distances (raster px) from each outline pixel of mask a to the outline of mask b."""
    edge = lambda m: cv2.morphologyEx(m, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0
    eb = edge(b)
    dist = cv2.distanceTransform((~eb).astype(np.uint8), cv2.DIST_L2, 5)
    return dist[edge(a)]


def ignore_mask(B, ignore, poly):
    """Where ink is neither right nor wrong: the reference pieces of a stroke's neighbours in the same shape, less
    this stroke's own. Judged with its neighbours' territory blanked, a stroke may run on through the corner where
    the two meet, instead of stopping short of it (the notch at every join, 2026-10-19)."""
    D = np.zeros_like(B)
    for p in ignore:
        D |= poly(ref_ring(p))
    return D & ~B.astype(bool)


def score(mine, refs, origin, ppn, pen_px, ignore=()):
    """How closely a list of our paths (spec node lists) covers a list of reference pieces: overlap (intersection
    over union) and the outline gap both ways, in nuqta (largest, and the 95th percentile). `ignore`: pieces whose
    ground is neither counted for nor against (ignore_mask)."""
    rings = [ref_ring(r) for r in refs]
    hulls = [h for nodes in mine for h in path_hulls(nodes, origin, ppn, pen_px)]
    far = runaway(rings, hulls, ppn)
    if far > RUNAWAY:
        return {"iou": 0.0, "gap_max": round(far, 3), "gap95": round(far, 3)}
    win = Window(np.concatenate([np.concatenate(rings), np.concatenate(hulls)]))
    A = win.hulls(hulls)
    B = np.zeros_like(A)
    for r in rings:
        B |= win.poly(r)
    if ignore:
        A &= ~ignore_mask(B, ignore, win.poly)
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


def heading_bend(a):
    """Changes of curvature along a centre line, rows (x, y, ...): the turn at each inner node (the chord headings'
    difference) over the mean of its two chords is the curvature there, and its differences, times 0.8 (which puts
    a wiggle 0.08 nuqta high at the usual spacing near the position term's price), are returned. Zero on any steady arc, however
    tight: a tooth's rounded top costs nothing for being round (Fable, 2026-10-20). Row j is about nodes j+1, j+2."""
    ch = np.diff(a[:, :2], axis=0)
    L = np.linalg.norm(ch, axis=1) + 1e-9
    h = np.arctan2(ch[:, 1], ch[:, 0])
    dh = (np.diff(h) + np.pi) % (2 * np.pi) - np.pi
    return np.diff(dh / ((L[1:] + L[:-1]) / 2)) * 0.8


def shape_cost(a, corners, rough, bend="position"):
    """refine's price on a path's shape, rows (x, y, nib angle): rough * (changes of bend along the centre line, and
    of the nib's rate of turning), plus a heavy one for doubling back, since a fold can hide under ink already drawn
    and cost nothing in overlap. A node in `corners` (the spec's "corner": a tooth's tip, where the pen goes up and
    comes straight back) is excused both its bend and its fold; the nib's turning still counts there. `bend`:
    "position" (third differences of the nodes, which also price a steady curve by how tight it is) or "heading"
    (heading_bend, which does not)."""
    n = len(a)
    if bend == "heading":
        bend = heading_bend(a) if n > 3 else np.zeros(1)
        if n > 3 and corners:
            bend = bend[[j for j in range(n - 3) if not {j + 1, j + 2} & corners]]
    else:
        bend = np.diff(a[:, :2], 3, axis=0) / 0.1 if n > 3 else np.zeros((1, 2))
        if n > 3:
            bend = bend[[j for j in range(n - 3) if not {j + 1, j + 2} & corners]] if corners else bend
    turn = np.diff(a[:, 2], 2) / 30 if n > 2 else np.zeros(1)
    ch = np.diff(a[:, :2], axis=0)
    cos = np.sum(ch[1:] * ch[:-1], 1) / (np.linalg.norm(ch[1:], axis=1) * np.linalg.norm(ch[:-1], axis=1) + 1e-9)
    fold = np.sum([max(0, -c) for j, c in enumerate(cos) if j + 1 not in corners]) * 10
    return rough * (np.sum(bend ** 2) + np.sum(turn ** 2)) + fold


def refine(nodes, pieces, origin, ppn, pen_px, rough=0.02, edge=1.0, iters=3, fixed=(), others=(), res=0.5, ignore=(),
           bend="position", hold=()):
    """Nudge a band's nodes (positions and nib angles; end widths stay) to cover its reference pieces, smoothly:
    cost = 1 - overlap + edge * (mean outline gap both ways, nuqta) + rough * (changes of bend along the centre
    line, and of the nib's rate of turning). A steady curve costs nothing; a wiggle does. The outline term is what holds thin ends: a hair overshooting a pointed end, or
    stopping short of it, hardly changes the overlap. Powell's method, a few sweeps. Returns new spec nodes and
    their score. `fixed`: indices of nodes that stay put (a node shared with another letter's stroke);
    `others`: paths already drawn over the same pieces (spec node lists), counted as ink but not moved. `res`: the
    raster's share of the scoring resolution (a coarse first pass at 0.25 is four times quicker). `ignore`: pieces
    whose ground counts neither way (ignore_mask). `bend`: shape_cost's bend term. `hold`: indices of nodes whose
    nib angle stays put while they move (a tooth's top at the studio's constant nib)."""
    from scipy.optimize import minimize
    rings = [ref_ring(r) for r in pieces]
    win = Window(np.concatenate(rings), margin=pen_px)
    win.W, win.H = int(win.W * res), int(win.H * res)
    sub = SUB * res
    px = lambda q: np.round((np.asarray(q) - [win.x1, win.y1]) * sub * 16).astype(np.int32)

    def poly(r):
        m = np.zeros((win.H, win.W), np.uint8)
        cv2.fillPoly(m, [px(r)], 1, cv2.LINE_8, 4)
        return m

    B = np.zeros((win.H, win.W), np.uint8)
    for r in rings:
        B |= poly(r)
    keep = ~ignore_mask(B, ignore, poly) if ignore else None
    n = len(nodes)
    base = np.array([[q["p"][0], q["p"][1], q["angle"]] for q in nodes], float)
    free = [i for i in range(n) if i not in fixed and i - n not in fixed]
    O = np.zeros_like(B)
    for h in [h for p in others for h in path_hulls(p, origin, ppn, pen_px, step=1.0)]:
        cv2.fillConvexPoly(O, cv2.convexHull(px(h)), 1, cv2.LINE_8, 4)

    turn = np.array([[1, 1, 0 if i in hold or i - n in hold else 10] for i in free], float).reshape(-1, 3)

    def unpack(v):
        a = base.copy()
        a[free] += v.reshape(-1, 3) * turn
        return a

    def make(a):
        return [{**q, "p": [float(a[i, 0]), float(a[i, 1])], "angle": float(a[i, 2])} for i, q in enumerate(nodes)]

    def cost(v):
        a = unpack(v)
        A = O.copy()
        for h in path_hulls(make(a), origin, ppn, pen_px, step=1.0):
            cv2.fillConvexPoly(A, cv2.convexHull(px(h)), 1, cv2.LINE_8, 4)
        if keep is not None:
            A &= keep
        iou = (A & B).sum() / max(1, (A | B).sum())
        gap = (outline_gap(A, B).mean() + outline_gap(B, A).mean()) / sub / ppn
        return 1 - iou + edge * gap + shape_cost(a, corners, rough, bend)

    corners = {i for i, q in enumerate(nodes) if q.get("corner")}

    v = np.zeros((len(free) * 3,))
    for _ in range(iters):
        r = minimize(cost, v, method="Powell", options={"xtol": 1e-3, "ftol": 1e-5, "maxfev": 20000})
        v = r.x
    a = unpack(v)
    outn = make(a)
    for q in outn:
        q["p"] = [round(q["p"][0], 3), round(q["p"][1], 3)]
        q["angle"] = round(q["angle"], 1)
    return outn, score([outn, *others], pieces, origin, ppn, pen_px, ignore)


def overshoot(nodes, pieces, origin, ppn, pen_px, near=None, radius=0.5):
    """How far (nuqta) our ink strays outside the reference pieces at its worst, and the overlap. `near`: a point
    (nuqta, the nodes' frame); only ink within `radius` nuqta of it counts towards the worst."""
    rings = [ref_ring(r) for r in pieces]
    hulls = path_hulls(nodes, origin, ppn, pen_px, step=0.25)
    far = runaway(rings, hulls, ppn)
    if far > RUNAWAY:
        return far, 0.0
    win = Window(np.concatenate([np.concatenate(rings), np.concatenate(hulls)]))
    A = win.hulls(hulls)
    B = np.zeros_like(A)
    for r in rings:
        B |= win.poly(r)
    out = (A & ~B.astype(bool)).astype(bool)
    if near is not None:
        c = np.asarray(near) * ppn + origin
        yy, xx = np.mgrid[0:win.H, 0:win.W]
        out &= np.hypot(xx / SUB + win.x1 - c[0], yy / SUB + win.y1 - c[1]) < radius * ppn
    dist = cv2.distanceTransform((1 - B).astype(np.uint8), cv2.DIST_L2, 5)
    worst = float(dist[out].max()) / SUB / ppn if out.any() else 0.0
    return worst, float((A & B).sum() / max(1, (A | B).sum()))


def trim_ends(nodes, pieces, origin, ppn, pen_px, step=0.1, tol=0.005):
    """Pull each end node back toward its neighbour, a tenth of the way at a time, while that lessens how far the
    ink strays outside the reference and costs no more than `tol` of overlap: a hairline end the overlap cannot
    see otherwise overshoots the reference's point (the ta's band, the alif's foot). Each end is judged by the ink
    within half a nuqta of where it began: judged by the stroke's worst anywhere, an end spur was never trimmed
    while the other end strayed further (119.s1's 0.020 nuqta spur, 2026-10-20)."""
    nodes = [dict(n) for n in nodes]
    _, iou = overshoot(nodes, pieces, origin, ppn, pen_px)
    for end, nb in ((0, 1), (-1, -2)):
        at = nodes[end]["p"]
        worst = overshoot(nodes, pieces, origin, ppn, pen_px, near=at)[0]
        for _ in range(8):
            a, b = np.array(nodes[end]["p"]), np.array(nodes[nb]["p"])
            trial = [dict(n) for n in nodes]
            trial[end] = {**trial[end], "p": [round(float(v), 3) for v in a + (b - a) * step]}
            w, i = overshoot(trial, pieces, origin, ppn, pen_px, near=at)
            if w < worst - 0.005 and i >= iou - tol:
                nodes, worst = trial, w
            else:
                break
    return nodes, overshoot(nodes, pieces, origin, ppn, pen_px)[0]


def _thin(m):
    """Zhang-Suen thinning of a 0/1 mask to a one-pixel skeleton."""
    m = np.pad(m.astype(np.uint8), 1)
    while True:
        changed = False
        for step in (0, 1):
            P = [np.roll(np.roll(m, -dy, 0), -dx, 1) for dy, dx in ((-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1))]
            B = sum(P)
            A = sum(((P[i] == 0) & (P[(i + 1) % 8] == 1)).astype(np.uint8) for i in range(8))
            if step == 0:
                c = (P[0] * P[2] * P[4] == 0) & (P[2] * P[4] * P[6] == 0)
            else:
                c = (P[0] * P[2] * P[6] == 0) & (P[0] * P[4] * P[6] == 0)
            kill = (m == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if kill.any():
                m[kill] = 0
                changed = True
        if not changed:
            return m[1:-1, 1:-1]


def skeleton_samples(piece, pen_px, sub=4):
    """Centre samples [x, y, w, phi, off] (screen px, degrees) of a band read off its skeleton, not by pairing its
    two sides: works where one side is far longer than the other (a crescent) or the band curls (a final alif
    turning in from the line). The skeleton's longest path, carried out to the piece's own ends."""
    from collections import deque
    ring = ref_ring(piece)
    x1, y1 = ring.min(0) - 4
    W, H = (ring.max(0) - ring.min(0) + 8) * sub
    m = np.zeros((int(H) + 1, int(W) + 1), np.uint8)
    cv2.fillPoly(m, [np.round((ring - [x1, y1]) * sub * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
    dt = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    sk = _thin(m)
    pts = {tuple(p) for p in np.argwhere(sk)}
    nb = lambda p: [(p[0] + dy, p[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (p[0] + dy, p[1] + dx) in pts]
    def far(src):
        prev, q, last = {src: None}, deque([src]), src
        while q:
            last = q.popleft()
            for n in nb(last):
                if n not in prev:
                    prev[n] = last
                    q.append(n)
        return last, prev
    a, _ = far(next(iter(pts)))
    b, prev = far(a)
    path, p = [], b
    while p is not None:
        path.append(p)
        p = prev[p]
    path = np.array(path[::-1], float)  # (row, col)
    # carry each end out to the outline along its own direction
    def extend(path, at_start):
        e, f = (path[0], path[min(6, len(path) - 1)]) if at_start else (path[-1], path[max(-7, -len(path))])
        d = (e - f) / (np.linalg.norm(e - f) or 1)
        ext, q = [], e.copy()
        while True:
            q = q + d
            r, c = int(round(q[0])), int(round(q[1]))
            if not (0 <= r < m.shape[0] and 0 <= c < m.shape[1]) or not m[r, c]:
                break
            ext.append(q.copy())
        ext = np.array(ext).reshape(-1, 2)
        return np.vstack([ext[::-1], path]) if at_start else np.vstack([path, ext])
    path = extend(extend(path, True), False)
    xy = np.c_[path[:, 1] / sub + x1, path[:, 0] / sub + y1]
    w = np.array([2 * dt[min(int(round(r)), m.shape[0] - 1), min(int(round(c)), m.shape[1] - 1)] / sub for r, c in path])
    step = max(1, len(xy) // 80)
    xy, w = xy[::step], w[::step]
    out = []
    for k in range(len(xy)):
        k0, k1 = max(0, k - 2), min(len(xy) - 1, k + 2)
        phi = math.degrees(math.atan2(-(xy[k1, 1] - xy[k0, 1]), xy[k1, 0] - xy[k0, 0]))
        out.append([float(xy[k, 0]), float(xy[k, 1]), float(w[k]), phi, math.degrees(math.asin(min(1.0, w[k] / pen_px)))])
    return out
