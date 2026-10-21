"""Tail tips stop where the reference's ink stops (the user, 2026-10-21). The fitter runs a tapering tail on into a
needle past the reference's end (0.1-0.35 nuqta on the ورد letters); jdtrim.py drops whole nodes only while the
overlap holds, which leaves most of it. Here each stroke end whose ink lies outside the reference near it is pulled
back toward its neighbour, STEP nuqta at a time (a node within STEP of its neighbour is dropped), until no ink within
NEAR nuqta of that end lies more than TOL outside the letter's outline. The nib angle and width of the end node stay.
python jdtip.py QUEUE IN_DIR OUT_DIR id [id ...]   (<id>.json {sid: nodes}, as jdtrim.py's)"""
import json, os, sys
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(sys.argv[1], "code"))
argv = sys.argv; sys.argv = argv[:2] + ["x", "100"]
import jdsheet
from pieces import path_hulls
from jdcatalog import origin, PPN, PEN
PX, UP = 100.0, 4; jdsheet.PX, jdsheet.SC = PX, PX / PPN; R = PX * UP
STEP, TOL, NEAR, SHORT = 0.05, 0.02, 0.5, 0.03  # nuqta; SHORT: most the shortfall near the end may grow


def near_end(nodes, rings, k, end_p):
    """(out, short) within NEAR nuqta of end_p: how far the shape's ink lies outside the reference at most, and the
    reference's outside ours (nuqta)."""
    hulls = [h for ns in nodes.values() for h in path_hulls(ns, np.array(origin(k)), PPN, PEN)]
    A, B = jdsheet.masks(hulls, rings)
    pts = np.concatenate(rings + hulls); x1, y1 = pts.min(0) - 4
    c = (np.array(origin(k)) + np.array(end_p) * PPN - [x1, y1]) * jdsheet.SC * UP
    yy, xx = np.ogrid[:A.shape[0], :A.shape[1]]
    near = (xx - c[0]) ** 2 + (yy - c[1]) ** 2 <= (NEAR * R) ** 2
    out = cv2.distanceTransform((1 - B).astype(np.uint8), cv2.DIST_L2, 5)[near & ((A & (1 - B)) > 0)].max(initial=0)
    short = cv2.distanceTransform((1 - A).astype(np.uint8), cv2.DIST_L2, 5)[near & ((B & (1 - A)) > 0)].max(initial=0)
    return out / R, short / R


def pull(ns, end):
    """The end node moved STEP nuqta toward its neighbour, or dropped when nearer than that."""
    ns = [dict(q) for q in ns]
    i, j = (0, 1) if end == "start" else (-1, -2)
    a, b = np.array(ns[i]["p"]), np.array(ns[j]["p"]); L = np.linalg.norm(b - a)
    if L <= STEP:
        keep = {x: ns[i][x] for x in ("angle", "width") if x in ns[i]}
        del ns[i]; ns[i].update(keep)
    else:
        ns[i]["p"] = [round(float(v), 3) for v in a + (b - a) * STEP / L]
    return ns


if __name__ == "__main__":
    q, src, dst, ids = argv[1], argv[2], argv[3], argv[4:]
    os.makedirs(dst, exist_ok=True)
    for k in ids:
        nodes = json.load(open(os.path.join(src, k + ".json")))
        jdsheet.NODES = src; _, rings, _ = jdsheet.shape(k)
        log = []
        for sid in list(nodes):
            for end in ("start", "end"):
                p0 = nodes[sid][0 if end == "start" else -1]["p"]
                o0, s0 = o, s = near_end(nodes, rings, k, p0); moved = 0.0
                while o > TOL and len(nodes[sid]) > 2:
                    t = pull(nodes[sid], end); to, ts = near_end({**nodes, sid: t}, rings, k, p0)
                    if ts > s0 + SHORT:  # past the reference's own end: a gap, not a tip; stop here
                        break
                    if to > o - 0.002:  # the ink outside is not this end's (a neighbour's cap, a join): leave it
                        break
                    nodes[sid], o, s = t, to, ts; moved += STEP
                if moved:
                    log.append(f"{sid} {end}: out {o0:.2f} -> {o:.2f}, short {s0:.2f} -> {s:.2f}, back about {moved:.2f} nuqta")
        json.dump(nodes, open(os.path.join(dst, k + ".json"), "w"))
        print(k, "; ".join(log) or "no tip past the reference")
