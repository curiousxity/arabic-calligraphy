"""Hashim beside ours and the studio: python jdplate.py QUEUE OUT.png PX id:vx,vy [id:vx,vy ...]
vx,vy: a point on the letter in page-65 view coordinates (1800 px wide); its ink (connected, plus any ink within half a
nuqta, for dots) is cut from h65_rows_gray.png and scaled to the studio letter's height. Prints each weight ratio."""
import json, os, sys, re
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(sys.argv[1], "code"))
argv = sys.argv; sys.argv = argv[:4] + [a.split(":")[0] for a in argv[4:]]
import jdsheet  # builds the ours|studio|diff cells for the ids, and saves its own sheet to OUT; replaced below
from jdcatalog import db
q, out, PX = argv[1], argv[2], float(argv[3])
im = cv2.imread(os.environ["JD_HASHIM65"], 0)
ink = cv2.morphologyEx((im < 150).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n, lab, st, cen = cv2.connectedComponentsWithStats(ink, 8); K = 7015 / 1800
rows = []
for a, (label, ts) in zip(argv[4:], jdsheet.cells):
    k, pt = a.split(":"); vx, vy = map(float, pt.split(","))
    x, y = int((vx - 300) * K), int((vy - 380) * K)
    r = lab[y - 40:y + 40, x - 40:x + 40]; ids, c = np.unique(r[r > 0], return_counts=True); i = ids[np.argmax(c)]
    m = (lab == i).astype(np.uint8)
    near = cv2.dilate(m, np.ones((61, 61), np.uint8))  # dots sit within about a nuqta
    for j in np.unique(lab[(near > 0) & (lab > 0)]):
        if st[j, 4] < 3000: m |= (lab == j).astype(np.uint8)
    ys, xs = np.nonzero(m); m = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    studio = np.array(ts[1])[..., 0] < 200; sy = np.nonzero(studio.any(1))[0]; hs = sy.max() - sy.min() + 1
    sc = hs / m.shape[0]
    t = cv2.resize(m.astype(np.float32), (max(1, int(m.shape[1] * sc)), hs), interpolation=cv2.INTER_AREA)[..., None]
    img = (np.array((246, 240, 228), np.float32) * (1 - t) + np.array((66, 52, 40), np.float32) * t).round().astype(np.uint8)
    rows.append((label, [Image.fromarray(img)] + ts))
f = ImageFont.truetype("segoeui.ttf", 15); PAD = 14
W = max(sum(t.width for t in ts) + 5 * PAD for _, ts in rows)
H = sum(max(t.height for t in ts) + 2 * PAD + 22 for _, ts in rows) + 40
sheet = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(sheet)
d.text((PAD, 8), "Hashim (p. 65, scaled to the studio's height) | ours | studio | difference (red ours only, blue studio only)", fill=(60, 60, 60), font=f)
y = 40
for label, ts in rows:
    d.text((PAD, y), label, fill=(20, 20, 20), font=f); y += 22; x = PAD; h = max(t.height for t in ts)
    for t in ts:
        sheet.paste(t, (x, y + h - t.height)); x += t.width + PAD
    y += h + 2 * PAD
sheet.save(out); print(out, sheet.size)
