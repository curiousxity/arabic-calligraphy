"""Take letter pieces straight from a vector sheet (an SVG), no tracing.
usage: python -I -X utf8 scripts/marks/thuluth/vectorSheet.py SVG KEY OUT_DIR [unit] [grid=X0,X1,COLS,Y0,Y1,ROWS,LABEL]

The pieces are the dark-filled paths (the grey ones are context, the
letters around a piece). Paths are grouped into pieces by the shapes they
draw: everything that touches after rasterising is one piece; labels and
headings come out as small pieces and are listed for skipping by hand.
Each piece's outline is written in library units, centred on its own box,
to OUT_DIR/KEY-traced.json ({n: {name, d, w, h}}) as the review traces
are, so traceMarks.py's TRACED table reads it like any traced sheet.
`unit` is library units per SVG unit ("auto" or left out: taken from the
pen, 48 units per pen width, the pen measured as on the scanned sheets).
A sheet laid out in cells that draw their letters at different sizes takes
`grid=`: the cells' bounds (SVG units), each cell's pen measured on its own
(rendered 4x for precision), every piece scaled by its cell's pen; pieces
within LABEL units of a cell's top are its heading and are dropped. A small
piece lying mostly inside a bigger one's box (a kaf's sign, a detached head)
joins it.
Also writes OUT_DIR/KEY-numbered.png (the sheet with every piece
numbered) and OUT_DIR/KEY-N.png (each piece, sheet crop and outline)."""
import sys, os, re, json
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

svg, key, out_dir = sys.argv[1:4]
UNIT = float(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] != "auto" else None
GRID = None
for a in sys.argv[4:]:
    if a.startswith("grid="): GRID = [float(v) for v in a[5:].split(",")]
os.makedirs(out_dir, exist_ok=True)
src = open(svg, encoding="utf-8").read()
W = float(re.search(r'<svg[^>]*\swidth="([\d.]+)"', src).group(1))
H = float(re.search(r'<svg[^>]*\sheight="([\d.]+)"', src).group(1))

def parse(d):
    """Absolute subpaths of ("M"|"L"|"C", points) commands from an SVG d."""
    toks = re.findall(r'[MmLlHhVvCcZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?', d)
    subs, cur, i, cmd = [], None, 0, None
    x = y = sx = sy = 0.0
    def num():
        nonlocal i
        v = float(toks[i]); i += 1; return v
    while i < len(toks):
        if re.fullmatch(r'[A-Za-z]', toks[i]): cmd = toks[i]; i += 1
        rel = cmd.islower(); c = cmd.upper()
        if c == "Z":
            if cur: subs.append(cur); cur = None
            x, y = sx, sy; continue
        if c == "M":
            if cur: subs.append(cur)
            nx, ny = num(), num()
            x, y = (x + nx, y + ny) if rel else (nx, ny); sx, sy = x, y
            cur = [("M", [(x, y)])]; cmd = "l" if rel else "L"; continue
        if c == "L":
            nx, ny = num(), num(); x, y = (x + nx, y + ny) if rel else (nx, ny)
            cur.append(("L", [(x, y)]))
        elif c == "H":
            nx = num(); x = x + nx if rel else nx; cur.append(("L", [(x, y)]))
        elif c == "V":
            ny = num(); y = y + ny if rel else ny; cur.append(("L", [(x, y)]))
        elif c == "C":
            p = [num() for _ in range(6)]
            if rel: p = [p[0] + x, p[1] + y, p[2] + x, p[3] + y, p[4] + x, p[5] + y]
            cur.append(("C", [(p[0], p[1]), (p[2], p[3]), (p[4], p[5])])); x, y = p[4], p[5]
    if cur: subs.append(cur)
    return subs

def tf(subs, m):
    a, b, c, d_, e, f = m
    return [[(k, [(a * px + c * py + e, b * px + d_ * py + f) for px, py in pts]) for k, pts in s] for s in subs]

def flatten(sub, steps=8):
    out, p = [], None
    for k, pts in sub:
        if k in ("M", "L"): p = pts[0]; out.append(p)
        else:
            (c1, c2, e) = pts
            for t in np.linspace(0, 1, steps + 1)[1:]:
                u = 1 - t
                out.append(tuple(u**3 * p[j] + 3 * u * u * t * c1[j] + 3 * u * t * t * c2[j] + t**3 * e[j] for j in (0, 1)))
            p = e
    return out

dark, grey = [], []
for attrs in re.findall(r'<path(.*?)/>', src, re.S):
    fill = re.search(r'fill:#([0-9a-f]{6})', attrs)
    if not fill: continue
    lum = sum(int(fill.group(1)[i:i + 2], 16) for i in (0, 2, 4)) / 3
    m = re.search(r'transform="matrix\(([^)]*)\)"', attrs)
    mat = [float(v) for v in m.group(1).split(",")] if m else [1, 0, 0, 1, 0, 0]
    subs = tf(parse(re.search(r'\sd="([^"]*)"', attrs).group(1)), mat)
    if lum < 48: dark.append(subs)
    elif lum < 160: grey.append(subs)

# rasterise every dark path (even-odd per path, then OR), 1 px per SVG unit
def raster(paths, shape, R=1.0, ox=0.0, oy=0.0):
    acc = np.zeros(shape, bool)
    for subs in paths:
        m = Image.new("1", (shape[1], shape[0]), 0)
        for s in subs:
            pts = flatten(s)
            if len(pts) > 2:
                one = Image.new("1", m.size, 0); ImageDraw.Draw(one).polygon([((x - ox) * R, (y - oy) * R) for x, y in pts], fill=1)
                m = Image.fromarray(np.array(m) ^ np.array(one))
        acc |= np.array(m)
    return acc
