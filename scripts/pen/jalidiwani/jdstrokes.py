"""Each fitted stroke in its own colour over the studio's outline (black line), first and last node marked.
python jdstrokes.py QUEUE OUT.png PX id [id ...]"""
import json, os, sys
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(sys.argv[1], "code"))
argv = sys.argv; sys.argv = argv[:4]
import jdsheet
from jdcatalog import strokes, origin, PPN, PEN, T
from pieces import ref_ring, path_hulls
PX = float(argv[3]); SC = PX / PPN; COL = [(220, 60, 50), (40, 120, 230), (30, 160, 80), (230, 150, 20)]
tiles = []
for k in argv[4:]:
    d_of = dict(strokes(k)); rings = [ref_ring([T, d_of[s]]) for s, _ in jdsheet.reg["shapes"][k]]
    fits = [(s, jdsheet.result(jdsheet.reg["fits"][h]["job"])) for s, h in jdsheet.reg["shapes"][k]]
    pts = np.concatenate(rings); x1, y1 = pts.min(0) - 6; x2, y2 = pts.max(0) + 6
    W, H = int((x2 - x1) * SC), int((y2 - y1) * SC)
    img = np.full((H, W, 3), 255, np.uint8)
    P = lambda r: np.round((np.asarray(r) - [x1, y1]) * SC).astype(np.int32)
    for j, (s, r) in enumerate(fits):
        m = np.zeros((H, W), np.uint8)
        for hh in path_hulls(r["nodes"], np.array(origin(k)), PPN, PEN):
            cv2.fillConvexPoly(m, cv2.convexHull(P(hh)), 1)
        img[m > 0] = (img[m > 0] * 0.35 + np.array(COL[j]) * 0.65).astype(np.uint8)
        n0, n1 = r["nodes"][0]["p"], r["nodes"][-1]["p"]
        for p, c in ((n0, (0, 200, 0)), (n1, (200, 0, 200))):
            q = P(np.array(origin(k)) + np.array(p) * PPN); cv2.circle(img, tuple(int(v) for v in q), 5, c, 2)
        cv2.putText(img, s, tuple(int(v) for v in P(np.array(origin(k)) + np.array(r["nodes"][len(r["nodes"]) // 2]["p"]) * PPN)), 0, 0.7, (0, 0, 0), 2)
    for rr in rings:
        cv2.polylines(img, [P(rr)], True, (0, 0, 0), 1, cv2.LINE_AA)
    cv2.putText(img, k, (8, 24), 0, 0.8, (0, 0, 0), 2); tiles.append(img)
H = max(t.shape[0] for t in tiles); out = np.full((H, sum(t.shape[1] for t in tiles) + 10 * len(tiles), 3), 255, np.uint8); x = 0
for t in tiles:
    out[:t.shape[0], x:x + t.shape[1]] = t; x += t.shape[1] + 10
cv2.imwrite(argv[2], out[..., ::-1]); print(argv[2], out.shape)
