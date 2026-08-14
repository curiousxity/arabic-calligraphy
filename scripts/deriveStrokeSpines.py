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

Requires: pip install fonttools numpy Pillow scikit-image scipy uharfbuzz
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
SCHEMA_DIR = ROOT / "src" / "data" / "strokeSchemas"


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


def _hb_font(path: Path):
    """One HarfBuzz font per font file, for resolving which glyph gets drawn."""
    import uharfbuzz as hb

    return hb.Font(hb.Face(path.read_bytes()))


RASTER = 512  # px across the em square


def flatten_glyph(tt, glyph_name):
    """This glyph's contours, flattened to line segments, in font units.

    Extracted so both `glyph_mask` (rasterizing for skeletonization) and
    `glyph_bbox_font_units` (the real-glyph box `seed_box` maps onto) read
    the identical outline instead of risking two independent flattens
    disagreeing at the margin.
    """
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.pens.basePen import BasePen

    glyph_set = tt.getGlyphSet()
    if glyph_name not in glyph_set:
        return []

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
    return pen.contours


def glyph_bbox_font_units(tt, glyph_name):
    """This glyph's own ink bounding box, in font units — the REAL box
    `seed_box` (see `make_seed_box`) maps a schema stroke's proportional
    position onto. `None` for an empty/missing glyph."""
    contours = flatten_glyph(tt, glyph_name)
    if not contours:
        return None
    all_pts = [p for c in contours for p in c]
    return (
        min(p[0] for p in all_pts), min(p[1] for p in all_pts),
        max(p[0] for p in all_pts), max(p[1] for p in all_pts),
    )


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

    contours = flatten_glyph(tt, glyph_name)
    if not contours:
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
    all_pts = [p for c in contours for p in c]
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

    ordered = sorted(contours, key=lambda c: -abs(signed_area(c)))
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


# ---------------------------------------------------------------------------
# Schema loading and glyph-name lookup
# ---------------------------------------------------------------------------

def load_schemas():
    """(unicodeHex, joiningForm) -> schema dict, mirroring strokeSchema/registry.ts.

    Ligatures (baseLetterSequence, no unicode) are skipped: matching a fused
    multi-letter outline is not what this pass is for, and the registry keys
    them differently.
    """
    out = {}
    for path in sorted(SCHEMA_DIR.glob("*.json")):
        desc = json.loads(path.read_text(encoding="utf-8"))
        g = desc.get("glyph", {})
        if g.get("baseLetterSequence") or not g.get("unicode"):
            continue
        out[(g["unicode"].upper(), g["joiningForm"])] = desc
    return out


# Every dual-joining letter, i.e. every letter that can sit on either side of
# a target letter and keep the cursive join — the same classification the app
# applies at runtime (DUAL_JOINING in src/lib/arabicJoining.ts), including
# tatweel and the Persian/Urdu extensions, since this repo ships fonts for
# those too. This is the neighbour set the contexts below are built from: a
# letter's joining form is not one glyph, and which variant a font draws
# depends on what it is joined to.
JOINING_NEIGHBOURS = [
    0x0626, 0x0628, 0x062A, 0x062B, 0x062C, 0x062D, 0x062E, 0x0633, 0x0634,
    0x0635, 0x0636, 0x0637, 0x0638, 0x0639, 0x063A, 0x0640, 0x0641, 0x0642,
    0x0643, 0x0644, 0x0645, 0x0646, 0x0647, 0x064A,
    0x0679, 0x067E, 0x0686, 0x06A9, 0x06AF, 0x06CC,
]


def shaped_base_glyph(hb_font, text, cluster):
    """The one base glyph HarfBuzz emits for `cluster` of `text`, or None.

    Shaped exactly as the app shapes (RTL, `arab`, `ar` — see
    src/lib/harfbuzz.ts), so the glyph id this returns is by construction the
    glyph the app will draw.

    Zero-advance glyphs sharing the cluster are the font's separately
    positioned marks and nuqat — Kufi2 decomposes its dots this way — and are
    not the letter's body. This is the same advance test `lib/joinPins.ts`
    uses to separate a real mark from a base letter, for the same reason.

    None, never a guess, when the cluster carries no such glyph (the font
    fused these letters into a ligature belonging to another cluster) or more
    than one: absence is this subsystem's mechanism for a match that cannot
    be verified.
    """
    import uharfbuzz as hb

    buf = hb.Buffer()
    buf.add_str(text)
    buf.direction = "rtl"
    buf.script = "arab"
    buf.language = "ar"
    hb.shape(hb_font, buf)
    hits = [
        info.codepoint
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions)
        if info.cluster == cluster and pos.x_advance != 0
    ]
    return hits[0] if len(hits) == 1 else None


def shaped_glyph_names(hb_font, tt, unicode_hex, form):
    """Every glyph name real shaping can produce for this letter in this form.

    This replaces a hand-rolled GSUB walk (cmap for the base, then the single
    substitution under `isol`/`init`/`medi`/`fina`) that diverged from
    HarfBuzz in two ways, leaving 46 of 401 shipped spines filed under glyph
    ids no shaping ever emits — dead data indistinguishable, from the app's
    side, from a stroke the gates rejected:

    - It stopped at the form feature, missing substitutions applied
      afterwards. Amiri's `fina` gives ra glyph 1830, and a chained
      contextual rule then turns that into 3455, which is what gets drawn.
    - It never applied `isol` at all, returning the bare cmap glyph. Kufi2
      has an explicit `isol`, so every one of its ten entries was dead.

    Asking the shaper cannot drift from the app the way a reimplementation
    can. It also exposes what the walk could not represent: one form is not
    one glyph. Amiri draws seven distinct ra-finals depending on the letter
    before it, each a different outline needing its own measured spine. All
    of them are returned — the table is keyed by glyph id, so each is
    matched against its own ink — in a deterministic order fixed by
    JOINING_NEIGHBOURS.
    """
    ch = chr(int(unicode_hex, 16))
    order = tt.getGlyphOrder()

    if form == "isolated":
        contexts = [(ch, 0)]
    elif form == "initial":
        contexts = [(ch + chr(n), 0) for n in JOINING_NEIGHBOURS]
    elif form == "final":
        contexts = [(chr(n) + ch, 1) for n in JOINING_NEIGHBOURS]
    elif form == "medial":
        contexts = [(chr(n) + ch + chr(n), 1) for n in JOINING_NEIGHBOURS]
    else:
        return []

    names = []
    for text, cluster in contexts:
        gid = shaped_base_glyph(hb_font, text, cluster)
        if gid is None or gid >= len(order):
            continue
        name = order[gid]
        if name not in names:
            names.append(name)
    return names


