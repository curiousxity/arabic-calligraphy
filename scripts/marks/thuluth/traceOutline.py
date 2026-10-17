"""Trace a clean outline image (coloured ink on white or transparent).
usage: traceOutline.py REPO IMAGE OUT_PNG OUT_JSON [unit_per_px]

`unit_per_px` is library units per pixel of the *source image*. A large
outline is shrunk first so the piece is about 600 px tall, twice the size
of a sheet piece: the tracer enlarges 8x and smooths, and tracing a
1000+ px image at that enlargement gives thousands of tiny segments."""
import sys, os, json, importlib.util
repo, image, out_png, out_json = sys.argv[1:5]
unit = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
spec = importlib.util.spec_from_file_location("review", os.path.join(repo, "scripts/marks/thuluth/review.py"))
rv = importlib.util.module_from_spec(spec); spec.loader.exec_module(rv)
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
TARGET_PX = 600
im = Image.open(image).convert("RGBA")
a = np.array(im)
ink = (a[..., 3] > 128) & (a[..., :3].min(-1) < 235)
ys, xs = np.nonzero(ink)
bx0, by0, bx1, by1 = xs.min() - 6, ys.min() - 6, xs.max() + 7, ys.max() + 7
crop = ink[by0:by1, bx0:bx1]
shrink = max(1.0, (by1 - by0) / TARGET_PX)
small = cv2.resize(crop.astype(np.float32), None, fx=1 / shrink, fy=1 / shrink, interpolation=cv2.INTER_AREA) > 0.5
small = np.pad(small, 8)   # the tracer crops 3 px outside the ink; keep that inside the array
data, contours, (x0, y0, S) = rv.trace(small, unit=unit * shrink, S=8)
with open(out_json, "w", encoding="utf-8") as fh:
    json.dump({"d": data["d"], "w": data["w"], "h": data["h"]}, fh, indent=1)
left = im.convert("RGB").crop((bx0, by0, bx1, by1))
# contours are in the padded shrunk crop, offset by the tracer's own crop: map back to source px
shifted = [[(((x / S + x0 - 8) * shrink) * S, ((y / S + y0 - 8) * shrink) * S) for x, y in c] for c in contours]
right = rv.draw_traced(shifted, left.size, S)
sc = 600 / max(left.size)
tiles = [t.resize((int(left.width * sc), int(left.height * sc)), Image.LANCZOS).convert("RGB") for t in (left, right)]
font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 22)
W = sum(t.width for t in tiles) + 40; H = max(t.height for t in tiles) + 40
page = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(page); x = 0
for t, label in zip(tiles, ("source", "traced outline")):
    page.paste(t, (x, 36)); d.text((x + 4, 6), label, fill=(200, 30, 30), font=font); x += t.width + 20
page.save(out_png)
print("shrink", round(shrink, 2), "units", data["w"], data["h"], "cmds", data["d"].count("C") + data["d"].count("L"))
