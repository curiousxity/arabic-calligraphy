"""pieces.refine on a GPU: the same cost, minimised by gradient descent over a soft raster of the swept nib.

    from gpufit import available, refine     # available(): torch with a GPU is here (CUDA, or a Mac's MPS)

pieces.refine scores each try by rasterising the stroke and runs Powell's method, one try after another, which a
CPU core does in minutes. Here the ink is made differentiable instead: the nib is placed every half pixel along
the path a few pixels apart, the quad between each placement and the next but one is inked (pieces.path_hulls
inks the quad between neighbours), and a pixel is inked by how far it lies inside the quad it is deepest in, through
a sigmoid, so the whole cost has a gradient and Adam follows it, coarse grid first and then fine. The cost
is pieces.refine's: 1 - overlap, plus `edge` times the outline gap (the area where ink and reference disagree over
the reference's perimeter, in nuqta), plus `rough` times the changes of bend and of the nib's turning, plus the fold
penalty. The result is scored by pieces.score, the CPU's own measure, so the two refiners are judged alike.

`corner` and `windows` (the user's red rings on stroke starts and joints, 2026-10-25): a cut-off corner or a notch at
a joint misses by 0.03 to 0.05 nuqta over almost no area, so neither the overlap nor the outline gap sees it
(tunejob.py's corner_w is the CPU's answer). Here each window, a circle (x, y, radius) in the nodes' nuqta, adds
`corner` times a power mean (P_CORNER) of how far each wrong pixel in it lies from the right ink: the studio's for
ink we add, ours for ink we miss (our side measured on the hard ink every RELAYOUT steps and held between, so the
gradient comes through the soft ink alone). The power mean leans on the deepest pixels, as the worst miss does. Of the
schedules' results, the one kept then also counts `corner` times the worst miss in the windows on a hard raster.
`widths_free`: the nib's width moves too (kept within 0.3 to 1.5), since a start whose width is off steps the edge.

`pen` (the studio ledger, 2026-10-25: docs/calligraphy/studioledger.md, "The pen"): the fit is held to a real qalam. The
user: "Most of thuluth is with a single sized qalam. the techniques are important like a flick or angles". So one nib
angle for the whole stroke, changing only at the nodes listed in "turns" (each starts a new angle, turned over the
segment before it); one nib size for the whole stroke ("size": free, else 1); and the width falls only where the pen
lifts, in the first "lift_start" and last "lift_end" nuqta of the path, gradually (never rising again toward that end)
and onto one corner: "anchor" [start, end], +1 or -1, names the nib end that stays on the paper, so that end's edge
runs on unbroken while the other closes onto it (the flick, as the lesson shows it). The optimiser moves the path of
the full nib's centre; a lifted node's centre is that point moved toward the planted corner by half the width lost,
so the nodes it hands back are ordinary centred ones (renderers need nothing new). Every node gains its "width".

`gpu_score` is pieces.score on the GPU, for the same reason the refine is (the user, 2026-10-25: "move the
processor-side scoring onto the 4070"): pieces.score builds the swept nib quad by quad in Python and fills each with
cv2, which held the Geekmini's CPU at 75% with its GPU half idle. Here the ink is _ink's, sharp (a pixel is ink when
it lies inside a quad), on pieces.score's own grid (SUB raster px to the screen px, the same margin); the studio's
outline is still filled by cv2, once a call; the outline gap is measured between the two edges' pixels directly
instead of through a distance transform. `judge="gpu"` makes refine() choose among its schedules by it.

`refine_pens` runs several pen-held tries of one stroke (its angles and anchors) side by side in one loop (the user,
2026-10-26: "have one loop on the card fit all eight angle-and-corner tries at once instead of one after another").
Moving the scoring to the GPU saved 3%: the time is the loop, thousands of small steps each sent from Python, so the
card sat half idle while the CPU stayed busy. Here one step moves every try. The ink (_ink_b) finds each pixel's deepest
quad and edge without the gradient and recomputes only that edge's depth with it, so the backward pass touches one
edge a pixel instead of every (quad, edge, pixel) cell, and eight tries need less memory than one did.

Nodes as smooth_path and refine make them: {"p", "angle"} and perhaps "width". A node with "dir", "corner",
"keep", "tin" or "tout" is outside this model: refine() hands those paths back to pieces.refine."""
import math, os, sys
import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pieces import ref_ring, path_hulls, score, refine as cpu_refine, SUB, RUNAWAY  # noqa: E402

try:
    import torch
except ImportError:  # no torch: available() is False and refine() is the CPU's
    torch = None

# Schedules of stages (raster px to the nuqta, softness px, steps, start rate); refine runs each and keeps the best by
# the CPU's measure. Fine and sharp suits long strokes (a blurred coarse grid rounds a hairline end off and the fit
# chases it: studio alif stem 0.906 coarse-first, 0.927 not); coarse first suits small ones, which need to travel
# further from their start (the alif's flag: 0.84 coarse-first, 0.72 not). Measured on the CPU, 2026-10-19.
# The user, 2026-10-19: accuracy before time. So three stages, the last on a 200 px grid, and twice the steps.
SCHEDULES = (((90, 0.4, 300, 0.004), (150, 0.3, 300, 0.002), (200, 0.25, 200, 0.001)),
             ((30, 1.0, 400, 0.02), (90, 0.6, 300, 0.006), (200, 0.25, 200, 0.001)))
STEP_PX = 3     # most either nib end moves between placements, raster px; each quad spans two steps, so every
                # inked pixel lies a step deep inside one and the ink is solid (0.9 and more at a softness of 0.6)
CHUNK = 24      # quads per block, each block inks only the pixels round it
BATCH_CELLS = 3e7  # most (quad edge, pixel) pairs in one batch, ~120 MB a tensor: a long stroke on the fine grid
                   # would otherwise build several GB at once, and nine jobs doing so crashed Geekmini's 4070
RELAYOUT = 25   # steps between recounts of the placements, and between checks that the cost is still falling
SETTLED = 2e-5  # a fall in cost over RELAYOUT steps smaller than this, four times running, ends the stage
UNSUPPORTED = ("dir", "corner", "keep", "tin", "tout")
P_CORNER = 6    # the corner term's power mean: high enough to follow the deepest pixels, low enough to stay smooth
WIN_PXN = 40    # raster px to the nuqta of the hard raster that judges the windows between schedules
WSCALE = float(os.environ.get("GPUFIT_WSCALE", 3.0))  # nib width per unit of the optimiser's step: at 0.1 it never narrowed a
                                                     # start far enough (032.s6 wants 1.0 to 0.6); at 3 it matched the CPU search


# on: with both schedules it matches pieces.refine on the studio's alif strokes (0.927 / 0.923 / 0.84 against the
# CPU's 0.948 / 0.908 / 0.81, with tighter outlines)
READY = True


def _pick():
    """Where the fits run: an NVIDIA card (CUDA), else a Mac's own GPU (MPS); None where there is no torch or no GPU,
    and the fits go to pieces.refine and pieces.score. HARF_DEVICE=cpu runs this module's own fit on the processor
    instead, the same steps and the same scoring as on a card: fitqueue.py sends some of a Mac's jobs there when its
    GPU is saturated (the user, 2026-10-27), and all of them when its GPU fails devcheck.py."""
    if not READY or torch is None:
        return None
    if os.environ.get("HARF_DEVICE", "").lower() == "cpu":
        return "cpu"
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    return "mps" if mps is not None and mps.is_available() else None