# ---------------------------------------------------------------------------
# Matching and zone sampling
# ---------------------------------------------------------------------------

def point_distance(p, q):
    return ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) ** 0.5


def polyline_length(pts):
    return sum(((pts[i + 1][0] - pts[i][0]) ** 2 + (pts[i + 1][1] - pts[i][1]) ** 2) ** 0.5
               for i in range(len(pts) - 1))


def arc_slice(pts, t0, t1):
    """The sub-polyline between two arc-length proportions of `pts`."""
    total = polyline_length(pts)
    if total <= 0:
        return pts[:1] * 2
    want0, want1 = t0 * total, t1 * total
    out, acc = [], 0.0
    for i in range(len(pts) - 1):
        seg = ((pts[i + 1][0] - pts[i][0]) ** 2 + (pts[i + 1][1] - pts[i][1]) ** 2) ** 0.5
        for want in (want0, want1):
            if acc <= want <= acc + seg and seg > 0:
                f = (want - acc) / seg
                out.append(tuple(pts[i][k] + (pts[i + 1][k] - pts[i][k]) * f for k in range(3)))
        if want0 < acc + seg and acc < want1:
            out.append(pts[i + 1])
        acc += seg
    return out if len(out) >= 2 else [pts[0], pts[-1]]


def compute_node_bbox(desc):
    """Python port of schemaGeometry.ts's `computeNodeBoundingBox`: bounding
    box of every stroke's authored node coordinates across all components, in
    the schema's own baseline-up convention."""
    xs = [n["x"] for c in desc["glyph"]["components"] for s in c["strokes"] for n in s["path"]["nodes"]]
    ys = [n["y"] for c in desc["glyph"]["components"] for s in c["strokes"] for n in s["path"]["nodes"]]
    if not xs:
        return (0.0, 0.0, 1.0, 1.0)
    return (min(xs), min(ys), max(xs), max(ys))


def make_seed_mapper(desc, real_bbox):
    """Builds a `map_point(x, y) -> (x, y)` function: the Python equivalent of
    the app's `mapNormToRealBox` (schemaGeometry.ts) for a single schema-space
    point. Normalizes against the schema's whole-glyph node bbox
    (`compute_node_bbox`), then maps that 0-1 proportion onto the REAL
    glyph's own ink bounding box (`real_bbox`, from `glyph_bbox_font_units`).

    This is a weak hint — used only to rank match candidates in
    `match_strokes` (via `make_seed_box`, below) and, since fix round 1, to
    canonicalise which end of a matched branch is which (via
    `canonicalize_branch_orientation`) — never a gate, and deliberately the
    same proportional mapping this project exists to replace; see the module
    docstring / CLAUDE.md for why it must never leak into shipped geometry.

    Both the schema's node space and `real_bbox` are y-up (baseline-up
    schema convention; font-unit outline convention), so — unlike
    `mapNormToRealBox`'s screen-space (y-down) counterpart — no Y flip is
    applied here. Checked against `glyph_branches`' own y-up output rather
    than assumed.
    """
    sx0, sy0, sx1, sy1 = compute_node_bbox(desc)
    sw, sh = max(sx1 - sx0, 1e-6), max(sy1 - sy0, 1e-6)
    rx0, ry0, rx1, ry1 = real_bbox
    rw, rh = rx1 - rx0, ry1 - ry0

    def map_point(x, y):
        nx = (x - sx0) / sw
        ny = (y - sy0) / sh
        return (rx0 + nx * rw, ry0 + ny * rh)

    return map_point


def make_seed_box(desc, real_bbox):
    """Builds a `seed_box(nodes) -> (x, y)` function on top of
    `make_seed_mapper`, mapping a stroke's own node span's midpoint
    (`nodes[0]`/`nodes[-1]` averaged) rather than a single point — this is
    the ranking hint `match_strokes` uses to pick a candidate branch."""
    map_point = make_seed_mapper(desc, real_bbox)

    def seed_box(nodes):
        mx = (nodes[0]["x"] + nodes[-1]["x"]) / 2
        my = (nodes[0]["y"] + nodes[-1]["y"]) / 2
        return map_point(mx, my)

    return seed_box


def node_t_values(nodes):
    """Arc-length proportion (0-1) of each node along its own stroke's
    authored node polyline (schema coordinates) — used to translate a zone's
    fromNode/toNode indices into arc-length proportions on the *matched real
    branch*, on the assumption that the schema author's node spacing along a
    stroke corresponds proportionally to the real glyph's stroke geometry.
    """
    pts = [(n["x"], n["y"], 0.0) for n in nodes]
    total = polyline_length(pts)
    if total <= 0:
        return [0.0] * len(nodes)
    ts, acc = [0.0], 0.0
    for i in range(len(pts) - 1):
        acc += ((pts[i + 1][0] - pts[i][0]) ** 2 + (pts[i + 1][1] - pts[i][1]) ** 2) ** 0.5
        ts.append(acc / total)
    return ts


# Fix round 1, CRITICAL 1. `glyph_branches`' skeleton walk gives each branch
# an arbitrary direction — nothing about it is tied to which end corresponds
# to the schema stroke's fromNode vs toNode. `arc_slice` always slices from a
# polyline's own start, so a branch matched "backwards" relative to the
# stroke's authored direction ships a spine that is either reversed in full
# (a StrokeSpine.points contract violation) or, for a zone that covers only
# part of the stroke, sliced from the WRONG END entirely (a real geometry
# error, up to 3+ nuqta off — worse than the mapping this project replaces).
# The old `if t0 > t1: reverse` handling in build_table only ever keys on
# schema node index order (never descending in any authored zone) and cannot
# see this at all. The fix is to canonicalise the BRANCH's orientation once
# per matched stroke, before any zone slicing, using the same weak
# proportional seed mapping `make_seed_box` already relies on to rank
# candidates — here to decide, not to guess geometry.
ORIENTATION_AMBIGUOUS_NUQTA = 0.5

