"""Jali Diwani strokes fitted with a pen held to the qalam: the Thuluth session's method (its pen-fitter note,
2026-10-25: one nib angle and size per stroke, the width falling only where the pen lifts, onto one corner), run on
the sheet's exact strokes (jdcatalog with JD_EXACT). Every choice is scored on the GPU (gpufit.gpu_score); the CPU's
pieces.score runs once a stroke, as a check. Runs on the Geekmini through the queue's "scan" mode (jdpensubmit.py).
For each stroke "shape.sN":
  starts   the outline's centre line (band or skeleton, the better one) and the stroke's free fit (jdx-), if any
  angles   for each start, the two nib angles (at least 30 degrees apart) whose straight sweep covers it best
  anchors  each end may lift onto either corner: the four pairs (a turning nib: the first pair for every angle, then
           the other three for the leading start and angle only, PEN_PRUNE)
each start's combinations refined side by side by gpufit.refine_pens with one schedule (fine first over SHORT nuqta, coarse first under),
the best by overlap less outline gap less the end windows' worst miss kept, then run again with the other schedule.
  python jdpenjob.py OUT stroke ...      writes OUT/pen.json {stroke: {...}} and OUT/pics.json {stroke: png base64}
env PEN_LIFT (nuqta at each end that may lift, default 1.0), PEN_SIZE ("1": the nib's size may move, default "1"),
PEN_FILL ("a.s0,b.s1": strokes filled with a small pen or the nib's tip, fitted freely, not held to the pen)."""
import base64, json, math, os, sys, time
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from jdcatalog import strokes, origin, transform, PPN, PEN  # noqa: E402
from ribbon import bands, smooth_path  # noqa: E402
from pieces import ref_ring, score, skeleton_samples, _thin  # noqa: E402
import gpufit  # noqa: E402
from gpufit import gpu_score  # noqa: E402

Q = os.environ.get("HARF_Q", "")
LIFT = float(os.environ.get("PEN_LIFT", 1.0))
SIZE = os.environ.get("PEN_SIZE", "1") == "1"
FILL = {x for x in os.environ.get("PEN_FILL", "").split(",") if x}
# PEN_ROTATE ("1", the default): the nib turns as it goes. Diwani's teacher rotates the pen in the fingers to taper an
# end and to follow a curve ("You must rotate the pen while moving", "a fixed angle gives the wrong shape": the course
# notes), so the Thuluth rule of one angle a stroke drew the trial's alif at 0.75 against the free fit's 0.97. Every
# node is then a turn (gpufit's pen "turns"): its own angle, kept smooth by the refine's roughness term, while the size
# stays one and the width still falls only where the pen lifts, onto one corner.
ROTATE = os.environ.get("PEN_ROTATE", "1") == "1"
# The small pen (the user, 2026-10-26: the head curls and the crowns' heads; the course: "one third of that width ... used
# for decorations and small heads"): those strokes are fitted with a nib a third as wide, and hand back node widths as
# fractions of the main nib (a third, less where the pen lifts), so a renderer draws them with the one pen.
SMALL_PEN = 1 / 3
SMALL = {"T04.s0", "T05.s0", "T06.s0"} | {x for x in os.environ.get("PEN_SMALL", "").split(",") if x}
# A long stroke's ends may thin over PEN_LIFT_LONG nuqta (the user, 2026-10-26: Diwani's long tails thin over more
# than the 1 nuqta of a Thuluth flick); LONG: the start path's length, nuqta, from which a stroke counts as long.
LIFT_LONG = float(os.environ.get("PEN_LIFT_LONG", 2.0))
LONG = 4.0
SHORT = 1.5
ANCHORS = ((1, 1), (1, -1), (-1, 1), (-1, -1))
# PEN_PRUNE ("1", the default; turning-nib fits only): every angle with the first anchor pair, then the other three
# pairs for the leading start and angle alone. The Thuluth session's logs (2026-10-26) had one angle's four pairs within
# 0.005 of each other and the angles 0.05-0.15 apart; on four turning-nib strokes the pruned search found the same fits
# in 2,135 s against 4,524 s. A turning nib's 12-24 tries overflow GPUFIT_PEN_PIXELS into several loops on the card, so
# fewer tries drop whole loops; a one-angle fit's 8 share one loop, and pruning made them 15% slower, so they keep the full search.
PRUNE = os.environ.get("PEN_PRUNE", "1") == "1"
# PEN_SPLIT ("T18.s0,..."): strokes whose sheet outline carries hairlines drawn with the pen's tip, a move of their own
# pulled from the wet body (the course: "using the tip of the pen to add a nice decoration", "come back with the tip
# of the pen ... extrude slightly, like neatly from the main line"). The main pen cannot sweep them, so such a stroke is
# fitted as its body, all of it wider than HAIR_W nuqta, with the main pen, and each hairline "stroke~hN" filled with
# the small pen, its widths free. T18.s0 held whole: 0.62, the head and both loops missed.
SPLIT = {x for x in os.environ.get("PEN_SPLIT", "").split(",") if x}
HAIR_W, HAIR_L = 0.2, 0.5  # nuqta: a hairline is thinner than HAIR_W and reaches HAIR_L; shorter bits are where the body thins
HAIR_SPACING = 0.12  # nuqta between a hairline's start nodes: a loop half a nuqta across needs a dozen to go round
TIP_ANGLE = 110  # degrees: an outline point sharper than this is a tooth's tip
TOOTH = 0.25  # nuqta the outline stands out of the stroke past its half width: a tooth the pen goes up into and back (tooth_start)
END_R, CORNER = 0.6, 2.0
ALT_GAP = 0.05
ROUGH, EDGE, SPACING = 0.05, 3.0, 0.3


