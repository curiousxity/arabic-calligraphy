"""Shared geometry for the tarkib piece schema: reading the library, and the
ink of one piece column by column. Used by measureJoins.py and pieceSchema.py.

Library units throughout: 48 per pen width, y down, each piece centred on its
own ink box (src/lib/markLibraryData.ts)."""
import os, re, json
import numpy as np, cv2

PEN = 48.0
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

def library(group="thuluth"):
    """[(id, name, w, h, d)] of one group, read from the generated data file."""
    src = open(os.path.join(REPO, "src/lib/markLibraryData.ts"), encoding="utf-8").read()
    start = src.index(f'{{ id: "{group}"'); end = src.find('  ] },', start)
    rows = re.findall(r'\{ id: "([^"]+)", name: "([^"]*)", w: (\d+), h: (\d+), d: "([^"]*)"', src[start:end])
    return [(i, n, int(w), int(h), d) for i, n, w, h, d in rows]

def contours(d):
    toks = re.findall(r"[MCLQZ]|-?\d+\.?\d*(?:e-?\d+)?", d); subs, i, p = [], 0, None
    while i < len(toks):
        t = toks[i]; i += 1
        if t == "M": p = (float(toks[i]), float(toks[i + 1])); i += 2; subs.append([p])
        elif t == "L": p = (float(toks[i]), float(toks[i + 1])); i += 2; subs[-1].append(p)
        elif t == "C":
            a = [float(v) for v in toks[i:i + 6]]; i += 6
            for s in np.linspace(0, 1, 9)[1:]:
                u = 1 - s; subs[-1].append(tuple(u**3 * p[j] + 3 * u * u * s * a[j] + 3 * u * s * s * a[2 + j] + s**3 * a[4 + j] for j in (0, 1)))
            p = (a[4], a[5])
    return [np.array(s) for s in subs if len(s) > 2]

class Ink:
    """The piece rasterised at 1 px per unit (nonzero fill, as the app draws)."""
    def __init__(self, d):
        cs = contours(d)
        pts = np.vstack(cs)
        self.x0, self.y0 = np.floor(pts.min(0)) - 2
        x1, y1 = np.ceil(pts.max(0)) + 2
        W, H = int(x1 - self.x0) + 1, int(y1 - self.y0) + 1
        # winding-number fill: sum signed per-contour fills
        acc = np.zeros((H, W), np.int32)
        for c in cs:
            m = np.zeros((H, W), np.uint8)
            cv2.fillPoly(m, [np.round((c - [self.x0, self.y0]) * 16).astype(np.int32)], 1, shift=4)
            area = 0.5 * np.sum(c[:-1, 0] * c[1:, 1] - c[1:, 0] * c[:-1, 1])
            acc += m.astype(np.int32) * (1 if area > 0 else -1)
        self.m = acc != 0
        self.contours = cs
        ys, xs = np.nonzero(self.m)
        self.xmin, self.xmax = xs.min() + self.x0, xs.max() + self.x0
        self.ymin, self.ymax = ys.min() + self.y0, ys.max() + self.y0

    def runs(self, x):
        """Vertical ink runs [(top, bottom)] in the column at unit x."""
        c = int(round(x - self.x0))
        if c < 0 or c >= self.m.shape[1]: return []
        col = self.m[:, c].astype(np.int8)
        edges = np.diff(np.concatenate([[0], col, [0]]))
        tops, bots = np.nonzero(edges == 1)[0], np.nonzero(edges == -1)[0]
        return [(t + self.y0, b + self.y0) for t, b in zip(tops, bots)]

    def components(self):
        """Separate ink blobs: (area, (x0,y0,x1,y1)) in units."""
        n, lab, st, _ = cv2.connectedComponentsWithStats(self.m.astype(np.uint8), 8)
        return [(int(st[i][4]), (st[i][0] + self.x0, st[i][1] + self.y0, st[i][0] + st[i][2] + self.x0, st[i][1] + st[i][3] + self.y0)) for i in range(1, n)]

def end_run(ink, side, depth=PEN / 2, span=PEN):
    """The ink at one end of the piece, measured `depth` in from the extreme:
    the run nearest the bottom of the piece's lower half that the column
    holds there, and its centreline slope over `span` around it. side is
    "right" (entry) or "left" (exit). Returns None if the column is empty."""
    sgn = -1 if side == "right" else 1
    x_ext = ink.xmax if side == "right" else ink.xmin
    x = x_ext + sgn * depth
    rs = ink.runs(x)
    if not rs: return None
    # the joining stroke runs low: take the lowest run
    t, b = max(rs, key=lambda r: r[1])
    mid = (t + b) / 2
    # follow that run's centre for the slope
    xs, ms = [], []
    for k in np.linspace(-span / 2, span / 2, 9):
        rr = ink.runs(x + k)
        if not rr: continue
        near = min(rr, key=lambda r: abs((r[0] + r[1]) / 2 - mid))
        if abs((near[0] + near[1]) / 2 - mid) > PEN: continue
        xs.append(x + k); ms.append((near[0] + near[1]) / 2)
    slope = float(np.polyfit(xs, ms, 1)[0]) if len(xs) >= 3 else 0.0
    return {"x": float(x), "y": float(mid), "thick": float(b - t), "runs": len(rs), "slope": slope}
