"""Smoothing refits (the user, 2026-10-21: "the studio has smoother strokes"): each stroke's fitted nodes resampled to
fewer, evenly spaced ones and polished again with the fitter's smoothness weight raised.

The tight second pass (.u, nodes 0.2 nuqta apart) leaves 10-30 nodes a stroke, 0.03-0.4 nuqta apart, and every node
is a place the edge can wobble; the studio draws an edge in one to three long curves. The pen model gets there with
few, even nodes: the path between nodes is a cubic, so few nodes are few curves. Each variant is a "refine" job
(fitjob's own mode) started from the resampled nodes, with `rough` (pieces.shape_cost: the path's third differences
and the nib angle's second) and `bend` set; the shared fitting code is unchanged and never synced.

python jdsmoothjobs.py QUEUE NODES_DIR id [id ...]   NODES_DIR: <id>.json {sid: nodes} (jdtrim.py's output).
Jobs are named jd-<id>.<sid>.<variant>, variant e.g. s40r30 (nodes 0.40 nuqta apart, rough 0.30)."""
import json, math, os, socket, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(sys.argv[1], "code"))
from jdcatalog import strokes, job
from build import path as build_path  # the queue's code: the same path the fitter sweeps

# (nuqta between nodes, rough, bend): the fit's own refine uses rough 0.05
VARIANTS = [(0.40, 0.05, "position"), (0.40, 0.30, "position"), (0.60, 0.30, "position")]
EDGE = 5.0  # as the second pass: the outline weighed five times, so a smoother path does not buy smoothness with its ends


def resample(nodes, spacing):
    """Nodes `spacing` nuqta apart along the path the fitter would sweep, the first and last kept; the nib angle
    and width read off the path as the sweep interpolates them (linearly in each segment's t)."""
    p = build_path(nodes)
    samples, prev = [], p["start"]
    for s in p["segs"]:
        P = [np.array(prev["p"]), np.array(s["c1"]), np.array(s["c2"]), np.array(s["to"]["p"])]
        for t in np.linspace(0, 1, 41)[:-1]:  # t = 1 is the next segment's start
            u = 1 - t
            c = u ** 3 * P[0] + 3 * u * u * t * P[1] + 3 * u * t * t * P[2] + t ** 3 * P[3]
            samples.append((c, prev["angle"] + (s["to"]["angle"] - prev["angle"]) * t,
                            prev.get("width", 1) + (s["to"].get("width", 1) - prev.get("width", 1)) * t))
        prev = s["to"]
    samples.append((np.array(prev["p"]), prev["angle"], prev.get("width", 1)))
    L = np.r_[0, np.cumsum([np.linalg.norm(samples[i + 1][0] - samples[i][0]) for i in range(len(samples) - 1)])]
    n = max(2, int(round(L[-1] / spacing)) + 1)
    out = []
    for target in np.linspace(0, L[-1], n):
        i = min(int(np.searchsorted(L, target, "right")) - 1, len(samples) - 2)
        f = 0 if L[i + 1] == L[i] else (target - L[i]) / (L[i + 1] - L[i])
        c = samples[i][0] * (1 - f) + samples[i + 1][0] * f
        q = {"p": [round(float(c[0]), 3), round(float(c[1]), 3)],
             "angle": round(samples[i][1] * (1 - f) + samples[i + 1][1] * f, 1)}
        w = samples[i][2] * (1 - f) + samples[i + 1][2] * f
        if w < 0.999: q["width"] = round(w, 3)
        out.append(q)
    return out


if __name__ == "__main__":
    q, nd, ids = sys.argv[1], sys.argv[2], sys.argv[3:]
    n = 0
    for k in ids:
        d_of = dict(strokes(k))
        for sid, nodes in json.load(open(os.path.join(nd, k + ".json"))).items():
            for sp, rough, bend in VARIANTS:
                j = job(k, sid, d_of[sid])
                j.update(name=f"{j['name']}.s{round(sp * 100)}r{round(rough * 100)}" + ("h" if bend == "heading" else ""),
                         mode="refine", start=resample(nodes, sp), refine={"rough": rough, "edge": EDGE, "bend": bend})
                dst = os.path.join(q, "todo", j["name"] + ".json"); tmp = dst + f".{socket.gethostname()}.tmp"
                open(tmp, "wb").write(json.dumps(j).encode()); os.replace(tmp, dst); n += 1
                print(j["name"], len(nodes), "->", len(j["start"]), "nodes")
    print("queued", n)
