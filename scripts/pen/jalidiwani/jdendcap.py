"""A tail's last bit made the studio's own outline (the user, 2026-11-02, of 731's tail: allowed, after the Thuluth
session's endcap.py). A local refit of the tip, widths free or held, left waists, spills or a needle (n731f2, f3, h1),
so the pen fit is left as it is and, inside a disc of R nuqta round the tail's last node, the stroke's ink becomes the
studio's: ours past the studio edge erased, the studio's ink filled. The studio outline is rounded first (CUT rounds of
corner cutting), as a stroke is smooth (no facets even where the studio outline has them). R is picked where ours and
the studio already agree (731: under 0.003 nuqta from 0.2 nuqta back), so the disc's edge leaves no step.

The record gains "endcap": {"c": tip, "r": R, "erase": rings, "fill": rings}, all in node (nuqta) coordinates; a second
patch on the same stroke makes it a list.
  python jdendcap.py IN/pen.json OUT/pen.json STROKE [R [X,Y]]       (JD_* env as jdpenjob; X,Y in nuqta)"""
import json, math, os, sys
import numpy as np
from shapely.geometry import Point, Polygon
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import jdpenjob as J  # noqa: E402

R, CUT = 0.3, 2


def chaikin(r, n):
    for _ in range(n):
        a, b = r, np.roll(r, -1, axis=0)
        r = np.stack([0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b], axis=1).reshape(-1, 2)
    return r


def rings_of(g):
    gs = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
    return [[[round(x, 4), round(y, 4)] for x, y in p.exterior.coords[:-1]] for p in gs
            if p.geom_type == "Polygon" and p.area > 1e-6]


RAMP, BLEND_PX = 0.15, 1500  # nuqta over which ours eases into the studio's edge; raster px a nuqta for the blend


REACH, SPARE = 1.0, 2  # nuqta a node's nib can ink from it; nodes kept past the last one in reach, for the curve


def runs_near(nodes, c, R2):
    """The runs of nodes that can ink the disc of R2 round c, each with SPARE nodes more either side. The ink is
    placed every few raster px, so a whole stroke drawn at BLEND_PX built several GB of tensors per patch for the
    pixels' windows, nearly all of it off the disc's frame (the Geekmini's memory, 2026-11-04)."""
    d = [math.hypot(q["p"][0] - c[0], q["p"][1] - c[1]) for q in nodes]
    keep = [False] * len(nodes)
    for i, v in enumerate(d):
        if v < R2 + REACH:
            for j in range(max(0, i - SPARE), min(len(nodes), i + SPARE + 1)):
                keep[j] = True
    out, cur = [], []
    for q, k in zip(nodes, keep):
        if k:
            cur.append(q)
        elif cur:
            out.append(cur); cur = []
    if cur:
        out.append(cur)
    return [r for r in out if len(r) > 1]


def release():
    """torch keeps the GPU memory of a patch's draw cached for the next; four patch jobs at once each held their
    biggest draw (gpufit._release does the same between a fit's stages)."""
    import gpufit
    if gpufit.available():
        import torch
        torch.cuda.empty_cache()