shape = (int(H) + 1, int(W) + 1)
ink = raster(dark, shape)
n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(ink.astype(np.uint8), np.ones((3, 3), np.uint8)), 8)

# which piece each dark path belongs to: the component under most of its ink
owner = []
for subs in dark:
    one = raster([subs], shape)
    ids, cnt = np.unique(lab[one], return_counts=True)
    owner.append(int(ids[np.argmax(cnt)]) if len(ids) else 0)

def pen_of(paths, box, R):
    """Pen width in SVG units of the given paths, rendered R times larger."""
    x0, y0, x1, y1 = box
    m = raster(paths, (int((y1 - y0) * R) + 2, int((x1 - x0) * R) + 2), R, x0, y0).astype(np.uint8)
    dt = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    ridge = dt[(dt >= cv2.dilate(dt, np.ones((3, 3)))) & (dt > R)]
    return float(2 * np.percentile(ridge, 90)) / R

comps = [i for i in range(1, n) if st[i][4] > 0]
cell_of = {i: None for i in comps}
if GRID:
    X0, X1, C, Y0, Y1, RW, LABEL = GRID
    cw, ch = (X1 - X0) / C, (Y1 - Y0) / RW
    for i in comps:
        cx, cy = st[i][0] + st[i][2] / 2, st[i][1] + st[i][3] / 2
        col, row = int((cx - X0) // cw), int((cy - Y0) // ch)
        if not (0 <= col < C and 0 <= row < RW): cell_of[i] = "out"; continue
        top = Y0 + row * ch
        cell_of[i] = "label" if st[i][1] < top + LABEL else (row, col)
    comps = [i for i in comps if isinstance(cell_of[i], tuple)]
    # a small piece mostly inside a bigger one's box (same cell) joins it
    joined = {}
    for i in comps:
        xi, yi, wi, hi, ai = st[i]
        for j in comps:
            if j == i or cell_of[j] != cell_of[i] or st[j][4] < 3 * ai: continue
            xj, yj, wj, hj, _ = st[j]
            ox = max(0, min(xi + wi, xj + wj) - max(xi, xj)); oy = max(0, min(yi + hi, yj + hj) - max(yi, yj))
            if ox * oy > 0.6 * wi * hi: joined[i] = j; break
    for i, j in joined.items():
        while j in joined: j = joined[j]
        owner = [j if o == i else o for o in owner]
    comps = [i for i in comps if i not in joined]
units = {}
if UNIT is not None:
    units = {i: UNIT for i in comps}
elif GRID:
    for cell in sorted({cell_of[i] for i in comps}):
        mine = [i for i in comps if cell_of[i] == cell]
        paths = [p for p, o in zip(dark, owner) if o in mine]
        x0 = min(st[i][0] for i in mine); y0 = min(st[i][1] for i in mine)
        x1 = max(st[i][0] + st[i][2] for i in mine); y1 = max(st[i][1] + st[i][3] for i in mine)
        pen = pen_of(paths, (x0, y0, x1, y1), 4)
        print(f"cell {cell}: pen {pen:.2f} svg units, unit {48 / pen:.3f}")
        for i in mine: units[i] = 48 / pen
else:
    pen = pen_of(dark, (0, 0, W, H), 1)
    print(f"pen {pen:.1f} svg units, unit {48 / pen:.3f}")
    units = {i: 48 / pen for i in comps}

# reading order: rows of pieces top to bottom, right to left within a row
comps.sort(key=lambda i: (st[i][1] + st[i][3] / 2))
rows, order = [], []
for i in comps:
    cy = st[i][1] + st[i][3] / 2
    if rows and abs(cy - rows[-1][0]) < 60: rows[-1][1].append(i)
    else: rows.append([cy, [i]])
for _, r in rows: order += sorted(r, key=lambda i: -(st[i][0] + st[i][2]))
num_of = {c: k + 1 for k, c in enumerate(order)}

traced = {}
for c in order:
    k = num_of[c]; UNIT = units[c]
    subs = [s for p, o in zip(dark, owner) if o == c for s in p]
    pts = [q for s in subs for q in flatten(s, 16)]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    mx, my = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    P = lambda p: f"{(p[0] - mx) * UNIT:.0f} {(p[1] - my) * UNIT:.0f}"
    d = []
    for s in subs:
        for kind, q in s:
            d.append(kind + " ".join(P(p) for p in q) if kind != "C" else "C" + " ".join(P(p) for p in q))
        d.append("Z")
    traced[str(k)] = {"name": f"part {k}", "d": "".join(d),
                      "w": round((max(xs) - min(xs)) * UNIT), "h": round((max(ys) - min(ys)) * UNIT),
                      "box": [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))],
                      "cell": list(cell_of[c]) if isinstance(cell_of[c], tuple) else None}
with open(os.path.join(out_dir, f"{key}-traced.json"), "w", encoding="utf-8", newline="\n") as fh:
    json.dump(traced, fh, ensure_ascii=False, indent=1)

# the numbered sheet: dark ink black, grey context light grey
g = raster(grey, shape)
view = np.full(shape + (3,), 255, np.uint8); view[g] = (200, 200, 200); view[ink] = (0, 0, 0)
im = Image.fromarray(view); dr = ImageDraw.Draw(im); font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 22)
for c in order:
    x, y, w, h, _ = st[c]; dr.rectangle((x, y, x + w, y + h), outline=(230, 40, 40))
    dr.text((x, y + h + 2), str(num_of[c]), fill=(230, 40, 40), font=font)
im.save(os.path.join(out_dir, f"{key}-numbered.png"))
print(len(order), "pieces")
for c in order:
    k = num_of[c]; v = traced[str(k)]; print(k, v["box"], "w", v["w"], "h", v["h"])