DEVICE = _pick()


def available():
    return DEVICE is not None


def _device():
    return torch.device(DEVICE or "cpu")


def _controls(P):
    """build.path's cubic handles for plain nodes: Catmull-Rom tangents, a third of the chord. P: (k, 2)."""
    k = P.shape[0]
    d = torch.empty_like(P)
    d[0] = P[1] - P[0]
    d[-1] = P[-1] - P[-2]
    if k > 2:
        d[1:-1] = P[2:] - P[:-2]
    t = d / d.norm(dim=1, keepdim=True).clamp_min(1e-9)
    chord = (P[1:] - P[:-1]).norm(dim=1, keepdim=True)
    return P[:-1] + t[:-1] * chord / 3, P[1:] - t[1:] * chord / 3


def _curve(a, widths, origin, ppn, pen, seg, t):
    """Nib ends at parameters t of segments seg (tensors of one shape), screen units."""
    P, ang = a[:, :2], a[:, 2]
    c1, c2 = _controls(P)
    u = (1 - t)[..., None]
    tt = t[..., None]
    c = u ** 3 * P[seg] + 3 * u * u * tt * c1[seg] + 3 * u * tt * tt * c2[seg] + tt ** 3 * P[seg + 1]
    th = torch.deg2rad(ang[seg] + (ang[seg + 1] - ang[seg]) * t)
    w = (widths[seg] + (widths[seg + 1] - widths[seg]) * t) * pen
    n = torch.stack([torch.cos(th), -torch.sin(th)], -1) * (w / 2)[..., None]
    c = c * ppn + origin
    return c + n, c - n


def _layout(a, widths, origin, ppn, pen, r):
    """Where to place the nib: (segment, t) for each placement, about STEP_PX raster px apart, counted from the
    ends' travel over a coarse pass; each segment's end left to the next, the last one's kept."""
    with torch.no_grad():
        k = a.shape[0] - 1
        seg = torch.arange(k, device=a.device)[:, None].expand(k, 33)
        t = torch.linspace(0, 1, 33, device=a.device)[None].expand(k, 33)
        ea, eb = _curve(a, widths, origin, ppn, pen, seg, t)
        travel = torch.maximum((ea[:, 1:] - ea[:, :-1]).norm(dim=-1), (eb[:, 1:] - eb[:, :-1]).norm(dim=-1)).sum(1) * r
        counts = (travel / STEP_PX).ceil().clamp_min(2).long().tolist()
    segs, ts = [], []
    for i, n in enumerate(counts):
        ts.append(torch.linspace(0, 1, n + 1)[: n + (1 if i == k - 1 else 0)])
        segs.append(torch.full((ts[-1].shape[0],), i, dtype=torch.long))
    return torch.cat(segs).to(a.device), torch.cat(ts).to(a.device)


def _placements(a, widths, origin, ppn, pen, r, layout=None):
    """Nib ends (n, 2) and (n, 2) in screen units along the path, about STEP_PX raster px apart."""
    seg, t = layout if layout is not None else _layout(a, widths, origin, ppn, pen, r)
    return _curve(a, widths, origin, ppn, pen, seg, t)