# Task 4 fix round, the partial-zone reversal. The endpoint rule below is a
# comparison of TWO DISTANCES TO ONE POINT, which is only a direction test
# when the stroke actually travels away from its own fromNode. It is not one
# for a stroke that doubles back — a CUP/EYE bowl (jeem, hah, khah, fa, qaf)
# curls round so both of its ends sit near the same side of the glyph, and
# there the comparison is decided by whichever end the mapping's own error
# happens to favour. Measured: it was confidently wrong, with margins of
# 1.7-3.6 nuqta, on exactly those letters across five unrelated fonts.
#
# The second estimator is a rank vote over ALL of the stroke's nodes, not two
# of them: map every node, project each onto the branch, and ask whether the
# projections advance along the branch in the same order the schema authored
# the nodes in (Kendall tau over every node pair). A rank statistic ignores
# how far off each individual node landed and reads only their order, which
# is what survives the mapping's median-0.37/p90-1.43-nuqta error; and a
# doubling-back stroke, which defeats the endpoint rule outright, is exactly
# the case it reads best, since its nodes sweep the whole arc.
#
# The two are combined as an AGREEMENT REQUIREMENT, never as a tiebreak: a
# stroke ships only when both estimators independently pick the same
# direction. Disagreement, and a vote too tied to have an opinion, are both
# drops — the vote is not permitted to overrule the endpoint rule and orient
# a branch by itself, because that would be substituting one mapping-derived
# guess for another rather than verifying anything.
ORIENTATION_VOTE_MIN_TAU = 0.0


def nearest_arc_t(branch, q):
    """Arc-length proportion (0-1) along `branch` of the point on it nearest
    to `q` — the projection the orientation vote ranks."""
    total = polyline_length(branch)
    best_t, best_d, acc = 0.0, float("inf"), 0.0
    for i in range(len(branch) - 1):
        ax, ay = branch[i][0], branch[i][1]
        vx, vy = branch[i + 1][0] - ax, branch[i + 1][1] - ay
        seg = (vx * vx + vy * vy) ** 0.5
        if seg <= 0:
            continue
        u = max(0.0, min(1.0, ((q[0] - ax) * vx + (q[1] - ay) * vy) / (seg * seg)))
        d = ((ax + u * vx - q[0]) ** 2 + (ay + u * vy - q[1]) ** 2) ** 0.5
        if d < best_d:
            best_d, best_t = d, (acc + u * seg) / max(total, 1e-9)
        acc += seg
    return best_t


def kendall_tau(seq):
    """(concordant - discordant) / total pairs. +1 = strictly increasing,
    -1 = strictly decreasing, 0 = no majority either way (which includes the
    degenerate case of every value being equal)."""
    concordant = discordant = 0
    for i in range(len(seq)):
        for j in range(i + 1, len(seq)):
            if seq[j] > seq[i]:
                concordant += 1
            elif seq[j] < seq[i]:
                discordant += 1
    total = concordant + discordant
    return (concordant - discordant) / total if total else 0.0


def orientation_vote_tau(branch, stroke, map_point):
    """Kendall tau of the stroke's mapped nodes' projections onto the RAW
    branch, in authored node order. Positive means the branch as given runs
    fromNode-to-toNode; negative means it runs backwards. Computed on the raw
    branch so its sign is directly comparable with the endpoint rule's own
    `d_start < d_end`."""
    nodes = stroke["path"]["nodes"]
    seeds = [map_point(n["x"], n["y"]) for n in nodes]
    return kendall_tau([nearest_arc_t(branch, q) for q in seeds])


def canonicalize_branch_orientation(branch, stroke, map_point, nuqta_units):
    """Reorients `branch` so its first point sits nearer the stroke's own
    fromNode end (`nodes[0]`, mapped through `map_point`) than its last point
    does — decided from each raw branch endpoint's distance to the fromNode
    seed *alone*, not a joint two-anchor (fromNode + toNode) sum — and then
    only if the all-node rank vote (`orientation_vote_tau`, see
    ORIENTATION_VOTE_MIN_TAU) independently agrees.

    A joint two-anchor sum was tried first (minimize
    dist(start,fromSeed)+dist(end,toSeed) vs the swapped pairing) and
    measured directly against the verification check described in the
    fix-round-1 report: it produced confidently WRONG orientations on 6 of
    65 shipped spines, every time because the *toNode* seed's own error (the
    proportional mapping this project exists to replace is only accurate to
    a median 0.37 / p90 1.43 nuqta — see spineError.test.ts) was large
    enough to outweigh a fromNode pairing that was, on its own, clearly
    correct. Anchoring on one estimate instead of summing two independently
    noisy ones removes that failure mode and is what the shipped table is
    actually verified against.

    Returns (oriented_branch, d_start, d_end, tau, reason) — the two
    raw-endpoint distances to the fromNode seed, in nuqta, plus the vote's
    tau. `oriented_branch` is `None`, and `reason` names which check
    refused, when either

      "ambiguous"  the two endpoint distances are within
                   ORIENTATION_AMBIGUOUS_NUQTA of each other, or
      "vote"       the rank vote has no majority (|tau| at or below
                   ORIENTATION_VOTE_MIN_TAU) or picks the other direction,

    in which case the caller drops the stroke's spines rather than guess, per
    "a rejected match ships nothing".
    """
    nodes = stroke["path"]["nodes"]
    seed_from = map_point(nodes[0]["x"], nodes[0]["y"])
    b_start, b_end = branch[0], branch[-1]

    def dist(p, q):
        return ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) ** 0.5

    d_start = dist(b_start, seed_from) / nuqta_units
    d_end = dist(b_end, seed_from) / nuqta_units
    tau = orientation_vote_tau(branch, stroke, map_point)
    if abs(d_start - d_end) < ORIENTATION_AMBIGUOUS_NUQTA:
        return None, d_start, d_end, tau, "ambiguous"
    endpoint_forward = d_start < d_end
    if abs(tau) <= ORIENTATION_VOTE_MIN_TAU or (tau > 0) != endpoint_forward:
        return None, d_start, d_end, tau, "vote"
    return (branch if endpoint_forward else list(reversed(branch))), d_start, d_end, tau, None


