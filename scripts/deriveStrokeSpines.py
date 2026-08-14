#!/usr/bin/env python3
"""Derive each font's stroke spines by matching the stroke schema's skeleton
against the real glyph's medial axis.

Replaces the proportional bounding-box mapping in
src/lib/strokeSchema/schemaGeometry.ts, which Phase C measured at median 0.37
nuqta / p90 1.43 from real ink, with only 14.5% of mapped nodes landing inside
the ink at all. See
docs/superpowers/specs/2026-08-13-stroke-spine-reanchoring-design.md.

Usage:
    python3 scripts/deriveStrokeSpines.py                  # every in-scope font
    python3 scripts/deriveStrokeSpines.py TahaNaskhRegular # one font
    python3 scripts/deriveStrokeSpines.py --sheets         # also write overlay PNGs

Requires: pip install fonttools numpy Pillow scikit-image scipy
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "public" / "fonts"
OUT_DIR = ROOT / "src" / "data" / "strokeSpines"
NUQTA_TS = ROOT / "src" / "lib" / "nuqta.ts"


def in_scope_fonts() -> dict[str, float]:
    """Font family -> nuqta/em ratio, read from the one measured table.

    A font absent from NUQTA_EM_RATIO is out of scope by design (Ruqaa,
    HarfCanvasDiwani) — and cannot be processed anyway, since the nuqta is the
    unit both the pruning threshold and the length gate are expressed in.
    """
    src = NUQTA_TS.read_text(encoding="utf-8")
    body = src.split("NUQTA_EM_RATIO", 1)[1].split("{", 1)[1].split("}", 1)[0]
    ratios = {m.group(1): float(m.group(2))
              for m in re.finditer(r"(\w+)\s*:\s*([0-9.]+)", body)}
    if not ratios:
        sys.exit("Could not parse NUQTA_EM_RATIO from src/lib/nuqta.ts")
    return ratios


def font_path(family: str) -> Path:
    for ext in (".ttf", ".otf"):
        p = FONT_DIR / f"{family}{ext}"
        if p.exists():
            return p
    sys.exit(f"No font file for {family} in {FONT_DIR}")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


RASTER = 512  # px across the em square


def glyph_mask(tt, glyph_name, upm):
    """Binary mask of one glyph, plus the transform back to font units.

    Rendered into a RASTER x RASTER box covering the em square with a margin,
    filled by nonzero winding so counters stay holes.
    """
    import numpy as np
    from PIL import Image, ImageDraw
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.pens.basePen import BasePen

    glyph_set = tt.getGlyphSet()
    if glyph_name not in glyph_set:
        return None, None

    class FlattenPen(BasePen):
        def __init__(self, gs):
            super().__init__(gs)
            self.contours = []
            self._cur = []

        def _moveTo(self, pt):
            if self._cur:
                self.contours.append(self._cur)
            self._cur = [pt]

        def _lineTo(self, pt):
            self._cur.append(pt)

        def _curveToOne(self, p1, p2, p3):
            p0 = self._cur[-1]
            for i in range(1, 9):
                t = i / 8
                u = 1 - t
                self._cur.append((
                    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
                    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
                ))

        def _closePath(self):
            if self._cur:
                self.contours.append(self._cur)
                self._cur = []

    rec = DecomposingRecordingPen(glyph_set)
    glyph_set[glyph_name].draw(rec)
    pen = FlattenPen(glyph_set)
    rec.replay(pen)
    if pen._cur:
        pen.contours.append(pen._cur)
    if not pen.contours:
        return None, None

    # Font units -> pixels. Origin at (0, -0.25*upm) so descenders fit.
    scale = RASTER / (upm * 1.5)
    ox, oy = 0.25 * upm, 0.5 * upm

    def to_px(p):
        return ((p[0] + ox) * scale, RASTER - (p[1] + oy) * scale)

    img = Image.new("1", (RASTER, RASTER), 0)
    draw = ImageDraw.Draw(img)

    # Pillow has no nonzero-winding fill, so draw outer contours filled and
    # re-draw counters as holes. Contour direction decides which is which —
    # but *which* sign means "outer" is not one constant across this font
    # library: measured directly (single-contour, no-counter letters like
    # alif), 13 of the 15 in-scope fonts are ordinary TrueType glyf outlines
    # where negative signed area is outer, matching the spec's clockwise-
    # outer convention. AlFatemi is CFF-flavoured (opposite, PostScript
    # convention: positive is outer) and Qahiri's glyf outlines are wound
    # backwards from the TrueType norm (also positive-outer) — most likely
    # an artifact of whatever tool built it, not a spec violation on our
    # part to work around. Hardcoding either sign silently produces an
    # empty mask for the other convention's fonts (verified: it did, for
    # Qahiri). Instead, a hole is by definition smaller than the outer
    # contour that contains it, so the glyph's own largest contour anchors
    # which sign counts as "outer" for that glyph, and every contour is
    # judged relative to it — self-correcting per font and per glyph, with
    # no format sniffing required.
    def signed_area(c):
        return sum((c[i][0] * c[(i + 1) % len(c)][1] - c[(i + 1) % len(c)][0] * c[i][1])
                   for i in range(len(c))) / 2

    ordered = sorted(pen.contours, key=lambda c: -abs(signed_area(c)))
    outer_positive = signed_area(ordered[0]) >= 0
    for contour in ordered:
        pts = [to_px(p) for p in contour]
        if len(pts) < 3:
            continue
        is_outer = (signed_area(contour) >= 0) == outer_positive
        draw.polygon(pts, fill=1 if is_outer else 0)

    mask = np.array(img, dtype=bool)

    def to_font_units(px, py, r_px):
        return ((px / scale) - ox, ((RASTER - py) / scale) - oy, r_px / scale)

    return mask, to_font_units


# Spurs shorter than this many nuqta are pruned as skeletonization noise
# rather than real strokes (teeth, serifs). 0.5 was the brief's starting
# point; checked by eye against TahaNaskhRegular's contact sheet and kept —
# raising it further started eating real short strokes (e.g. teeth) before
# it visibly reduced remaining spur clutter.
SPUR_PRUNE_NUQTA = 0.5


def glyph_branches(tt, glyph_name, upm, nuqta_units):
    """Pruned medial-axis branches for a glyph, in font units, y-up.

    Each branch is a list of (x, y, radius) triples. Spurs shorter than
    SPUR_PRUNE_NUQTA nuqta are dropped — the threshold is in the letterform's
    own unit, which is why NUQTA_EM_RATIO is a prerequisite rather than a
    nicety.
    """
    import numpy as np
    from skimage.morphology import medial_axis

    mask, to_font_units = glyph_mask(tt, glyph_name, upm)
    if mask is None or not mask.any():
        return []

    skel, dist = medial_axis(mask, return_distance=True)
    ys, xs = np.nonzero(skel)
    if len(xs) == 0:
        return []

    pixels = set(zip(xs.tolist(), ys.tolist()))

    def neighbours(p):
        x, y = p
        return [(x + dx, y + dy)
                for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                if (dx or dy) and (x + dx, y + dy) in pixels]

    degree = {p: len(neighbours(p)) for p in pixels}
    nodes = {p for p, d in degree.items() if d != 2}

    branches, seen = [], set()
    for start in nodes:
        for first in neighbours(start):
            if (start, first) in seen:
                continue
            path, prev, cur = [start], start, first
            while True:
                path.append(cur)
                if cur in nodes:
                    break
                nxt = [n for n in neighbours(cur) if n != prev]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
            seen.add((start, first))
            seen.add((path[-1], path[-2]))
            branches.append(path)

    # An unbranched blob (a dot) yields no degree!=2 pixel at all; take its
    # whole ring as one branch rather than losing it.
    if not branches and pixels:
        branches = [list(pixels)]

    min_len = SPUR_PRUNE_NUQTA * nuqta_units
    out = []
    for path in branches:
        pts = [to_font_units(px, py, float(dist[py, px])) for px, py in path]
        length = sum(((pts[i + 1][0] - pts[i][0]) ** 2 + (pts[i + 1][1] - pts[i][1]) ** 2) ** 0.5
                     for i in range(len(pts) - 1))
        is_spur = degree.get(path[0], 0) == 1 or degree.get(path[-1], 0) == 1
        if is_spur and length < min_len:
            continue
        out.append(pts)
    return out


def write_sheet(tt, family, upm, nuqta_units, glyph_names):
    """One PNG per font: each glyph filled grey with its branches drawn on top.

    This is the eyeball pass. The nuqta table was accepted the same way, and
    two fonts were dropped on the strength of it.
    """
    from PIL import Image, ImageDraw
    cols, cell = 8, 128
    rows = (len(glyph_names) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * cell), (250, 248, 240))
    draw = ImageDraw.Draw(sheet)
    for i, name in enumerate(glyph_names):
        mask, _ = glyph_mask(tt, name, upm)
        if mask is None:
            continue
        cx, cy = (i % cols) * cell, (i // cols) * cell
        thumb = Image.fromarray((~mask * 255).astype("uint8")).resize((cell, cell))
        sheet.paste(thumb.convert("RGB"), (cx, cy))
        for branch in glyph_branches(tt, name, upm, nuqta_units):
            pts = [(cx + cell * (x + 0.25 * upm) / (upm * 1.5),
                    cy + cell * (1 - (y + 0.5 * upm) / (upm * 1.5)))
                   for x, y, _ in branch]
            if len(pts) > 1:
                draw.line(pts, fill=(200, 40, 40), width=1)
    out = OUT_DIR / f"{family}-sheet.png"
    sheet.save(out)
    print(f"    sheet -> {out.relative_to(ROOT)}")


def build_table(family: str, ratio: float, sheets: bool) -> dict:
    from fontTools.ttLib import TTFont
    path = font_path(family)
    tt = TTFont(path, fontNumber=0, lazy=True)
    # Kufi2.ttf and NotoSans.ttf are variable fonts whose gvar glyph count
    # disagrees with maxp; fontTools throws on getGlyphSet() until gvar is
    # dropped. Harmless to the app's own rendering path.
    if "gvar" in tt:
        del tt["gvar"]
    upm = tt["head"].unitsPerEm
    nuqta_units = ratio * upm
    if sheets:
        # Task 3 will hand write_sheet the glyphs the schema matcher actually
        # processed; until then, the font's own cmap-encoded Arabic-range
        # glyphs (base letterforms, no contextual GSUB variants) are the
        # closest stand-in and are what this task's eyeball check reviewed.
        cmap = tt.getBestCmap()
        glyph_names = [name for cp, name in sorted(cmap.items())
                       if 0x0600 <= cp <= 0x06FF]
        write_sheet(tt, family, upm, nuqta_units, glyph_names)
    return {
        "font": family,
        "unitsPerEm": upm,
        "fontSha256": sha256(path),
        "glyphs": {},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("fonts", nargs="*")
    ap.add_argument("--sheets", action="store_true")
    args = ap.parse_args()

    ratios = in_scope_fonts()
    families = args.fonts or sorted(ratios)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for family in families:
        if family not in ratios:
            print(f"  skip {family}: no measured nuqta, out of scope")
            continue
        table = build_table(family, ratios[family], args.sheets)
        out = OUT_DIR / f"{family}.json"
        out.write_text(json.dumps(table, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"  {family}: {len(table['glyphs'])} glyphs -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
