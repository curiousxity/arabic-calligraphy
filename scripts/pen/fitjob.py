"""Fit one studio piece, as one job: read a job file, write the result. fitqueue.py runs these, one process each.

    python -B scripts/pen/fitjob.py JOB.json OUT.json

A job is self-contained, so it can run on a computer without the repository:
    name     the piece's name, for the logs
    piece    [[a, d, e, f], "svg d"]: the reference piece, in screen px (ribbon.py's form)
    origin   [x, y]: where the run's frame sits in screen px; ppn screen px to the nuqta; pen the nib in screen px
    mode     "fit" (default): try a band, a band off the skeleton, and a pull, and keep the best (method step 5 in
             docs/calligraphy/stroke-ledger.md); "refine": polish `start` (spec nodes) with pieces.refine, passing
             the job's `refine` options through (rough, edge, iters, res, fixed, others) against `pieces`
             (default: [piece]); "widen": the stroke `start` written with a pen as wide as its band and judged on
             every shape that draws it (widenjob.py, which documents its own fields)
    spacing  "fit" only: nuqta between a band's nodes (default SPACING); closer for a curl
    edge     "fit" only: the weight of the outline gap in the refine (default EDGE); higher holds small features, a
             slanted start or a hook, that the overlap barely sees
    trim     true (default): trim hairline overshoot from both ends afterwards
    ignore   the shape's other strokes, as pieces: ground where ink counts neither way (pieces.ignore_mask), so the
             stroke runs on through the corner where it meets a neighbour instead of stopping short of it
The result: {name, kind, nodes, score, all, seconds, host, cpus, gpu, settings}."""
import json, math, os, socket, sys, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ribbon import bands, smooth_path  # noqa: E402
from pieces import ref_ring, score, fit_pull, refine, skeleton_samples, trim_ends  # noqa: E402
# Defaults, tight: the user puts accuracy before time (2026-10-19). Nodes 0.9 nuqta apart and an outline weight of 1
# missed slanted starts and hooks that the overlap barely sees (the curved alif: 0.22 nuqta off at its head; 0.12 so).
SPACING, EDGE = 0.3, 3.0

try:
    import gpufit  # noqa: E402
    GPU = gpufit.available()  # a band is refined on the GPU where there is one (gpufit.py), else by pieces.refine
except ImportError:  # a worker's snapshot from before gpufit.py
    GPU = False


def _from_samples(samples, piece, O, PPN, PEN, spacing=SPACING, edge=EDGE, ignore=()):
    """A band through centre samples: the nib hint that starts best, then refined coarse and fine."""
    L = sum(math.dist(samples[i][:2], samples[i + 1][:2]) for i in range(len(samples) - 1)) / PPN
    best = None
    for h in (0, 45, 90, 135):
        p = smooth_path(samples, PEN, O, PPN, spacing or SPACING, hint=h)
        s = score([p], [piece], O, PPN, PEN, ignore)
        if best is None or s["iou"] > best[1]["iou"]:
            best = (p, s)
    if GPU:
        return gpufit.refine(best[0], [piece], O, PPN, PEN, rough=0.05, edge=edge, ignore=ignore)
    p, _ = refine(best[0], [piece], O, PPN, PEN, rough=0.05, edge=edge, res=0.25, iters=2, ignore=ignore)
    return refine(p, [piece], O, PPN, PEN, rough=0.05, edge=edge, iters=1, ignore=ignore)


def fit(piece, O, PPN, PEN, log=print, spacing=SPACING, edge=EDGE, ignore=()):
    cands, t0 = [], time.time()
    lap = lambda: "%.0fs" % (time.time() - t0)
    b = bands([piece], PEN)[0]
    if b:
        p, s = _from_samples(b, piece, O, PPN, PEN, spacing, edge, ignore)
        cands.append(("band", p, s)); log("band", round(s["iou"], 4), lap())
    p, s = _from_samples(skeleton_samples(piece, PEN), piece, O, PPN, PEN, spacing, edge, ignore)
    cands.append(("skeleton", p, s)); log("skeleton", round(s["iou"], 4), lap())
    # a pull: along the piece's long axis, the nib at whichever of six angles starts best
    r = (ref_ring(piece) - O) / PPN
    c = r.mean(0); _, _, vt = np.linalg.svd(r - c); ax = vt[0]
    pr = (r - c) @ ax; a0, a1 = c + ax * pr.min() * 0.8, c + ax * pr.max() * 0.8
    best = None
    for ang in range(0, 180, 30):
        q = [{"p": list(a0), "angle": ang, "width": 1}, {"p": list(a1), "angle": ang, "width": 1}]
        s = score([q], [piece], O, PPN, PEN)
        if best is None or s["iou"] > best[1]:
            best = (ang, s["iou"])
    p, _ = fit_pull(piece, O, PPN, PEN, [a0[0], a0[1], a1[0], a1[1], best[0], 1, 1])
    s = score([p], [piece], O, PPN, PEN, ignore)
    cands.append(("pull", p, s)); log("pull", round(s["iou"], 4), lap())
    kind, p, s = max(cands, key=lambda c: c[2]["iou"] - c[2]["gap95"])
    return kind, p, {k: v for k, _, v in cands}


def run(job, log=print):
    if job.get("mode") == "widen":
        import widenjob
        return widenjob.run(job)
    t = time.time()
    piece, O, PPN, PEN = job["piece"], np.asarray(job["origin"], float), float(job["ppn"]), float(job["pen"])
    pieces = job.get("pieces") or [piece]
    ignore = job.get("ignore") or []
    if job.get("mode", "fit") == "refine":
        p, s = (gpufit.refine if GPU else refine)(job["start"], pieces, O, PPN, PEN, ignore=ignore, **job.get("refine", {}))
        kind, alls = "refine", {"refine": s}
    else:
        kind, p, alls = fit(piece, O, PPN, PEN, log, job.get("spacing", SPACING), job.get("edge", EDGE), ignore)
    if job.get("trim", True):
        p, _ = trim_ends(p, pieces + ignore, O, PPN, PEN)  # ink on a neighbour's ground is not overshoot
    s = score([p], pieces, O, PPN, PEN, ignore)
    return {"name": job["name"], "kind": kind, "nodes": p, "score": s, "all": alls,
            "seconds": round(time.time() - t), "host": socket.gethostname(), "cpus": os.cpu_count(), "gpu": GPU,
            "settings": {"spacing": job.get("spacing", SPACING), "edge": job.get("edge", EDGE), "ignore": bool(ignore)}}


def _plain(v):
    """numpy scalars and arrays as JSON."""
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, np.ndarray)):
        return [_plain(x) for x in v]
    if isinstance(v, np.generic):
        return v.item()
    return v


if __name__ == "__main__":
    job_f, out_f = sys.argv[1:3]
    job = json.load(open(job_f, encoding="utf-8"))
    res = run(job, lambda *a: print(job["name"], *a, flush=True))
    with open(out_f, "w", encoding="utf-8") as f:
        json.dump(_plain(res), f)
    print(job["name"], res["kind"], "iou %.4f" % res["score"]["iou"], "%ds" % res["seconds"], flush=True)