def match_strokes(desc, branches, nuqta_units, seed_box):
    """Assign each schema stroke a branch, or None.

    Score: seed distance + orientation disagreement + length disagreement,
    with a hard component-class rule. Returns (assignment, margins) where
    margin is the cost gap to the runner-up — the confidence signal the gate
    uses.
    """
    import numpy as np
    from scipy.optimize import linear_sum_assignment

    strokes = [(c, s) for c in desc["glyph"]["components"] for s in c["strokes"]]
    if not strokes or not branches:
        return {}, {}

    # A DOT component may only take a short, isolated branch; a body stroke
    # may not. This one rule removes most of the plausible-but-wrong matches.
    def allowed(component, branch):
        short = polyline_length(branch) < 1.5 * nuqta_units
        return short if component["type"] == "DOT" else not short

    cost = np.full((len(strokes), len(branches)), 1e6)
    for i, (component, stroke) in enumerate(strokes):
        nodes = stroke["path"]["nodes"]
        seed = seed_box(nodes)
        want_len = (stroke.get("lengthDots") or 1.0) * nuqta_units
        for j, branch in enumerate(branches):
            if not allowed(component, branch):
                continue
            mid = branch[len(branch) // 2]
            dist = ((mid[0] - seed[0]) ** 2 + (mid[1] - seed[1]) ** 2) ** 0.5 / nuqta_units
            got_len = polyline_length(branch)
            ratio = max(got_len, 1e-6) / max(want_len, 1e-6)
            len_cost = abs(np.log(ratio))
            ang = np.arctan2(branch[-1][1] - branch[0][1], branch[-1][0] - branch[0][0])
            want_ang = np.arctan2(nodes[-1]["y"] - nodes[0]["y"], nodes[-1]["x"] - nodes[0]["x"])
            ang_cost = abs(((ang - want_ang + np.pi) % (2 * np.pi)) - np.pi) / np.pi
            cost[i, j] = dist + 2.0 * len_cost + ang_cost

    rows, cols = linear_sum_assignment(cost)
    assignment, margins = {}, {}
    for i, j in zip(rows, cols):
        if cost[i, j] >= 1e6:
            continue
        # Real competitors only — a 1e6 sentinel (the `allowed()` class rule
        # ruling out DOT vs body branches) is not a runner-up, it is a
        # non-candidate. Including it made every stroke with exactly one
        # allowed branch score a ~1e6 margin and pass the margin gate
        # unconditionally regardless of fit quality (fix round 1, IMPORTANT
        # 3). `margins[i] = None` now means "no real competitor to measure
        # confidence against" — gate() treats that as inapplicable rather
        # than as a pass, and the caller reports it separately.
        real_others = sorted(c for k, c in enumerate(cost[i]) if k != j and c < 1e6)
        assignment[i] = j
        margins[i] = (real_others[0] - cost[i, j]) if real_others else None
    return assignment, margins


# ---------------------------------------------------------------------------
# Gates
# ---------------------------------------------------------------------------

MIN_MARGIN = 0.35        # cost units; below this the runner-up is too close to trust
LEN_RATIO_BAND = (0.5, 2.0)


def gate(stroke, branch, margin, nuqta_units):
    """Returns None if the entry may ship, else the reason it was dropped.

    `margin=None` means match_strokes found no real competing branch to
    measure confidence against (see IMPORTANT 3, fix round 1) — the margin
    check is skipped rather than treated as a pass or a fail; the caller
    tracks that case separately as "single candidate" so it is visible
    rather than silently folded into ordinary passes.
    """
    want = (stroke.get("lengthDots") or 0) * nuqta_units
    got = polyline_length(branch)
    if want > 0:
        ratio = got / want
        if not (LEN_RATIO_BAND[0] <= ratio <= LEN_RATIO_BAND[1]):
            return f"length ratio {ratio:.2f}"
    if margin is not None and margin < MIN_MARGIN:
        return f"margin {margin:.2f}"
    if len(branch) < 2:
        return "degenerate branch"
    return None


# Fix round 1, IMPORTANT 2: replaced the absolute MAX_CONNECTIVITY_VIOLATIONS
# threshold (was 2). Audited against all 104 non-ligature schemas: 31 glyphs
# assert 0 schema-adjacent stroke pairs, 62 assert 1, 5 assert 2, and only 6
# assert 3 — so an absolute threshold of "> 2" could arithmetically fire on
# at most 6 of 104 schemas, regardless of which font or how badly a glyph was
# misread; it was inert by construction, not because matches were good. A
# ratio is proportionate to how much adjacency structure the schema actually
# claims for that glyph, and is reachable on the 73 schemas that assert any
# adjacency at all.
MAX_CONNECTIVITY_RATIO = 0.5


def connectivity_violations(desc, strokes, assignment, branches, nuqta_units):
    """Returns (violations, adjacent_pairs).

    `adjacent_pairs` is a property of the SCHEMA alone — how many stroke
    pairs it asserts share a node — counted regardless of whether either
    side ended up assigned, so it is comparable across glyphs and fonts.
    `violations` is how many of those pairs got matched branches whose
    endpoints don't meet (only countable for pairs where both sides were
    assigned). A glyph with more than MAX_CONNECTIVITY_RATIO of its own
    asserted adjacencies violated has had its structure misread, not one
    stroke mismatched, so the caller drops it whole.
    """
    def endpoints(i):
        b = branches[assignment[i]]
        return (b[0], b[-1])

    near = lambda p, q: ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) ** 0.5 < nuqta_units

    adjacent_pairs = 0
    violations = 0
    for i in range(len(strokes)):
        for j in range(i + 1, len(strokes)):
            ni = strokes[i][1]["path"]["nodes"]
            nj = strokes[j][1]["path"]["nodes"]
            shares_node = any(
                abs(a["x"] - b["x"]) < 1e-6 and abs(a["y"] - b["y"]) < 1e-6
                for a in ni for b in nj
            )
            if not shares_node:
                continue
            adjacent_pairs += 1
            if i not in assignment or j not in assignment:
                continue
            ei, ej = endpoints(i), endpoints(j)
            if not any(near(p, q) for p in ei for q in ej):
                violations += 1
    return violations, adjacent_pairs


