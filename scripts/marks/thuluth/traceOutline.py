"""Trace a clean outline image (coloured ink on white or transparent).
usage: trace_outline.py REPO IMAGE OUT_PNG OUT_JSON [unit_per_px]"""
import sys, os, json, importlib.util
repo, image, out_png, out_json = sys.argv[1:5]
unit = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
spec = importlib.util.spec_from_file_location("review", os.path.join(repo, "scripts/marks/thuluth/review.py"))
rv = importlib.util.module_from_spec(spec); spec.loader.exec_module(rv)
import numpy as np
from PIL import Image, ImageDraw, ImageFont
im = Image.open(image).convert("RGBA")
a = np.array(im)
ink = (a[..., 3] > 128) & (a[..., :3].min(-1) < 235)
# the tracer upsamples 8x; a large source needs no blur-closing, so shrink first
# so that the piece is about 600 px tall (what the sheets' pieces are after 8x)
ys, xs = np.nonzero(ink)
h = ys.max() - ys.min()
S = 8
sel = ink
data, contours, (x0, y0, S) = rv.trace(sel, unit=unit, S=S)
json.dump({"d": data["d"], "w": data["w"], "h": data["h"]}, open(out_json, "w"), indent=1)
src = Image.fromarray(np.where(ink, 0, 255).astype(np.uint8)).convert("RGB")
bx0, by0, bx1, by1 = xs.min() - 6, ys.min() - 6, xs.max() + 7, ys.max() + 7
left = im.convert("RGB").crop((bx0, by0, bx1, by1))
right = rv.draw_traced(contours, (bx1 - bx0, by1 - by0), S)
sc = 600 / max(left.size)
tiles = [t.resize((int(t.width * sc), int(t.height * sc)), Image.LANCZOS).convert("RGB") for t in (left, right)]
font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 22)
W = sum(t.width for t in tiles) + 40; H = max(t.height for t in tiles) + 40
page = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(page); x = 0
for t, label in zip(tiles, ("source", "traced outline")):
    page.paste(t, (x, 36)); d.text((x + 4, 6), label, fill=(200, 30, 30), font=font); x += t.width + 20
page.save(out_png)
print("size px", xs.max() - xs.min(), h, "units", data["w"], data["h"], "cmds", data["d"].count("C") + data["d"].count("L"))
