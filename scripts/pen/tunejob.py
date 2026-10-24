"""Point tuning of fitted strokes as one job (fitjob.py mode "tune"), so the searches that ran on the laptop
(SCRATCH/me/eyetune.py and joint.py, 2026-10-23) run on a worker. Each is a coordinate search on chosen nodes,
judged on every shape that draws the strokes, as the comparison sheets draw it (widenjob.py's masks()).

    search "window"  eyetune.py: positions (and with `angles`, nib angles) in steps STEPS; the score is the mean
                     overlap of every shape minus win_w/100 x each window's mismatch (plus perim_w x its edge length
                     against the studio's, so a spike or notch counts though it adds little area); no shape may fall
                     more than `floor` below where it began
    search "hair"    SCRATCH/me/autocut.py, one hair at one stroke end: the end cut back along its path (CUTS), its
                     node's nib turned (TURNS) or narrowed (WIDTHS), or turned and narrowed; of those that bring our
                     ink within CLEAR of the studio's within R of the hair without any shape losing more than
                     `slack`, the one with the most overlap over the shapes is kept (none: the stroke as it was)
    search "joint"   joint.py, one stroke end: first lengthened if that helps, then its last K nodes moved, turned and
                     widened in JOINT_STEPS, shrinking the mismatch within R of the joint with its worst point weighed
                     in; no shape's overlap may fall, no worst miss within R may grow past where it began + 0.005,
                     and gates() holds the nib's turn, the chord lengths and the path's bends near what they were

Like a widen job it is self-contained: the reading side (SCRATCH/me/tjob.py) resolves every other stroke first.
    name, mode "tune", search    as above
    ppn, pen, px, up, fill_max, fill_gaps    as a widen job's
    strokes  {job: {origin, start, idx}}: the strokes tuned, their nodes now and the nodes the search may move;
             "joint" has one stroke, with `end` (0 or -1) and idx its last K nodes
    shapes   {shape: {rings, fill, others, tuned: {job: [delta, ...]}, windows: [[x0, y0, x1, y1]], at: [x, y]}}:
             as a widen job's, with each tuned stroke's placements; windows and the joint's point in screen px
             (the shape's own frame), so they hold when the frame's corner moves with the ink; optional close:
             [[x0, y0, x1, y1, r]], boxes (screen px) where the studio's ink is closed with a disc of r nuqta before
             judging, for a notch the user said the studio should not have either (401's and 409's necks)
    win_w, perim_w, angles, floor    "window"'s weights (defaults 10, 0, true, 0.001)
The result: {name, kind "tune", job (the first stroke), jobs {job: nodes}, judge {shape: {before, after}}, score,
seconds, host, cpus, gpu, settings}; before and after are [overlap, worst miss in nuqta]."""
import copy, os, socket, time
import numpy as np
import cv2
from pieces import ref_ring, path_hulls
from outline import smooth_mask
from widenjob import masks, worst

STEPS = (0.04, 0.02, 0.01)  # nuqta; with angles, x100 degrees (eyetune.py)
JOINT_STEPS = (1.5, 0.75, 0.35)  # joint.py's scales of its moves (0.04 nuqta, 4 degrees, 0.1 width)
R, BEND = 0.35, 8.0  # joint.py: the joint's radius in nuqta, and how far a node's path bend may move (degrees)


