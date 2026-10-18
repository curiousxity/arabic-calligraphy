"""Build a sheet's review pages, with one number per piece across the whole
sheet, so a number never repeats on a page (a sheet's row images number
their pieces from 1 each).  usage: reviewSheet.py N   (the sheet: 10 for t10)

Numbers are kept in traces/tN/numbers.json ({"1": "t10r1 4", ...}): a piece
keeps its number for good, and a piece added later (a split) takes the next
free one. The pages, traces/tN/page-1.png and on, show only pieces not yet in
the app's library (approved pieces are read from traceMarks.py's GROUPS),
each labelled with its number and, smaller, the row it came from. Old
review pictures in the folder are removed so only one set is ever in use."""
import sys, os, re, json, glob, importlib.util
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("review", os.path.join(HERE, "review.py"))
rv = importlib.util.module_from_spec(spec); spec.loader.exec_module(rv)
N = sys.argv[1]
folder = os.path.join(HERE, "traces", f"t{N}")
rows = [s for s in rv.SHEETS if re.fullmatch(rf"t{N}(r\d+)?", s)]

# every traced piece, row by row, in the order its row lists them
pieces = []
for sheet in rows:
    jpath = os.path.join(folder, f"{sheet}-traced.json")
    if not os.path.exists(jpath): continue
    with open(jpath, encoding="utf-8") as fh: traced = json.load(fh)
    pieces += [f"{sheet} {k}" for k in rv.SHEETS[sheet]["units"] if str(k) in traced]

npath = os.path.join(folder, "numbers.json")
numbers = {}
if os.path.exists(npath):
    with open(npath, encoding="utf-8") as fh: numbers = json.load(fh)
have = set(numbers.values())
nxt = max(map(int, numbers), default=0) + 1
for p in pieces:
    if p not in have: numbers[str(nxt)] = p; nxt += 1
with open(npath, "w", encoding="utf-8", newline="\n") as fh: json.dump(numbers, fh, indent=1)

with open(os.path.join(HERE, "..", "traceMarks.py"), encoding="utf-8") as fh:
    approved = {f"{s} {k}" for s, k in re.findall(r'\("(t\d+(?:r\d+)?)","(\d+)"', fh.read())}
pending = [(int(n), p) for n, p in numbers.items() if p in pieces and p not in approved and p not in rv.SKIP]
pending.sort()

for old in glob.glob(os.path.join(folder, "*review*.png")) + glob.glob(os.path.join(folder, "page-*.png")):
    os.remove(old)
big = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 44)
small = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 20)
PER, LW = 6, 130
for pg in range(0, len(pending), PER):
    strips = []
    for n, p in pending[pg:pg + PER]:
        sheet, k = p.split()
        strips.append((n, sheet, Image.open(os.path.join(folder, f"{sheet}-{k}.png")).convert("RGB")))
    W = LW + max(im.width for *_, im in strips)
    H = sum(im.height + 24 for *_, im in strips)
    page = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(page)
    y = 0
    for n, sheet, im in strips:
        d.line([(0, y + 2), (W, y + 2)], fill=(210, 210, 210), width=2)
        mid = y + 12 + im.height // 2
        d.text((12, mid - 30), str(n), fill=(20, 60, 200), font=big)
        row = re.search(r"r(\d+)$", sheet)
        if row: d.text((14, mid + 20), f"row {row.group(1)}", fill=(150, 150, 150), font=small)
        page.paste(im, (LW, y + 12)); y += im.height + 24
    out = os.path.join(folder, f"page-{pg // PER + 1}.png")
    page.save(out)
    print(os.path.relpath(out, HERE), "->", ", ".join(str(n) for n, _ in pending[pg:pg + PER]))
print("numbers:", ", ".join(f"{n}={p}" for n, p in sorted(numbers.items(), key=lambda t: int(t[0]))))
