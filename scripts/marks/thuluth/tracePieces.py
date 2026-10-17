"""Trace chosen pieces of a sheet with the review tool and draw each beside
its source crop, enlarged.  usage: trace_pieces.py REPO SHEET OUT_DIR n [n...]"""
import sys, os, json, importlib.util
repo, sheet, out_dir = sys.argv[1:4]
nums = [int(x) for x in sys.argv[4:]]
spec = importlib.util.spec_from_file_location("review", os.path.join(repo, "scripts/marks/thuluth/review.py"))
rv = importlib.util.module_from_spec(spec); spec.loader.exec_module(rv)
import numpy as np
from PIL import Image, ImageDraw, ImageFont
cfg = rv.SHEETS[sheet]
src = os.path.join(rv.HERE, cfg["file"])
im, clean = rv.clean_sheet(src, cfg["dot"])
units = {k: v for k, v in cfg["units"].items() if k in nums}
sel = rv.assign(clean, units, cfg["splits"])
color = Image.open(src).convert("RGB")
font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 22)
os.makedirs(out_dir, exist_ok=True)
traced = {}
for k in nums:
    if not sel[k].any():
        print(k, "EMPTY"); continue
    data, contours, (x0, y0, S) = rv.trace(sel[k])
    traced[k] = {"name": units[k][0], **data}
    ys, xs = np.nonzero(sel[k])
    bx0, by0, bx1, by1 = xs.min() - 6, ys.min() - 6, xs.max() + 7, ys.max() + 7
    left = color.crop((bx0, by0, bx1, by1))
    right = rv.draw_traced(contours, (bx1 - bx0, by1 - by0), S)
    # the cleaned pixels that were traced, so leftovers are visible
    mid = Image.fromarray(np.where(sel[k][by0:by1, bx0:bx1], 0, 255).astype(np.uint8)).convert("RGB")
    sc = max(1, 420 // max(left.size))
    tiles = [t.resize((t.width * sc, t.height * sc), Image.LANCZOS).convert("RGB") for t in (left, mid, right)]
    W = sum(t.width for t in tiles) + 40; H = max(t.height for t in tiles) + 40
    page = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(page)
    x = 0
    for t, label in zip(tiles, ("source", "cleaned pixels", "traced outline")):
        page.paste(t, (x, 36)); d.text((x + 4, 6), label, fill=(200, 30, 30), font=font); x += t.width + 20
    page.save(os.path.join(out_dir, f"{sheet}-{k}.png"))
    print(k, units[k][0], data["w"], data["h"], "cmds", data["d"].count("C") + data["d"].count("L"))
json.dump(traced, open(os.path.join(out_dir, f"{sheet}-traced.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
