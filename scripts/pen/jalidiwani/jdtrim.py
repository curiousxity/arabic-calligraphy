"""Whole-shape end trims: per stroke, drop end nodes one at a time while the shape's overlap holds (within 0.0005),
its worst poke-out past the studio's outline shrinks, and its worst shortfall grows no more than 0.02 nuqta. fitjob's
trim_ends judges each stroke alone with its neighbours' ground ignored, so a hairline that ends past the letter's
outline inside nobody's ink, or a tail run on to a needle, is left (ورد pilot, 2026-10-20).
python jdtrim.py QUEUE OUTDIR id [id ...]  -> OUTDIR/<id>.json {sid: nodes}, the trims printed."""
import copy, json, os, sys
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(sys.argv[1], "code"))
argv = sys.argv; sys.argv = argv[:2] + ["x", "100"]
import jdsheet
from pieces import path_hulls
from jdcatalog import origin, PPN, PEN
PX, UP = 100.0, 4; jdsheet.PX, jdsheet.SC = PX, PX / PPN; nq = PX * UP
os.makedirs(argv[2], exist_ok=True)
for k in argv[3:]:
    reg = jdsheet.reg
    nodes = {sid: jdsheet.result(reg["fits"][h]["job"])["nodes"] for sid, h in reg["shapes"][k]}
    _, rings, _ = jdsheet.shape(k)

    def measure(nb):
        hulls = [hh for ns in nb.values() for hh in path_hulls(ns, np.array(origin(k)), PPN, PEN)]
        A, B = jdsheet.masks(hulls, rings)
        return ((A & B).sum() / (A | B).sum(),
                cv2.distanceTransform((1 - B).astype(np.uint8), cv2.DIST_L2, 5)[(A & (1 - B)) > 0].max(initial=0) / nq,
                cv2.distanceTransform((1 - A).astype(np.uint8), cv2.DIST_L2, 5)[(B & (1 - A)) > 0].max(initial=0) / nq)
    m0 = cur = measure(nodes); log = []
    while True:
        best = None
        for sid in nodes:
            if len(nodes[sid]) <= 3: continue
            for end in ("start", "end"):
                t = copy.deepcopy(nodes); t[sid] = t[sid][1:] if end == "start" else t[sid][:-1]
                m = measure(t)
                if m[0] >= cur[0] - 0.0005 and m[1] < cur[1] - 0.005 and m[2] <= m0[2] + 0.02 and (best is None or m[1] < best[0][1]):
                    best = (m, t, f"{sid} {end}")
        if best is None: break
        cur, nodes = best[0], best[1]; log.append(best[2])
    json.dump(nodes, open(os.path.join(argv[2], k + ".json"), "w"))
    print(k, "before iou %.4f out %.2f short %.2f" % m0, "| after iou %.4f out %.2f short %.2f" % cur, "| dropped:", ", ".join(log) or "none")
