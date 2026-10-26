"""Which of the studio's shapes guides the cut of a letter on Hashim's page, and where it lies over his ink
(jdplatecut.py --guide with several ids; the user, 2026-10-24: run everything possible on the Geekmini's GPU).

pick(m, cands) -> (best index, M, iou, table). m: his letter's mask, as jdplatecut crops it. cands: per candidate, its
strokes' rings in px (the studio's outline at his nib). Each candidate is laid over his ink at every pose of a grid,
size about his height (FACTORS), stretch (ASPECTS) and turn (TURNS) around its middle, and every shift at once: the
overlap at all shifts is one FFT cross-correlation on the GPU (torch; the CPU where there is no CUDA). The best pose of
the best candidate is refined on a finer grid at full size. Score: the share of the union both cover (IoU).
M is 2x3, in the same convention jdplatecut applies: crop px = M[:, :2] @ ring px + M[:, 2]."""
import numpy as np, cv2
import torch

DEV = torch.device("cuda" if torch.cuda.is_available() else "cpu")
FACTORS = np.linspace(0.8, 1.25, 10)
ASPECTS = np.linspace(0.85, 1.18, 7)
TURNS = np.radians(np.arange(-12, 13, 3))
CHUNK = 64


def _L(f, a, th):
    return np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]]) @ np.diag([f * np.sqrt(a), f / np.sqrt(a)])