def old_fit(stroke):
    """The stroke's free fit from the queue (jdx-, and its second pass), the better by overlap less outline gap."""
    rs = [json.load(open(f, encoding="utf-8")) for f in (os.path.join(Q, "done", f"jdx-{stroke}{x}.json") for x in ("", ".u"))
          if os.path.exists(f)]
    return max(rs, key=lambda r: r["score"]["iou"] - r["score"]["gap95"]) if rs else None


def split_piece(piece):
    """A PEN_SPLIT stroke's outline as its body (wider than HAIR_W) and its hairlines (reaching HAIR_L or more), longest first, each a piece in
    the stroke's own frame, plus the slivers where the body thins out (in nobody's target). A hairline's loop is a hole;
    a ring holds none, so the hole is joined to the outline by a slit of no width."""
    (a, d, e, f), _ = piece
    ring = ref_ring(piece); r = 8.0  # raster px a screen px
    x1, y1 = ring.min(0) - 4
    W, H = [int(v) + 1 for v in (ring.max(0) + 4 - [x1, y1]) * r]
    M = np.zeros((H, W), np.uint8)
    cv2.fillPoly(M, [np.round((ring - [x1, y1]) * r).astype(np.int32)], 1)
    k = int(HAIR_W / 2 * PPN * r) * 2 + 1
    body = cv2.morphologyEx(M, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))

    def rings_of(mask):
        cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        out = []
        for i, c in enumerate(cs):
            if hier[0][i][3] != -1 or len(c) < 3:  # a pixel's contour is one point, a ring with no segments to parse
                continue
            pts, j = c[:, 0].astype(float), hier[0][i][2]
            while j != -1:
                h = cs[j][:, 0].astype(float)
                ia, ib = np.unravel_index((((pts[:, None] - h[None]) ** 2).sum(-1)).argmin(), (len(pts), len(h)))
                pts = np.vstack([pts[:ia + 1], np.roll(h, -ib, 0), h[ib:ib + 1], pts[ia:]])
                j = hier[0][j][0]
            P = pts / r + [x1, y1]
            q = np.c_[(P[:, 0] - e) / a, (P[:, 1] - f) / d]
            out.append((max(cv2.boundingRect(c)[2:]) / r / PPN, [(a, d, e, f), "M " + " L ".join("%.4f %.4f" % tuple(v) for v in q) + " Z"]))
        return sorted(out, key=lambda t: -t[0])
    bodies, hairs = rings_of(body), rings_of(M & (1 - body))
    return (bodies[0][1], [p for s, p in hairs if s >= HAIR_L],
            [p for s, p in bodies[1:]] + [p for s, p in hairs if s < HAIR_L])