class Shapes:
    """Every shape's studio ink and fixed strokes drawn once; the tuned strokes drawn per call."""
    def __init__(self, job):
        self.job = job; self.ppn, self.pen = float(job["ppn"]), float(job["pen"])
        self.S, self.up = job["px"] / self.ppn, job["up"]; self.pxn = job["px"] * self.up
        self.c = {}
        for k, sh in job["shapes"].items():
            rings = [ref_ring([[1, 1, 0, 0], d]) for d in sh["rings"]]
            fixed = []
            for o in sh["others"]:
                fixed += [hh + np.asarray(o["delta"]) for hh in path_hulls(o["nodes"], np.asarray(o["origin"], float), self.ppn, self.pen)]
            self.c[k] = (rings, [rings[i] for i in sh["fill"]], fixed)

    def draw(self, k, cur):
        """(ours, studio's, corner): the masks, and the frame's corner in screen px."""
        rings, fills, hulls = self.c[k]; hulls = list(hulls)
        for j, ds in self.job["shapes"][k]["tuned"].items():
            o = np.asarray(self.job["strokes"][j]["origin"], float)
            for d in ds:
                hulls += [hh + np.asarray(d) for hh in path_hulls(cur[j], o, self.ppn, self.pen)]
        corner = np.concatenate(rings + hulls).min(0) - 2  # widenjob.masks()'s own corner
        A, B = masks(hulls, rings, fills, self.S, self.up, self.pxn, self.job["fill_max"], self.job["fill_gaps"])
        for c in self.job["shapes"][k].get("close", []):
            (x0, y0), (x1, y1) = self.px(c[:2], corner).astype(int), self.px(c[2:4], corner).astype(int)
            r = max(1, int(c[4] * self.pxn)); x0, y0 = max(0, x0), max(0, y0)
            disc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
            B[y0:y1, x0:x1] |= cv2.morphologyEx(B, cv2.MORPH_CLOSE, disc)[y0:y1, x0:x1]
        return smooth_mask(A, self.pxn), B, corner

    def px(self, p, corner):
        return (np.asarray(p, float) - corner) * self.S * self.up


iou = lambda A, B: float((A & B).sum() / max(1, (A | B).sum()))
edge = lambda M: int((M ^ cv2.erode(M, np.ones((3, 3), np.uint8))).sum())


def window(job, sh):
    win_w, perim_w = job.get("win_w", 10.0), job.get("perim_w", 0.0)
    angles, floor = job.get("angles", True), job.get("floor", 0.001)

    def judge(cur):
        tot, loc, ious = 0.0, 0.0, {}
        for k in job["shapes"]:
            A, B, c0 = sh.draw(k, cur); ious[k] = iou(A, B); tot += ious[k]
            for w in job["shapes"][k].get("windows", []):
                (x0, y0), (x1, y1) = sh.px(w[:2], c0).astype(int), sh.px(w[2:], c0).astype(int)
                a, b = A[max(0, y0):y1, max(0, x0):x1], B[max(0, y0):y1, max(0, x0):x1]
                loc += float((a != b).sum()) / max(1, (a | b).sum())
                if perim_w:
                    loc += perim_w * abs(edge(a) - edge(b)) / max(1, edge(b))
        return tot / len(ious) - win_w * loc * 0.01, ious

    cur = {j: copy.deepcopy(s["start"]) for j, s in job["strokes"].items()}
    best, i0 = judge(cur)
    for step in STEPS:
        improved = True
        while improved:
            improved = False
            for j, s in job["strokes"].items():
                for i in s["idx"]:
                    moves = [(step, 0, 0), (-step, 0, 0), (0, step, 0), (0, -step, 0)]
                    if angles:
                        moves += [(0, 0, step * 100), (0, 0, -step * 100)]
                    for d in moves:
                        c = copy.deepcopy(cur); q = c[j][i]; p = q["p"]
                        q["p"] = [round(p[0] + d[0], 4), round(p[1] + d[1], 4)]
                        if d[2]:
                            q["angle"] = round(q.get("angle", 145) + d[2], 2)
                        s_, ious = judge(c)
                        if s_ > best + 1e-5 and all(ious[k] >= i0[k] - floor for k in ious):
                            cur, best, improved = c, s_, True
    return cur


def gates(ns, ref, lo, hi):
    """joint.py's gates: nib turn per chord and chord ratio over chords lo..hi against what ref already did there,
    and no node's path bend moved more than BEND."""
    def turn(n):
        return [abs(((n[i + 1].get("angle", 145) - n[i].get("angle", 145)) + 180) % 360 - 180) for i in range(len(n) - 1)]
    def ratio(n):
        L = [np.hypot(*np.subtract(n[i + 1]["p"], n[i]["p"])) for i in range(len(n) - 1)]
        return [max(L[i], L[i + 1]) / max(1e-6, min(L[i], L[i + 1])) for i in range(len(L) - 1)]
    def bend(n):
        P = np.array([q["p"] for q in n]); d = np.diff(P, axis=0); a = np.degrees(np.arctan2(d[:, 1], d[:, 0]))
        return (np.diff(a) + 180) % 360 - 180
    t, t0 = turn(ns)[lo:hi], turn(ref)[lo:hi]
    r, r0 = ratio(ns)[max(0, lo - 1):hi], ratio(ref)[max(0, lo - 1):hi]
    return (max(t, default=0) <= max(5.0, max(t0, default=0)) + 1e-6
            and max(r, default=0) <= max(2.5, max(r0, default=0)) + 1e-6
            and float(np.abs(bend(ns) - bend(ref)).max(initial=0)) <= BEND)


