"""Stack traced pieces' review pictures into one page, each labelled with its
row and number so no two pieces on a page share a label (rows of one sheet
are numbered from 1 each).
usage: reviewSheet.py OUT.png TRACES_DIR SHEET:n,n,... [SHEET:n,...]
e.g.   reviewSheet.py traces/t8/review-2.png traces/t8 t8r2:1,2,3,4 t8r3:1
A sheet key like t8r2 labels its pieces "row 2 · 1"; a key with no row
("t6") labels them by number alone."""
import sys, os, re
from PIL import Image, ImageDraw, ImageFont

out, src = sys.argv[1:3]
font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 30)
strips = []
for arg in sys.argv[3:]:
    sheet, nums = arg.split(":")
    m = re.match(r"t\d+r(\d+)$", sheet)
    for n in nums.split(","):
        label = f"row {m.group(1)} · {n}" if m else n
        strips.append((label, Image.open(os.path.join(src, f"{sheet}-{n}.png")).convert("RGB")))
LW = 170   # the label column
W = LW + max(im.width for _, im in strips)
H = sum(im.height + 24 for _, im in strips)
page = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(page)
y = 0
for label, im in strips:
    d.line([(0, y + 2), (W, y + 2)], fill=(210, 210, 210), width=2)
    d.text((10, y + im.height // 2), label, fill=(20, 60, 200), font=font)
    page.paste(im, (LW, y + 12)); y += im.height + 24
page.save(out)
print(out, page.size)
