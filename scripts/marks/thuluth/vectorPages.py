"""Review pages for a vector sheet: one page per cell, each piece's crop of
the sheet beside the outline taken for it, numbered as in KEY-numbered.png.
usage: python -I -X utf8 scripts/marks/thuluth/vectorPages.py RENDER_PNG SVG_W OUT_DIR KEY NAME [NAME...]
RENDER_PNG is the sheet rendered whole (for the crops), SVG_W its width in
SVG units; NAMEs label the cells row by row."""
import sys, os, re, json
from PIL import Image, ImageDraw, ImageFont, ImageChops
render, svg_w, out_dir, key = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
names = sys.argv[5:]
src = Image.open(render).convert("RGB"); s = src.width / svg_w
with open(os.path.join(out_dir, f"{key}-traced.json"), encoding="utf-8") as fh: traced = json.load(fh)

def polys(d):
    toks = re.findall(r'[MLCZ]|-?\d+(?:\.\d+)?', d); i = 0; out = []; cur = []; p = (0, 0)
    while i < len(toks):
        t = toks[i]; i += 1
        if t == "M":
            if cur: out.append(cur)
            p = (float(toks[i]), float(toks[i + 1])); i += 2; cur = [p]
        elif t == "L": p = (float(toks[i]), float(toks[i + 1])); i += 2; cur.append(p)
        elif t == "C":
            c1 = (float(toks[i]), float(toks[i + 1])); c2 = (float(toks[i + 2]), float(toks[i + 3])); e = (float(toks[i + 4]), float(toks[i + 5])); i += 6
            for k in range(1, 13):
                u = k / 12; v = 1 - u
                cur.append(tuple(v**3 * p[j] + 3 * v * v * u * c1[j] + 3 * v * u * u * c2[j] + u**3 * e[j] for j in (0, 1)))
            p = e
        elif t == "Z" and cur: out.append(cur); cur = []
    if cur: out.append(cur)
    return out

def outline(v, sc):
    """Filled nonzero, as the app's canvas fills it: each contour adds its
    winding (the sign of its area) to the pixels it encloses."""
    import numpy as np
    Wd, Hd = int(v["w"] * sc) + 12, int(v["h"] * sc) + 12; wind = np.zeros((Hd, Wd), int)
    for pl in polys(v["d"]):
        pts = [(x * sc + Wd / 2, y * sc + Hd / 2) for x, y in pl]
        if len(pts) < 3: continue
        area = sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))
        m = Image.new("1", (Wd, Hd), 0); ImageDraw.Draw(m).polygon(pts, fill=1)
        wind += np.array(m).astype(int) * (1 if area > 0 else -1)
    mask = Image.fromarray(((wind != 0) * 255).astype("uint8"))
    img = Image.new("RGB", (Wd, Hd), "white"); img.paste((0, 0, 0), (0, 0), mask); return img

big = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 34); small = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 18)
head = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 30)
cells = {}
for n, v in traced.items(): cells.setdefault(tuple(v["cell"]), []).append(int(n))
SC = 0.6   # outline drawing scale: library units to px
for ci, cell in enumerate(sorted(cells)):
    rows = []
    for n in sorted(cells[cell]):
        v = traced[str(n)]; x0, y0, x1, y1 = v["box"]
        crop = src.crop((int((x0 - 25) * s), int((y0 - 25) * s), int((x1 + 25) * s), int((y1 + 25) * s)))
        o = outline(v, SC)
        f = o.height / max(1, crop.height); crop = crop.resize((max(1, int(crop.width * f)), o.height), Image.LANCZOS)
        rows.append((n, crop, o, v))
    W = 120 + max(c.width + o.width + 60 for _, c, o, _ in rows); H = 60 + sum(o.height + 40 for *_, o, _ in [(r[0], r[1], r[2], r[3]) for r in rows])
    page = Image.new("RGB", (max(W, 700), H), "white"); dr = ImageDraw.Draw(page)
    dr.text((12, 12), names[ci] if ci < len(names) else str(cell), fill=(0, 0, 0), font=head)
    y = 60
    for n, c, o, v in rows:
        dr.line([(0, y), (page.width, y)], fill=(215, 215, 215), width=2)
        dr.text((12, y + 12), str(n), fill=(20, 60, 200), font=big)
        dr.text((12, y + 52), f'{v["h"]} tall', fill=(150, 150, 150), font=small)
        page.paste(c, (120, y + 20)); page.paste(o, (120 + c.width + 40, y + 20)); y += o.height + 40
    page.save(os.path.join(out_dir, f"page-{ci + 1:02d}-{names[ci].lower() if ci < len(names) else ci}.png"))
print(len(cells), "pages")
