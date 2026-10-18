"""Convert an Adobe Illustrator EPS (AI 8 format) to a plain SVG of filled paths.
usage: python -I -X utf8 scripts/marks/thuluth/eps2svg.py IN.eps OUT.svg

Reads Illustrator's own drawing operators, not PostScript in general:
colours (`Xa` RGB, `k` CMYK, `g` grey, for the fill), paths (`m`, `l`/`L`,
`c`/`C`, `v`/`V`, `y`/`Y`), painting (`f`/`F`/`b`/`B` fill; `s`/`S`/`n`/`N`
don't) and compound paths (`*u` ... `*U`, painted once as one path). The
page is the %%BoundingBox, flipped to SVG's y-down. Enough for the
vector letter sheets; an EPS with gradients, images or text objects would
need more."""
import sys, re

src = open(sys.argv[1], "rb").read().decode("latin1")
bb = [float(v) for v in re.search(r"%%HiResBoundingBox:\s*([-\d. ]+)", src).group(1).split()]
X0, Y0, X1, Y1 = bb
body = src[src.find("%%EndSetup"):src.find("%%PageTrailer")]
toks = re.findall(r"\([^)]*\)|[^\s()]+", body)

def num(t):
    try: return float(t)
    except ValueError: return None

P = lambda x, y: f"{x - X0:.3f},{Y1 - y:.3f}"
stack, cur, sub, fill = [], [], [], "#000000"
compound, comp_parts, out = False, [], []
cx = cy = 0.0
for t in toks:
    v = num(t)
    if v is not None: stack.append(v); continue
    s = stack
    if t == "Xa" and len(s) >= 3: r, g, b = s[-3:]; fill = "#%02x%02x%02x" % tuple(int(round(c * 255)) for c in (r, g, b))
    elif t == "k" and len(s) >= 4:
        c, m, y, k = s[-4:]; fill = "#%02x%02x%02x" % tuple(int(round(255 * (1 - min(1, a + k)))) for a in (c, m, y))
    elif t == "g" and len(s) >= 1: fill = "#%02x%02x%02x" % ((int(round(s[-1] * 255)),) * 3)
    elif t == "m" and len(s) >= 2:
        if sub: cur.append(sub)
        cx, cy = s[-2:]; sub = [f"M{P(cx, cy)}"]
    elif t in ("l", "L") and len(s) >= 2: cx, cy = s[-2:]; sub.append(f"L{P(cx, cy)}")
    elif t in ("c", "C") and len(s) >= 6:
        a = s[-6:]; sub.append(f"C{P(a[0], a[1])} {P(a[2], a[3])} {P(a[4], a[5])}"); cx, cy = a[4], a[5]
    elif t in ("v", "V") and len(s) >= 4:
        a = s[-4:]; sub.append(f"C{P(cx, cy)} {P(a[0], a[1])} {P(a[2], a[3])}"); cx, cy = a[2], a[3]
    elif t in ("y", "Y") and len(s) >= 4:
        a = s[-4:]; sub.append(f"C{P(a[0], a[1])} {P(a[2], a[3])} {P(a[2], a[3])}"); cx, cy = a[2], a[3]
    elif t in ("f", "F", "b", "B", "s", "S", "n", "N"):
        if sub: cur.append(sub); sub = []
        painted = t in ("f", "F", "b", "B")
        d = "".join("".join(p) + "Z" for p in cur); cur = []
        if compound:
            if d: comp_parts.append(d)
            comp_fill, comp_painted = fill, painted
        elif painted and d: out.append((d, fill))
    elif t == "*u": compound, comp_parts, comp_painted = True, [], False
    elif t == "*U":
        if comp_parts and comp_painted: out.append(("".join(comp_parts), comp_fill))
        compound, comp_parts = False, []
    stack = []

W, H = X1 - X0, Y1 - Y0
with open(sys.argv[2], "w", encoding="utf-8", newline="\n") as fh:
    fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:g}" height="{H:g}" viewBox="0 0 {W:g} {H:g}">\n')
    for d, f in out:
        fh.write(f'<path d="{d}" style="fill:{f};fill-rule:nonzero"/>\n')
    fh.write("</svg>\n")
print(len(out), "paths", f"{W:g}x{H:g}")