def job_of(stroke):
    base, _, h = stroke.partition("~")
    k, sid = base.split(".", 1)
    d_of = dict(strokes(k)); T = transform(k)
    piece, ignore = [T, d_of[sid]], [[T, od] for osid, od in d_of.items() if osid != sid]
    if base in SPLIT:  # the body ("~" none) or hairline "~hN", the stroke's other parts beside the shape's strokes
        body, hairs, slivers = split_piece(piece)
        parts = [body] + hairs; i = int(h[1:]) if h else 0
        piece, ignore = parts[i], ignore + [p for j, p in enumerate(parts) if j != i] + slivers
    return piece, ignore, np.array(origin(k), float)


def judge(s):
    return s["iou"] - s["gap95"] - CORNER * s.get("window_worst", 0.0)


def end_windows(nodes, pen=PEN):
    """The two end windows, their radius in proportion to the nib: a small pen's tip is a third the size, and a window
    sized for the main nib's covers a whole head curl, so the curl's spiral scored as a missed tip and an unwound fit won
    (113.s2, trial three: 0.87 lost to 0.76)."""
    r = END_R * pen / PEN
    return [(*nodes[0]["p"], r), (*nodes[-1]["p"], r)]


def length(nodes):
    P = np.array([n["p"] for n in nodes])
    return float(np.linalg.norm(np.diff(P, axis=0), axis=1).sum())


