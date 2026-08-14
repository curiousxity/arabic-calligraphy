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
    """Binary mask of one glyph, plus the transforms to and from font units.

    Rendered into a RASTER x RASTER box sized from the glyph's own outline
    bounds plus a margin (see below — not a fixed em-relative box), filled
    by nonzero winding so counters stay holes. Returns (mask, to_font_units,
    to_px); to_px is exposed too so any other caller that needs to place
    something in the same pixel space (write_sheet's branch overlay) shares
    this function's one box derivation instead of re-deriving it — the
    previous, fixed-box version of this function had exactly two independent
    copies of that math, and only one of them got updated when the box
    changed.
    """
    import numpy as np
    from PIL import Image, ImageDraw
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.pens.basePen import BasePen

    glyph_set = tt.getGlyphSet()
    if glyph_name not in glyph_set:
        return None, None, None

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
        return None, None, None

    # Font units -> pixels, in a box sized from this glyph's own outline
    # rather than a fixed em-relative box. A fixed box (the original design
    # here) clips silently: Pillow just doesn't draw whatever falls outside
    # it, with no error, and several in-scope glyphs are bigger than the em
    # square in one direction or another — Urdu's kaf overflows a fixed
    # [-0.25, 1.25]*upm box by 0.65 em, several fonts' jeem/hah/khah/meem
    # descend past a fixed [-0.5, 1.0]*upm bottom, and a cluster of mark
    # glyphs (Amiri/uni0615 etc.) sit entirely outside such a box and would
    # silently produce an empty mask. Deriving the box from the actual
    # outline bounds makes that class of bug structurally impossible.
    all_pts = [p for c in pen.contours for p in c]
    minx = min(p[0] for p in all_pts)
    maxx = max(p[0] for p in all_pts)
    miny = min(p[1] for p in all_pts)
    maxy = max(p[1] for p in all_pts)

    # Margin sized relative to the glyph's own extent, not upm: a fixed
    # em-fraction margin would be tiny relative to a large flourish and huge
    # relative to a small dot. Without any margin the outline would run
    # flush to the raster edge, and medial_axis would read that clipped
    # edge as a straight boundary and pull the skeleton toward it exactly
    # as the fixed-box bug did — the margin exists to keep the glyph's own
    # ink away from the box edge, not to center it nicely.
    span = max(maxx - minx, maxy - miny, 1.0)
    margin = 0.15 * span
    x0, x1 = minx - margin, maxx + margin
    y0, y1 = miny - margin, maxy + margin
    # Pixels must be square (isotropic) or the medial-axis radius — a single
    # scalar read back through one `scale` — would mean different things on
    # each axis. Take the longer side and center the shorter axis within it
    # rather than stretching either axis independently.
    side = max(x1 - x0, y1 - y0)
    ox = x0 - (side - (x1 - x0)) / 2
    oy = y0 - (side - (y1 - y0)) / 2
    scale = RASTER / side

    def to_px(p):
        return ((p[0] - ox) * scale, RASTER - (p[1] - oy) * scale)

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
        # The box above is derived from these exact points plus a margin, so
        # this can't fail under normal operation — it's a guard against the
        # box-derivation logic silently regressing to clip again, not a
        # check expected to ever actually fire.
        for x, y in pts:
            assert -0.5 <= x <= RASTER + 0.5 and -0.5 <= y <= RASTER + 0.5, (
                f"{glyph_name}: outline point ({x:.1f}, {y:.1f}) falls outside "
                f"the {RASTER}px raster box — the per-glyph box derivation is "
                f"clipping again"
            )
        if len(pts) < 3:
            continue
        is_outer = (signed_area(contour) >= 0) == outer_positive
        draw.polygon(pts, fill=1 if is_outer else 0)

    mask = np.array(img, dtype=bool)

    def to_font_units(px, py, r_px):
        return ((px / scale) + ox, ((RASTER - py) / scale) + oy, r_px / scale)

    return mask, to_font_units, to_px


# Spurs shorter than this many nuqta are pruned as skeletonization noise
# rather than real strokes (teeth, serifs). 0.5 was the brief's starting
# point; checked by eye against TahaNaskhRegular's contact sheet and kept —
# raising it further started eating real short strokes (e.g. teeth) before
# it visibly reduced remaining spur clutter.
SPUR_PRUNE_NUQTA = 0.5