def extend(nodes, e, d):
    """A node added d nuqta past end e along the last chord, the nib's angle and width carried on."""
    ns = [dict(n) for n in nodes]
    a, b = (ns[1], ns[0]) if e == 0 else (ns[-2], ns[-1])
    t = np.subtract(b["p"], a["p"]); t = t / (np.linalg.norm(t) or 1)
    q = dict(b); q["p"] = [round(float(v), 4) for v in np.add(b["p"], t * d)]
    return [q] + ns if e == 0 else ns + [q]


def joint(job, sh):
    (j, s), = job["strokes"].items()
    e, K = int(s["end"]), len(s["idx"])

    def local(A, B, at):
        yy, xx = np.ogrid[:A.shape[0], :A.shape[1]]
        win = (xx - at[0]) ** 2 + (yy - at[1]) ** 2 < (R * sh.pxn) ** 2
        over, bare = (A == 1) & (B == 0) & win, (B == 1) & (A == 0) & win
        o = cv2.distanceTransform((1 - B).astype(np.uint8), cv2.DIST_L2, 5)[over].max() / sh.pxn if over.any() else 0.0
        b = cv2.distanceTransform((1 - A).astype(np.uint8), cv2.DIST_L2, 5)[bare].max() / sh.pxn if bare.any() else 0.0
        return float(o), float(b), float((over.sum() + bare.sum()) / sh.pxn ** 2)

    def judge(ns):
        res = {}
        for k in job["shapes"]:
            A, B, c0 = sh.draw(k, {j: ns}); res[k] = (iou(A, B), local(A, B, sh.px(job["shapes"][k]["at"], c0)))
        return res

    cost = lambda res: sum(v[1][2] + 0.5 * max(v[1][0], v[1][1]) for v in res.values())
    nodes = [dict(n) for n in s["start"]]; ref = [dict(n) for n in nodes]
    base0 = judge(nodes); best_c = cost(base0)
    worst0 = {k: max(v[1][0], v[1][1]) for k, v in base0.items()}
    ok = lambda res: (all(res[k][0] >= base0[k][0] for k in res)
                      and all(max(v[1][0], v[1][1]) <= worst0[k] + 0.005 for k, v in res.items()))

    def span(n):
        idx = list(range(min(K, n))) if e == 0 else list(range(n - min(K, n), n))
        return idx, ((0, min(K, n - 1)) if e == 0 else (max(0, n - 1 - K), n - 1))
    idx, (lo, hi) = span(len(nodes))
    for d in (0.3, 0.2, 0.15, 0.1, 0.05):  # a stroke stopping short of its joint: lengthen it, longest that helps
        trial = extend(nodes, e, d); res = judge(trial)
        if ok(res) and cost(res) < best_c - 0.002:
            nodes, best_c = trial, cost(res); ref = [dict(q) for q in nodes]
            idx, (lo, hi) = span(len(nodes))
            break
    for step in JOINT_STEPS:
        improved = True
        while improved:
            improved = False
            for i in idx:
                for key, d in (("x", 0.04), ("y", 0.04), ("angle", 4.0), ("width", 0.1)):
                    for sgn in (1, -1):
                        trial = [dict(q) for q in nodes]; q = trial[i]
                        if key in ("x", "y"):
                            p = list(q["p"]); a = 0 if key == "x" else 1
                            p[a] = round(p[a] + sgn * d * step, 4); q["p"] = p
                        elif key == "angle":
                            q["angle"] = round(q.get("angle", 145) + sgn * d * step, 2)
                        else:
                            w = round(q.get("width", 1) + sgn * d * step, 3)
                            if not 0.25 <= w <= 1.5:
                                continue
                            q["width"] = w
                        if not gates(trial, ref, lo, hi):
                            continue
                        res = judge(trial)
                        if ok(res) and cost(res) < best_c - 0.0005:
                            nodes, best_c, improved = trial, cost(res), True
    return {j: nodes}


