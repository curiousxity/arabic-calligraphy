"""Trace a panel's border or corner ornaments as one frame piece.
usage: traceBorder.py IMAGE OUT_JSON OUT_PNG UNIT [invert] [ring=X0,Y0,X1,Y1] [box=X0,Y0,X1,Y1 ...] [small=AREA]

Only the ornament is kept, never the writing inside: `ring=` keeps the ink
outside that inner rectangle (a border all the way round), each `box=`
keeps the ink inside it (a corner spray). `invert` is for white-on-black
panels. Specks under `small` px (default 12) are dropped. UNIT is library
units per source pixel. Writes {d, w, h} like a review trace, and a
preview: the kept ink beside the traced outline."""
import sys, os, json, importlib.util
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("review", os.path.join(here, "review.py"))
rv = importlib.util.module_from_spec(spec); spec.loader.exec_module(rv)

image, out_json, out_png, unit = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
opts = sys.argv[5:]
gray = np.array(Image.open(image).convert("L"))
if "invert" in opts: gray = 255 - gray
ink = gray < 128
keep = np.zeros_like(ink)
small = 12
for o in opts:
    if o.startswith("ring="):
        x0, y0, x1, y1 = (int(v) for v in o[5:].split(","))
        ring = np.ones_like(ink); ring[y0:y1, x0:x1] = False; keep |= ring
    elif o.startswith("box="):
        x0, y0, x1, y1 = (int(v) for v in o[4:].split(","))
        keep[y0:y1, x0:x1] = True
    elif o.startswith("small="): small = int(o[6:])
sel = ink & keep
n, lab, st, _ = cv2.connectedComponentsWithStats(sel.astype(np.uint8), 8)
for i in range(1, n):
    if st[i][4] < small: sel[lab == i] = False
data, contours, (cx0, cy0, S) = rv.trace(sel, unit=unit, S=4, gray=np.where(keep, gray, 255))
with open(out_json, "w", encoding="utf-8", newline="\n") as fh:
    json.dump({"d": data["d"], "w": data["w"], "h": data["h"]}, fh, indent=1)
ys, xs = np.nonzero(sel)
bx0, by0, bx1, by1 = xs.min() - 6, ys.min() - 6, xs.max() + 7, ys.max() + 7
left = Image.fromarray(np.where(sel, 0, 255).astype(np.uint8)).crop((bx0, by0, bx1, by1)).convert("RGB")
shifted = [[((x / S + cx0 - 8 - bx0) * S, (y / S + cy0 - 8 - by0) * S) for x, y in c] for c in contours]
right = rv.draw_traced(shifted, left.size, S)
sc = 900 / max(left.size)
tiles = [t.resize((int(left.width * sc), int(left.height * sc)), Image.LANCZOS).convert("RGB") for t in (left, right)]
font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 22)
page = Image.new("RGB", (max(t.width for t in tiles) + 20, sum(t.height for t in tiles) + 80), "white")
d = ImageDraw.Draw(page); y = 0
for t, label in zip(tiles, ("kept ink", "traced outline")):
    d.text((4, y + 4), label, fill=(200, 30, 30), font=font); page.paste(t, (0, y + 34)); y += t.height + 40
page.save(out_png)
print("units", data["w"], data["h"], "chars", len(data["d"]))
