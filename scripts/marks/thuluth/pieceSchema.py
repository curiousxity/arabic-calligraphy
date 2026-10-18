"""Generate the tarkib piece geometry: where each Thuluth piece can be joined
and stretched. Writes TypeScript to stdout:

    python -I -X utf8 scripts/marks/thuluth/pieceSchema.py | tr -d '\\r' > src/lib/tarkibSchemaData.ts

Geometry only. What a piece *is* (its letters and forms) is read from its
name by src/lib/tarkibSchema.ts with the same phrase reader the composer
uses, so there is one table of letters, not two.

Per piece, in library units (48 per pen, y down, centred):
- `right` / `left`: the join ends, entry and exit. Each is an anchor,
  {point, angle}: where the neighbouring letter meets this piece and the
  writing direction there (right to left). Chaining puts the next piece's
  entry anchor on this piece's exit anchor, a hair overlapping, so the ink
  merges. When the end is a flat cut, it also carries `face`: a cut in
  splitAtCut's frame ({cutX, angle, window}; an entry keeps the far side,
  an exit the near), 2 units inside the edge, so a curved join can be
  spliced there (climbs, stretches).
  **Vector pieces**: each was drawn beside its neighbours in grey on the
  bought sheet, so the anchors are where the piece touched grey ink: the
  touch on the right (the previous letter) is the entry, on the left the
  exit. The designer cut the pieces flat where they *end* at a neighbour,
  but a letter that a neighbour runs *onto* (the head of a middle meem) has
  no flat end there: that anchor is on its body and has no face. A first
  version looked only for flat edges, took "the rightmost flat edge facing
  right", and caught the flat serif on a starting jeem's head.
  **Scanned pieces** have no neighbours to read: the rightmost/leftmost flat
  edge facing out is tried, then the stroke's tip, cut acrossthe lowest ink run half a pen in from the extreme, if that run is a single
  stroke 0.2-1.6 pens thick (measureJoins.py: the vector ends run 0.3-2.5
  pens, so no thickness rule is used for them).
- `zones`: straight, near-horizontal strokes that may lengthen (a single
  ink run 0.25-1.3 pens thick whose centreline slope stays under 0.35 for
  at least 1.5 pens), longest first, cut at their middle.
- `foot`: the rightmost ink point in the lowest 30% of the piece, where a
  previous letter's stroke would land if this piece stood in for a middle
  form the library lacks (tarkibSchema.ts, `standIn`).
- `dots`: how many separate nuqta-sized blobs the piece draws.
`NUQTA_D`: the nuqta. The vector set draws no dots and the scans rarely
keep them, so it is the library's own "Nuqta" (dots-44, from a sheet drawn
at another scale) rescaled to one pen across, centred.
Overrides (`schema-overrides.json`, {id: {right|left|zones|dots|reviewed|
noFreeEnd}}) are applied last."""
import sys, os, re, json, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from joinGeometry import library, Ink, end_run, contours, PEN
from svgInk import dark_and_grey, flatten, raster
import cv2

EDGE_STRAIGHT = 0.6        # units: a segment this close to its chord is a straight edge
EDGE_LEN = (0.3 * PEN, 3.0 * PEN)
END_REACH = 0.8 * PEN      # an end edge's midpoint lies this close to the ink's extreme x
INSET = 2.0

def segments(d):
    """Original path segments as (p0, p1, max deviation from the chord)."""
    toks = re.findall(r"[MCLQZ]|-?\d+\.?\d*(?:e-?\d+)?", d); out, i, p, start = [], 0, None, None
    while i < len(toks):
        t = toks[i]; i += 1
        if t == "M": p = start = (float(toks[i]), float(toks[i + 1])); i += 2
        elif t == "L":
            q = (float(toks[i]), float(toks[i + 1])); i += 2; out.append((p, q, 0.0)); p = q
        elif t == "C":
            a = [float(v) for v in toks[i:i + 6]]; i += 6; q = (a[4], a[5])
            pts = [(a[0], a[1]), (a[2], a[3])]
            out.append((p, q, max(dist_to_line(c, p, q) for c in pts))); p = q
        elif t == "Z":
            if p and start and p != start: out.append((p, start, 0.0))
            p = start
    return out

