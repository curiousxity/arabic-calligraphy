"""Map, trace and lay out one row image in one go.
usage: python -I -X utf8 scripts/marks/thuluth/autoSheet.py KEY IMAGE OUT_DIR

Runs mapSheet.py in parts mode (writing drafts/KEY.json and
sheetmaps/KEY-numbered.png), traces every part with tracePieces.py, and
writes OUT_DIR/KEY-review.png: each part's source, cleaned pixels and trace."""
import sys, os, json, subprocess
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
key, image, out_dir = sys.argv[1:4]
py = [sys.executable, "-I", "-X", "utf8"]
os.makedirs(os.path.join(HERE, "sheetmaps"), exist_ok=True)
subprocess.run(py + [os.path.join(HERE, "mapSheet.py"), image,
                     os.path.join(HERE, "sheetmaps", key + "-numbered.png"), "parts", key], check=True)
with open(os.path.join(HERE, "drafts", key + ".json"), encoding="utf-8") as fh:
    nums = list(json.load(fh)["units"])
subprocess.run(py + [os.path.join(HERE, "tracePieces.py"), REPO, key, out_dir] + nums, check=True)
files = [os.path.join(out_dir, f"{key}-{n}.png") for n in nums]
files = [f for f in files if os.path.exists(f)]
ims = [Image.open(f).convert("RGB") for f in files]
ims = [im.resize((max(1, int(im.width * 240 / im.height)), 240)) for im in ims]
font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 26)
page = Image.new("RGB", (max(im.width for im in ims) + 70, 250 * len(ims)), "white")
d = ImageDraw.Draw(page)
for i, (f, im) in enumerate(zip(files, ims)):
    page.paste(im, (70, i * 250)); d.text((4, i * 250 + 100), f.rsplit("-", 1)[1][:-4], fill=(0, 0, 200), font=font)
page.save(os.path.join(out_dir, key + "-review.png"))