def glyph_branches(tt, glyph_name, upm, nuqta_units):
    """Pruned medial-axis branches for a glyph, in font units, y-up.

    Each branch is a list of (x, y, radius) triples. A branch is dropped
    only when it is a genuine spur: a degree-1 endpoint whose *other* end is
    a real junction (degree >= 3) on a larger structure, and shorter than
    SPUR_PRUNE_NUQTA nuqta. A connected component of the skeleton that has
    no junction at all — a closed ring (a dot's whole boundary) or a
    two-endpoint segment with no branch point — is never a spur candidate,
    because there is no larger structure for it to be a spur *of*; it IS
    its own entire structure. See the connected-components handling below
    for why this needs to be explicit rather than falling out of the walk.
    """
    import numpy as np
    from skimage.morphology import medial_axis

    mask, to_font_units, _ = glyph_mask(tt, glyph_name, upm)
    if mask is None or not mask.any():
        return []

    # medial_axis's thinning resolves pixel-level ties with an RNG; left
    # unseeded, the pinned skimage 0.24.0 measurably returns a different
    # skeleton on repeat calls against the *identical* mask (measured on
    # Amiri U+0629, five calls: skeleton pixel counts [315, 298, 350, 316,
    # 333], branch counts [4, 8, 8, 11, 8] — one run dropped an entire
    # 195px loop component outright). Task 3 commits this output as data
    # keyed by fontSha256, so an unchanged font regenerating to a different
    # table would be a real bug, and the eyeball pass in write_sheet would
    # not be reviewing what actually ships. rng=0 pins it deterministic;
    # don't remove this as if it were an unused/default argument.
    skel, dist = medial_axis(mask, return_distance=True, rng=0)
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

    # Connected components of the skeleton, found independently of the
    # node-driven walk below. This matters because a component with no
    # junction at all (every pixel degree <= 2 — a closed ring, or a lone
    # single pixel with degree 0) contains no node to start that walk from,
    # so without handling it here it contributes nothing to `branches` and
    # silently vanishes before pruning even runs — this is exactly what was
    # happening to dot glyphs whose medial axis comes out as a simple ring.
    components, unvisited = [], set(pixels)
    while unvisited:
        seed = next(iter(unvisited))
        comp, frontier = {seed}, [seed]
        unvisited.discard(seed)
        while frontier:
            p = frontier.pop()
            for n in neighbours(p):
                if n in unvisited:
                    unvisited.discard(n)
                    comp.add(n)
                    frontier.append(n)
        components.append(comp)

    def measure(path):
        pts = [to_font_units(px, py, float(dist[py, px])) for px, py in path]
        length = sum(((pts[i + 1][0] - pts[i][0]) ** 2 + (pts[i + 1][1] - pts[i][1]) ** 2) ** 0.5
                     for i in range(len(pts) - 1))
        return pts, length

    min_len = SPUR_PRUNE_NUQTA * nuqta_units
    out, seen = [], set()
    for comp in components:
        if len(comp) == 1:
            # A lone pixel has degree 0, which *is* != 2, so it would
            # otherwise land in comp_nodes as a "node" with no neighbours
            # to walk to — producing zero branches from a walk that only
            # starts at nodes and follows edges. Handle it directly rather
            # than let it fall through the node-walk logic and vanish.
            pts, _ = measure(list(comp))
            out.append(pts)
            continue

        comp_nodes = comp & nodes
        if not comp_nodes:
            # Every pixel here has degree exactly 2: a closed loop with no
            # junction. This is not only a dot's own thin boundary ring —
            # skimage's medial_axis of a solid filled circular glyph (e.g.
            # sukun, or the Arabic-Indic digit for 5, both drawn as filled
            # discs) collapses to a *loop* of tied-distance ridge pixels
            # around the center, not a single point, because real glyph
            # outlines are never perfectly circular. A graph where every
            # vertex has degree 2 is structurally a single cycle, so it has
            # a well-defined connected order — but that order is adjacency,
            # not a Python set's iteration order. Using `list(comp)`
            # directly (the first version of this fix) discarded adjacency
            # and produced a scrambled point sequence whose straight
            # segments crisscrossed the loop's interior, which is exactly
            # what showed up on the review sheet as a solid red-filled
            # blob instead of a thin ring outline. Walk it properly instead.
            start = next(iter(comp))
            path, prev, cur = [start], start, neighbours(start)[0]
            while cur != start:
                path.append(cur)
                nxt = [n for n in neighbours(cur) if n != prev]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
            pts, _ = measure(path)
            out.append(pts)
            continue

        comp_branches = []
        for start in comp_nodes:
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
                comp_branches.append(path)

        kept = []
        for path in comp_branches:
            d0, d1 = degree.get(path[0], 0), degree.get(path[-1], 0)
            is_spur = (d0 == 1 and d1 >= 3) or (d1 == 1 and d0 >= 3)
            _, length = measure(path)
            if is_spur and length < min_len:
                continue
            kept.append(path)

        # A component made only of short junction-to-leaf branches (e.g. an
        # odd tiny 3-way dot) could in principle still prune to nothing even
        # under the refined rule above. Never let a component that had at
        # least one branch end up with zero — keep its single longest one.
        if comp_branches and not kept:
            kept = [max(comp_branches, key=lambda p: measure(p)[1])]

        for path in kept:
            pts, _ = measure(path)
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
        mask, _, to_px = glyph_mask(tt, name, upm)
        if mask is None:
            continue
        cx, cy = (i % cols) * cell, (i // cols) * cell
        thumb = Image.fromarray((~mask * 255).astype("uint8")).resize((cell, cell))
        sheet.paste(thumb.convert("RGB"), (cx, cy))
        # Each glyph has its own box (see glyph_mask), so the branch overlay
        # must go through *this* glyph's own to_px rather than a formula
        # hardcoded for the old, single, fixed box — that mismatch is
        # exactly what silently misaligned this overlay before.
        cell_scale = cell / RASTER
        for branch in glyph_branches(tt, name, upm, nuqta_units):
            pts = [(cx + px * cell_scale, cy + py * cell_scale)
                   for x, y, _ in branch
                   for px, py in [to_px((x, y))]]
            if len(pts) > 1:
                draw.line(pts, fill=(200, 40, 40), width=1)
            elif len(pts) == 1:
                # A dot's whole medial axis can collapse to one point (a
                # single-pixel skeleton, or a ring so small it rasterizes to
                # one). draw.line drops these silently; mark them so a dot
                # is visible on the sheet at all rather than reading as
                # "no branch found here".
                px, py = pts[0]
                r = 1.5
                draw.ellipse((px - r, py - r, px + r, py + r), fill=(200, 40, 40))
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
