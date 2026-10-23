"""A stroke written with a pen as wide as its band, as one job (fitjob.py mode "widen"): each node where the standard
nib's end stands inside the studio's piece by more than `short` gets the ink's chord along its own nib line as its
width (capped at WIDEST, TOL inside both edges), centred on that chord; the added width and the moves then smoothed
so the pen never jumps. Judged, before and after, on every shape that draws the stroke, as the comparison sheets draw
it (method in docs/calligraphy/stroke-ledger.md, "the wider pen").

The job is self-contained, so a worker needs neither the studio's files nor the sheets: the reading side resolves
every other stroke of each shape to its nodes before it submits.
    name      <stroke's job>.wd[tag]
    piece, origin, ppn, pen   the stroke's studio piece, as a fit job's
    start     the stroke's nodes now
    short, passes, move, ends, taper    widen() below
    px, up, fill_max, fill_gaps         the sheet's scale and pocket filling (sheet.py's PX, UP, FILL_MAX, FILL_GAPS)
    shapes    {shape: {rings: [svg d], fill: [ring index], targets: [delta], others: [{nodes, origin, delta}]}}:
              the studio's outlines, which of them are filled marks, where this stroke sits in the shape (screen px
              from its home frame; twice where the shape draws it twice), and every other stroke as the sheet draws it
The result: {name, kind, job, nodes, judge: {shape: {before: [overlap, worst], after: [...]}}, score, seconds, ...}."""
import os, socket, time
import numpy as np
import cv2
from pieces import ref_ring, path_hulls
from outline import smooth_mask

WIDEST, TOL = 1.5, 0.005
nib_u = lambda a: np.array([np.cos(np.radians(a)), -np.sin(np.radians(a))])


class Piece:
    """The studio's piece as a mask, S px to the nuqta, in the stroke's own nuqta frame."""
    def __init__(self, piece, origin, ppn, S=400):
        r = (ref_ring(piece) - np.asarray(origin, float)) / ppn
        self.S = S; self.c0 = r.min(0) - 0.5; sz = ((r.max(0) - self.c0 + 0.5) * S).astype(int)[::-1]
        self.M = np.zeros(sz, np.uint8); cv2.fillPoly(self.M, [np.round((r - self.c0) * S).astype(np.int32)], 1)
        self.dM = (cv2.distanceTransform(self.M, cv2.DIST_L2, 5) - cv2.distanceTransform(1 - self.M, cv2.DIST_L2, 5)) / S

    def q(self, p):
        return np.round((np.asarray(p) - self.c0) * self.S).astype(int)

    def inside(self, p):
        q = self.q(p); return 0 <= q[1] < self.M.shape[0] and 0 <= q[0] < self.M.shape[1] and self.M[q[1], q[0]] > 0

    def depth(self, p):
        q = self.q(p)
        if not (0 <= q[1] < self.M.shape[0] and 0 <= q[0] < self.M.shape[1]):
            return -1.0
        return float(self.dM[q[1], q[0]])

    def chord(self, c, u):
        c = np.asarray(c, float); ends = []
        for sgn in (1, -1):
            t = 0.0
            while self.inside(c + u * (t + 0.0025) * sgn) and t < 3.0:
                t += 0.0025
            ends.append(c + u * t * sgn)
        return float(np.linalg.norm(ends[0] - ends[1])), ends


def widen(nodes, piece, nib, short=0.01, passes=1, move=1.0, ends=True, taper=(0, 0)):
    w, mv = [], []
    for n in nodes:
        c = np.array(n["p"], float); u = nib_u(n.get("angle", 145)); w0 = n.get("width", 1.0)
        deep = max(piece.depth(c + u * nib * w0 / 2), piece.depth(c - u * nib * w0 / 2))
        L, e = piece.chord(c, u)
        if deep <= short or L > WIDEST * nib or L - 2 * TOL <= nib * w0 or not piece.inside(c):
            w.append(w0); mv.append(np.zeros(2)); continue
        w.append(min(WIDEST, (L - 2 * TOL) / nib)); mv.append((e[0] + e[1]) / 2 - c)
    w0 = np.array([n.get("width", 1.0) for n in nodes]); dw, mv = np.array(w) - w0, np.array(mv)
    # the added width and the moves smoothed over three nodes ([1,2,1]/4; an end with its one neighbour, [2,1]/3):
    # a lone widened node would bulge, and an end left at the old width next to a widened node cuts a step into the
    # end (108's tip). Only what was added is smoothed, so a thin start (144's 0.5) stays thin where nothing was added.
    # passes smooths that many times (a kink where one node moved and its neighbour didn't: 722, 436); move scales the
    # moves (0: the pen widens about the node where it is)
    ds, ms = dw.copy(), mv.copy() * move
    for _ in range(passes):
        d0, m0 = ds.copy(), ms.copy()
        for i in range(1, len(dw) - 1):
            ds[i] = (d0[i - 1] + 2 * d0[i] + d0[i + 1]) / 4; ms[i] = (m0[i - 1] + 2 * m0[i] + m0[i + 1]) / 4
        if len(dw) > 2 and ends:
            for i, j in ((0, 1), (-1, -2)):
                ds[i] = (2 * d0[i] + d0[j]) / 3; ms[i] = (2 * m0[i] + m0[j]) / 3
    # taper (a, b): the added width and moves eased to nothing over the first a and last b nodes, where the stroke
    # hands over to another at a lift and must meet it with the same pen (719's S-curve into its tail)
    ta, tb = (min(int(v), len(ds)) for v in taper)  # never past the stroke's own nodes (043.s1 has two)
    for n_, idx in ((ta, range(ta)), (tb, range(len(ds) - tb, len(ds)))):
        for k_, i in enumerate(idx):
            f = (k_ / n_) if n_ and idx.start == 0 else ((len(ds) - 1 - i) / n_ if n_ else 1)
            ds[i] *= f; ms[i] *= f
    ws = np.minimum(WIDEST, w0 + ds)
    res = []
    for n, wi, m in zip(nodes, ws, ms):
        p = np.array(n["p"], float) + m
        res.append({**n, "p": [round(float(p[0]), 4), round(float(p[1]), 4)], "width": round(float(wi), 3)})
    return res


