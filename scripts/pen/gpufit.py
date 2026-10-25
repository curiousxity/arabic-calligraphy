"""pieces.refine on a GPU: the same cost, minimised by gradient descent over a soft raster of the swept nib.

    from gpufit import available, refine     # available(): torch with CUDA is here

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

Nodes as smooth_path and refine make them: {"p", "angle"} and perhaps "width". A node with "dir", "corner",
"keep", "tin" or "tout" is outside this model: refine() hands those paths back to pieces.refine."""
import math, os, sys
import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pieces import ref_ring, path_hulls, score, refine as cpu_refine  # noqa: E402

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


def available():
    return READY and torch is not None and torch.cuda.is_available()


def _device():
    return torch.device("cuda" if available() else "cpu")


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


def window_worst(nodes, pieces, origin, ppn, pen_px, others=(), windows=(), ignore=()):
    """The deepest miss either way (nuqta) inside the windows, on a hard raster of the strokes and the pieces. Ink on
    `ignore`'s ground (the neighbours' pieces) is no miss, as in _refine's corner term: without that, a stroke run on
    through a joint was judged worse than its start and every schedule's result was thrown away (2026-10-25)."""
    if not windows:
        return 0.0
    rings = [ref_ring(p) for p in pieces]
    hulls = [h for q in (nodes, *others) for h in path_hulls(q, origin, ppn, pen_px, step=1.0)]
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
           bend="position", hold=(), corner=0.0, windows=(), widths_free=False):
    """pieces.refine's signature and result (new nodes, their score); `iters` and `res` only matter on the CPU.
    `ignore`: pieces whose ground counts neither way (pieces.ignore_mask). `bend`: as pieces.shape_cost. `hold`:
    as pieces.refine, which takes such a job (the GPU path does not hold angles). `corner`, `windows`,
    `widths_free`: as the module's notes (GPU only; the score gains "window_worst" when there are windows)."""
    if torch is None or hold or any(k in q for q in nodes for k in UNSUPPORTED):
        return cpu_refine(nodes, pieces, origin, ppn, pen_px, rough, edge, iters, fixed, others, res, ignore, bend, hold)

    def judged(ns):
        s = score([ns, *others], pieces, origin, ppn, pen_px, ignore)
        if windows:
            s = {**s, "window_worst": round(window_worst(ns, pieces, origin, ppn, pen_px, others, windows, ignore), 4)}
        return s, s["iou"] - s["gap95"] - corner * s.get("window_worst", 0.0)
    s0, k0 = judged(nodes)
    best = (nodes, s0, k0)  # never hand back worse than it was given
    for stages in SCHEDULES:
        out, _ = _refine(nodes, pieces, origin, ppn, pen_px, rough, edge, fixed, others, stages, ignore, bend,
                         corner, windows, widths_free)
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


def _refine(nodes, pieces, origin, ppn, pen_px, rough, edge, fixed, others, stages, ignore=(), bend="position",
            corner=0.0, windows=(), widths_free=False):
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
        opt = torch.optim.Adam([v], lr=rate)
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
            **({"width": round(float(wd[i]), 3)} if widths_free and free[i, 0] else {})} for i, q in enumerate(nodes)]
    return out, score([out, *others], pieces, origin, ppn, pen_px, ignore)