def schema_adjacent_pairs(desc):
    """Same adjacency count as `connectivity_violations`' denominator, but
    computed straight from the schema with no font/branches/assignment in
    hand — a purely structural property of the authored data, used to print
    the adjacency histogram in `main` (fix round 1, IMPORTANT 2: this ceiling
    is set by the schema, not by any one font, which is why the old absolute
    threshold was inert across every font, not just this one)."""
    strokes = [(c, s) for c in desc["glyph"]["components"] for s in c["strokes"]]
    count = 0
    for i in range(len(strokes)):
        for j in range(i + 1, len(strokes)):
            ni = strokes[i][1]["path"]["nodes"]
            nj = strokes[j][1]["path"]["nodes"]
            if any(abs(a["x"] - b["x"]) < 1e-6 and abs(a["y"] - b["y"]) < 1e-6 for a in ni for b in nj):
                count += 1
    return count


CONSENSUS_MIN_FONTS = 4
CONSENSUS_MAX_DEV_NUQTA = 1.5


def drop_cross_font_outliers(tables, ratios):
    """Drop any font's spine for a stroke that disagrees with the consensus.

    Normalizing by each font's own em and nuqta puts every font's spine in the
    same unit, so "this font put the seen connector somewhere nobody else did"
    becomes measurable. Requires CONSENSUS_MIN_FONTS entries: with fewer there
    is no consensus to be an outlier from, and dropping on that sample is
    noise, not evidence.

    Returns {family: count} of spines dropped per font (a deviation from the
    brief's single global int — Step 3's report table needs a per-font
    column, and this is the natural place to produce it since this function
    already walks every dropped spine).
    """
    import statistics
    keyed = {}
    for family, table in tables.items():
        nuqta_units = ratios[family] * table["unitsPerEm"]
        for glyph_id, entry in table["glyphs"].items():
            for spine in entry["spines"]:
                key = (entry["schemaGlyph"], spine["strokeId"], spine["zoneIndex"])
                pts = spine["points"]
                keyed.setdefault(key, []).append((
                    family, glyph_id, spine,
                    (pts[0]["x"] / nuqta_units, pts[0]["y"] / nuqta_units),
                    (pts[-1]["x"] / nuqta_units, pts[-1]["y"] / nuqta_units),
                ))

    dropped_per_font = {family: 0 for family in tables}
    for key in sorted(keyed):
        rows = keyed[key]
        if len(rows) < CONSENSUS_MIN_FONTS:
            continue
        med_start = tuple(statistics.median(r[3][k] for r in rows) for k in (0, 1))
        med_end = tuple(statistics.median(r[4][k] for r in rows) for k in (0, 1))
        for family, glyph_id, spine, start, end in rows:
            dev = max(
                ((start[0] - med_start[0]) ** 2 + (start[1] - med_start[1]) ** 2) ** 0.5,
                ((end[0] - med_end[0]) ** 2 + (end[1] - med_end[1]) ** 2) ** 0.5,
            )
            if dev > CONSENSUS_MAX_DEV_NUQTA:
                tables[family]["glyphs"][glyph_id]["spines"].remove(spine)
                dropped_per_font[family] += 1
                print(f"    drop {family} {key} : {dev:.2f} nuqta from consensus")
    # A glyph left with no spines is an empty entry; remove it so the table
    # never carries a key that resolves to nothing.
    for table in tables.values():
        for gid in [g for g, e in table["glyphs"].items() if not e["spines"]]:
            del table["glyphs"][gid]
    return dropped_per_font


# ---------------------------------------------------------------------------
# Sheet overlay (eyeball check)
# ---------------------------------------------------------------------------