def masks(hulls, rings, fills, S, up, pxn, fill_max, fill_gaps):
    """Ours and the studio's ink, solid, as sheet.py's masks() draws them (the waiting layer left out)."""
    pts = np.concatenate(rings + hulls) if hulls else np.concatenate(rings)
    x1, y1 = pts.min(0) - 2; x2, y2 = pts.max(0) + 2
    W, H = (int((x2 - x1) * S) + 1) * up, (int((y2 - y1) * S) + 1) * up
    px = lambda r: np.round((np.asarray(r) - [x1, y1]) * S * up * 16).astype(np.int32)
    A, B = np.zeros((H, W), np.uint8), np.zeros((H, W), np.uint8)
    for h in hulls:
        cv2.fillConvexPoly(A, cv2.convexHull(px(h)), 1, cv2.LINE_8, 4)
    F = np.zeros_like(A)
    for r in fills:
        layer = np.zeros_like(A); cv2.fillPoly(layer, [px(r)], 1, cv2.LINE_8, 4); F |= layer
    A |= F
    if fills and fill_gaps:  # paper shut in against a filled mark, up to fill_max nuqta^2, is part of it
        n, lab = cv2.connectedComponents((1 - A).astype(np.uint8), connectivity=4)
        edge = set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        near = lab * cv2.dilate(F, np.ones((5, 5), np.uint8))
        for i in set(np.unique(near)) - edge - {0}:
            if (lab == i).sum() <= fill_max * pxn ** 2:
                A[lab == i] = 1
    for r in rings:
        layer = np.zeros_like(B); cv2.fillPoly(layer, [px(r)], 1, cv2.LINE_8, 4); B |= layer
    return A, B


def worst(A, B, pxn):
    o, b = (A == 1) & (B == 0), (B == 1) & (A == 0)
    wo = cv2.distanceTransform((1 - B).astype(np.uint8), cv2.DIST_L2, 5)[o].max() / pxn if o.any() else 0.0
    wb = cv2.distanceTransform((1 - A).astype(np.uint8), cv2.DIST_L2, 5)[b].max() / pxn if b.any() else 0.0
    return round(float(max(wo, wb)), 3)


def judge(job, nodes, sh):
    """(overlap, worst miss in nuqta) of one shape, with this stroke drawn by `nodes`."""
    ppn, pen = float(job["ppn"]), float(job["pen"])
    S, up = job["px"] / ppn, job["up"]; pxn = job["px"] * up
    rings = [ref_ring([[1, 1, 0, 0], d]) for d in sh["rings"]]
    fills = [rings[i] for i in sh["fill"]]
    hulls = []
    for o in sh["others"]:
        hulls += [hh + np.asarray(o["delta"]) for hh in path_hulls(o["nodes"], np.asarray(o["origin"], float), ppn, pen)]
    for d in sh["targets"]:
        hulls += [hh + np.asarray(d) for hh in path_hulls(nodes, np.asarray(job["origin"], float), ppn, pen)]
    A, B = masks(hulls, rings, fills, S, up, pxn, job["fill_max"], job["fill_gaps"])
    A = smooth_mask(A, pxn)
    return round(float((A & B).sum() / max(1, (A | B).sum())), 4), worst(A, B, pxn)


def run(job):
    t = time.time()
    ppn, pen = float(job["ppn"]), float(job["pen"])
    nodes = widen(job["start"], Piece(job["piece"], job["origin"], ppn), pen / ppn, job.get("short", 0.01),
                  job.get("passes", 1), job.get("move", 1.0), job.get("ends", True), tuple(job.get("taper", (0, 0))))
    res = {k: {"before": judge(job, job["start"], sh), "after": judge(job, nodes, sh)} for k, sh in job["shapes"].items()}
    return {"name": job["name"], "kind": "widen", "job": job["job"], "nodes": nodes, "judge": res,
            "score": {"iou": min((v["after"][0] for v in res.values()), default=0.0)},
            "seconds": round(time.time() - t), "host": socket.gethostname(), "cpus": os.cpu_count(), "gpu": False,
            "settings": {k: job.get(k) for k in ("short", "passes", "move", "ends", "taper")}}
