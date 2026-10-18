"""Take one clean tile from a repeating border, for a frame the app tiles.
usage: tileBorder.py IMAGE OUT_JSON OUT_PNG CX,CY,CX,CY... PERIOD BAND

The hadith panel's border (thuluth-25-hadith.webp) repeats one motif. A
whole-border trace is half a megabyte and blurry, so one tile is cut
instead: centred on each listed motif centre (source px), each cut is
folded onto its own mirror images (the motif is symmetric both ways, so the
scan's noise averages out), the cuts are averaged, and the result is traced
once. PERIOD is the repeat along the band and BAND its thickness, in source
px; the tile is cut at exactly one period plus 1 px each side, so abutting
copies overlap rather than leave a seam. Units are chosen so the period is
400 library units. Writes {d, w, h, tile: {period, band}}; the app builds the
ring (`tileRing.ts`) to fit the block it frames."""
import sys, os, json, importlib.util
import numpy as np, cv2
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("review", os.path.join(here, "review.py"))
rv = importlib.util.module_from_spec(spec); spec.loader.exec_module(rv)

image, out_json, out_png = sys.argv[1:4]
nums = [float(v) for v in sys.argv[4].split(",")]
centres = list(zip(nums[::2], nums[1::2]))
period, band = float(sys.argv[5]), float(sys.argv[6])
g = np.array(Image.open(image).convert("L")).astype(np.float32)
w, h = int(round(period + 2)), int(round(band + 2))
def cut(cx, cy):
    M = np.float32([[1, 0, w / 2 - cx], [0, 1, h / 2 - cy]])
    return cv2.warpAffine(g, M, (w, h), flags=cv2.INTER_CUBIC, borderValue=255)
fold = lambda t: (t + t[:, ::-1] + t[::-1] + t[::-1, ::-1]) / 4
tile = np.mean([fold(cut(cx, cy)) for cx, cy in centres], 0)
# averaging leaves the thin curls mid-grey; reading ink at 110, not 128, keeps them open
tile = np.clip(tile + 18, 0, 255)
unit = 400 / period
# looser fitting than a letter (opttolerance 1.0, more smoothing): the ring repeats
# this outline dozens of times, and every curve saved here is saved per tile
data, _, _ = rv.trace(tile < 128, unit=unit, S=8, blur=0.25, opttolerance=1.0, gray=np.clip(tile, 0, 255).astype(np.uint8))
data["tile"] = {"period": 400, "band": round(band * unit)}
# the tracer centres on the ink box; the folded tile is symmetric, so that is the tile's centre
with open(out_json, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(data, fh, indent=1)
Image.fromarray(np.clip(np.tile(tile, (1, 4)), 0, 255).astype(np.uint8)).save(out_png)
print("units", data["w"], data["h"], "tile", data["tile"], "chars", len(data["d"]))