def dist_to_line(c, a, b):
    ax, ay = a; bx, by = b; L = math.hypot(bx - ax, by - ay)
    if L < 1e-9: return math.hypot(c[0] - ax, c[1] - ay)
    return abs((bx - ax) * (ay - c[1]) - (ax - c[0]) * (by - ay)) / L

def inside(ink, x, y):
    c, r = int(round(x - ink.x0)), int(round(y - ink.y0))
    return 0 <= r < ink.m.shape[0] and 0 <= c < ink.m.shape[1] and bool(ink.m[r, c])

def cut_of(point, direction, half=None):
    """splitAtCut's {cutX, angle} for a cut line through `point`, perpendicular
    to `direction` (the writing direction there). With `half`, the cut is only
    that far either side of the point (splitAtCut's `window`): an infinite line
    across a join would also cross the letter's other strokes."""
    ang = math.atan2(direction[1], direction[0])
    c, s = math.cos(ang), math.sin(ang)
    cut = {"cutX": round(point[0] * c + point[1] * s, 2), "angle": round(ang, 4)}
    if half: cut["window"] = {"y": round(-point[0] * s + point[1] * c, 2), "half": round(half, 1)}
    return cut

def end_of(point, direction, face=None):
    """A join end: where the neighbour meets this piece and the writing
    direction there; `face` when that end is a flat cut a join can splice."""
    e = {"point": [round(point[0], 1), round(point[1], 1)], "angle": round(math.atan2(direction[1], direction[0]), 4)}
    if face: e["face"] = face
    return e

def flat_face(ink, segs, side):
    """The straight end edge on `side`, as an end with a cut 2 units inside it."""
    best = None
    for a, b, dev in segs:
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if dev > EDGE_STRAIGHT or not (EDGE_LEN[0] <= L <= EDGE_LEN[1]): continue
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        nx, ny = (b[1] - a[1]) / L, -(b[0] - a[0]) / L
        if inside(ink, mx + 3 * nx, my + 3 * ny): nx, ny = -nx, -ny     # outward: off the ink
        if not inside(ink, mx - 3 * nx, my - 3 * ny): continue           # ink must lie behind the edge
        facing = nx if side == "right" else -nx
        if facing < 0.3: continue
        reach = (ink.xmax - mx) if side == "right" else (mx - ink.xmin)
        if reach > END_REACH: continue
        if best is None or reach < best[0]: best = (reach, (mx, my), (nx, ny), L)
    if not best: return None
    _, (mx, my), (nx, ny), L = best
    # writing direction: into the piece at an entry (against the outward normal), out of it at an exit
    w = (-nx, -ny) if side == "right" else (nx, ny)
    return end_of((mx, my), w, cut_of((mx - INSET * nx, my - INSET * ny), w, L / 2 + 6))

def run_face(ink, side):
    r = end_run(ink, side)
    if not r or r["runs"] != 1 or not (0.2 * PEN <= r["thick"] <= 1.6 * PEN): return None
    # writing direction is leftward along the stroke: (-1, -slope) normalised
    dx, dy = -1.0, -r["slope"]; L = math.hypot(dx, dy)
    tip = (ink.xmax if side == "right" else ink.xmin, r["y"])
    return end_of(tip, (dx / L, dy / L), cut_of((r["x"], r["y"]), (dx / L, dy / L), r["thick"] / 2 + 8))

def zones(ink):
    out, x, cur = [], ink.xmin + 2, []
    def close():
        if len(cur) and cur[-1][0] - cur[0][0] >= 1.5 * PEN:
            xs = np.array([c[0] for c in cur]); ms = np.array([c[1] for c in cur])
            slope = float(np.polyfit(xs, ms, 1)[0])
            if abs(slope) < 0.35:
                mid = len(cur) // 2
                dx, dy = -1.0, -slope; L = math.hypot(dx, dy)
                out.append({**cut_of((cur[mid][0], cur[mid][1]), (dx / L, dy / L), 0.9 * PEN), "length": round(float(xs[-1] - xs[0]), 1)})
    while x <= ink.xmax - 2:
        rs = ink.runs(x)
        low = max(rs, key=lambda r: r[1]) if rs else None
        ok = low and 0.25 * PEN <= low[1] - low[0] <= 1.3 * PEN
        m = (low[0] + low[1]) / 2 if ok else None
        if ok and (not cur or abs(m - cur[-1][1]) < 0.35 * 2):
            cur.append((x, m))
        else:
            close(); cur = [(x, m)] if ok else []
        x += 2
    close()
    return sorted(out, key=lambda z: -z["length"])[:2]

