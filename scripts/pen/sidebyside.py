"""A labelled side-by-side: our ink (scripts/pen/ink.mjs) beside the reference's pieces, at one scale.

    python -I -X utf8 scripts/pen/sidebyside.py OURS.json REF.json REF_PX_PER_NUQTA OUT.png "title" [REF_BASELINE_Y] [OVERLAY.png]

REF.json is a list of [[a, d, e, f], "svg d"] pieces in screen px (ribbon.py's form). Both are drawn at
PX px to the nuqta, ours on the left, the reference on the right, each on its own line, under a title with
the date and how closely the two outlines agree once laid over each other (overlap: shared ink over all ink,
the two aligned where they agree best, within a fifth of a nuqta of their line and their ink's centre). Used for every entry in
docs/calligraphy/comparisons/; see docs/calligraphy/stroke-ledger.md."""
import datetime, json, os, sys
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pieces import ref_ring  # noqa: E402

PX = 60
MARGIN = 40
PAPER, INK = (246, 240, 228), (66, 52, 40)


def font(size):
    for f in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def mask(rings, origin, size, union=False):
    """Our rings are one outline with holes (counters), so they alternate; the reference's are overlapping pieces,
    so they add up."""
    m = np.zeros((size[1], size[0]), np.uint8)
    for r in rings:
        layer = np.zeros_like(m)
        cv2.fillPoly(layer, [np.round((np.asarray(r) - origin) * 16).astype(np.int32)], 1, cv2.LINE_AA, 4)
        m = (m | layer) if union else (m ^ layer)
    return m


def panel(rings, base_y, union=False):
    """Rings in output px (y down); returns the image and where the line falls in it."""
    pts = np.concatenate([np.asarray(r) for r in rings])
    x1, y1 = pts.min(0) - MARGIN
    x2, y2 = pts.max(0) + MARGIN
    size = (int(x2 - x1), int(y2 - y1))
    m = mask(rings, np.array([x1, y1]), size, union)
    img = np.full((size[1], size[0], 3), PAPER, np.uint8)
    img[m > 0] = INK
    return img, m, int(base_y - y1), np.array([x1, y1])


def main():
    ours_f, ref_f, ref_ppn, out, title = sys.argv[1:6]
    ref_base = float(sys.argv[6]) if len(sys.argv) > 6 else None
    overlay = sys.argv[7] if len(sys.argv) > 7 else None
    ours = json.load(open(ours_f, encoding="utf-8"))
    k = PX / ours["nuqta"]
    our_rings = [np.asarray(r) * k for r in ours["rings"]]
    ref = json.load(open(ref_f, encoding="utf-8"))
    s = PX / float(ref_ppn)
    ref_rings = [ref_ring(p) * s for p in ref]
    a, am, ab, _ = panel(our_rings, 0.0)
    b, bm, bb, _ = panel(ref_rings, (ref_base if ref_base is not None else max(r[:, 1].max() for r in ref_rings) / s) * s, union=True)
    # overlap: lay the two on one line and one ink centre
    H = max(am.shape[0], bm.shape[0]) + 2 * max(ab, bb)
    W = max(am.shape[1], bm.shape[1]) * 2
    def place(m, base):
        ys, xs = np.nonzero(m)
        out = np.zeros((H, W), np.uint8)
        dy, dx = H // 2 - base, W // 2 - int(xs.mean())
        out[ys + dy, xs + dx] = 1
        return out
    A, B = place(am, ab), place(bm, bb)
    # then the shift, within a fifth of a nuqta, at which they agree best: the ink's centre is only a first guess
    def iou_at(dx, dy):
        Bs = np.roll(np.roll(B, dy, 0), dx, 1)
        return (A & Bs).sum() / max(1, (A | Bs).sum())
    reach, best = int(PX * 0.2), (0.0, 0, 0)
    for dy in range(-reach, reach + 1, 3):
        for dx in range(-reach, reach + 1, 3):
            best = max(best, (iou_at(dx, dy), dx, dy))
    for dy in range(best[2] - 2, best[2] + 3):
        for dx in range(best[1] - 2, best[1] + 3):
            best = max(best, (iou_at(dx, dy), dx, dy))
    iou = best[0]
    if overlay:
        # ours over the reference at that shift: dark where both, blue ours only, orange the reference's only
        Bs = np.roll(np.roll(B, best[2], 0), best[1], 1)
        ys, xs = np.nonzero(A | Bs)
        crop = (slice(ys.min() - 10, ys.max() + 10), slice(xs.min() - 10, xs.max() + 10))
        o = np.full(A.shape + (3,), 245, np.uint8)
        o[Bs > 0] = (240, 170, 90); o[A > 0] = (60, 140, 220); o[(A & Bs) > 0] = (60, 60, 60)
        Image.fromarray(o[crop]).save(overlay)
    # side by side, each on the line
    top = max(ab, bb)
    h = top + max(am.shape[0] - ab, bm.shape[0] - bb)
    canvas = Image.new("RGB", (am.shape[1] + bm.shape[1] + 30, h + 90), (255, 255, 255))
    canvas.paste(Image.fromarray(a), (0, 90 + top - ab))
    canvas.paste(Image.fromarray(b), (am.shape[1] + 30, 90 + top - bb))
    d = ImageDraw.Draw(canvas)
    d.text((12, 8), title, fill=(30, 30, 30), font=font(26))
    d.text((12, 42), f"{datetime.date.today().isoformat()}   overlap {iou:.2f}", fill=(90, 90, 90), font=font(18))
    d.text((12, 66), "HarfCanvas (ours)", fill=(160, 0, 0), font=font(18))
    d.text((am.shape[1] + 42, 66), "Studio reference", fill=(160, 0, 0), font=font(18))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    canvas.save(out)
    print(out, canvas.size, "overlap %.3f" % iou)


if __name__ == "__main__":
    main()
