"""Edge refits (<name>.e): fitted as the second pass (.u, nodes 0.2 nuqta apart, outline weighed five times), but with the
neighbours' ground ignored only away from the letter's outer edge. A band BAND nuqta deep inside the letter's outline
counts again, so a stroke's end may run on through a neighbour inside the letter but not out past its edge as a
sliver or barb (the waws' heads, ورد pilot, 2026-10-20). The shared fitting code is unchanged: the trimmed ground goes
in as ordinary ignore pieces (straight-line paths, one per piece of ground).
python jdedge.py QUEUE id [id ...]"""
import json, os, socket, sys
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(sys.argv[1], "code"))
from jdcatalog import strokes, job, transform, PPN
from pieces import ref_ring
BAND, RS = 0.12, 8  # nuqta; raster px per screen px
q, ids = sys.argv[1], sys.argv[2:]
n = 0
for k in ids:
    st = strokes(k)
    if len(st) < 2:
        continue
    rings = {sid: ref_ring([transform(k), d]) for sid, d in st}
    pts = np.concatenate(list(rings.values())); x0, y0 = pts.min(0) - 4; W, H = ((pts.max(0) - [x0, y0] + 8) * RS).astype(int)
    P = lambda r: np.round((r - [x0, y0]) * RS).astype(np.int32)
    M = {}
    for sid, r in rings.items():
        m = np.zeros((H, W), np.uint8); cv2.fillPoly(m, [P(r)], 1); M[sid] = m
    U = np.zeros((H, W), np.uint8)
    for m in M.values(): U |= m
    e = int(round(BAND * PPN * RS)); Ue = cv2.erode(U, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * e + 1, 2 * e + 1)))
    for sid, d in st:
        ground = []
        for osid, m in M.items():
            if osid == sid: continue
            g = m & Ue
            cs, _ = cv2.findContours(g, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for c in cs:
                if cv2.contourArea(c) < 4 * RS * RS: continue
                c = c[:, 0, :] / RS + [x0, y0]
                ground.append([[1, 1, 0, 0], "M " + " L ".join("%.2f %.2f" % (x, y) for x, y in c) + " Z"])
        j = job(k, sid, d); j.update(name=j["name"] + ".e", spacing=0.2, edge=5, ignore=ground)
        dst = os.path.join(q, "todo", j["name"] + ".json"); tmp = dst + f".{socket.gethostname()}.tmp"
        open(tmp, "wb").write(json.dumps(j).encode()); os.replace(tmp, dst); n += 1
print("queued", n, "edge refits")