def dot_blobs(ink):
    comps = ink.components()
    if len(comps) < 2: return []
    big = max(a for a, _ in comps)
    out = []
    for a, (x0, y0, x1, y1) in comps:
        w, h = x1 - x0, y1 - y0
        if a == big: continue
        if 0.6 * PEN <= max(w, h) <= 1.6 * PEN and max(w, h) / max(1, min(w, h)) < 1.8: out.append((x0, y0, x1, y1))
    return out

SHEET_OF = {"thuluth-v1-": ("t35", "thuluth-35-beginnings.svg"), "thuluth-v2-": ("t36", "thuluth-36-middles.svg"),
            "thuluth-v3-": ("t34", "thuluth-34-endings.svg")}
_sheets = {}

def sheet(prefix):
    if prefix not in _sheets:
        key, svg = SHEET_OF[prefix]
        here = os.path.dirname(os.path.abspath(__file__))
        traced = json.load(open(os.path.join(here, f"traces/{key}/{key}r1-traced.json"), encoding="utf-8"))
        dark, grey = dark_and_grey(open(os.path.join(here, "..", svg), encoding="utf-8").read())
        boxes = lambda paths: [np.vstack([np.array(flatten(s)) for s in p]) for p in paths]
        gb = [(b.min(0), b.max(0)) for b in boxes(grey)]
        db = [(b.min(0), b.max(0)) for b in boxes(dark)]
        _sheets[prefix] = (traced, dark, db, grey, gb)
    return _sheets[prefix]

CONTACT_R = 4          # raster px per SVG unit for the contact test

