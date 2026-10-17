"""Map a new Thuluth sheet: measure its pen, number its clusters, draft its units.
usage: python -I -X utf8 scripts/marks/thuluth/mapSheet.py IMAGE OUT_PNG [parts]

With `parts`, each separate shape (after cleaning, no merging of nearby
shapes) is numbered instead of each cluster: for rows whose words sit so
close that clusters swallow several of them.

Prints the pen width (median stroke thickness of the big shapes), the
library units per source px that puts it at the shared scale (48 units per
pen width, as on sheets 1-5), and one draft `units` line per cluster in
reading order (rows top to bottom, right to left). The numbered map is
written to OUT_PNG; written notes come out as clusters too and are dropped
by hand when the draft is turned into a SHEETS entry in review.py."""
import sys, os, importlib.util, numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("review", os.path.join(HERE, "review.py"))
rv = importlib.util.module_from_spec(spec); spec.loader.exec_module(rv)
path, out = sys.argv[1], sys.argv[2]
parts = len(sys.argv) > 3 and sys.argv[3] == "parts"
img = Image.open(path)
if img.mode in ("RGBA", "LA"):
    bg = Image.new("RGB", img.size, "white"); bg.paste(img, mask=img.getchannel("A")); img = bg
gray = np.array(img.convert("L"))
mask = (gray < 140).astype(np.uint8)
# pen: 90th percentile of ridge thickness over the large shapes
n, lab, st, _ = cv2.connectedComponentsWithStats(mask, 8)
big = np.isin(lab, [i for i in range(1, n) if st[i][4] > 0.002 * mask.size])
dt = cv2.distanceTransform(big.astype(np.uint8), cv2.DIST_L2, 5)
ridge = dt[(dt > 0) & (dt == cv2.dilate(dt, np.ones((3, 3))))]
pen = float(2 * np.percentile(ridge, 90)) if len(ridge) else 16.0
unit = 48.0 / pen
print(f"pen {pen:.1f} px  unit {unit:.3f}  size {gray.shape[1]}x{gray.shape[0]}")
tmp = os.path.join(os.path.dirname(out), "_map_src.png"); img.convert("RGB").save(tmp)
im, clean = rv.clean_sheet(tmp, max(8, int(round(pen))))
os.remove(tmp)
dil = 1 if parts else max(5, int(round(pen)))
d = cv2.dilate(clean, np.ones((dil, dil), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(d, 8)
boxes = []
for i in range(1, n):
    x, y, w, h, a = st[i]
    ink = int(clean[lab == i].sum())
    if ink < (4 if parts else 1.5) * pen * pen: continue
    boxes.append((int(x), int(y), int(x + w), int(y + h), ink))
boxes.sort(key=lambda b: (b[1] + b[3]) / 2)
rows = []
for b in boxes:
    cy = (b[1] + b[3]) / 2
    if rows and abs(cy - rows[-1][0]) < 5 * pen: rows[-1][1].append(b)
    else: rows.append([cy, [b]])
order = [b for _, r in rows for b in sorted(r, key=lambda b: -b[2])]
color = img.convert("RGB"); dr = ImageDraw.Draw(color)
font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", max(16, int(pen * 1.6)))
for k, (x0, y0, x1, y1, ink) in enumerate(order, 1):
    dr.rectangle((x0, y0, x1, y1), outline=(220, 0, 0), width=2)
    dr.text((x0 + 2, y0 + 1), str(k), fill=(0, 0, 230), font=font)
    print(f'    {k}: ("?", ({x0-4},{y0-4},{x1+4},{y1+4})),  # ink {ink}')
color.save(out)