def _raster(rings, A, off, shape, ds):
    z = np.zeros(shape, np.uint8)
    for r in rings:
        cv2.fillPoly(z, [np.round(((r @ A.T) / ds + off) * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
    return z


def _best_shift(Am, Bs, Hp, Wp):
    """Am (h, w) his mask, Bs (n, hb, wb) the posed candidates: the best IoU over all shifts for each, and its shift."""
    h, w = Am.shape
    FA = torch.fft.rfft2(torch.as_tensor(Am, dtype=torch.float32, device=DEV), s=(Hp, Wp))
    sA = float(Am.sum()); out = []
    for i in range(0, len(Bs), CHUNK):
        B = torch.as_tensor(np.stack(Bs[i:i + CHUNK]), dtype=torch.float32, device=DEV)
        sB = B.sum((1, 2))
        inter = torch.fft.irfft2(FA[None] * torch.conj(torch.fft.rfft2(B, s=(Hp, Wp))), s=(Hp, Wp)).clamp_min(0)
        iou = inter / (sA + sB[:, None, None] - inter).clamp_min(1)
        v, k = iou.reshape(len(B), -1).max(1)
        for vv, kk in zip(v.tolist(), k.tolist()):
            ty, tx = divmod(kk, Wp)
            out.append((vv, ty if ty <= h else ty - Hp, tx if tx <= w else tx - Wp))
    return out


def _search(m, rings, cs, sc0, poses, ds):
    """IoU of each pose (f, a, th) with its best shift, at 1/ds size; (iou, M) per pose."""
    Am = cv2.resize(m.astype(np.float32), (m.shape[1] // ds, m.shape[0] // ds), interpolation=cv2.INTER_AREA) if ds > 1 else m.astype(np.float32)
    pts = np.concatenate(rings) - cs
    span = np.abs(pts).max() * sc0 * 1.3 / ds + 4
    side = int(2 * span) + 1; off = np.array([span, span])
    Hp, Wp = Am.shape[0] + side, Am.shape[1] + side
    As = [sc0 * _L(*p) for p in poses]
    Bs = [_raster([r - cs for r in rings], A, off, (side, side), ds).astype(np.float32) for A in As]
    res = []
    for (v, ty, tx), A in zip(_best_shift(Am, Bs, Hp, Wp), As):
        q = (off + [tx, ty]) * ds                    # where the candidate's middle lands, crop px
        res.append((v, np.c_[A, q - A @ cs]))
    return res


def pick(m, cands):
    H = np.ptp(np.nonzero(m)[0]) + 1
    table = []
    for rings in cands:
        pts = np.concatenate(rings); sc0 = H / np.ptp(pts[:, 1])
        z = _raster(rings, np.eye(2), -pts.min(0) + 2, tuple((np.ptp(pts, 0) + 5).astype(int)[::-1]), 1)
        ys, xs = np.nonzero(z); cs = np.array([xs.mean(), ys.mean()]) + pts.min(0) - 2   # the shape's middle
        poses = [(f, a, th) for f in FACTORS for a in ASPECTS for th in TURNS]
        coarse = _search(m, rings, cs, sc0, poses, 2)
        j = int(np.argmax([v for v, _ in coarse])); f0, a0, t0 = poses[j]
        fine = [(f0 + df, a0 + da, t0 + np.radians(dt)) for df in np.linspace(-0.04, 0.04, 5)
                for da in np.linspace(-0.04, 0.04, 5) for dt in np.linspace(-2, 2, 5)]
        res = _search(m, rings, cs, sc0, fine, 1)
        k = int(np.argmax([v for v, _ in res]))
        f, a, th = fine[k]
        table.append({"iou": round(res[k][0], 4), "M": res[k][1], "pose": {"size": round(f, 3), "stretch": round(a, 3),
                      "turn deg": round(float(np.degrees(th)), 1), "base scale": round(float(sc0), 4)}})
    best = int(np.argmax([t["iou"] for t in table]))
    return best, table[best]["M"], table[best]["iou"], table


def _rel_search(target, rings, poses):
    """rings in crop px; the best pose (f, a, th about their middle) and shift over target: (iou, 2x3 in crop px)."""
    pts = np.concatenate(rings)
    z = _raster(rings, np.eye(2), -pts.min(0) + 2, tuple((np.ptp(pts, 0) + 5).astype(int)[::-1]), 1)
    ys, xs = np.nonzero(z); cs = np.array([xs.mean(), ys.mean()]) + pts.min(0) - 2
    return _search(target, rings, cs, 1.0, poses, 1)


BODY_POSES = [(f, a, th) for f in np.linspace(0.85, 1.15, 7) for a in np.linspace(0.88, 1.12, 5)
              for th in np.radians(np.arange(-9, 10, 3))]
MARK_POSES = [(f, a, th) for f in np.linspace(0.7, 1.4, 8) for a in np.linspace(0.8, 1.25, 6)
              for th in np.radians(np.arange(-24, 25, 4))]


def refine(m, parts, M, marks, pad, rounds=2):
    """Strokes mesh rather than sit rigidly (the user, 2026-10-25): after the whole shape is placed by M, each part (a
    body stroke, or a mark's strokes together) is placed again on its own, over the ink the other parts leave: its
    size, stretch, turn and place searched near where it lies (body strokes within 15%, 9 degrees; marks within
    0.7-1.4x, 24 degrees), the shift kept to a window `pad` px round it. parts: per part, its rings in ring px;
    marks: per part, True for a mark. Returns per part its 2x3 (crop px = Mp[:, :2] @ ring px + Mp[:, 2]) and the
    overlap with its ink."""
    M = np.array(M, float); Ms = [M.copy() for _ in parts]
    posed = lambda j, A=None: [r @ (Ms[j] if A is None else A)[:, :2].T + (Ms[j] if A is None else A)[:, 2] for r in parts[j]]
    region = lambda j: _raster(posed(j), np.eye(2), np.zeros(2), m.shape, 1)
    ious = [None] * len(parts)
    for _ in range(rounds):
        for j in sorted(range(len(parts)), key=lambda j: marks[j]):
            others = np.zeros_like(m)
            for k in range(len(parts)):
                if k != j:
                    others |= region(k)
            # a little past the others' edges, so a mark is not drawn to the rim of a stem its guide is thinner than
            others = cv2.dilate(others, np.ones((5, 5), np.uint8))
            target = (m & (1 - others)).astype(np.uint8)
            # each round searches from the shape's own pose, so the ranges never compound
            P = posed(j, M); pts = np.concatenate(P)
            lo = np.maximum(np.floor(pts.min(0) - pad), 0).astype(int); hi = np.minimum(np.ceil(pts.max(0) + pad), m.shape[::-1]).astype(int)
            win = target[lo[1]:hi[1], lo[0]:hi[0]]
            if win.sum() == 0:
                continue
            res = _rel_search(win, [r - lo for r in P], MARK_POSES if marks[j] else BODY_POSES)
            k = int(np.argmax([v for v, _ in res])); v, R = res[k]
            R = np.c_[R[:, :2], R[:, 2] + lo - R[:, :2] @ lo]          # window px back to crop px
            Ms[j] = np.c_[R[:, :2] @ M[:, :2], R[:, :2] @ M[:, 2] + R[:, 2]]
            ious[j] = round(float(v), 4)
    return Ms, ious
