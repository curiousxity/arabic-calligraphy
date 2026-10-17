"""Draw every Thuluth piece in the generated mark library side by side at
library scale, bottoms on one line, with the alif height marked.
usage: python -I -X utf8 scripts/marks/thuluth/lineup.py OUT_PNG (run from the repo root)"""
import re, sys
from PIL import Image, ImageDraw, ImageFont
src = open("src/lib/markLibraryData.ts", encoding="utf-8").read()
items = re.findall(r'id: "(thuluth-[^"]+)", name: "([^"]+)", w: (\d+), h: (\d+), d: "([^"]+)"', src)
def polys(d):
    out, cur, pos = [], [], (0, 0)
    for cmd, args in re.findall(r'([MLCZ])([^MLCZ]*)', d):
        n = [float(v) for v in args.split()]
        if cmd == "M": cur = [(n[0], n[1])]; pos = cur[0]
        elif cmd == "L": pos = (n[0], n[1]); cur.append(pos)
        elif cmd == "C":
            p0 = pos; p1, p2, p3 = (n[0], n[1]), (n[2], n[3]), (n[4], n[5])
            for i in range(1, 13):
                t = i / 12; u = 1 - t
                cur.append(tuple(u**3*p0[k] + 3*u*u*t*p1[k] + 3*u*t*t*p2[k] + t**3*p3[k] for k in (0, 1)))
            pos = p3
        else: out.append(cur); cur = []
    return out
GAP, BASE = 60, 700   # every piece's bottom on one line (the meem's tail hangs below the others in real writing)
W = sum(max(int(w), 240) for _, _, w, _, _ in items) + GAP * (len(items) + 1) + 160; H = BASE + 120
page = Image.new("L", (W, H), 255); x = GAP
font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 22)
dr = ImageDraw.Draw(page)
for mid, name, w, h, d in items:
    w, h = int(w), int(h); m = Image.new("1", (W, H), 0)
    for p in polys(d):
        layer = Image.new("1", (W, H), 0)
        ImageDraw.Draw(layer).polygon([(x + w / 2 + a, BASE - h / 2 + b) for a, b in p], fill=1)
        m = Image.fromarray(__import__("numpy").logical_xor(__import__("numpy").array(m), __import__("numpy").array(layer)))
    page.paste(0, mask=m)
    dr.text((x, BASE + 20), f"{name.split(' (')[0]}  {h} tall", fill=0, font=font)
    x += max(w, 240) + GAP
dr.line([(0, BASE - 500), (W, BASE - 500)], fill=170); dr.text((4, BASE - 530), "alif height (500)", fill=120, font=font)
page.save(sys.argv[1])
