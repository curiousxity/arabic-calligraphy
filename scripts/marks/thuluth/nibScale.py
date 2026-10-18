"""Correct the bought vector sheets' per-cell scale by the stroke the pen
drew in each direction. usage: python -I -X utf8 scripts/marks/thuluth/nibScale.py
Writes thuluth/traces/nib-scale.json ({sheet: {"row,col": factor}}), which
traceMarks.py applies to each cell's pieces after merging them.

vectorSheet.py scales each cell so its strokes' 90th-percentile thickness
is one pen (48 units). A broad nib draws its full width only across strokes
that run across it (in Thuluth, the flat ones); an upright stroke comes out
thinner. A cell of flat and upright strokes measures right, but a cell of
uprights alone (the alifs, some lams) measured its uprights as the full pen
and came out about 1.6x too large: its alif stems 44-48 units thick where
every kaf, lam and ta stem, scanned or bought, is 28 (measured 2026-10-18).

Telling such a cell by its shape failed (a curved letter's sides read as
uprights too), so it goes by letter: the alif and lam cells (STEM_CELLS) are
rescaled so their stems match the stems of the same sheet's kaf and ta
cells (REFERENCE_CELLS, letters with flat strokes, so cut right; each hand
its own), when more than DEADBAND off. A stem is a piece's upright stroke:
the 75th percentile of its thickness at 70-110 degrees, the median over the
cell's pieces. The source's scale, corrected before anything is built: no
letter is scaled in a composition."""
import os, sys, json, hashlib, collections
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from svgInk import parse, raster

PEN = 48
DEADBAND = 0.1
# cells as (row, col) in each sheet's trace: the first set's grid runs left
# to right (traceMarks.py VECTOR_LETTERS), the second's is read right to left
# (cell n = row * 7 + 6 - col: traceMarks.py ALPHABET, MIDDLE_CELLS, FINISHING_CELLS)
STEM_CELLS = {"t34r1": ["0,0", "2,2"], "t35r1": ["0,0", "2,2"], "t36r1": ["2,2"],
              "t37r1": ["0,6", "3,5"], "t38r1": ["0,6", "3,5"], "t39r1": ["2,2"], "t40r1": ["0,6", "1,0"]}
REFERENCE_CELLS = {"t34r1": ["2,1", "1,2"], "t35r1": ["2,1", "1,2"], "t36r1": ["2,1", "1,2"],
                   "t37r1": ["3,6", "2,5"], "t38r1": ["3,6", "2,5"], "t39r1": ["2,3", "1,2"], "t40r1": ["1,1", "1,5"]}

def ridge_dirs(d, w, h, R=0.5):
    """(stroke direction in degrees 0-180, thickness in units) at each ridge
    point of the outline's distance transform, where the stroke is clearly
    two-sided (the structure tensor of the ink's edges around the point)."""
    shape = (int(h * R) + 10, int(w * R) + 10)
    m = raster([parse(d)], shape, R, -w / 2 - 5 / R, -h / 2 - 5 / R).astype(np.uint8)
    dt = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    rid = (dt >= cv2.dilate(dt, np.ones((3, 3)))) & (dt > 3)
    f = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 2)
    gx = cv2.Sobel(f, cv2.CV_32F, 1, 0); gy = cv2.Sobel(f, cv2.CV_32F, 0, 1)
    out = []
    for y, x in zip(*np.nonzero(rid)):
        r = int(dt[y, x]) + 3
        a = gx[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1]; b = gy[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1]
        ev, evec = np.linalg.eigh(np.array([[np.sum(a * a), np.sum(a * b)], [np.sum(a * b), np.sum(b * b)]]))
        if ev[1] < 3 * max(ev[0], 1e-6): continue
        across = evec[:, 1]
        out.append(((np.degrees(np.arctan2(across[1], across[0])) + 90) % 180, 2 * dt[y, x] / R))
    return out

def stem(d, w, h):
    """A piece's upright stroke thickness, or None if it has too little upright."""
    up = [t for p, t in ridge_dirs(d, w, h) if 70 <= p <= 110]
    return float(np.percentile(up, 75)) if len(up) >= 8 else None

if __name__ == "__main__":
    cache = json.load(open(os.path.join(HERE, "traces/smoothed-cache.json"), encoding="utf-8"))
    result = {}
    for sheet in STEM_CELLS:
        n = sheet[1:-2]
        tr = json.load(open(os.path.join(HERE, f"traces/t{n}/{sheet}-traced.json"), encoding="utf-8"))
        stems = collections.defaultdict(list)
        for k, v in tr.items():
            cell = "{},{}".format(*v["cell"]) if "cell" in v else None
            if cell not in STEM_CELLS[sheet] + REFERENCE_CELLS[sheet]: continue
            u = cache.get("u:" + hashlib.sha1(v["d"].encode()).hexdigest())
            s = u and stem(u["d"], int(u["w"]), int(u["h"]))
            if s: stems[cell].append(s)
        ref = float(np.median([s for c in REFERENCE_CELLS[sheet] for s in stems[c]]))
        fix = {}
        for cell in STEM_CELLS[sheet]:
            r = float(np.median(stems[cell])) / ref
            if abs(r - 1) > DEADBAND: fix[cell] = round(1 / r, 3)
            print(f"{sheet} {cell}: stem {r * ref:.0f} against {ref:.0f}{'  -> x' + str(fix[cell]) if cell in fix else ''}")
        result[sheet] = fix
    with open(os.path.join(HERE, "traces/nib-scale.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(result, fh, indent=1)
