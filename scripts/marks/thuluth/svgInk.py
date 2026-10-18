"""Reading the bought vector sheets (SVG): their dark letter paths and the
grey context letters drawn around them. Shared by vectorSheet.py (which cut
the pieces out) and pieceSchema.py (which finds where each piece met its
neighbours: its join faces)."""
import re
import numpy as np
from PIL import Image, ImageDraw

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

def dark_and_grey(src):
    """The sheet's dark (lum < 48) and grey (48-160) filled paths, each a list
    of absolute subpaths, transforms applied."""
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
    return dark, grey

def raster(paths, shape, R=1.0, ox=0.0, oy=0.0):
    """Even-odd per path, then OR, R px per SVG unit, origin (ox, oy)."""
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