CUTS = (0.03, 0.05, 0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.4)
TURNS = (-60, -45, -30, -20, -10, 10, 20, 30, 45, 60)
WIDTHS = (0.8, 0.6, 0.4)
CLEAR, HAIR_R = 0.02, 0.2


def cut(nodes, e, d):
    """hair.py's cut: the stroke shortened by d nuqta at end e, measured along its nodes; None if too little is left."""
    ns = [dict(n) for n in (nodes if e == -1 else nodes[::-1])]
    left = d
    while len(ns) > 2:
        a, b = np.array(ns[-2]["p"]), np.array(ns[-1]["p"]); L = float(np.linalg.norm(b - a))
        if L > left:
            t = 1 - left / L
            q = dict(ns[-1]); q["p"] = [round(float(v), 4) for v in a + (b - a) * t]
            for key in ("angle", "width"):
                if key in ns[-1] or key in ns[-2]:
                    dflt = 1 if key == "width" else 145
                    va, vb = ns[-2].get(key, dflt), ns[-1].get(key, dflt)
                    q[key] = round(float(va + (vb - va) * t), 3)
            ns[-1] = q
            return ns if e == -1 else ns[::-1]
        left -= L; ns.pop()
    return None


def hair(job, sh):
    (j, s), = job["strokes"].items()
    e, slack = int(s["end"]), job.get("slack", 0.0015)
    k0 = job["at_shape"]

    def reach(ns):
        A, B, c0 = sh.draw(k0, {j: ns}); at = sh.px(job["shapes"][k0]["at"], c0)
        yy, xx = np.ogrid[:A.shape[0], :A.shape[1]]
        m = (A == 1) & (B == 0) & ((xx - at[0]) ** 2 + (yy - at[1]) ** 2 < (HAIR_R * sh.pxn) ** 2)
        return float(cv2.distanceTransform((1 - B).astype(np.uint8), cv2.DIST_L2, 5)[m].max() / sh.pxn) if m.any() else 0.0

    def ious(ns):
        return {k: iou(*sh.draw(k, {j: ns})[:2]) for k in job["shapes"]}

    base = s["start"]; i0 = ious(base); pick = None
    tries = [(f"cut {d}", cut(base, e, d)) for d in CUTS]
    for da in TURNS:
        for w in (None,) + WIDTHS:
            ns = [dict(n) for n in base]; q = ns[e]; q["angle"] = round(q.get("angle", 145) + da, 2)
            if w:
                q["width"] = round(q.get("width", 1.0) * w, 3)
            tries.append((f"nib {da:+d}" + (f" width x{w}" if w else ""), ns))
    for w in WIDTHS:
        ns = [dict(n) for n in base]; ns[e]["width"] = round(ns[e].get("width", 1.0) * w, 3)
        tries.append((f"width x{w}", ns))
    for how, ns in tries:
        if ns is None or reach(ns) >= CLEAR:
            continue
        i1 = ious(ns)
        if all(i1[k] >= i0[k] - slack for k in i1) and (pick is None or sum(i1.values()) > sum(pick[2].values())):
            pick = (how, ns, i1)
    job["_how"] = pick[0] if pick else None
    return {j: pick[1] if pick else base}


def run(job):
    t = time.time()
    sh = Shapes(job)
    start = {j: s["start"] for j, s in job["strokes"].items()}

    def verdict(cur):
        out = {}
        for k in job["shapes"]:
            A, B, _ = sh.draw(k, cur); out[k] = [round(iou(A, B), 4), worst(A, B, sh.pxn)]
        return out
    before = verdict(start)
    cur = {"joint": joint, "hair": hair}.get(job["search"], window)(job, sh)
    after = verdict(cur)
    keys = ("search", "win_w", "perim_w", "angles", "floor")
    return {"name": job["name"], "kind": "tune", "job": next(iter(job["strokes"])), "jobs": cur,
            "nodes": cur[next(iter(job["strokes"]))],
            "judge": {k: {"before": before[k], "after": after[k]} for k in job["shapes"]},
            "score": {"iou": min((v[0] for v in after.values()), default=0.0)},
            "seconds": round(time.time() - t), "host": socket.gethostname(), "cpus": os.cpu_count(), "gpu": False,
            "settings": {**{k: job.get(k) for k in keys}, "how": job.get("_how")}}