def write_sheet(tt, family, upm, nuqta_units, glyph_names, spines_by_glyph):
    """One PNG per font: each glyph filled grey, raw medial-axis branches in
    red, and the spines that actually survived matching + every gate drawn
    over them in green with a short stroke-id label — this is the eyeball
    pass Step 4 reads: green ink should sit on the stroke its label names.
    """
    from PIL import Image, ImageDraw
    cols, cell = 8, 160
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
        for stroke_id, spine_pts in spines_by_glyph.get(name, []):
            pts = [(cx + px * cell_scale, cy + py * cell_scale)
                   for x, y, _ in spine_pts
                   for px, py in [to_px((x, y))]]
            if len(pts) > 1:
                draw.line(pts, fill=(30, 160, 60), width=2)
            mx, my = pts[len(pts) // 2]
            draw.text((mx + 2, my - 8), stroke_id, fill=(20, 110, 40))
    out = OUT_DIR / f"{family}-sheet.png"
    sheet.save(out)
    print(f"    sheet -> {out.relative_to(ROOT)}")


# ---------------------------------------------------------------------------
# Table construction
# ---------------------------------------------------------------------------

def clamp_index(idx, n):
    return idx if isinstance(idx, int) and 0 <= idx < n else None


def zone_count(desc):
    """Total authored stretchZones across every stroke of one schema entry —
    the unit fix round 1's reconciliation accounts every zone in."""
    return sum(
        len(s["editBehavior"]["stretchZones"])
        for c in desc["glyph"]["components"] for s in c["strokes"]
    )


def build_table(family: str, ratio: float, sheets: bool, schemas: dict) -> tuple[dict, dict, dict]:
    """Builds one font's SpineTable in memory (nothing is written here — the
    caller writes only after the cross-font consensus pass, per Step 3).

    Returns (table, drops, accounting).

    `drops` = {"length", "margin", "orientation", "connectivity"}: authored
    zones dropped by the four per-match gates (consensus is a separate,
    later pass over every font at once — see drop_cross_font_outliers).

    `accounting` reconciles every match attempt to exactly one bucket (fix
    round 1's "make the report's numbers total" requirement) — for a given
    font, `accounting["shipped"] + sum(drops.values()) +
    accounting["unassigned"] + accounting["no_glyph_name"] +
    accounting["no_geometry"] + accounting["collision"] +
    accounting["invalid_zone"]` must equal `accounting["attempted"]`.

    That denominator is per-font rather than the authored zone count, because
    one authored (letter, form) is attempted once per glyph the font actually
    draws for it — see shaped_glyph_names. `single_candidate` is reported
    separately and is a *subset* of `shipped`, not an addend of its own — see
    IMPORTANT 3.
    """
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

    table = {
        "font": family,
        "unitsPerEm": upm,
        "fontSha256": sha256(path),
        "glyphs": {},
    }
    drops = {"length": 0, "margin": 0, "orientation": 0, "orientation_vote": 0,
             "zone_orientation": 0, "connectivity": 0}
    accounting = {
        "shipped": 0, "unassigned": 0, "no_glyph_name": 0, "no_geometry": 0,
        "collision": 0, "invalid_zone": 0, "single_candidate": 0,
        # Task 4 fix round: split, because conflating the two is precisely how
        # the partial-zone reversal stayed invisible through two review
        # rounds. `_full` counts zones spanning the whole stroke (where the
        # zone's own endpoints ARE the stroke's, so only the toNode seed can
        # dissent); `_partial` counts interior-node zones measured against
        # their OWN fromNode/toNode seeds. Both are pre-consensus, like every
        # other accounting bucket — a counted zone may still be removed later
        # by drop_cross_font_outliers, so these figures are an upper bound on
        # what actually ships, not a count of it.
        "anchors_disagree_full": 0, "anchors_disagree_partial": 0,
        # The reconciliation's denominator. It is not the authored zone count
        # any more: one authored (letter, form) is matched once per glyph the
        # font actually draws for it, and a Naskh face draws several. Every
        # (zone x glyph) attempt still lands in exactly one bucket.
        "attempted": 0,
    }
    sheet_glyph_names = []
    spines_by_glyph = {}
    seen_glyph_ids = {}  # glyph_id -> (unicode_hex, form) that claimed it first, for a deterministic collision log

    hb_font = _hb_font(path)
    targets = []  # (unicode_hex, form, glyph_name), deterministic
    for unicode_hex, form in sorted(schemas):
        n_zones = zone_count(schemas[(unicode_hex, form)])
        names = shaped_glyph_names(hb_font, tt, unicode_hex, form)
        if not names:
            accounting["no_glyph_name"] += n_zones
            accounting["attempted"] += n_zones
            continue
        accounting["attempted"] += n_zones * len(names)
        targets.extend((unicode_hex, form, name) for name in names)

    for unicode_hex, form, glyph_name in targets:
        desc = schemas[(unicode_hex, form)]
        n_zones = zone_count(desc)

        branches = glyph_branches(tt, glyph_name, upm, nuqta_units)
        bbox = glyph_bbox_font_units(tt, glyph_name) if branches else None
        if not branches or bbox is None:
            accounting["no_geometry"] += n_zones
            continue

        if glyph_name not in sheet_glyph_names:
            sheet_glyph_names.append(glyph_name)

        strokes = [(c, s) for c in desc["glyph"]["components"] for s in c["strokes"]]
        seed_box = make_seed_box(desc, bbox)
        map_point = make_seed_mapper(desc, bbox)
        assignment, margins = match_strokes(desc, branches, nuqta_units, seed_box)

        for i in range(len(strokes)):
            if i not in assignment:
                accounting["unassigned"] += len(strokes[i][1]["editBehavior"]["stretchZones"])
        if not assignment:
            continue

        # Connectivity is checked on the *raw* assignment, before any
        # per-stroke gate runs — a structurally misread glyph is dropped
        # whole, not stroke by stroke. (Step 3's "before anything is
        # written".) Fix round 1, IMPORTANT 2: ratio, not absolute count —
        # see MAX_CONNECTIVITY_RATIO's own comment for why.
        violations, adjacent_pairs = connectivity_violations(desc, strokes, assignment, branches, nuqta_units)
        if adjacent_pairs > 0 and violations > MAX_CONNECTIVITY_RATIO * adjacent_pairs:
            print(f"    {family}: {desc['glyph']['id']} connectivity {violations}/{adjacent_pairs} "
                  f"violations exceeds ratio {MAX_CONNECTIVITY_RATIO} — dropping glyph whole")
            # Every zone that would have been attempted here is the cost of
            # this drop, whether or not it would individually have passed
            # the length/margin gate — the whole match is discarded.
            drops["connectivity"] += sum(
                len(strokes[i][1]["editBehavior"]["stretchZones"]) for i in assignment
            )
            continue
        elif violations > 0:
            print(f"    {family}: {desc['glyph']['id']} connectivity {violations}/{adjacent_pairs} violations (kept)")

        glyph_id = tt.getGlyphID(glyph_name)  # runtime table is keyed by glyph id, not name
        gid_key = str(glyph_id)
        if gid_key in table["glyphs"]:
            prior = seen_glyph_ids[gid_key]
            print(f"    {family}: glyph id {glyph_id} ({glyph_name}) already claimed by "
                  f"{prior}; skipping {(unicode_hex, form)} (deterministic first-wins)")
            accounting["collision"] += sum(
                len(strokes[i][1]["editBehavior"]["stretchZones"]) for i in assignment
            )
            continue

        spines = []
        sheet_entries = []
        for i, j in sorted(assignment.items()):
            branch = branches[j]
            stroke = strokes[i][1]
            n_stroke_zones = len(stroke["editBehavior"]["stretchZones"])
            reason = gate(stroke, branch, margins[i], nuqta_units)
            if reason is not None:
                if reason.startswith("length"):
                    drops["length"] += n_stroke_zones
                else:
                    # "margin ..." and the rare "degenerate branch" case both
                    # land here: both are per-stroke match-confidence
                    # failures, and "degenerate branch" is only reachable
                    # when lengthDots is absent (so the length gate can't
                    # fire first) and the matched branch has under two
                    # points — rare enough not to warrant its own report
                    # bucket.
                    drops["margin"] += n_stroke_zones
                continue

            # Fix round 1, CRITICAL 1: canonicalise which end of the branch
            # is which BEFORE any zone slicing — see
            # canonicalize_branch_orientation's own comment. An ambiguous
            # orientation drops the whole stroke's spines rather than guess.
            oriented, fwd, bwd, tau, why = canonicalize_branch_orientation(
                branch, stroke, map_point, nuqta_units)
            if oriented is None:
                drops["orientation" if why == "ambiguous" else "orientation_vote"] += n_stroke_zones
                continue

            branch = oriented

            if margins[i] is None:
                # No real competing branch existed for this stroke (fix
                # round 1, IMPORTANT 3) — the margin gate could not speak to
                # confidence here, only the length gate did. Still ships if
                # it passed, but counted separately so this is visible.
                accounting["single_candidate"] += n_stroke_zones

            nodes = stroke["path"]["nodes"]
            t_values = node_t_values(nodes)
            n = len(nodes)
            node_seed = [map_point(nd["x"], nd["y"]) for nd in nodes]
            for zone_index, zone in enumerate(stroke["editBehavior"]["stretchZones"]):
                from_idx = clamp_index(zone.get("fromNode"), n)
                to_idx = clamp_index(zone.get("toNode"), n)
                if from_idx is None or to_idx is None:
                    # Fix round 1, MINOR 4: an out-of-range zone index used to
                    # silently fall back to 0/n-1, widening the zone to the
                    # whole stroke — exactly the papering-over fallback the
                    # global constraints forbid. Drop the zone instead. Latent
                    # on every authored zone as of this fix (none are
                    # out-of-range today); counted so a future bad schema file
                    # doesn't fail this silently either.
                    accounting["invalid_zone"] += 1
                    continue
                t0, t1 = t_values[from_idx], t_values[to_idx]
                sliced = arc_slice(branch, min(t0, t1), max(t0, t1))
                if t0 > t1:
                    sliced = list(reversed(sliced))

                # Task 4 fix round. The audit this replaces asked its question
                # only of zones spanning the whole stroke, which is exactly
                # the population that CANNOT fail it: for those the slice's
                # endpoints are the branch's endpoints, so the fromNode signal
                # restates the orientation decision itself. 156 shipped
                # partial zones were therefore never checked at all, and 35 of
                # them were running backwards. The check below is asked of
                # every zone, against the zone's OWN fromNode/toNode seeds and
                # the SLICE's own endpoints — the literal statement of the
                # StrokeSpine.points contract ("ordered from the zone's
                # fromNode end to its toNode end", src/lib/strokeSpines/types.ts).
                #
                # The fromNode signal is a gate and the toNode signal a
                # counter, which is not an inconsistency: the toNode seed is
                # the noisier of the two by construction (fix round 1's own
                # measurement, and the reason the orientation rule anchors on
                # fromNode alone), so dropping on it would discard matches
                # that were traced by hand and found correct. Splitting the
                # counter full/partial is the part that must never be undone —
                # a single figure is what let this hide.
                from_backwards = (point_distance(sliced[0], node_seed[from_idx])
                                  - point_distance(sliced[-1], node_seed[from_idx])) / nuqta_units
                to_backwards = (point_distance(sliced[-1], node_seed[to_idx])
                                - point_distance(sliced[0], node_seed[to_idx])) / nuqta_units
                is_full = {from_idx, to_idx} == {0, n - 1}
                if to_backwards >= ORIENTATION_AMBIGUOUS_NUQTA:
                    accounting["anchors_disagree_full" if is_full
                               else "anchors_disagree_partial"] += 1
                if from_backwards >= ORIENTATION_AMBIGUOUS_NUQTA:
                    # Inert on full-stroke zones by construction (see above),
                    # so every hit here is a partial zone whose window was
                    # sliced off the wrong end of its stroke. Latent as of
                    # this fix — the orientation vote removes the population
                    # that used to trip it — and kept as a permanent guard
                    # against it returning unnoticed, the same way
                    # invalid_zone is kept.
                    print(f"    {family}: {desc['glyph']['id']} {stroke['id']} zone {zone_index} "
                          f"runs backwards from its own fromNode by {from_backwards:.2f}nq — dropping zone")
                    drops["zone_orientation"] += 1
                    continue

                points = [{"x": x, "y": y, "radius": r} for x, y, r in sliced]
                spines.append({
                    "strokeId": stroke["id"],
                    "zoneIndex": zone_index,
                    "points": points,
                })
                sheet_entries.append((stroke["id"], sliced))

        if not spines:
            continue

        table["glyphs"][gid_key] = {
            "schemaGlyph": desc["glyph"]["id"],
            "spines": spines,
        }
        accounting["shipped"] += len(spines)
        seen_glyph_ids[gid_key] = (unicode_hex, form)
        spines_by_glyph.setdefault(glyph_name, []).extend(sheet_entries)

    if sheets:
        write_sheet(tt, family, upm, nuqta_units, sheet_glyph_names, spines_by_glyph)

    return table, drops, accounting


def run_sweep(families, ratios, schemas) -> None:
    """Task 4 review, MINOR 2. The two orientation thresholds' sensitivity,
    re-runnable rather than pasted into a report from a throwaway edit of the
    constants — which is how the last sweep became unreproducible.

    Writes nothing: it rebuilds each font's table in memory at each setting
    and reports only the pre-consensus shipped count, so a reader can see how
    much coverage each threshold is responsible for.
    """
    global ORIENTATION_AMBIGUOUS_NUQTA, ORIENTATION_VOTE_MIN_TAU
    base_nq, base_tau = ORIENTATION_AMBIGUOUS_NUQTA, ORIENTATION_VOTE_MIN_TAU
    try:
        for name, values in (("ORIENTATION_AMBIGUOUS_NUQTA", (0.0, 0.25, 0.5, 1.0)),
                             ("ORIENTATION_VOTE_MIN_TAU", (-1.0, 0.0, 0.34, 0.5, 0.9))):
            print(f"\nsweep {name} (other threshold held at its committed value; "
                  f"pre-consensus shipped zones)")
            print(f"  {'value':>7} " + "".join(f"{f[:12]:>13}" for f in families) + f"{'TOTAL':>8}")
            for v in values:
                ORIENTATION_AMBIGUOUS_NUQTA, ORIENTATION_VOTE_MIN_TAU = base_nq, base_tau
                if name == "ORIENTATION_AMBIGUOUS_NUQTA":
                    ORIENTATION_AMBIGUOUS_NUQTA = v
                else:
                    ORIENTATION_VOTE_MIN_TAU = v
                counts = [build_table(f, ratios[f], False, schemas)[2]["shipped"] for f in families]
                marker = "  <- committed" if v == (base_nq if name == "ORIENTATION_AMBIGUOUS_NUQTA"
                                                   else base_tau) else ""
                print(f"  {v:>7} " + "".join(f"{c:>13}" for c in counts)
                      + f"{sum(counts):>8}{marker}")
    finally:
        ORIENTATION_AMBIGUOUS_NUQTA, ORIENTATION_VOTE_MIN_TAU = base_nq, base_tau


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("fonts", nargs="*")
    ap.add_argument("--sheets", action="store_true")
    ap.add_argument("--sweep", action="store_true",
                    help="report the orientation thresholds' sensitivity and write nothing")
    args = ap.parse_args()

    ratios = in_scope_fonts()
    families = args.fonts or sorted(ratios)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    schemas = load_schemas()

    if args.sweep:
        run_sweep([f for f in families if f in ratios], ratios, schemas)
        return

    total_zones = sum(zone_count(desc) for desc in schemas.values())
    print(f"schemas: {len(schemas)} non-ligature entries, {total_zones} authored zones")

    # Fix round 1, IMPORTANT 2: the connectivity ceiling is a property of the
    # SCHEMA data alone (how many stroke pairs a glyph's own authoring
    # asserts share a node), not of any one font — printed once here,
    # independent of which fonts are processed, so a reader can see why the
    # old absolute threshold was inert on every font, not just this one.
    adjacency_hist = {}
    for desc in schemas.values():
        n = schema_adjacent_pairs(desc)
        adjacency_hist[n] = adjacency_hist.get(n, 0) + 1
    hist_str = ", ".join(f"{n} pairs: {c} glyphs" for n, c in sorted(adjacency_hist.items()))
    print(f"schema adjacency (structural, font-independent): {hist_str}")
    print()

    # Every font's table is built in memory first; nothing is written until
    # the cross-font consensus pass (the fourth gate) has run over all of
    # them, since it needs more than one font in hand to have a consensus to
    # compare against.
    tables, all_drops, all_accounting = {}, {}, {}
    for family in families:
        if family not in ratios:
            print(f"  skip {family}: no measured nuqta, out of scope")
            continue
        table, drops, accounting = build_table(family, ratios[family], args.sheets, schemas)
        tables[family] = table
        all_drops[family] = drops
        all_accounting[family] = accounting

    consensus_drops = drop_cross_font_outliers(tables, ratios) if tables else {}

    print()
    header = (f"{'font':<18} {'glyphs':>7} {'spines':>7} {'length':>8} {'margin':>8} "
              f"{'orient.':>8} {'vote':>6} {'zoneor.':>8} {'connect.':>9} {'consensus':>10}")
    print(header)
    print("-" * len(header))
    for family in sorted(tables):
        table = tables[family]
        drops = all_drops[family]
        n_glyphs = len(table["glyphs"])
        n_spines = sum(len(e["spines"]) for e in table["glyphs"].values())
        print(f"{family:<18} {n_glyphs:>7} {n_spines:>7} {drops['length']:>8} {drops['margin']:>8} "
              f"{drops['orientation']:>8} {drops['orientation_vote']:>6} {drops['zone_orientation']:>8} "
              f"{drops['connectivity']:>9} {consensus_drops.get(family, 0):>10}")

        out = OUT_DIR / f"{family}.json"
        out.write_text(json.dumps(table, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"  {family}: {n_glyphs} glyphs, {n_spines} spines -> {out.relative_to(ROOT)}")

    # Fix round 1: "make the report's numbers total" — reconcile every
    # authored zone to exactly one bucket. Evaluated against the pre-
    # consensus `accounting["shipped"]` (consensus is a later, separate pass
    # over already-shipped spines, not a new attribution of an authored
    # zone), so this holds regardless of what consensus later removes.
    print()
    for family in sorted(all_accounting):
        acc = all_accounting[family]
        drops = all_drops[family]
        accounted = (acc["shipped"] + sum(drops.values()) + acc["unassigned"]
                     + acc["no_glyph_name"] + acc["no_geometry"] + acc["collision"]
                     + acc["invalid_zone"])
        attempted = acc["attempted"]
        status = "OK" if accounted == attempted else "MISMATCH"
        print(f"  {family}: reconcile {accounted}/{attempted} attempts "
              f"({total_zones} authored zones x the glyphs this font draws them as) [{status}] "
              f"(shipped {acc['shipped']}, length {drops['length']}, margin {drops['margin']}, "
              f"orientation {drops['orientation']}, orientation_vote {drops['orientation_vote']}, "
              f"zone_orientation {drops['zone_orientation']}, connectivity {drops['connectivity']}, "
              f"unassigned {acc['unassigned']}, no_glyph_name {acc['no_glyph_name']}, "
              f"no_geometry {acc['no_geometry']}, collision {acc['collision']}, "
              f"invalid_zone {acc['invalid_zone']}; of which single_candidate {acc['single_candidate']}, "
              f"anchors_disagree full {acc['anchors_disagree_full']} "
              f"partial {acc['anchors_disagree_partial']} [pre-consensus])")
        assert accounted == attempted, (
            f"{family}: {accounted} attempts accounted for out of {attempted} made — "
            f"some zone was silently dropped without an accounting bucket"
        )


if __name__ == "__main__":
    main()