def contact_faces(pid, ink, segs):
    """{"right": cut, "left": cut} from where a vector piece touched its grey neighbours."""
    prefix = pid[:11]
    traced, dark, db, grey, gb = sheet(prefix)
    v = traced[pid[11:]]
    x0, y0, x1, y1 = v["box"]
    unit = (v["w"] + v["h"]) / max(1, (x1 - x0) + (y1 - y0))
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    pad = 2 * PEN / unit
    lo, hi = np.array([x0 - pad, y0 - pad]), np.array([x1 + pad, y1 + pad])
    near = lambda bb: [i for i, (a, b) in enumerate(bb) if (a <= hi).all() and (b >= lo).all()]
    shape = (int((hi[1] - lo[1]) * CONTACT_R) + 2, int((hi[0] - lo[0]) * CONTACT_R) + 2)
    g = raster([grey[i] for i in near(gb)], shape, CONTACT_R, lo[0], lo[1])
    dk = raster([dark[i] for i in near(db)], shape, CONTACT_R, lo[0], lo[1])
    # this piece's dark ink: inside its own box, one SVG unit of slack
    own = np.zeros_like(dk)
    a0 = ((np.array([x0, y0]) - 1 - lo) * CONTACT_R).astype(int); a1 = ((np.array([x1, y1]) + 1 - lo) * CONTACT_R).astype(int)
    own[a0[1]:a1[1], a0[0]:a1[0]] = True
    gd = cv2.dilate(g.astype(np.uint8), np.ones((5, 5), np.uint8))
    touch = dk & own & (gd > 0)
    gn, glab, gst, gcen = cv2.connectedComponentsWithStats(gd, 8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(cv2.dilate(touch.astype(np.uint8), np.ones((9, 9), np.uint8)), 8)
    # Which side a touch is on is where the touching grey letter lies, not
    # where the touch is: a starting tooth stands on the next letter's stroke,
    # its foot anywhere under it. Grey to the right is the previous letter.
    found = {}
    for i in range(1, n):
        if st[i][4] < 12: continue
        ids, cnt = np.unique(glab[(lab == i) & (glab > 0)], return_counts=True)
        if not len(ids): continue
        gx = gcen[ids[np.argmax(cnt)]][0] / CONTACT_R + lo[0]
        side = "right" if gx > mx else "left"
        sx, sy = cen[i] / CONTACT_R + lo
        spot = ((sx - mx) * unit, (sy - my) * unit)
        # two touches on one side: keep the one farthest out
        if side not in found or (spot[0] > found[side][0]) == (side == "right"): found[side] = spot
    sides = found
    out = {}
    for side, (cx, cy) in sides.items():
        # the writing direction: leftward, through the spot
        w = (-1.0, 0.0)
        best = None
        for a, b, dev in segs:
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if dev > EDGE_STRAIGHT or not (0.2 * PEN <= L <= EDGE_LEN[1]): continue
            ex, ey = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            nx, ny = (b[1] - a[1]) / L, -(b[0] - a[0]) / L
            if inside(ink, ex + 3 * nx, ey + 3 * ny): nx, ny = -nx, -ny
            # a flat cut faces its neighbour: rightward at an entry, leftward at an exit
            if (nx if side == "right" else -nx) < 0.2: continue
            if dist_to_line((cx, cy), a, b) > 0.25 * PEN or math.hypot(ex - cx, ey - cy) > L / 2 + 0.25 * PEN: continue
            dist = math.hypot(ex - cx, ey - cy)
            if best is None or dist < best[0]: best = (dist, (ex, ey), (nx, ny), L)
        if best:
            _, (ex, ey), (nx, ny), L = best
            w = (-nx, -ny) if side == "right" else (nx, ny)
            out[side] = end_of((ex, ey), w, cut_of((ex - INSET * nx, ey - INSET * ny), w, L / 2 + 6))
        else:
            out[side] = end_of(nearest_edge_point(ink, (cx, cy)), w)
    return out

def nearest_edge_point(ink, p):
    """The ink boundary pixel nearest p, in units: where a touch lands."""
    m = ink.m.astype(np.uint8)
    edge = m - cv2.erode(m, np.ones((3, 3), np.uint8))
    ys, xs = np.nonzero(edge)
    k = np.argmin((xs + ink.x0 - p[0]) ** 2 + (ys + ink.y0 - p[1]) ** 2)
    return (float(xs[k] + ink.x0), float(ys[k] + ink.y0))

overrides = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema-overrides.json"), encoding="utf-8"))
geo, nuqta, counts = {}, None, {"pieces": 0, "right": 0, "left": 0, "contact": 0, "zones": 0}
for i, n, w, h, d in library():
    ink = Ink(d); segs = segments(d); g = {}
    if i[:11] in SHEET_OF:
        g.update(contact_faces(i, ink, segs)); counts["contact"] += len(g)
    else:
        for side in ("right", "left"):
            f = flat_face(ink, segs, side) or run_face(ink, side)
            if f: g[side] = f
    counts["right"] += "right" in g; counts["left"] += "left" in g
    z = zones(ink)
    if z: g["zones"] = z; counts["zones"] += 1
    g["dots"] = len(dot_blobs(ink))
    ys, xs = np.nonzero(ink.m)
    low = ys >= np.percentile(ys, 70)
    k = np.argmax(np.where(low, xs, -1))
    g["foot"] = [float(xs[k] + ink.x0), float(ys[k] + ink.y0)]
    g.update(overrides.get(i, {}))
    geo[i] = g; counts["pieces"] += 1
_dot = [r for r in library("dots") if r[0] == "dots-44"][0]
_k = PEN / _dot[2]
nuqta = re.sub(r"(-?\d+\.?\d*) (-?\d+\.?\d*)", lambda m: f"{float(m.group(1)) * _k:.1f} {float(m.group(2)) * _k:.1f}", _dot[4])
print("// Generated by scripts/marks/thuluth/pieceSchema.py — do not edit by hand.")
print("// Join cuts, stretch zones and dot counts of the Thuluth pieces (library units).")
print('import type { PieceGeometry } from "./tarkibSchema";')
print("")
print(f"export const NUQTA_D = {json.dumps(nuqta or '')};")
print("")
print("export const PIECE_GEOMETRY: Record<string, PieceGeometry> = {")
for i, g in geo.items():
    print(f"  {json.dumps(i)}: {json.dumps(g, separators=(',', ':'))},")
print("};")
print(json.dumps(counts), file=sys.stderr)
