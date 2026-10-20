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
SCHEDULES = (((90, 0.4, 150, 0.004), (150, 0.3, 150, 0.002)),
             ((30, 1.0, 250, 0.02), (90, 0.6, 150, 0.006)))
STEP_PX = 3     # most either nib end moves between placements, raster px; each quad spans two steps, so every
                # inked pixel lies a step deep inside one and the ink is solid (0.9 and more at a softness of 0.6)
CHUNK = 24      # quads per block, each block inks only the pixels round it
UNSUPPORTED = ("dir", "corner", "keep", "tin", "tout")


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


def _placements(a, widths, origin, ppn, pen, r):
    """Nib ends (n, 2) and (n, 2) in screen units along the path, about STEP_PX raster px apart."""
    P, ang = a[:, :2], a[:, 2]
    c1, c2 = _controls(P)
    ends_a, ends_b = [], []
    for i in range(P.shape[0] - 1):
        def at(t):
            u = 1 - t
            c = (u ** 3)[:, None] * P[i] + (3 * u * u * t)[:, None] * c1[i] + (3 * u * t * t)[:, None] * c2[i] + (t ** 3)[:, None] * P[i + 1]
            th = torch.deg2rad(ang[i] + (ang[i + 1] - ang[i]) * t)
            w = (widths[i] + (widths[i + 1] - widths[i]) * t) * pen
            n = torch.stack([torch.cos(th), -torch.sin(th)], 1) * (w / 2)[:, None]
            c = c * ppn + origin
            return c + n, c - n
        with torch.no_grad():  # how many placements: from the ends' travel over a coarse pass
            ea, eb = at(torch.linspace(0, 1, 33, device=a.device))
            travel = torch.maximum((ea[1:] - ea[:-1]).norm(dim=1), (eb[1:] - eb[:-1]).norm(dim=1)).sum() * r
            n = int(max(2, math.ceil(float(travel) / STEP_PX)))
        ea, eb = at(torch.linspace(0, 1, n + 1, device=a.device)[:-1] if i < P.shape[0] - 2 else torch.linspace(0, 1, n + 1, device=a.device))
        ends_a.append(ea); ends_b.append(eb)
    return torch.cat(ends_a), torch.cat(ends_b)


def _ink(ea, eb, x1, y1, r, H, W, soft):
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


def refine(nodes, pieces, origin, ppn, pen_px, rough=0.02, edge=1.0, iters=3, fixed=(), others=(), res=0.5):
    """pieces.refine's signature and result (new nodes, their score); `iters` and `res` only matter on the CPU."""
    if torch is None or any(k in q for q in nodes for k in UNSUPPORTED):
        return cpu_refine(nodes, pieces, origin, ppn, pen_px, rough, edge, iters, fixed, others, res)
    best = (nodes, score([nodes, *others], pieces, origin, ppn, pen_px))  # never hand back worse than it was given
    for stages in SCHEDULES:
        out, s = _refine(nodes, pieces, origin, ppn, pen_px, rough, edge, fixed, others, stages)
        if s["iou"] - s["gap95"] > best[1]["iou"] - best[1]["gap95"]:
            best = (out, s)
    return [dict(q) for q in best[0]], best[1]


def _refine(nodes, pieces, origin, ppn, pen_px, rough, edge, fixed, others, stages):
    dev = _device()
    rings = [ref_ring(p) for p in pieces]
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
    v = torch.zeros((n, 3), device=dev, requires_grad=True)

    def unpack():
        return base + v * scale * free

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
        perim = max(1.0, float((cv2.morphologyEx(Bm, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0).sum()) / 2)
        Bt = torch.tensor(Bm, dtype=torch.float32, device=dev)
        Ot = torch.tensor(Om, dtype=torch.float32, device=dev)
        opt = torch.optim.Adam([v], lr=rate)
        sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, steps, rate / 10)
        for _ in range(steps):
            opt.zero_grad()
            a = unpack()
            ea, eb = _placements(a, widths, org, ppn, pen_px, r)
            A = 1 - (1 - _ink(ea, eb, x1, y1, r, H, W, soft)) * (1 - Ot)
            inter = (A * Bt).sum()
            iou = inter / (A.sum() + Bt.sum() - inter)
            gap = (A.sum() + Bt.sum() - 2 * inter) / perim / px_per_nuqta
            cost = 1 - iou + edge * gap
            if n > 3:
                cost = cost + rough * ((torch.diff(a[:, :2], 3, dim=0) / 0.1) ** 2).sum()
            if n > 2:
                cost = cost + rough * ((torch.diff(a[:, 2], 2) / 30) ** 2).sum()
            ch = torch.diff(a[:, :2], dim=0)
            cos = (ch[1:] * ch[:-1]).sum(1) / (ch[1:].norm(dim=1) * ch[:-1].norm(dim=1) + 1e-9)
            cost = cost + torch.relu(-cos).sum() * 10
            cost.backward()
            opt.step()
            sched.step()
    a = unpack().detach().cpu().numpy()
    out = [{**q, "p": [round(float(a[i, 0]), 3), round(float(a[i, 1]), 3)], "angle": round(float(a[i, 2]), 1)} for i, q in enumerate(nodes)]
    return out, score([out, *others], pieces, origin, ppn, pen_px)