def walk_samples(piece, pen, sub=8):
    """Centre samples [x, y, w, phi, off] of a tip-drawn hairline, walked through every branch of its skeleton once (an
    Euler path between its free ends), so a loop is gone round where the longest path cuts straight past it (T18.s0's
    hairlines, 2026-10-27: 0.57 and 0.42). Spurs shorter than a few line widths come off first. None when no such walk
    exists (more than two free ends left, or no branch at all)."""
    from collections import defaultdict
    ring = ref_ring(piece)
    x1, y1 = ring.min(0) - 4
    W, H = [int(v) + 1 for v in (ring.max(0) + 4 - [x1, y1]) * sub]
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.round((ring - [x1, y1]) * sub * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
    dt = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    pts = {tuple(p) for p in np.argwhere(_thin(m))}
    N8 = ((-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1))
    nb = lambda p: [(p[0] + a, p[1] + b) for a, b in N8 if (p[0] + a, p[1] + b) in pts]  # noqa: E731

    def crossings(p):  # 0-to-1 steps round the 8 neighbours: the branches a pixel joins, blind to staircase corners
        r8 = [(p[0] + a, p[1] + b) in pts for a, b in N8]
        return sum((not r8[i]) and r8[(i + 1) % 8] for i in range(8))
    nodes = {p for p in pts if crossings(p) != 2}
    cl = {}  # each end or junction pixel's cluster: a junction is a few pixels thick
    for p in nodes:
        if p in cl:
            continue
        cl[p], q = len(set(cl.values())), [p]
        while q:
            for n in nb(q.pop()):
                if n in nodes and n not in cl:
                    cl[n] = cl[p]; q.append(n)
    segs, seen = [], set()
    for u in nodes:
        for v in nb(u):
            if v in nodes or v in seen:
                continue
            path, prev, cur = [u, v], u, v
            seen.add(v)
            while True:
                nx = [n for n in nb(cur) if n != prev and n not in path[-3:]]
                end = [n for n in nx if n in nodes and (len(path) > 3 or cl[n] != cl[u])]
                if end:
                    path.append(end[0]); break
                nx = sorted((n for n in nx if n not in seen and n not in nodes), key=lambda n: abs(n[0] - cur[0]) + abs(n[1] - cur[1]))
                if not nx:
                    path = None; break
                prev, cur = cur, nx[0]; seen.add(cur); path.append(cur)
            if path:
                segs.append([cl[u], cl[path[-1]], path])
    if not segs:
        return None
    width = 2 * float(np.median([dt[p] for p in pts])) / sub  # the line's own width, screen px
    parent = {}

    def root(c):
        while parent.get(c, c) != c:
            c = parent[c]
        return c
    short = lambda p: len(p) / sub < 3 * width  # noqa: E731
    while True:
        segs = [[root(a), root(b), p] for a, b, p in segs]
        deg = defaultdict(int)
        for a, b, _ in segs:
            deg[a] += 1; deg[b] += 1
        # a crossing thins to a few junctions a pixel or two apart, joined by short links: one junction
        link = [i for i, (a, b, p) in enumerate(segs) if a != b and deg[a] > 1 and deg[b] > 1 and short(p)]
        # a short branch to a free end is where thinning frays a blunt end
        spur = [i for i, (a, b, p) in enumerate(segs) if (a == b or deg[a] == 1 or deg[b] == 1) and short(p) and len(segs) > 1]
        if link:
            a, b, _ = segs.pop(link[0]); parent[b] = a
        elif spur:
            segs.pop(spur[0])
        else:
            break
    odd = [c for c, k in deg.items() if k % 2]
    if len(odd) not in (0, 2):
        return None
    adj = defaultdict(list)
    for i, (a, b, _) in enumerate(segs):
        adj[a].append(i); adj[b].append(i)
    used, stack, walk = set(), [(odd[0] if odd else segs[0][0], None)], []
    while stack:  # Hierholzer
        v, _ = stack[-1]
        while adj[v] and adj[v][-1] in used:
            adj[v].pop()
        if adj[v]:
            i = adj[v].pop(); used.add(i)
            a, b, _ = segs[i]
            stack.append((b if a == v else a, (i, v)))
        else:
            walk.append(stack.pop()[1])
    path = []
    for i, frm in [e for e in walk[::-1] if e]:
        p = segs[i][2] if segs[i][0] == frm else segs[i][2][::-1]
        path += p[1:] if path else p
    path = np.array(path, float)
    xy = np.c_[path[:, 1] / sub + x1, path[:, 0] / sub + y1]
    w = np.array([2 * dt[int(r), int(c)] / sub for r, c in path])
    step = max(1, len(xy) // 240)
    xy, w = xy[::step], w[::step]
    out = []
    for k in range(len(xy)):
        k0, k1 = max(0, k - 2), min(len(xy) - 1, k + 2)
        phi = math.degrees(math.atan2(-(xy[k1, 1] - xy[k0, 1]), xy[k1, 0] - xy[k0, 0]))
        out.append([float(xy[k, 0]), float(xy[k, 1]), float(w[k]), phi, math.degrees(math.asin(min(1.0, w[k] / pen)))])
    return out


def tooth_start(piece, O, nodes, pen=PEN, sub=4):
    """The band's start with a node added at each tooth's tip, so the pen goes up into the tooth and back down: the
    centre line cuts under a tooth's peak, and the fit rounded over it (13 strokes, 2026-10-27: 290.s1 ... 366.s0,
    0.74-0.85). A tooth is where the outline stands out from the start path TOOTH nuqta beyond the stroke's half width
    there, away from the path's ends; the farthest such point in each stretch of PPN along the path is the tip.
    None without a tooth."""
    ring = ref_ring(piece)
    x1, y1 = ring.min(0) - 4
    W, H = [int(v) + 1 for v in (ring.max(0) + 4 - [x1, y1]) * sub]
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.round((ring - [x1, y1]) * sub * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
    dt = cv2.distanceTransform(m, cv2.DIST_L2, 5) / sub  # screen px to the outline
    P = np.array([n["p"] for n in nodes]) * PPN + O
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    arc = np.r_[0, np.cumsum(seg)]
    t = np.linspace(0, arc[-1], max(2, int(arc[-1] * 2)))  # half a screen px apart
    dense = np.c_[np.interp(t, arc, P[:, 0]), np.interp(t, arc, P[:, 1])]
    half = np.array([dt[min(max(int(round((y - y1) * sub)), 0), H - 1), min(max(int(round((x - x1) * sub)), 0), W - 1)]
                     for x, y in dense])
    d = np.linalg.norm(ring[:, None] - dense[None], axis=2)
    j = d.argmin(1); out = d[np.arange(len(ring)), j] - half[j]
    # a tip is a point of the outline, sharper than TIP_ANGLE and turned outward (the chord across it runs through the
    # ink): where the centre line runs off the middle, the outline across a valley stands out too, but it is not a point
    ra = np.r_[0, np.cumsum(np.linalg.norm(np.diff(ring, axis=0, append=ring[:1]), axis=1))][:-1]
    L = ra[-1] + np.linalg.norm(ring[0] - ring[-1])
    def sharp(k):
        a_ = ring[np.argmin(np.abs((ra - ra[k] + 0.25 * PPN) % L - 0))]
        b_ = ring[np.argmin(np.abs((ra - ra[k] - 0.25 * PPN) % L - 0))]
        u, v = a_ - ring[k], b_ - ring[k]
        cosang = u @ v / max(np.linalg.norm(u) * np.linalg.norm(v), 1e-9)
        mx, my = (a_ + b_) / 2
        inside = m[min(max(int(round((my - y1) * sub)), 0), H - 1), min(max(int(round((mx - x1) * sub)), 0), W - 1)]
        return inside and cosang > math.cos(math.radians(TIP_ANGLE))
    ok = (t[j] > 0.3 * PPN) & (t[j] < arc[-1] - 0.3 * PPN) & (out >= TOOTH * PPN)
    ok = ok & np.array([bool(o) and sharp(k) for k, o in enumerate(ok)])
    tips = []
    for k in np.argsort(-out):
        if ok[k] and all(abs(t[j[k]] - t[j[q]]) > PPN for q in tips):
            tips.append(k)
    if not tips:
        return None
    nodes = [dict(n) for n in nodes]
    for k in sorted(tips, key=lambda q: -t[j[q]]):  # from the far end, so earlier indices hold
        i = int(np.searchsorted(arc, t[j[k]]))  # the tip goes in before node i
        i = min(max(i, 1), len(nodes) - 1)
        tip = ring[k] + (dense[j[k]] - ring[k]) / max(np.linalg.norm(dense[j[k]] - ring[k]), 1e-6) * pen * 0.1
        nodes.insert(i, {"p": [round(float(v), 3) for v in (tip - O) / PPN], "angle": nodes[i - 1]["angle"]})
    return nodes


def band_start(piece, O, ignore, pen=PEN, hair=False):
    best = None
    walk = hair and walk_samples(piece, pen)  # a hairline goes round its loops; without a walk, the band's usual starts
    for samples in ((walk,) if walk else (bands([piece], pen)[0], skeleton_samples(piece, pen))):
        if not samples:
            continue
        for h in (0, 45, 90, 135):
            p = smooth_path(samples, pen, O, PPN, HAIR_SPACING if walk else SPACING, hint=h)
            s = gpu_score([p], [piece], O, PPN, pen, ignore)
            if best is None or s["iou"] > best[1]["iou"]:
                best = (p, s)
    if best is None or length(best[0]) < 0.05:
        # a round mark thins to one skeleton point, and smooth_path makes two nodes on it: a path of no length, which
        # the fit drove out of the raster (T21.s0, 2026-10-27). A chord along the ring's long axis instead, a nib short
        ring = ref_ring(piece); c = ring.mean(0)
        v = np.linalg.eigh(np.cov((ring - c).T))[1][:, -1]; t = (ring - c) @ v
        half = max(np.ptp(t) - pen, 0.2 * np.ptp(t)) / 2
        a = best[0][0]["angle"] if best else 45.0
        best = ([{"p": [round(float(x), 3) for x in (c + k * half * v - O) / PPN], "angle": a} for k in (-1, 1)], None)
    return best[0]


def angles(nodes, piece, O, ignore, pen=PEN):
    """The two best single nib angles for this path, at least 30 degrees apart."""
    sc = sorted(((gpu_score([[{**n, "angle": a, "width": 1} for n in nodes]], [piece], O, PPN, pen, ignore)["iou"], a)
                 for a in range(0, 180, 10)), reverse=True)
    out = [sc[0][1]]
    for _, a in sc[1:]:
        if min(abs(a - out[0]), 180 - abs(a - out[0])) >= 30:
            out.append(a); break
    return out


def lifts(nodes):
    """Where the width falls at each end: how far from the end it is below 0.95 of the stroke's widest, and how low."""
    w = np.array([n.get("width", 1) for n in nodes]); P = np.array([n["p"] for n in nodes])
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    top = w.max(); out = {}
    for end, idx in (("start", list(range(len(w)))), ("end", list(range(len(w) - 1, -1, -1)))):
        i = 0
        while i < len(idx) and w[idx[i]] < 0.95 * top:
            i += 1
        out[end] = {"nuqta": round(abs(arc[idx[i - 1]] - arc[idx[0]]), 2), "min": round(float(w[idx[0]] / top), 3)} if i else None
    return out


def ink(nodes_list, rings, O, x1, y1, r, H, W, pen=PEN):
    A = (gpufit.ink_masks(nodes_list, O, PPN, pen, (float(x1), float(y1), float(r), H, W)).cpu().numpy().astype(np.uint8)
         if nodes_list else np.zeros((H, W), np.uint8))
    to_px = lambda q: np.round((np.asarray(q) - [x1, y1]) * r * 16).astype(np.int32)  # noqa: E731
    B = np.zeros((H, W), np.uint8)
    for ring in rings:
        cv2.fillPoly(B, [to_px(ring)], 1, cv2.LINE_8, 4)
    return A, B


def picture(stroke, piece, ignore, O, old, new, pen=PEN, labels=("free fit", "pen", "sheet", "pen + sheet edge")):
    """free fit | pen | sheet | pen over the sheet's outline, the shape's other strokes pale behind, 60 px to the nuqta."""
    PX = 60; r = PX / PPN
    ring = ref_ring(piece); others = [ref_ring(p) for p in ignore]
    pts = np.concatenate([ring] + [gpufit._reach([n], O, PPN, PEN) for n in (old, new) if n])  # widths: of the main nib
    x1, y1 = pts.min(0) - PPN * 0.4; x2, y2 = pts.max(0) + PPN * 0.4
    W, H = int((x2 - x1) * r) + 1, int((y2 - y1) * r) + 1
    _, G = ink([], others, O, x1, y1, r, H, W)
    _, B = ink([], [ring], O, x1, y1, r, H, W)
    paper, inkc, pale = np.array((228, 240, 246)), np.array((40, 52, 66)), np.array((205, 210, 214))

    def panel(M):
        im = np.where(G[..., None] == 1, pale, paper).astype(np.uint8)
        im[M == 1] = inkc
        return im
    tiles = [panel(ink([n], [], O, x1, y1, r, H, W)[0] if n else np.zeros((H, W), np.uint8)) for n in (old, new)]
    tiles.append(panel(B))
    ov = panel(ink([new], [], O, x1, y1, r, H, W)[0])
    ov[cv2.morphologyEx(B, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0] = (40, 40, 220)
    tiles.append(ov)
    gap = np.full((H, 8, 3), 255, np.uint8)
    row = np.hstack(sum([[t, gap] for t in tiles], [])[:-1])
    if W < 200:
        row = cv2.resize(row, None, fx=200 / W, fy=200 / W, interpolation=cv2.INTER_NEAREST); W = 200
    head = np.full((52, row.shape[1], 3), 255, np.uint8)
    cv2.putText(head, stroke, (4, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 160), 1, cv2.LINE_AA)
    for i, lab in enumerate(labels):
        cv2.putText(head, lab, (i * (W + 8) + 4, 44), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA)
    ok, png = cv2.imencode(".png", np.vstack([head, row]))
    return base64.b64encode(png.tobytes()).decode()


def fit(stroke, log):
    t0 = time.time()
    piece, ignore, O = job_of(stroke)
    hair = "~h" in stroke  # a tip-drawn hairline of a PEN_SPLIT stroke: the small pen, filled
    fill = stroke in FILL or hair
    # a mark narrower than the nib cannot be the main pen's: it is a small-pen mark (T21.s0, 0.56 nuqta to a 0.82 nib)
    narrow = float(np.ptp(ref_ring(piece), 0).max()) < PEN
    P = PEN * SMALL_PEN if stroke in SMALL or hair or narrow else PEN   # this stroke's nib, screen px
    r_old = None if hair or stroke in SPLIT else old_fit(stroke)  # a free fit of the whole outline fits no part
    starts = [("walk" if hair else "band", band_start(piece, O, ignore, P, hair))]
    tooth = None if hair else tooth_start(piece, O, starts[0][1], P)
    if tooth:
        starts.append(("tooth", tooth))
    if r_old:
        starts.append(("free", [{"p": n["p"], "angle": n["angle"]} for n in r_old["nodes"]]))
    tried = []
    if fill:
        for sname, nodes in starts:
            p, s = gpufit.refine(nodes, [piece], O, PPN, P, rough=ROUGH, edge=EDGE, ignore=ignore, widths_free=True,
                                 corner=CORNER, windows=end_windows(nodes, P), judge="gpu")
            tried.append({"start": sname, "angle0": None, "anchor": None, "score": s, "nodes": p, "pen": None})
            log(stroke, "fill", sname, s["iou"], s["gap95"], "%.0fs" % (time.time() - t0))
    def pen_of(nodes, a, anc):
        lift = LIFT_LONG if length(nodes) >= LONG else LIFT
        return {"angle": a, "lift_start": lift, "lift_end": lift, "anchor": list(anc), "size": SIZE,
                **({"turns": list(range(1, len(nodes)))} if ROTATE else {})}

    def run_pens(sname, nodes, pens):
        """Every pen side by side in one loop on the card (gpufit.refine_pens; the user, 2026-10-26: "make that change
        for the diwani branch as well"), with this start's schedule; each try goes into tried."""
        sched = 0 if length(nodes) >= SHORT else 1
        res = gpufit.refine_pens(nodes, [piece], O, PPN, P, pens, rough=ROUGH, edge=EDGE, ignore=ignore,
                                 schedules=(sched,), corner=CORNER, windows=end_windows(nodes, P), judge="gpu")
        for pen, (p, s) in zip(pens, res):
            a, anc = pen["angle"], pen["anchor"]
            tried.append({"start": sname, "angle0": a, "anchor": anc, "score": s, "nodes": p, "pen": pen})
            log(stroke, sname, a if np.isscalar(a) else "own" if len(set(a)) > 1 else a[0], anc, s["iou"], s["gap95"], "%.0fs" % (time.time() - t0))

    prune = PRUNE and ROTATE
    for sname, nodes in ([] if fill else starts):
        starts_a = angles(nodes, piece, O, ignore, P)
        if ROTATE:  # the start path's own angles too, each node turning on its own
            starts_a = [[q["angle"] for q in nodes]] + [[a] * len(nodes) for a in starts_a]
        run_pens(sname, nodes, [pen_of(nodes, a, anc) for a in starts_a for anc in (ANCHORS[:1] if prune else ANCHORS)])
    if prune and not fill and tried:  # the other three anchor pairs, for the leading start and angle only (a fill has none)
        lead = max(tried, key=lambda c: judge(c["score"]))
        nodes = dict(starts)[lead["start"]]
        run_pens(lead["start"], nodes, [pen_of(nodes, lead["angle0"], anc) for anc in ANCHORS[1:]])
    best = max(tried, key=lambda c: judge(c["score"]))
    if best["score"]["iou"] == 0:  # every try left the sheet's ink: no fit, and nothing sane to draw a picture from
        raise RuntimeError(f"{stroke}: no try touched the sheet's ink")
    if best["pen"] is not None:  # the other schedule, from the same start (a restart: the lift does not carry over)
        nodes = dict(starts)[best["start"]]
        other = 1 - (0 if length(nodes) >= SHORT else 1)
        (p, s), = gpufit.refine_pens(nodes, [piece], O, PPN, P, [best["pen"]], rough=ROUGH, edge=EDGE, ignore=ignore,
                                     schedules=(other,), corner=CORNER, windows=end_windows(nodes, P), judge="gpu")
        log(stroke, "other schedule", s["iou"], s["gap95"])
        if judge(s) > judge(best["score"]):
            best = {**best, "nodes": p, "score": s, "schedule": other}
    n = best["nodes"]
    # the best by overlap alone, when it beats the judge's choice by ALT_GAP: drawn too, for the user to choose between
    # (113.s2 in trial four: the spiral at 0.87 lost to a hook at 0.76 on its end's worst miss)
    alt = max(tried, key=lambda c: c["score"]["iou"])
    alt = alt if alt["score"]["iou"] > best["score"]["iou"] + ALT_GAP else None
    cpu = score([n], [piece], O, PPN, P, ignore)
    if P != PEN:  # widths as fractions of the main nib, so the stroke draws with the one pen
        n = [{**q, "width": round(q.get("width", 1) * SMALL_PEN, 4)} for q in n]
    an = alt and [{**q, "width": round(q.get("width", 1) * P / PEN, 4)} for q in alt["nodes"]]
    out = {"recipe": ("small pen" if P != PEN else "pen") if best["pen"] else "fill", "nodes": n, "score": best["score"],
           "cpu_score": cpu, "pen_scale": round(P / PEN, 4), "start": best["start"], "anchor": best["anchor"], "prune": prune,
           "angle": round(n[len(n) // 2]["angle"] % 180, 1),
           "angles": [round(min(q["angle"] for q in n), 1), round(max(q["angle"] for q in n), 1)],
           "size": round(max(q.get("width", 1) for q in n), 3), "length": round(length(n), 2), "lifts": lifts(n),
           "free": {"score": r_old["score"]} if r_old else None,
           "alt": {"score": alt["score"], "anchor": alt["anchor"], "start": alt["start"], "nodes": an} if alt else None,
           "tried": [{k: (v if k != "pen" or not v else {**v, "angle": "own" if len(set(np.atleast_1d(v["angle"]))) > 1 else float(np.atleast_1d(v["angle"])[0])}) for k, v in c.items() if k != "nodes"} for c in tried], "seconds": round(time.time() - t0)}
    pics = {stroke: picture(stroke, piece, ignore, O, r_old["nodes"] if r_old else None, n)}  # n in main-nib widths
    if alt:
        pics[stroke + ".alt"] = picture(stroke, piece, ignore, O, n, an,
                                        labels=("judge's pick", "best overlap", "sheet", "best overlap + sheet edge"))
    return out, pics


if __name__ == "__main__":
    od, names = sys.argv[1], sys.argv[2:]
    res, pics = {}, {}
    log = lambda *a: print(*a, flush=True)  # noqa: E731
    log("gpu", gpufit.available(), "pen px", round(PEN, 3), "ppn", PPN)
    def hairs(s):  # counted on the whole outline: job_of hands back the body, already split
        k, sid = s.split(".", 1)
        return len(split_piece([transform(k), dict(strokes(k))[sid]])[1])
    for st in [p for s in names for p in ([s] + [f"{s}~h{i}" for i in range(1, hairs(s) + 1)] if s in SPLIT else [s])]:
        res[st], p = fit(st, log)
        pics.update(p)
        json.dump(res, open(os.path.join(od, "pen.json"), "w"))
        json.dump(pics, open(os.path.join(od, "pics.json"), "w"))
