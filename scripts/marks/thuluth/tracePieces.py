"""Trace chosen pieces of a sheet with the review tool and draw each beside
its source crop, enlarged.  usage: tracePieces.py REPO SHEET OUT_DIR n [n...]

Hand touch-up: each traced piece is also saved, cleaned and enlarged
TOUCH times, as thuluth/touchup/<sheet>-<n>.png, unless that file already
exists. The user paints over it (white erases, black adds) in any paint
program. When the file exists, the piece is traced from it instead of the
scan, so the hand edits always win and are never overwritten.

Pieces are traced from the scan's grey edge shading (not a black-and-white
mask), lightly smoothed, so the outline follows the pen's edge rather than
the scan's pixel steps. The traced pieces are merged into
OUT_DIR/<sheet>-traced.json: pieces traced earlier and not named this time
are kept as they were."""
import sys, os, json, importlib.util
repo, sheet, out_dir = sys.argv[1:4]
nums = [int(x) for x in sys.argv[4:]]
spec = importlib.util.spec_from_file_location("review", os.path.join(repo, "scripts/marks/thuluth/review.py"))
rv = importlib.util.module_from_spec(spec); spec.loader.exec_module(rv)
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
SMOOTH = dict(blur=0.5, alphamax=1.2, opttolerance=0.8)
cfg = rv.SHEETS[sheet]
src = os.path.join(rv.HERE, cfg["file"])
im, clean = rv.clean_sheet(src, cfg["dot"])
units = {k: v for k, v in cfg["units"].items() if k in nums}
sel = rv.assign(clean, units, cfg["splits"], cfg.get("erase"))
color = Image.open(src).convert("RGB")
font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 22)
os.makedirs(out_dir, exist_ok=True)
jpath = os.path.join(out_dir, f"{sheet}-traced.json")
traced = {}
if os.path.exists(jpath):
    with open(jpath, encoding="utf-8") as fh: traced = json.load(fh)
TOUCH = 4
touch_dir = os.path.join(rv.HERE, "touchup")
os.makedirs(touch_dir, exist_ok=True)
for k in nums:
    if not sel[k].any():
        print(k, "EMPTY"); continue
    ys, xs = np.nonzero(sel[k])
    bx0, by0, bx1, by1 = xs.min() - 6, ys.min() - 6, xs.max() + 7, ys.max() + 7
    tpath = os.path.join(touch_dir, f"{sheet}-{k}.png")
    if os.path.exists(tpath):
        # traced from the user's hand touch-up (same crop, TOUCH times larger)
        g = np.array(Image.open(tpath).convert("L"))
        tsel = g < 140
        data, contours, (x0, y0, S) = rv.trace(tsel, unit=3.0 / TOUCH, S=2, gray=g,
                                               blur=SMOOTH["blur"] * TOUCH, alphamax=SMOOTH["alphamax"], opttolerance=SMOOTH["opttolerance"])
        # map the contours back to the scan's px for the review drawing
        S2 = S * TOUCH
        shifted = [[(x + x0 * S, y + y0 * S) for x, y in c] for c in contours]
        src_note = "touched up"
    else:
        near = cv2.dilate(sel[k].astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        crop = np.where(near, im, 255)[by0:by1, bx0:bx1]
        Image.fromarray(crop).resize((crop.shape[1] * TOUCH, crop.shape[0] * TOUCH), Image.BICUBIC).save(tpath)
        data, contours, (x0, y0, S) = rv.trace(sel[k], gray=im, **SMOOTH)
        S2 = S
        # contours are relative to the tracer's own crop; shift them to this one
        shifted = [[(x + (x0 - bx0) * S, y + (y0 - by0) * S) for x, y in c] for c in contours]
        src_note = "scan"
    traced[str(k)] = {"name": units[k][0], **data}
    sc = max(1, 420 // max(bx1 - bx0, by1 - by0))
    left = color.crop((bx0, by0, bx1, by1))
    right = rv.draw_traced(shifted, (bx1 - bx0, by1 - by0), S2, scale=sc).convert("RGB")
    # the pixels that were traced, so leftovers are visible
    if src_note == "scan":
        mid = Image.fromarray(np.where(sel[k][by0:by1, bx0:bx1], 0, 255).astype(np.uint8)).convert("RGB")
    else:
        mid = Image.fromarray(np.where(tsel, 0, 255).astype(np.uint8)).resize((bx1 - bx0, by1 - by0), Image.LANCZOS).convert("RGB")
    tiles = [t.resize((t.width * sc, t.height * sc), Image.LANCZOS).convert("RGB") for t in (left, mid)] + [right]
    W = sum(t.width for t in tiles) + 40; H = max(t.height for t in tiles) + 40
    page = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(page)
    x = 0
    for t, label in zip(tiles, ("source", "cleaned pixels" if src_note == "scan" else "your touch-up", "traced outline")):
        page.paste(t, (x, 36)); d.text((x + 4, 6), label, fill=(200, 30, 30), font=font); x += t.width + 20
    page.save(os.path.join(out_dir, f"{sheet}-{k}.png"))
    print(k, units[k][0], src_note, data["w"], data["h"], "cmds", data["d"].count("C") + data["d"].count("L"))
with open(jpath, "w", encoding="utf-8") as fh:
    json.dump(traced, fh, ensure_ascii=False, indent=1)