def blended(stroke, rec, studio, c, r, others=()):
    """The ink inside the disc of r + RAMP round c: ours eased into the studio's by their signed distances, all
    studio inside r, all ours at r + RAMP. A hard switch at r left a jog where the two edges differ (0.005 nuqta at
    484's, 485's and 732's tips, the user, 2026-11-03: the "=" tips)."""
    import cv2
    from shapely.geometry import box as Box
    R2 = r + RAMP; x1, y1 = c[0] - R2 - 0.05, c[1] - R2 - 0.05; n = int((2 * R2 + 0.1) * BLEND_PX) + 1
    piece, _, O = J.job_of(stroke)
    near = [run for nodes in [rec["nodes"]] + list(others) for run in runs_near(nodes, c, R2)]
    # a run whose nib never reaches the frame is left out: gpufit._ink sizes its windows by the blocks in the frame,
    # and with none there it asked torch for a negative range (251.s0's third patch, a neighbour's run beside the disc)
    fx1, fy1 = x1 * J.PPN + O[0], y1 * J.PPN + O[1]; fx2, fy2 = fx1 + n / BLEND_PX * J.PPN, fy1 + n / BLEND_PX * J.PPN
    near = [q for q in near if (lambda e: (e[:, 0].max() > fx1) & (e[:, 0].min() < fx2) & (e[:, 1].max() > fy1)
                                & (e[:, 1].min() < fy2))(J.gpufit._reach([q], O, J.PPN, J.PEN))]
    A, _ = J.ink(near, [], O, x1 * J.PPN + O[0], y1 * J.PPN + O[1], BLEND_PX / J.PPN, n, n)
    release()
    if rec.get("endcap"):  # the stroke's earlier patches are ours too: blending against the bare fit left a step where
        # two discs overlapped and erased the first patch's ink (104's peak under its leg patch, 023.s2's tip)
        A = apply(A.astype(bool), rec["endcap"], O, x1 * J.PPN + O[0], y1 * J.PPN + O[1], BLEND_PX / J.PPN)
    Sm = np.zeros((n, n), np.uint8)
    loc = studio.intersection(Box(x1, y1, x1 + n / BLEND_PX, y1 + n / BLEND_PX))
    for g in ([loc] if loc.geom_type == "Polygon" else list(getattr(loc, "geoms", []))):
        if g.geom_type == "Polygon" and not g.is_empty:
            cv2.fillPoly(Sm, [np.round((np.array(g.exterior.coords) - [x1, y1]) * BLEND_PX * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
    sdf = lambda M: cv2.distanceTransform((1 - M).astype(np.uint8), cv2.DIST_L2, 5) - cv2.distanceTransform(M.astype(np.uint8), cv2.DIST_L2, 5)  # noqa: E731
    yy, xx = np.mgrid[0:n, 0:n]; d = np.hypot(xx / BLEND_PX + x1 - c[0], yy / BLEND_PX + y1 - c[1])
    t = np.clip((R2 - d) / RAMP, 0, 1); t = t * t * (3 - 2 * t)
    M = ((1 - t) * sdf(A.astype(np.uint8)) + t * sdf(Sm) < 0).astype(np.uint8)
    cs, _ = cv2.findContours(M, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    from shapely.ops import unary_union
    # an island of ours alone (our pen's tip past the studio's, cut loose by the blend: 164.s1, 474, 476) is dropped
    gs = [g for g in (Polygon(q[:, 0] / BLEND_PX + [x1, y1]).buffer(0) for q in cs if len(q) > 2) if g.intersects(studio)]
    return unary_union(gs).simplify(0.0005), R2


def endcap(stroke, rec, r=R, at=None, others=()):
    """others: the node lists of the shape's other strokes, so their ink counts as ours (a patch at 076's peak, on
    green, erased blue beside it)."""
    piece, _, O = J.job_of(stroke.split("~")[0])  # the letter's outline: the disc holds only the tail
    from shapely.validation import make_valid
    studio = make_valid(Polygon(chaikin((J.ref_ring(piece) - O) / J.PPN, CUT)))  # a loop's crossing: both lobes kept
    c = list(at) if at is not None else rec["nodes"][-1]["p"]  # anywhere (the user, 2026-11-03), the tail's end by default
    ink, R2 = blended(stroke, rec, studio, c, r, others)
    disc = Point(c).buffer(R2, 128)
    return {"c": c, "r": R2, "erase": rings_of(disc.difference(ink)), "fill": rings_of(disc.intersection(ink))}


def apply(A, cap, O, x1, y1, scale):
    """A (bool raster of our ink, px = (screen - [x1, y1]) * scale) with the cap's erase and fill drawn in; a list of
    caps in turn."""
    import cv2
    if isinstance(cap, list):
        for c in cap:
            A = apply(A, c, O, x1, y1, scale)
        return A
    to = lambda ring: np.round(((np.array(ring) * J.PPN + O) - [x1, y1]) * scale * 16).astype(np.int32)  # noqa: E731
    E, F = (np.zeros(A.shape, np.uint8) for _ in range(2))
    for M, rs in ((E, cap["erase"]), (F, cap["fill"])):
        if rs:
            cv2.fillPoly(M, [to(q) for q in rs], 1, cv2.LINE_8, 4)
    return (A & (E == 0)) | (F == 1)


if __name__ == "__main__":
    src, dst, st = sys.argv[1:4]
    p = json.load(open(src))
    at = [float(v) for v in sys.argv[5].split(",")] if len(sys.argv) > 5 else None
    c_ = at if at is not None else p[st]["nodes"][-1]["p"]  # strokes nowhere near the patch are left out (_ink)
    others = [v["nodes"] for k, v in p.items() if k != st and k.split("~")[0] == st.split("~")[0]
              and min(np.hypot(q["p"][0] - c_[0], q["p"][1] - c_[1]) for q in v["nodes"]) < 1.5]
    cap = endcap(st, p[st], float(sys.argv[4]) if len(sys.argv) > 4 else R, at, others)
    had = p[st].get("endcap")  # a stroke patched in more than one place keeps a list
    p[st]["endcap"] = cap if not had else (had if isinstance(had, list) else [had]) + [cap]
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    json.dump(p, open(dst, "w"))
    print(st, "erase", len(cap["erase"]), "fill", len(cap["fill"]), "patches", len(p[st]["endcap"]) if isinstance(p[st]["endcap"], list) else 1)