def _ink(ea, eb, x1, y1, r, H, W, soft):
    """Soft ink on the grid: each pixel by its depth inside the quad (placement i to i + 2) it is deepest in. The quads
    go in blocks of CHUNK, each block over a window of the grid just round it, all blocks in one batch."""
    V = torch.stack([ea[:-2], eb[:-2], eb[2:], ea[2:]], 1)                    # (q, 4, 2)
    # corners in order round their centre: where the nib turns across its travel the quad would cross itself (a
    # bow-tie inking almost nothing); pieces.path_hulls takes the hull for the same reason
    with torch.no_grad():
        c = V.mean(1, keepdim=True)
        order = torch.atan2(V[..., 1] - c[..., 1], V[..., 0] - c[..., 0]).argsort(1)
    V = torch.gather(V, 1, order[..., None].expand(-1, -1, 2))
    q = V.shape[0]
    pad = (-q) % CHUNK
    if pad:  # the last quad again: a repeat changes no pixel's deepest
        V = torch.cat([V, V[-1:].expand(pad, -1, -1)])
    nc = V.shape[0] // CHUNK
    V = V.view(nc, CHUNK, 4, 2)
    E = torch.roll(V, -1, 2) - V
    area = (V[..., 0] * torch.roll(V, -1, 2)[..., 1] - torch.roll(V, -1, 2)[..., 0] * V[..., 1]).sum(2)
    L = E.norm(dim=-1)
    N = torch.stack([-E[..., 1], E[..., 0]], -1) * (torch.sign(area)[..., None] / L.clamp_min(1e-9))[..., None]
    off = (V * N).sum(-1)                                                    # (nc, CHUNK, 4)
    off = torch.where(L > 1e-6, off, torch.full_like(off, -1e9))             # a zero-length edge bounds nothing
    with torch.no_grad():
        m = 4 * soft / r
        lo = V.reshape(nc, -1, 2).min(1).values - m
        hi = V.reshape(nc, -1, 2).max(1).values + m
        j0 = ((lo[:, 0] - x1) * r).floor().clamp(0, W - 1).long()
        i0 = ((lo[:, 1] - y1) * r).floor().clamp(0, H - 1).long()
        ww = int(((hi[:, 0] - x1) * r).ceil().clamp(max=W).sub(j0).max()) + 1
        hh = int(((hi[:, 1] - y1) * r).ceil().clamp(max=H).sub(i0).max()) + 1
        jj = j0[:, None] + torch.arange(ww, device=V.device)[None]           # (nc, ww)
        ii = i0[:, None] + torch.arange(hh, device=V.device)[None]           # (nc, hh)
        inside = (ii < H)[:, :, None] & (jj < W)[:, None, :]
        flat = torch.where(inside, ii[:, :, None] * W + jj[:, None, :], torch.full_like(inside, H * W, dtype=torch.long))
    xs = (float(x1) + jj.float() / float(r))[:, None, None, None, :]         # pixel centres where cv2 puts them
    ys = (float(y1) + ii.float() / float(r))[:, None, None, :, None]
    depth = torch.full((H * W + 1,), -1e9, device=V.device, dtype=V.dtype)
    per = max(1, int(BATCH_CELLS // (CHUNK * 4 * hh * ww)))                  # blocks per batch
    for b in range(0, nc, per):
        sl = slice(b, b + per)
        sd = N[sl, ..., 0, None, None] * xs[sl] + N[sl, ..., 1, None, None] * ys[sl] - off[sl, ..., None, None]  # (n, CHUNK, 4, hh, ww)
        d = sd.min(2).values.max(1).values                                   # each pixel's deepest quad, per block
        depth = depth.scatter_reduce(0, flat[sl].reshape(-1), d.reshape(-1), reduce="amax", include_self=True)
    return torch.sigmoid(depth[: H * W].view(H, W) * r / soft)


def _ink_loop(ea, eb, x1, y1, r, H, W, soft):
    """Soft ink on the grid: each pixel by its depth inside the quad (placement i to i + 2) it is deepest in."""
    V = torch.stack([ea[:-2], eb[:-2], eb[2:], ea[2:]], 1)                    # (q, 4, 2)
    # corners in order round their centre: where the nib turns across its travel the quad would cross itself (a
    # bow-tie inking almost nothing); pieces.path_hulls takes the hull for the same reason
    with torch.no_grad():
        c = V.mean(1, keepdim=True)
        order = torch.atan2(V[..., 1] - c[..., 1], V[..., 0] - c[..., 0]).argsort(1)
    V = torch.gather(V, 1, order[..., None].expand(-1, -1, 2))
    E = torch.roll(V, -1, 1) - V                                             # edges
    area = (V[:, :, 0] * torch.roll(V, -1, 1)[:, :, 1] - torch.roll(V, -1, 1)[:, :, 0] * V[:, :, 1]).sum(1)
    L = E.norm(dim=-1, keepdim=True)
    N = torch.stack([-E[..., 1], E[..., 0]], -1) * torch.sign(area)[:, None, None] / L.clamp_min(1e-9)  # inward
    ok = (L[..., 0] > 1e-6)                                                  # a zero-length edge bounds nothing
    depth = torch.full((H, W), -1e9, device=ea.device)
    for s in range(0, V.shape[0], CHUNK):
        v, nn, k = V[s:s + CHUNK], N[s:s + CHUNK], ok[s:s + CHUNK]
        with torch.no_grad():
            lo, hi = v.reshape(-1, 2).min(0).values, v.reshape(-1, 2).max(0).values
            m = 4 * soft / r
            i0 = max(0, int((float(lo[1]) - m - y1) * r)); i1 = min(H, int((float(hi[1]) + m - y1) * r) + 2)
            j0 = max(0, int((float(lo[0]) - m - x1) * r)); j1 = min(W, int((float(hi[0]) + m - x1) * r) + 2)
        if i1 <= i0 or j1 <= j0:
            continue
        ys = y1 + torch.arange(i0, i1, device=ea.device) / r  # pixel centres where cv2 puts them
        xs = x1 + torch.arange(j0, j1, device=ea.device) / r
        p = torch.stack(torch.meshgrid(xs, ys, indexing="xy"), -1)          # (h, w, 2)
        # signed distance inside each edge, for every quad and pixel: (k, 4, h, w)
        sd = ((p[None, None] - v[:, :, None, None, :]) * nn[:, :, None, None, :]).sum(-1)
        sd = torch.where(k[:, :, None, None], sd, torch.full_like(sd, 1e9))
        d = sd.min(1).values.max(0).values                                  # deepest quad's depth, units
        old = depth[i0:i1, j0:j1].clone()
        depth[i0:i1, j0:j1] = torch.maximum(old, d)
    return torch.sigmoid(depth * r / soft)


def _edge(m):
    """cv2's morphological gradient with a 3 x 3 square: pixels whose neighbourhood holds both ink and paper."""
    m = m[None, None].float()
    return (torch.nn.functional.max_pool2d(m, 3, 1, 1) - (-torch.nn.functional.max_pool2d(-m, 3, 1, 1)))[0, 0] > 0


def _near(a, b, chunk=4096):
    """For each point of a (n, 2), the distance to the nearest point of b (m, 2)."""
    if not len(b):
        return torch.full((len(a),), float("inf"), device=a.device)
    return torch.cat([torch.cdist(a[i:i + chunk], b).min(1).values for i in range(0, len(a), chunk)]) if len(a) else a.new_zeros(0)


def ink_masks(mine, origin, ppn, pen_px, frame):
    """Our paths' sharp ink on a grid: frame (x1, y1, r, H, W), r raster px to the screen px. A bool tensor (H, W)."""
    dev = _device()
    x1, y1, r, H, W = frame
    org = torch.tensor(origin, dtype=torch.float32, device=dev)
    A = torch.zeros((H, W), dtype=torch.bool, device=dev)
    for nodes in mine:
        a = torch.tensor([[q["p"][0], q["p"][1], q.get("angle", 145)] for q in nodes], dtype=torch.float32, device=dev)
        w = torch.tensor([q.get("width", 1) for q in nodes], dtype=torch.float32, device=dev).clamp(0, 1.5)
        ea, eb = _placements(a, w, org, ppn, pen_px, r)
        A |= _ink(ea, eb, x1, y1, r, H, W, 0.01) > 0.5
    return A


def _reach(mine, origin, ppn, pen_px):
    """Where our nib ends go, screen px (n, 2), on a coarse layout: for the frame and the runaway check."""
    dev = _device()
    org = torch.tensor(origin, dtype=torch.float32, device=dev)
    pts = []
    for nodes in mine:
        a = torch.tensor([[q["p"][0], q["p"][1], q.get("angle", 145)] for q in nodes], dtype=torch.float32, device=dev)
        w = torch.tensor([q.get("width", 1) for q in nodes], dtype=torch.float32, device=dev).clamp(0, 1.5)
        ea, eb = _placements(a, w, org, ppn, pen_px, 1.0)
        pts += [ea, eb]
    return torch.cat(pts).cpu().numpy()


def gpu_score(mine, refs, origin, ppn, pen_px, ignore=()):
    """pieces.score on the GPU (module notes): {iou, gap_max, gap95}, the outline gap in nuqta. Paths outside the
    GPU's model (UNSUPPORTED keys), or no GPU, go to pieces.score."""
    if not available() or any(k in q for nodes in mine for q in nodes for k in UNSUPPORTED):
        return score(mine, refs, origin, ppn, pen_px, ignore)
    dev = _device()
    with torch.no_grad():
        rings = [ref_ring(p) for p in refs]
        ink_pts = _reach(mine, origin, ppn, pen_px)
        ref_pts = np.concatenate(rings)
        far = float(max(0.0, *(ref_pts.min(0) - ink_pts.min(0)), *(ink_pts.max(0) - ref_pts.max(0)))) / ppn
        if far > RUNAWAY:
            return {"iou": 0.0, "gap_max": round(far, 3), "gap95": round(far, 3)}
        pts = np.concatenate([ref_pts, ink_pts])
        x1, y1 = pts.min(0) - 20 - pen_px  # pieces.Window's margin, and the nib's reach past its coarse layout
        x2, y2 = pts.max(0) + 20 + pen_px
        W, H = int((x2 - x1) * SUB), int((y2 - y1) * SUB)
        to_px = lambda q: np.round((np.asarray(q) - [x1, y1]) * SUB * 16).astype(np.int32)  # noqa: E731
        Bm = np.zeros((H, W), np.uint8)
        for ring in rings:
            cv2.fillPoly(Bm, [to_px(ring)], 1, cv2.LINE_8, 4)
        B = torch.tensor(Bm, dtype=torch.bool, device=dev)
        A = ink_masks(mine, origin, ppn, pen_px, (float(x1), float(y1), float(SUB), H, W))
        if ignore:
            Dm = np.zeros((H, W), np.uint8)
            for p in ignore:
                cv2.fillPoly(Dm, [to_px(ref_ring(p))], 1, cv2.LINE_8, 4)
            A &= ~(torch.tensor(Dm, dtype=torch.bool, device=dev) & ~B)
        iou = float((A & B).sum()) / max(1, float((A | B).sum()))
        ea, eb = _edge(A).nonzero().float(), _edge(B).nonzero().float()
        g = torch.cat([_near(ea, eb), _near(eb, ea)]) / SUB / ppn
        if not len(g) or not torch.isfinite(g).all():
            return {"iou": round(iou, 3), "gap_max": 99.0, "gap95": 99.0}
        return {"iou": round(iou, 3), "gap_max": round(float(g.max()), 3), "gap95": round(float(torch.quantile(g, 0.95)), 3)}


def window_worst(nodes, pieces, origin, ppn, pen_px, others=(), windows=(), ignore=()):
    """The deepest miss either way (nuqta) inside the windows, on a hard raster of the strokes and the pieces. Ink on
    `ignore`'s ground (the neighbours' pieces) is no miss, as in _refine's corner term: without that, a stroke run on
    through a joint was judged worse than its start and every schedule's result was thrown away (2026-10-25)."""
    if not windows:
        return 0.0
    rings = [ref_ring(p) for p in pieces]
    own = path_hulls(nodes, origin, ppn, pen_px, step=1.0)
    hulls = own + [h for q in others for h in path_hulls(q, origin, ppn, pen_px, step=1.0)]
    # a fit run far off its piece is a runaway, as gpu_score's check: its miss is how far, with no raster drawn. The
    # raster spans all the ink at WIN_PXN, so a runaway's took a Diwani job on a tiny closed mark (T21.s0) to 15 GB
    ref_pts, ink_pts = np.concatenate(rings), np.concatenate(own)
    far = float(max(0.0, *(ref_pts.min(0) - ink_pts.min(0)), *(ink_pts.max(0) - ref_pts.max(0)))) / ppn
    if far > RUNAWAY:
        return far
    pts = np.concatenate(rings + hulls)
    x1, y1 = pts.min(0) - pen_px
    r = WIN_PXN / ppn
    W, H = int((pts[:, 0].max() - x1) * r) + 2, int((pts[:, 1].max() - y1) * r) + 2
    to_px = lambda q: np.round((np.asarray(q) - [x1, y1]) * r * 16).astype(np.int32)
    A, B = np.zeros((H, W), np.uint8), np.zeros((H, W), np.uint8)
    for h in hulls:
        cv2.fillConvexPoly(A, cv2.convexHull(to_px(h)), 1, cv2.LINE_8, 4)
    for ring in rings:
        cv2.fillPoly(B, [to_px(ring)], 1, cv2.LINE_8, 4)
    D = np.zeros((H, W), np.uint8)
    for p in ignore:
        cv2.fillPoly(D, [to_px(ref_ring(p))], 1, cv2.LINE_8, 4)
    yy, xx = np.mgrid[0:H, 0:W]
    win = np.zeros((H, W), bool)
    for x, y, rad in windows:
        cx, cy = (np.asarray(origin) + np.array([x, y]) * ppn - [x1, y1]) * r
        win |= np.hypot(xx - cx, yy - cy) < rad * WIN_PXN
    o, u = win & (A == 1) & (B == 0) & (D == 0), win & (B == 1) & (A == 0)
    wo = cv2.distanceTransform(1 - B, cv2.DIST_L2, 5)[o].max() / WIN_PXN if o.any() else 0.0
    wu = cv2.distanceTransform(1 - A, cv2.DIST_L2, 5)[u].max() / WIN_PXN if u.any() else 0.0
    return float(max(wo, wu))


def refine(nodes, pieces, origin, ppn, pen_px, rough=0.02, edge=1.0, iters=3, fixed=(), others=(), res=0.5, ignore=(),
           bend="position", hold=(), corner=0.0, windows=(), widths_free=False, pen=None, schedules=None, judge="cpu"):
    """pieces.refine's signature and result (new nodes, their score); `iters` and `res` only matter on the CPU.
    `ignore`: pieces whose ground counts neither way (pieces.ignore_mask). `bend`: as pieces.shape_cost. `hold`:
    as pieces.refine, which takes such a job (the GPU path does not hold angles). `corner`, `windows`,
    `widths_free`, `pen`: as the module's notes (GPU only; the score gains "window_worst" when there are windows).
    `schedules`: indices into SCHEDULES to run (default all). `judge`: "gpu" scores the results by gpu_score."""
    if pen is not None and torch is None:
        raise RuntimeError("the pen-held fit needs torch")
    if torch is None or hold or any(k in q for q in nodes for k in UNSUPPORTED):
        return cpu_refine(nodes, pieces, origin, ppn, pen_px, rough, edge, iters, fixed, others, res, ignore, bend, hold)

    scorer = gpu_score if judge == "gpu" else score

    def judged(ns):
        s = scorer([ns, *others], pieces, origin, ppn, pen_px, ignore)
        if windows:
            s = {**s, "window_worst": round(window_worst(ns, pieces, origin, ppn, pen_px, others, windows, ignore), 4)}
        return s, s["iou"] - s["gap95"] - corner * s.get("window_worst", 0.0)
    # never hand back worse than it was given; a pen-held fit's start is not held to the pen, so it is no fallback
    best = (nodes, *judged(nodes)) if pen is None else (None, None, -1e9)
    for i, stages in enumerate(SCHEDULES):
        if schedules is not None and i not in schedules:
            continue
        out, _ = _refine(nodes, pieces, origin, ppn, pen_px, rough, edge, fixed, others, stages, ignore, bend,
                         corner, windows, widths_free, pen, scorer)
        s, k = judged(out)
        if k > best[2]:
            best = (out, s, k)
    return [dict(q) for q in best[0]], best[1]


def shape_cost(a, rough, bend="position"):
    """pieces.shape_cost on the GPU (no corners: a path with them goes to the CPU), differentiable."""
    n = len(a)
    cost = a.new_zeros(())
    if n > 3:
        if bend == "heading":
            ch = torch.diff(a[:, :2], dim=0)
            L = ch.norm(dim=1) + 1e-9
            h = torch.atan2(ch[:, 1], ch[:, 0])
            dh = torch.remainder(torch.diff(h) + math.pi, 2 * math.pi) - math.pi
            cost = cost + rough * ((torch.diff(dh / ((L[1:] + L[:-1]) / 2)) * 0.8) ** 2).sum()
        else:
            cost = cost + rough * ((torch.diff(a[:, :2], 3, dim=0) / 0.1) ** 2).sum()
    if n > 2:
        cost = cost + rough * ((torch.diff(a[:, 2], 2) / 30) ** 2).sum()
    ch = torch.diff(a[:, :2], dim=0)
    cos = (ch[1:] * ch[:-1]).sum(1) / (ch[1:].norm(dim=1) * ch[:-1].norm(dim=1) + 1e-9)
    return cost + torch.relu(-cos).sum() * 10


LIFT_MIN = 0.02  # the narrowest a lifted nib's mark gets: a corner's width (a zero-width quad inks nothing)
PEN_PIXELS = float(os.environ.get("GPUFIT_PEN_PIXELS", 6e6))  # most grid pixels, over all tries, in one refine_pens
                                                              # loop (refine_pens); ~0.6 GB a job, seven jobs well
                                                              # inside the 4070's 12 GB


def _pen_params(nodes, pen, dev):
    """The pen-held fit's fixed parts: which angle each node takes, the angles to start from, the nodes that may lift
    and the side each lifts onto (module notes, `pen`)."""
    n = len(nodes)
    turns = sorted(set(int(t) for t in pen.get("turns", ()) if 0 < int(t) < n))
    group = torch.tensor([sum(1 for t in turns if t <= i) for i in range(n)], device=dev)
    ang0 = pen.get("angle")
    if ang0 is None:  # the nodes' own angles, folded to a half turn: their circular median
        a = np.radians([2 * q["angle"] for q in nodes])
        ang0 = math.degrees(math.atan2(np.median(np.sin(a)), np.median(np.cos(a)))) / 2
    ang0 = [ang0] * (len(turns) + 1) if np.isscalar(ang0) else list(ang0)
    P = np.array([q["p"] for q in nodes], float)
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    ls, le = float(pen.get("lift_start", 0)), float(pen.get("lift_end", 0))
    ze = arc > arc[-1] - le + 1e-9
    zs = (arc < ls - 1e-9) & ~ze  # a stroke shorter than both zones: the end's zone wins
    ks, ke = pen.get("anchor", (1, 1))
    k = np.where(ze, float(ke), np.where(zs, float(ks), 0.0))
    t = lambda x: torch.tensor(x, dtype=torch.float32, device=dev)  # noqa: E731
    return {"group": group, "ang0": t(ang0), "zs": t(zs), "ze": t(ze), "k": t(k), "size": bool(pen.get("size"))}


def _pen_unpack(pp, xy, vang, vsize, vlift, pen_px, ppn):
    """Nodes (n, 3) of centres and angles, and widths (n,), from the pen-held fit's variables: xy the full nib's centre
    path (nuqta), vang the angles (tens of degrees from their start), vsize the size, vlift each node's narrowing."""
    ang = pp["ang0"][pp["group"]] + vang[pp["group"]] * 10
    size = (1 + vsize * WSCALE).clamp(0.7, 1.5) if pp["size"] else torch.ones_like(vsize)
    drop = torch.nn.functional.softplus(vlift - 5)  # each node's fall in width, about nothing at the start
    zs, ze = pp["zs"], pp["ze"]
    fall = torch.cumsum(drop * ze, 0) * ze + torch.flip(torch.cumsum(torch.flip(drop * zs, [0]), 0), [0]) * zs
    w = (size - fall).clamp_min(LIFT_MIN)
    th = torch.deg2rad(ang)
    nv = torch.stack([torch.cos(th), -torch.sin(th)], -1)
    c = xy + (pp["k"] * (size - w) / 2 * pen_px / ppn)[:, None] * nv
    return torch.cat([c, ang[:, None]], 1), w


def _refine(nodes, pieces, origin, ppn, pen_px, rough, edge, fixed, others, stages, ignore=(), bend="position",
            corner=0.0, windows=(), widths_free=False, pen=None, scorer=score):
    dev = _device()
    rings = [ref_ring(p) for p in pieces]
    ignored = [ref_ring(p) for p in ignore]
    pts = np.concatenate(rings)
    x1, y1 = pts.min(0) - pen_px * 1.5
    x2, y2 = pts.max(0) + pen_px * 1.5
    n = len(nodes)
    base = torch.tensor([[q["p"][0], q["p"][1], q["angle"]] for q in nodes], dtype=torch.float32, device=dev)
    widths = torch.tensor([q.get("width", 1) for q in nodes], dtype=torch.float32, device=dev)
    free = torch.tensor([0.0 if (i in fixed or i - n in fixed) else 1.0 for i in range(n)], device=dev)[:, None]
    scale = torch.tensor([1.0, 1.0, 10.0], device=dev)
    org = torch.tensor(origin, dtype=torch.float32, device=dev)
    other_hulls = [h for p in others for h in path_hulls(p, origin, ppn, pen_px, step=1.0)]
    v = torch.zeros((n, 4), device=dev, requires_grad=True)  # x, y, angle and (with widths_free) width
    wfree = free[:, 0] * (1.0 if widths_free else 0.0)

    def unpack():
        return base + v[:, :3] * scale * free

    def widths_now():
        return (widths + v[:, 3] * WSCALE * wfree).clamp(0.3, 1.5)

    params = [v]
    if pen is not None:
        pp = _pen_params(nodes, pen, dev)
        vang = torch.zeros(int(pp["group"].max()) + 1, device=dev, requires_grad=True)
        vsize = torch.zeros((), device=dev, requires_grad=True)
        vlift = torch.zeros(n, device=dev, requires_grad=True)
        params = [v, vang, vsize, vlift]
        held = lambda: _pen_unpack(pp, base[:, :2] + v[:, :2] * free, vang, vsize, vlift, pen_px, ppn)  # noqa: E731
        unpack = lambda: held()[0]  # noqa: E731
        widths_now = lambda: held()[1]  # noqa: E731

    for px_per_nuqta, soft, steps, rate in stages:
        r = px_per_nuqta / ppn
        W, H = int((x2 - x1) * r) + 1, int((y2 - y1) * r) + 1
        to_px = lambda q: np.round((np.asarray(q) - [x1, y1]) * r * 16).astype(np.int32)
        Bm = np.zeros((H, W), np.uint8)
        for ring in rings:
            cv2.fillPoly(Bm, [to_px(ring)], 1, cv2.LINE_8, 4)
        Om = np.zeros((H, W), np.uint8)
        for h in other_hulls:
            cv2.fillConvexPoly(Om, cv2.convexHull(to_px(h)), 1, cv2.LINE_8, 4)
        Dm = np.zeros((H, W), np.uint8)  # the neighbours' ground: ink there is neither right nor wrong
        for ring in ignored:
            cv2.fillPoly(Dm, [to_px(ring)], 1, cv2.LINE_8, 4)
        Dm &= ~Bm.astype(bool)
        perim = max(1.0, float((cv2.morphologyEx(Bm, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0).sum()) / 2)
        Bt = torch.tensor(Bm, dtype=torch.float32, device=dev)
        Ot = torch.tensor(Om, dtype=torch.float32, device=dev)
        Kt = torch.tensor(1 - Dm, dtype=torch.float32, device=dev)
        if corner and windows:
            yy, xx = np.mgrid[0:H, 0:W]
            Wm = np.zeros((H, W), bool)
            for x, y, rad in windows:
                cx, cy = (np.asarray(origin) + np.array([x, y]) * ppn - [x1, y1]) * r
                Wm |= np.hypot(xx - cx, yy - cy) < rad * px_per_nuqta
            Wt = torch.tensor(Wm, dtype=torch.float32, device=dev)
            DBt = torch.tensor(cv2.distanceTransform(1 - Bm, cv2.DIST_L2, 5) / px_per_nuqta, device=dev)
            DAt = None
        opt = torch.optim.Adam(params, lr=rate)
        sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, steps, rate / 10)
        layout, last, still = None, None, 0
        for step in range(steps):
            opt.zero_grad()
            a = unpack()
            wd = widths_now()
            if step % RELAYOUT == 0:  # how many placements per segment: recounted now and then, as the path moves
                layout = _layout(a.detach(), wd.detach(), org, ppn, pen_px, r)
            ea, eb = _placements(a, wd, org, ppn, pen_px, r, layout)
            A = (1 - (1 - _ink(ea, eb, x1, y1, r, H, W, soft)) * (1 - Ot)) * Kt
            inter = (A * Bt).sum()
            iou = inter / (A.sum() + Bt.sum() - inter)
            gap = (A.sum() + Bt.sum() - 2 * inter) / perim / px_per_nuqta
            cost = 1 - iou + edge * gap + shape_cost(a, rough, bend)
            if corner and windows:
                if step % RELAYOUT == 0:  # how far each pixel lies from our hard ink, held until the next recount
                    Ah = (A.detach() > 0.5).to(torch.uint8).cpu().numpy()
                    DAt = torch.tensor(cv2.distanceTransform(1 - Ah, cv2.DIST_L2, 5) / px_per_nuqta, device=dev)
                extra, miss = A * (1 - Bt) * Kt * Wt, Bt * (1 - A) * Wt
                mass = (extra + miss).sum() + 1e-6
                # + 1e-8 inside the root: a window with nothing wrong in it would otherwise give an infinite gradient
                cost = cost + corner * ((extra * DBt ** P_CORNER + miss * DAt ** P_CORNER).sum() / mass + 1e-8) ** (1 / P_CORNER)
            cost.backward()
            opt.step()
            sched.step()
            # stop once the cost has settled (checked every RELAYOUT steps, the one sync with the GPU)
            if step % RELAYOUT == RELAYOUT - 1:
                c = float(cost.detach())
                still = still + 1 if last is not None and last - c < SETTLED else 0
                last = c
                if still >= 4:
                    break
    a = unpack().detach().cpu().numpy()
    wd = widths_now().detach().cpu().numpy()
    out = [{**q, "p": [round(float(a[i, 0]), 3), round(float(a[i, 1]), 3)], "angle": round(float(a[i, 2]), 1),
            **({"width": round(float(wd[i]), 3)} if (widths_free and free[i, 0]) or pen is not None else {})}
           for i, q in enumerate(nodes)]
    return out, scorer([out, *others], pieces, origin, ppn, pen_px, ignore)


def _controls_b(P):
    """_controls for a batch of paths, P (C, k, 2)."""
    d = torch.empty_like(P)
    d[:, 0] = P[:, 1] - P[:, 0]
    d[:, -1] = P[:, -1] - P[:, -2]
    if P.shape[1] > 2:
        d[:, 1:-1] = P[:, 2:] - P[:, :-2]
    t = d / d.norm(dim=-1, keepdim=True).clamp_min(1e-9)
    chord = (P[:, 1:] - P[:, :-1]).norm(dim=-1, keepdim=True)
    return P[:, :-1] + t[:, :-1] * chord / 3, P[:, 1:] - t[:, 1:] * chord / 3


def _curve_b(a, widths, origin, ppn, pen, ci, seg, t):
    """_curve for a batch, a (C, n, 3) and widths (C, n): the nib ends of path ci at parameter t of segment seg."""
    P, ang = a[..., :2], a[..., 2]
    c1, c2 = _controls_b(P)
    u = (1 - t)[..., None]
    tt = t[..., None]
    c = u ** 3 * P[ci, seg] + 3 * u * u * tt * c1[ci, seg] + 3 * u * tt * tt * c2[ci, seg] + tt ** 3 * P[ci, seg + 1]
    th = torch.deg2rad(ang[ci, seg] + (ang[ci, seg + 1] - ang[ci, seg]) * t)
    w = (widths[ci, seg] + (widths[ci, seg + 1] - widths[ci, seg]) * t) * pen
    n = torch.stack([torch.cos(th), -torch.sin(th)], -1) * (w / 2)[..., None]
    c = c * ppn + origin
    return c + n, c - n


def _layout_b(a, widths, origin, ppn, pen, r):
    """_layout for a batch: (ci, seg, t) of every placement, the paths end to end; each quad's first placement (the
    quad runs to the placement two on), each path's quads padded to whole blocks of CHUNK with its last quad again;
    and the path each block inks."""
    with torch.no_grad():
        C, n = a.shape[:2]
        k = n - 1
        ci = torch.arange(C, device=a.device)[:, None, None].expand(C, k, 33)
        seg = torch.arange(k, device=a.device)[None, :, None].expand(C, k, 33)
        t = torch.linspace(0, 1, 33, device=a.device)[None, None].expand(C, k, 33)
        ea, eb = _curve_b(a, widths, origin, ppn, pen, ci, seg, t)
        travel = torch.maximum((ea[:, :, 1:] - ea[:, :, :-1]).norm(dim=-1),
                               (eb[:, :, 1:] - eb[:, :, :-1]).norm(dim=-1)).sum(2) * r
        counts = (travel / STEP_PX).ceil().clamp_min(2).long().cpu().numpy()
    cis, segs, ts, quads, blocks = [], [], [], [], []
    base = 0
    for c in range(C):
        m = 0
        for i in range(k):
            nn = int(counts[c, i])
            tv = np.linspace(0, 1, nn + 1, dtype=np.float32)[: nn + (1 if i == k - 1 else 0)]
            ts.append(tv)
            segs.append(np.full(len(tv), i))
            m += len(tv)
        cis.append(np.full(m, c))
        q = np.arange(base, base + m - 2)
        pad = (-len(q)) % CHUNK
        quads.append(np.r_[q, np.full(pad, q[-1])])
        blocks.append(np.full((len(q) + pad) // CHUNK, c))
        base += m
    as_t = lambda x, dt=torch.long: torch.tensor(np.concatenate(x), dtype=dt, device=a.device)  # noqa: E731
    return as_t(cis), as_t(segs), as_t(ts, torch.float32), as_t(quads), as_t(blocks)


def _ink_b(ea, eb, quads, blocks, C, x1, y1, r, H, W, soft):
    """_ink for a batch of paths: (C, H, W). Each pixel's deepest quad, and the edge it is nearest inside, are found
    without the gradient; only that edge's depth is then recomputed with it (module notes, `refine_pens`). A pixel
    whose ink would be under e^-30 is left blank, as _ink's sigmoid all but does."""
    V = torch.stack([ea[quads], eb[quads], eb[quads + 2], ea[quads + 2]], 1)  # (q, 4, 2)
    # corners in order round their centre, as _ink
    with torch.no_grad():
        c = V.mean(1, keepdim=True)
        order = torch.atan2(V[..., 1] - c[..., 1], V[..., 0] - c[..., 0]).argsort(1)
    V = torch.gather(V, 1, order[..., None].expand(-1, -1, 2))
    nc = V.shape[0] // CHUNK
    V = V.view(nc, CHUNK, 4, 2)
    E = torch.roll(V, -1, 2) - V
    area = (V[..., 0] * torch.roll(V, -1, 2)[..., 1] - torch.roll(V, -1, 2)[..., 0] * V[..., 1]).sum(2)
    L = E.norm(dim=-1)
    N = torch.stack([-E[..., 1], E[..., 0]], -1) * (torch.sign(area)[..., None] / L.clamp_min(1e-9))[..., None]
    off = (V * N).sum(-1)                                                    # (nc, CHUNK, 4)
    off = torch.where(L > 1e-6, off, torch.full_like(off, -1e9))             # a zero-length edge bounds nothing
    HW = H * W
    with torch.no_grad():
        m = 4 * soft / r
        lo = V.reshape(nc, -1, 2).min(1).values - m
        hi = V.reshape(nc, -1, 2).max(1).values + m
        j0 = ((lo[:, 0] - x1) * r).floor().clamp(0, W - 1).long()
        i0 = ((lo[:, 1] - y1) * r).floor().clamp(0, H - 1).long()
        # each block's window as _ink makes it for that path alone (the widest of the path's blocks): a pixel past an
        # acute corner of a thin quad reads shallower than its distance, so a wider window would ink more
        bw = ((hi[:, 0] - x1) * r).ceil().clamp(max=W).sub(j0).long() + 1
        bh = ((hi[:, 1] - y1) * r).ceil().clamp(max=H).sub(i0).long() + 1
        pw = torch.zeros(C, dtype=torch.long, device=V.device).scatter_reduce(0, blocks, bw, reduce="amax")
        ph = torch.zeros(C, dtype=torch.long, device=V.device).scatter_reduce(0, blocks, bh, reduce="amax")
        ww, hh = int(pw.max()), int(ph.max())
        jj = j0[:, None] + torch.arange(ww, device=V.device)[None]           # (nc, ww)
        ii = i0[:, None] + torch.arange(hh, device=V.device)[None]           # (nc, hh)
        inside = ((ii < H) & (torch.arange(hh, device=V.device)[None] < ph[blocks][:, None]))[:, :, None] \
            & ((jj < W) & (torch.arange(ww, device=V.device)[None] < pw[blocks][:, None]))[:, None, :]
        flat = torch.where(inside, blocks[:, None, None] * HW + ii[:, :, None] * W + jj[:, None, :],
                           torch.full_like(inside, C * HW, dtype=torch.long))
        xs = (float(x1) + jj.float() / float(r))[:, None, None, None, :]     # pixel centres where cv2 puts them
        ys = (float(y1) + ii.float() / float(r))[:, None, None, :, None]
        Nd, od = N.detach(), off.detach()
        depth = torch.full((C * HW + 1,), -1e9, device=V.device, dtype=V.dtype)
        found = []
        per = max(1, int(BATCH_CELLS // (CHUNK * 4 * hh * ww)))              # blocks per batch
        for b in range(0, nc, per):
            sl = slice(b, b + per)
            sd = Nd[sl, ..., 0, None, None] * xs[sl] + Nd[sl, ..., 1, None, None] * ys[sl] - od[sl, ..., None, None]
            de, e = sd.min(2)                                                # each quad's depth, and its edge
            d, qa = de.max(1)                                                # each pixel's deepest quad, per block
            e = e.gather(1, qa[:, None]).squeeze(1)
            key = ((torch.arange(b, b + d.shape[0], device=V.device)[:, None, None] * CHUNK + qa) * 4 + e).reshape(-1)
            f, d = flat[sl].reshape(-1), d.reshape(-1)
            keep = (d * r / soft > -30) & (f < C * HW)
            f, d, key = f[keep], d[keep], key[keep]
            depth.scatter_reduce_(0, f, d, reduce="amax", include_self=True)
            found.append((f, d, key))
        f, d, key = (torch.cat(x) for x in zip(*found))
        hit = d == depth[f]
        win = torch.full((C * HW + 1,), -1, dtype=torch.long, device=V.device)
        win[f[hit]] = key[hit]
        pix = (win[: C * HW] >= 0).nonzero().squeeze(1)
        key = win[pix]
        rem = pix % HW
        px = float(x1) + (rem % W).float() / float(r)
        py = float(y1) + (rem // W).float() / float(r)
    Nf = N.reshape(-1, 4, 2)[key // 4, key % 4]
    of = off.reshape(-1, 4)[key // 4, key % 4]
    dp = Nf[:, 0] * px + Nf[:, 1] * py - of
    depth = torch.full((C * HW,), -1e9, device=V.device, dtype=V.dtype).index_put((pix,), dp)
    return torch.sigmoid(depth.view(C, H, W) * r / soft)


def _pen_unpack_b(pp, xy, vang, vsize, vlift, pen_px, ppn):
    """_pen_unpack for a batch: xy (C, n, 2), vang (C, groups), vsize (C,), vlift (C, n); pp's "ang0" (C, groups) and
    "k" (C, n) are each try's own. Nodes (C, n, 3) and widths (C, n)."""
    g = pp["group"]
    ang = pp["ang0"][:, g] + vang[:, g] * 10
    size = ((1 + vsize * WSCALE).clamp(0.7, 1.5) if pp["size"] else torch.ones_like(vsize))[:, None]
    drop = torch.nn.functional.softplus(vlift - 5)
    zs, ze = pp["zs"], pp["ze"]
    fall = torch.cumsum(drop * ze, 1) * ze + torch.flip(torch.cumsum(torch.flip(drop * zs, [1]), 1), [1]) * zs
    w = (size - fall).clamp_min(LIFT_MIN)
    th = torch.deg2rad(ang)
    nv = torch.stack([torch.cos(th), -torch.sin(th)], -1)
    c = xy + (pp["k"] * (size - w) / 2 * pen_px / ppn)[..., None] * nv
    return torch.cat([c, ang[..., None]], -1), w


def _shape_cost_b(a, rough, bend="position"):
    """shape_cost for a batch of paths, a (C, n, 3): (C,)."""
    n = a.shape[1]
    cost = a.new_zeros(a.shape[0])
    if n > 3:
        if bend == "heading":
            ch = torch.diff(a[..., :2], dim=1)
            L = ch.norm(dim=-1) + 1e-9
            h = torch.atan2(ch[..., 1], ch[..., 0])
            dh = torch.remainder(torch.diff(h, dim=1) + math.pi, 2 * math.pi) - math.pi
            cost = cost + rough * ((torch.diff(dh / ((L[:, 1:] + L[:, :-1]) / 2), dim=1) * 0.8) ** 2).sum(1)
        else:
            cost = cost + rough * ((torch.diff(a[..., :2], 3, dim=1) / 0.1) ** 2).sum((1, 2))
    if n > 2:
        cost = cost + rough * ((torch.diff(a[..., 2], 2, dim=1) / 30) ** 2).sum(1)
    ch = torch.diff(a[..., :2], dim=1)
    cos = (ch[:, 1:] * ch[:, :-1]).sum(-1) / (ch[:, 1:].norm(dim=-1) * ch[:, :-1].norm(dim=-1) + 1e-9)
    return cost + torch.relu(-cos).sum(1) * 10


def _release(what):
    """Each job's own record of its GPU memory (the most it held live, and what the allocator kept), then the cached
    blocks handed back: six jobs share the 4070, a stage's grids change size at every relayout, and an allocator that
    keeps every size it has seen grows past what the job needs (2026-10-26: the card's memory climbed all morning)."""
    if DEVICE == "mps":  # a Mac's GPU shares the computer's memory; it keeps no peak
        print(f"gpu memory {what}: held {torch.mps.driver_allocated_memory() / 2**30:.2f} GB", flush=True)
        torch.mps.empty_cache()
    if DEVICE != "cuda":
        return
    print(f"gpu memory {what}: peak {torch.cuda.max_memory_allocated() / 2**30:.2f} GB, "
          f"held {torch.cuda.memory_reserved() / 2**30:.2f} GB", flush=True)
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()


def refine_pens(nodes, pieces, origin, ppn, pen_px, pens, rough=0.02, edge=1.0, fixed=(), others=(), ignore=(),
                bend="position", corner=0.0, windows=(), schedules=None, judge="gpu"):
    """refine(pen=p) for every p in `pens`, the tries side by side in one loop (module notes): a list of (nodes,
    score), one a pen. The pens must share their turns, lift zones and size rule; their angles and anchors differ."""
    if torch is None:
        raise RuntimeError("the pen-held fit needs torch")
    scorer = gpu_score if judge == "gpu" else score

    def judged(ns):
        s = scorer([ns, *others], pieces, origin, ppn, pen_px, ignore)
        if windows:
            s = {**s, "window_worst": round(window_worst(ns, pieces, origin, ppn, pen_px, others, windows, ignore), 4)}
        return s, s["iou"] - s["gap95"] - corner * s.get("window_worst", 0.0)
    best = [(None, None, -1e9)] * len(pens)
    pts = np.concatenate([ref_ring(p) for p in pieces])
    span = pts.max(0) - pts.min(0) + 3 * pen_px
    for i, stages in enumerate(SCHEDULES):
        if schedules is not None and i not in schedules:
            continue
        # as many tries at once as PEN_PIXELS allows on the finest grid: eight tries of a long stroke on seven
        # workers overran the 4070's 12 GB, and Windows paged the card's memory to the CPU's (alif 003b, 2026-10-26:
        # 3 hours a stroke instead of 5 minutes)
        r = max(s[0] for s in stages) / ppn
        per = max(1, int(PEN_PIXELS // ((span[0] * r + 1) * (span[1] * r + 1))))
        outs = [o for j in range(0, len(pens), per)
                for o in _refine_pens(nodes, pieces, origin, ppn, pen_px, rough, edge, fixed, others, stages, ignore,
                                      bend, corner, windows, pens[j:j + per])]
        for c, out in enumerate(outs):
            s, k = judged(out)
            if k > best[c][2]:
                best[c] = (out, s, k)
    return [([dict(q) for q in b[0]], b[1]) for b in best]


def _refine_pens(nodes, pieces, origin, ppn, pen_px, rough, edge, fixed, others, stages, ignore, bend, corner,
                 windows, pens):
    """_refine's pen-held loop over a batch of tries; each try's nodes. A stage ends once every try has settled."""
    dev = _device()
    C = len(pens)
    rings = [ref_ring(p) for p in pieces]
    ignored = [ref_ring(p) for p in ignore]
    pts = np.concatenate(rings)
    x1, y1 = pts.min(0) - pen_px * 1.5
    x2, y2 = pts.max(0) + pen_px * 1.5
    n = len(nodes)
    base = torch.tensor([[q["p"][0], q["p"][1]] for q in nodes], dtype=torch.float32, device=dev)
    free = torch.tensor([0.0 if (i in fixed or i - n in fixed) else 1.0 for i in range(n)], device=dev)[None, :, None]
    org = torch.tensor(origin, dtype=torch.float32, device=dev)
    other_hulls = [h for p in others for h in path_hulls(p, origin, ppn, pen_px, step=1.0)]
    pps = [_pen_params(nodes, p, dev) for p in pens]
    for q in pps[1:]:
        if not (torch.equal(q["group"], pps[0]["group"]) and torch.equal(q["zs"], pps[0]["zs"])
                and torch.equal(q["ze"], pps[0]["ze"]) and q["size"] == pps[0]["size"]):
            raise ValueError("tries in one loop must share their turns, lift zones and size rule")
    pp = {**pps[0], "ang0": torch.stack([q["ang0"] for q in pps]), "k": torch.stack([q["k"] for q in pps])}
    v = torch.zeros((C, n, 2), device=dev, requires_grad=True)
    vang = torch.zeros((C, int(pp["group"].max()) + 1), device=dev, requires_grad=True)
    vsize = torch.zeros(C, device=dev, requires_grad=True)
    vlift = torch.zeros((C, n), device=dev, requires_grad=True)
    params = [v, vang, vsize, vlift]
    unpack = lambda: _pen_unpack_b(pp, base[None] + v * free, vang, vsize, vlift, pen_px, ppn)  # noqa: E731

    for px_per_nuqta, soft, steps, rate in stages:
        r = px_per_nuqta / ppn
        W, H = int((x2 - x1) * r) + 1, int((y2 - y1) * r) + 1
        to_px = lambda q: np.round((np.asarray(q) - [x1, y1]) * r * 16).astype(np.int32)  # noqa: E731
        Bm = np.zeros((H, W), np.uint8)
        for ring in rings:
            cv2.fillPoly(Bm, [to_px(ring)], 1, cv2.LINE_8, 4)
        Om = np.zeros((H, W), np.uint8)
        for h in other_hulls:
            cv2.fillConvexPoly(Om, cv2.convexHull(to_px(h)), 1, cv2.LINE_8, 4)
        Dm = np.zeros((H, W), np.uint8)  # the neighbours' ground: ink there is neither right nor wrong
        for ring in ignored:
            cv2.fillPoly(Dm, [to_px(ring)], 1, cv2.LINE_8, 4)
        Dm &= ~Bm.astype(bool)
        perim = max(1.0, float((cv2.morphologyEx(Bm, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0).sum()) / 2)
        Bt = torch.tensor(Bm, dtype=torch.float32, device=dev)
        Ot = torch.tensor(Om, dtype=torch.float32, device=dev)
        Kt = torch.tensor(1 - Dm, dtype=torch.float32, device=dev)
        Bs = Bt.sum()
        if corner and windows:
            yy, xx = np.mgrid[0:H, 0:W]
            Wm = np.zeros((H, W), bool)
            for x, y, rad in windows:
                cx, cy = (np.asarray(origin) + np.array([x, y]) * ppn - [x1, y1]) * r
                Wm |= np.hypot(xx - cx, yy - cy) < rad * px_per_nuqta
            Wt = torch.tensor(Wm, dtype=torch.float32, device=dev)
            DBt = torch.tensor(cv2.distanceTransform(1 - Bm, cv2.DIST_L2, 5) / px_per_nuqta, device=dev)
            DAt = None
        opt = torch.optim.Adam(params, lr=rate)
        sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, steps, rate / 10)
        layout, last, still = None, None, np.zeros(C, int)
        for step in range(steps):
            opt.zero_grad()
            a, wd = unpack()
            if step % RELAYOUT == 0:
                layout = _layout_b(a.detach(), wd.detach(), org, ppn, pen_px, r)
            ci, seg, t, quads, blocks = layout
            ea, eb = _curve_b(a, wd, org, ppn, pen_px, ci, seg, t)
            A = (1 - (1 - _ink_b(ea, eb, quads, blocks, C, x1, y1, r, H, W, soft)) * (1 - Ot)) * Kt
            inter = (A * Bt).sum((1, 2))
            As = A.sum((1, 2))
            iou = inter / (As + Bs - inter)
            gap = (As + Bs - 2 * inter) / perim / px_per_nuqta
            cost = 1 - iou + edge * gap + _shape_cost_b(a, rough, bend)
            if corner and windows:
                if step % RELAYOUT == 0:
                    Ah = (A.detach() > 0.5).to(torch.uint8).cpu().numpy()
                    DAt = torch.tensor(np.stack([cv2.distanceTransform(1 - h, cv2.DIST_L2, 5) for h in Ah]) / px_per_nuqta,
                                       device=dev)
                extra, miss = A * (1 - Bt) * Kt * Wt, Bt * (1 - A) * Wt
                mass = (extra + miss).sum((1, 2)) + 1e-6
                cost = cost + corner * ((extra * DBt ** P_CORNER + miss * DAt ** P_CORNER).sum((1, 2)) / mass + 1e-8) ** (1 / P_CORNER)
            cost.sum().backward()
            opt.step()
            sched.step()
            if step % RELAYOUT == RELAYOUT - 1:  # every try's settling, as _refine's (the one sync with the GPU)
                c = cost.detach().cpu().numpy()
                still = np.where(last - c < SETTLED, still + 1, 0) if last is not None else still * 0
                last = c
                if (still >= 4).all():
                    break
        _release(f"pens x{C} stage {px_per_nuqta}px")
    a, wd = unpack()
    a, wd = a.detach().cpu().numpy(), wd.detach().cpu().numpy()
    return [[{**q, "p": [round(float(a[c, i, 0]), 3), round(float(a[c, i, 1]), 3)], "angle": round(float(a[c, i, 2]), 1),
              "width": round(float(wd[c, i]), 3)} for i, q in enumerate(nodes)] for c in range(C)]
