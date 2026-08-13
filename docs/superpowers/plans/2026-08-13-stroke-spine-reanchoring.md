# Stroke Spine Re-anchoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the schema→glyph bounding-box proportion that Phase C measured as inaccurate with a per-font table of stroke spines matched against each real glyph's medial axis, so a stretch handle's axis lies on the ink it claims to describe.

**Architecture:** An offline Python script rasterizes each glyph, extracts its medial axis, matches the schema's stroke graph onto the skeleton's branches, and writes a per-font JSON table keyed by glyph id. Four generation-time gates drop any match that cannot be verified; a rejected entry ships nothing and the stroke simply offers no handle. At runtime a lazily-loaded registry hands the polyline to `useGlyphSchemaCatalog`, and `setStretchFactor` takes its anchor and drag from the polyline's ends instead of from the glyph's bounding box.

**Tech Stack:** TypeScript + React 19 + Vite (app), Vitest (tests), Python 3 with fontTools / numpy / Pillow / scikit-image (offline tooling only — nothing new ships to the browser).

**Spec:** `docs/superpowers/specs/2026-08-13-stroke-spine-reanchoring-design.md`

## Global Constraints

- **In-scope fonts are the 15 with a measured nuqta** in `NUQTA_EM_RATIO` (`src/lib/nuqta.ts`). `public/fonts/` holds 17 files; `Ruqaa` and `HarfCanvasDiwani` are deliberately excluded and must stay excluded. The nuqta is not decoration here — it is the unit the spur-pruning threshold and the length-agreement gate are expressed in, so a font without one cannot be processed.
- **Spine coordinates are font units, y-up**, relative to the glyph's own origin — the same space `opentype.js`/fontTools report outlines in. The y-flip to canvas space happens once, at handle creation.
- **A rejected match ships nothing.** Never fall back to the old proportional mapping at runtime, and never invent a spine. Absence is the out-of-scope mechanism, exactly as `nuqtaEmRatio` returning `null` already is.
- **Saved projects are never migrated.** A stored handle keeps its coordinates and renders as it does today.
- **Do not change the displacement engine.** `applyGlyphEdit` / `applyAxisDisplacement` in `src/lib/glyphEdits.ts` are out of scope for this plan. This plan changes where the axis *is*, not what displacement does with it.
- **Python steps are not TDD.** The repo has no Python test infrastructure and its three existing scripts (`measureNuqta.py`, `mergePuaGlyphs.py`, `renderFontSample.py`) have no tests; adding pytest is out of scope. Python tasks are verified by running the script and reading its report plus the rendered contact sheet. Every TypeScript task is strict TDD. This is a deliberate deviation, stated so nobody "fixes" it silently.
- **Verification loop after any non-trivial change**, in this order: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, `npm run build`.
- **`npm test` from the repo root double-counts if a worktree exists under `.worktrees/`** — vitest scans it too. Harmless, alarming if unexpected.
- **The pre-commit hook bumps `package.json`'s patch version on every commit.** `package.json` and `package-lock.json` appearing in every diff is the mechanism working, not noise. Never hand-edit the patch.

## File Structure

**Created:**
- `scripts/deriveStrokeSpines.py` — the whole offline pipeline: rasterize, skeletonize, prune, graph, match, gate, report, render overlays.
- `src/data/strokeSpines/<FontFamily>.json` — 15 generated tables, committed.
- `src/lib/strokeSpines/types.ts` — the JSON contract as TypeScript.
- `src/lib/strokeSpines/registry.ts` — lazy per-font loader and `getSpine`.
- `src/lib/strokeSpines/registry.test.ts`
- `src/lib/strokeSpines/spineTable.test.ts` — verifies the committed data against the font binaries.
- `src/lib/strokeSpines/anchorFromSpine.ts` — the font-units → block-text-units conversion, pure and testable away from React.
- `src/lib/strokeSpines/anchorFromSpine.test.ts`
- `src/lib/strokeSpines/endToEnd.test.ts` — real font × word, anchor lands on ink, join invariance holds.

**Modified:**
- `src/lib/strokeSchema/deriveCatalog.ts` — `StretchDefinition` gains `spine?`.
- `src/lib/strokeSchema/glyphLookup.ts` — attaches the spine.
- `src/types.ts:19-50` — `GlyphStretchHandle` gains `spine?`.
- `src/App.tsx:745-848` — `setStretchFactor` prefers the spine; no spine, no handle.
- `src/lib/strokeSchema/spineError.test.ts` — header note only; it now characterizes the seed.
- `CLAUDE.md`, `PROGRESS.md`, `src/components/guide/sections/` — documentation.

`anchorFromSpine.ts` exists as its own file rather than living inside `App.tsx` because `App.tsx` is already ~2600 lines and this is the one piece of real arithmetic in the runtime change — pulling it out is what makes it testable without mounting React.

---

### Task 1: The spine table contract and a Python skeleton that emits it

**Files:**
- Create: `scripts/deriveStrokeSpines.py`
- Create: `src/lib/strokeSpines/types.ts`
- Modify: `scripts/FONTS.md`

**Interfaces:**
- Consumes: `NUQTA_EM_RATIO` keys from `src/lib/nuqta.ts` (read as text by the script — do not import TS from Python; parse the key list with a regex and fail loudly if zero keys are found).
- Produces: the on-disk JSON contract, and `SpineTable` / `GlyphSpines` / `StrokeSpine` TypeScript types that every later task reads.

- [ ] **Step 1: Write the TypeScript contract**

Create `src/lib/strokeSpines/types.ts`:

```ts
/**
 * A stroke's spine on one real glyph of one real font: a polyline lying on
 * that glyph's medial axis, in font units, y-up, relative to the glyph's own
 * origin.
 *
 * This replaces the proportional bounding-box mapping in
 * strokeSchema/schemaGeometry.ts, which Phase C measured at median 0.37 nuqta
 * / p90 1.43 from real ink. See
 * docs/superpowers/specs/2026-08-13-stroke-spine-reanchoring-design.md.
 */
export type SpinePoint = {
  x: number;
  y: number;
  /** Distance to the outline at this point — half the local stroke width. Sizes the displacement band. */
  radius: number;
};

export type StrokeSpine = {
  /** Schema Stroke.id this spine was matched to. */
  strokeId: string;
  /** Which of that stroke's stretchZones — see deriveCatalog.ts's StretchDefinition.zoneIndex. */
  zoneIndex: number;
  /** At least two points, ordered from the zone's fromNode end to its toNode end. */
  points: SpinePoint[];
};

export type GlyphSpines = {
  /** The schema GlyphDescription.glyph.id this glyph was matched against, for traceability. */
  schemaGlyph: string;
  spines: StrokeSpine[];
};

export type SpineTable = {
  font: string;
  unitsPerEm: number;
  /** SHA-256 of the font file this was generated from. spineTable.test.ts re-hashes and compares, so a regenerated font with a stale table fails loudly. */
  fontSha256: string;
  /** Keyed by font glyph id, as a decimal string (JSON object keys are strings). */
  glyphs: Record<string, GlyphSpines>;
};
```

- [ ] **Step 2: Write the script skeleton**

Create `scripts/deriveStrokeSpines.py`. This step emits a *valid but empty* table so the contract is exercisable before any geometry exists.

```python
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

Requires: pip install fonttools numpy Pillow scikit-image
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
```

- [ ] **Step 3: Run it and confirm the scope rule holds**

Run: `python3 scripts/deriveStrokeSpines.py TahaNaskhRegular Ruqaa`

Expected: `TahaNaskhRegular: 0 glyphs -> src/data/strokeSpines/TahaNaskhRegular.json`, and `skip Ruqaa: no measured nuqta, out of scope`. Confirm the JSON has a 64-character `fontSha256` and a plausible `unitsPerEm`.

- [ ] **Step 4: Document the dependency**

Add to `scripts/FONTS.md`, under the existing requirements note:

```markdown
`deriveStrokeSpines.py` additionally needs numpy, Pillow and scikit-image:

    pip install fonttools numpy Pillow scikit-image

These are offline tooling only — nothing here ships to the browser.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/deriveStrokeSpines.py scripts/FONTS.md src/lib/strokeSpines/types.ts src/data/strokeSpines/TahaNaskhRegular.json
git commit -m "Add the stroke-spine table contract and its generator skeleton"
```

---

### Task 2: Medial axis extraction, pruning, and the branch graph

**Files:**
- Modify: `scripts/deriveStrokeSpines.py`

**Interfaces:**
- Consumes: `in_scope_fonts()`, `font_path()` from Task 1.
- Produces: `glyph_branches(tt, glyph_name, upm, nuqta_units) -> list[Branch]`, where `Branch` is a list of `(x, y, radius)` triples in font units, y-up. Task 3 matches schema strokes onto these.

- [ ] **Step 1: Add rasterization and skeletonization**

Insert into `scripts/deriveStrokeSpines.py`:

```python
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
    # re-draw counters as holes. Contour direction decides which is which:
    # a negative signed area is a counter in TrueType's convention.
    def signed_area(c):
        return sum((c[i][0] * c[(i + 1) % len(c)][1] - c[(i + 1) % len(c)][0] * c[i][1])
                   for i in range(len(c))) / 2

    for contour in sorted(pen.contours, key=lambda c: -abs(signed_area(c))):
        pts = [to_px(p) for p in contour]
        if len(pts) < 3:
            continue
        draw.polygon(pts, fill=0 if signed_area(contour) < 0 else 1)

    mask = np.array(img, dtype=bool)

    def to_font_units(px, py, r_px):
        return ((px / scale) - ox, ((RASTER - py) / scale) - oy, r_px / scale)

    return mask, to_font_units


def glyph_branches(tt, glyph_name, upm, nuqta_units):
    """Pruned medial-axis branches for a glyph, in font units, y-up.

    Each branch is a list of (x, y, radius) triples. Spurs shorter than half a
    nuqta are dropped — the threshold is in the letterform's own unit, which is
    why NUQTA_EM_RATIO is a prerequisite rather than a nicety.
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

    min_len = 0.5 * nuqta_units
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
```

- [ ] **Step 2: Add the overlay contact sheet**

Still in `scripts/deriveStrokeSpines.py`:

```python
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
```

Wire `--sheets` in `build_table` to call it for the glyphs it processed.

- [ ] **Step 3: Run it and look at the result**

Run: `python3 scripts/deriveStrokeSpines.py TahaNaskhRegular --sheets`

Then open `src/data/strokeSpines/TahaNaskhRegular-sheet.png`. Expected: skeleton lines running down the middle of each letter's strokes, teeth showing as separate short branches, dots as their own tiny components, and no dense hairball of spurs along the outline. If spurs dominate, raise the pruning multiple from `0.5` and re-run — record whatever value you settle on in a comment saying it was tuned by eye, because no test can see it.

- [ ] **Step 4: Keep the sheet out of the repo**

Add to `.gitignore`:

```
src/data/strokeSpines/*-sheet.png
```

The sheets are a review artifact regenerated on demand, not data.

- [ ] **Step 5: Commit**

```bash
git add scripts/deriveStrokeSpines.py .gitignore
git commit -m "Extract pruned medial-axis branches, with an overlay sheet to check them by eye"
```

---

### Task 3: Match schema strokes to branches, sample zones, and gate

**Files:**
- Modify: `scripts/deriveStrokeSpines.py`

**Interfaces:**
- Consumes: `glyph_branches()` from Task 2.
- Produces: fully populated `SpineTable` JSON per Task 1's contract, plus a coverage report on stdout. Task 5 onward reads only the JSON.

- [ ] **Step 1: Load the schemas and find each glyph's real glyph id**

```python
SCHEMA_DIR = ROOT / "src" / "data" / "strokeSchemas"


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


FORM_SUFFIX = {"isolated": "isol", "initial": "init", "medial": "medi", "final": "fina"}


def glyph_name_for(tt, unicode_hex, form):
    """The font's glyph name for one letter in one joining form.

    Walks the cmap for the base codepoint, then follows GSUB's single
    substitutions for the matching form feature — which is how the font itself
    decides, rather than us guessing from naming conventions.
    """
    cp = int(unicode_hex, 16)
    base = tt.getBestCmap().get(cp)
    if base is None:
        return None
    if form == "isolated":
        return base
    feature = FORM_SUFFIX.get(form)
    gsub = tt.get("GSUB")
    if feature is None or gsub is None:
        return None
    for record in gsub.table.FeatureList.FeatureRecord:
        if record.FeatureTag != feature:
            continue
        for idx in record.Feature.LookupListIndex:
            lookup = gsub.table.LookupList.Lookup[idx]
            for sub in lookup.SubTable:
                mapping = getattr(sub, "mapping", None)
                if mapping and base in mapping:
                    return mapping[base]
    return None
```

- [ ] **Step 2: Add matching and zone sampling**

```python
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
        others = sorted(c for k, c in enumerate(cost[i]) if k != j)
        assignment[i] = j
        margins[i] = (others[0] - cost[i, j]) if others else float("inf")
    return assignment, margins
```

Add `scipy` to the pip line in `scripts/FONTS.md` — `linear_sum_assignment` lives there.

- [ ] **Step 3: Add the four gates and the report**

```python
MIN_MARGIN = 0.35        # cost units; below this the runner-up is too close to trust
LEN_RATIO_BAND = (0.5, 2.0)


def gate(stroke, branch, margin, nuqta_units):
    """Returns None if the entry may ship, else the reason it was dropped."""
    want = (stroke.get("lengthDots") or 0) * nuqta_units
    got = polyline_length(branch)
    if want > 0:
        ratio = got / want
        if not (LEN_RATIO_BAND[0] <= ratio <= LEN_RATIO_BAND[1]):
            return f"length ratio {ratio:.2f}"
    if margin < MIN_MARGIN:
        return f"margin {margin:.2f}"
    if len(branch) < 2:
        return "degenerate branch"
    return None
```

Connectivity is the third gate, checked per glyph before anything is written:

```python
MAX_CONNECTIVITY_VIOLATIONS = 2


def connectivity_violations(desc, strokes, assignment, branches, nuqta_units):
    """How many schema-adjacent stroke pairs got non-adjacent branches.

    Two strokes are adjacent when they share a node position; their matched
    branches should then meet at an endpoint. A glyph with several violations
    has had its structure misread, not one stroke mismatched, so the caller
    drops it whole.
    """
    def endpoints(i):
        b = branches[assignment[i]]
        return (b[0], b[-1])

    near = lambda p, q: ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) ** 0.5 < nuqta_units

    violations = 0
    for i in range(len(strokes)):
        for j in range(i + 1, len(strokes)):
            if i not in assignment or j not in assignment:
                continue
            ni = strokes[i][1]["path"]["nodes"]
            nj = strokes[j][1]["path"]["nodes"]
            shares_node = any(
                abs(a["x"] - b["x"]) < 1e-6 and abs(a["y"] - b["y"]) < 1e-6
                for a in ni for b in nj
            )
            if not shares_node:
                continue
            ei, ej = endpoints(i), endpoints(j)
            if not any(near(p, q) for p in ei for q in ej):
                violations += 1
    return violations
```

Cross-font agreement is the fourth, and runs in `main` after every font is built, because it is the only gate that needs more than one font in hand:

```python
CONSENSUS_MIN_FONTS = 4
CONSENSUS_MAX_DEV_NUQTA = 1.5


def drop_cross_font_outliers(tables, ratios):
    """Drop any font whose spine for a stroke disagrees with the consensus.

    Normalizing by each font's own em and nuqta puts every font's spine in the
    same unit, so "this font put the seen connector somewhere nobody else did"
    becomes measurable. Requires CONSENSUS_MIN_FONTS entries: with two or three
    there is no consensus to be an outlier from, and dropping on that sample is
    noise, not evidence.
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
                    (pts[0][0] / nuqta_units, pts[0][1] / nuqta_units),
                    (pts[-1][0] / nuqta_units, pts[-1][1] / nuqta_units),
                ))

    dropped = 0
    for key, rows in keyed.items():
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
                dropped += 1
                print(f"    drop {family} {key} : {dev:.2f} nuqta from consensus")
    # A glyph left with no spines is an empty entry; remove it so the table
    # never carries a key that resolves to nothing.
    for table in tables.values():
        for gid in [g for g, e in table["glyphs"].items() if not e["spines"]]:
            del table["glyphs"][gid]
    return dropped
```

This means `main` must build every font's table in memory first and write them all after the consensus pass — restructure the loop accordingly rather than writing each file as it is built.

Finally print a report table: one row per font, columns `glyphs | spines | dropped: length | margin | connectivity | consensus`.

- [ ] **Step 4: Run against one font and read the report**

Run: `python3 scripts/deriveStrokeSpines.py TahaNaskhRegular --sheets`

Expected: a nonzero spine count and a drop breakdown. There is no correct number here — the point is that the reasons are legible and no single reason accounts for everything (which would mean a threshold is miscalibrated rather than the data being hard). Re-open the sheet and confirm the spines that survived sit on the strokes their labels name.

- [ ] **Step 5: Commit**

```bash
git add scripts/deriveStrokeSpines.py scripts/FONTS.md
git commit -m "Match schema strokes onto medial-axis branches behind four gates"
```

---

### Task 4: Generate every in-scope font's table

**Files:**
- Create: `src/data/strokeSpines/*.json` (15 files)

- [ ] **Step 1: Generate**

Run: `python3 scripts/deriveStrokeSpines.py --sheets`

- [ ] **Step 2: Read the coverage report**

Record the per-font coverage numbers — Task 6 pins them as a characterization. If a font produces zero spines, do not paper over it: find out whether its GSUB walk failed (`glyph_name_for` returning `None` for every form is the signature) and fix that rather than accepting the gap.

- [ ] **Step 3: Check the sheets**

Open each `*-sheet.png`. You are looking for spines on the wrong stroke, not for missing ones — a missing spine is the gate working. Note anything suspicious in the commit message.

- [ ] **Step 4: Commit**

```bash
git add src/data/strokeSpines/
git commit -m "Generate stroke-spine tables for the 15 in-scope fonts"
```

---

### Task 5: The runtime registry

**Files:**
- Create: `src/lib/strokeSpines/registry.ts`
- Create: `src/lib/strokeSpines/registry.test.ts`

**Interfaces:**
- Consumes: `SpineTable`, `StrokeSpine` from `src/lib/strokeSpines/types.ts`; the JSON files from Task 4.
- Produces:
  - `loadSpineTable(fontFamily: string): Promise<SpineTable | null>`
  - `getSpineTableIfLoaded(fontFamily: string): SpineTable | null`
  - `getSpine(table: SpineTable | null, glyphId: number, strokeId: string, zoneIndex: number): StrokeSpine | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/strokeSpines/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadSpineTable, getSpine, getSpineTableIfLoaded } from "./registry";

describe("stroke spine registry", () => {
  it("returns null for a font with no table, rather than throwing", async () => {
    expect(await loadSpineTable("Ruqaa")).toBeNull();
    expect(await loadSpineTable("NoSuchFont")).toBeNull();
  });

  it("loads a real generated table and caches it", async () => {
    const table = await loadSpineTable("TahaNaskhRegular");
    expect(table).not.toBeNull();
    expect(table!.font).toBe("TahaNaskhRegular");
    expect(table!.unitsPerEm).toBeGreaterThan(0);
    expect(table!.fontSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(getSpineTableIfLoaded("TahaNaskhRegular")).toBe(table);
  });

  it("finds a spine by glyph id, stroke id and zone index", async () => {
    const table = await loadSpineTable("TahaNaskhRegular");
    const [glyphId, entry] = Object.entries(table!.glyphs)[0];
    const first = entry.spines[0];

    const found = getSpine(table, Number(glyphId), first.strokeId, first.zoneIndex);
    expect(found).toEqual(first);
  });

  it("returns null for an unknown glyph, stroke or zone", async () => {
    const table = await loadSpineTable("TahaNaskhRegular");
    const [glyphId, entry] = Object.entries(table!.glyphs)[0];
    const first = entry.spines[0];

    expect(getSpine(table, 999999, first.strokeId, 0)).toBeNull();
    expect(getSpine(table, Number(glyphId), "NO_SUCH_STROKE", 0)).toBeNull();
    expect(getSpine(table, Number(glyphId), first.strokeId, 99)).toBeNull();
    expect(getSpine(null, 1, "x", 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/strokeSpines/registry.test.ts`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 3: Implement**

Create `src/lib/strokeSpines/registry.ts`:

```ts
import type { SpineTable, StrokeSpine } from "./types";

/**
 * One generated table per font, loaded on demand.
 *
 * Not eager, unlike strokeSchema/registry.ts: 15 fonts x ~120 glyphs x ~3
 * strokes is far too much to put in the main bundle, and a session uses one
 * or two fonts. Dropping a file into src/data/strokeSpines/ is still the whole
 * integration step — there is no list to edit.
 */
const modules = import.meta.glob<{ default: SpineTable }>("../../data/strokeSpines/*.json");

const cache = new Map<string, SpineTable | null>();

function modulePathFor(fontFamily: string): string | undefined {
  return Object.keys(modules).find((p) => p.endsWith(`/${fontFamily}.json`));
}

/**
 * The font's spine table, or `null` when it has none.
 *
 * `null` is the out-of-scope mechanism, exactly as `nuqtaEmRatio` returning
 * null already is — a font without a table offers no schema-backed stretch
 * handles rather than falling back to the proportional mapping this replaced.
 */
export async function loadSpineTable(fontFamily: string): Promise<SpineTable | null> {
  const cached = cache.get(fontFamily);
  if (cached !== undefined) return cached;

  const path = modulePathFor(fontFamily);
  if (!path) {
    cache.set(fontFamily, null);
    return null;
  }

  const mod = await modules[path]();
  const table = mod.default ?? null;
  cache.set(fontFamily, table);
  return table;
}

/** Synchronous peek for render paths that must not await. Null until loadSpineTable has resolved. */
export function getSpineTableIfLoaded(fontFamily: string): SpineTable | null {
  return cache.get(fontFamily) ?? null;
}

export function getSpine(
  table: SpineTable | null,
  glyphId: number,
  strokeId: string,
  zoneIndex: number
): StrokeSpine | null {
  const entry = table?.glyphs[String(glyphId)];
  if (!entry) return null;
  return (
    entry.spines.find((s) => s.strokeId === strokeId && s.zoneIndex === zoneIndex) ?? null
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/strokeSpines/registry.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/strokeSpines/registry.ts src/lib/strokeSpines/registry.test.ts
git commit -m "Load stroke-spine tables lazily, one per font"
```

---

### Task 6: Verify the committed tables against the font binaries

**Files:**
- Create: `src/lib/strokeSpines/spineTable.test.ts`
- Modify: `src/lib/strokeSchema/spineError.test.ts` (header comment only)

**Interfaces:**
- Consumes: the JSON tables, `allStrokeSchemas()` from `strokeSchema/registry.ts`, `nuqtaEmRatio` from `lib/nuqta.ts`, `contoursToPolygons`/`splitContours` from `lib/glyphContours.ts`, `pointInPolygon` from `lib/svgPath.ts`.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Write the failing test**

Create `src/lib/strokeSpines/spineTable.test.ts`:

```ts
/// <reference types="node" />
/**
 * The committed spine tables, checked against the real font binaries.
 *
 * The highest-value assertion here is the SHA-256 one: a font regenerated or
 * replaced without re-running scripts/deriveStrokeSpines.py leaves a table
 * anchored to outlines that no longer exist, and nothing else in the app would
 * notice. CLAUDE.md's "adding a font is a five-place edit" warning exists
 * because these omissions all fail silently; this makes one of them fail loudly.
 *
 * Coverage counts are a CHARACTERIZATION, like joinPins.fonts.test.ts's
 * EXPECTED_COVERAGE — they pin what the generator currently produces so a
 * regeneration that quietly loses letters is visible. Regenerating and getting
 * different numbers is not automatically a bug; it is a prompt to look.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as opentype from "opentype.js";
import type { SpineTable } from "./types";
import { allStrokeSchemas } from "../strokeSchema/registry";
import { nuqtaEmRatio } from "../nuqta";
import { contoursToPolygons, splitContours } from "../glyphContours";
import { pointInPolygon } from "../svgPath";

const dir = path.dirname(fileURLToPath(import.meta.url));
const SPINE_DIR = path.resolve(dir, "../../data/strokeSpines");
const FONT_DIR = path.resolve(dir, "../../../public/fonts");

function tables(): { family: string; table: SpineTable }[] {
  return fs
    .readdirSync(SPINE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      family: f.replace(/\.json$/, ""),
      table: JSON.parse(fs.readFileSync(path.join(SPINE_DIR, f), "utf-8")) as SpineTable,
    }));
}

function fontFile(family: string): string {
  for (const ext of [".ttf", ".otf"]) {
    const p = path.join(FONT_DIR, `${family}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`No font file for ${family}`);
}

describe("committed stroke spine tables", () => {
  const all = tables();

  it("covers at least one font", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it.each(all)("$family: was generated from the font file that is here now", ({ family, table }) => {
    const bytes = fs.readFileSync(fontFile(family));
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(table.fontSha256);
  });

  it.each(all)("$family: unitsPerEm matches the font", ({ family, table }) => {
    const font = opentype.loadSync(fontFile(family));
    expect(table.unitsPerEm).toBe(font.unitsPerEm);
  });

  it.each(all)("$family: is only generated for fonts with a measured nuqta", ({ family }) => {
    expect(nuqtaEmRatio(family)).not.toBeNull();
  });

  it.each(all)("$family: every spine references a real schema stroke and zone", ({ table }) => {
    const schemas = new Map(allStrokeSchemas().map((s) => [s.glyph.id, s]));
    for (const entry of Object.values(table.glyphs)) {
      const schema = schemas.get(entry.schemaGlyph);
      expect(schema, `unknown schema glyph ${entry.schemaGlyph}`).toBeDefined();
      const strokes = new Map(
        schema!.glyph.components.flatMap((c) => c.strokes.map((s) => [s.id, s] as const))
      );
      for (const spine of entry.spines) {
        const stroke = strokes.get(spine.strokeId);
        expect(stroke, `unknown stroke ${spine.strokeId}`).toBeDefined();
        expect(stroke!.editBehavior.stretchZones[spine.zoneIndex]).toBeDefined();
      }
    }
  });

  it.each(all)("$family: every spine point lies inside its glyph's ink", ({ family, table }) => {
    const font = opentype.loadSync(fontFile(family));
    for (const [glyphIdStr, entry] of Object.entries(table.glyphs)) {
      const glyph = font.glyphs.get(Number(glyphIdStr));
      if (!glyph) continue;
      // Font units, y-up: getPath at size = unitsPerEm gives y-down, so flip
      // the spine's y to compare in the same space.
      const polygons = contoursToPolygons(
        splitContours(glyph.getPath(0, 0, font.unitsPerEm).commands)
      );
      for (const spine of entry.spines) {
        for (const p of spine.points) {
          const inside = polygons.some((poly) => pointInPolygon(p.x, -p.y, poly));
          expect(inside, `${family} glyph ${glyphIdStr} ${spine.strokeId} (${p.x},${p.y})`).toBe(
            true
          );
        }
      }
    }
  });

  it.each(all)("$family: every spine's length agrees with the schema's lengthDots", ({ family, table }) => {
    const ratio = nuqtaEmRatio(family)!;
    const nuqtaUnits = ratio * table.unitsPerEm;
    const schemas = new Map(allStrokeSchemas().map((s) => [s.glyph.id, s]));

    for (const entry of Object.values(table.glyphs)) {
      const strokes = new Map(
        schemas
          .get(entry.schemaGlyph)!
          .glyph.components.flatMap((c) => c.strokes.map((s) => [s.id, s] as const))
      );
      for (const spine of entry.spines) {
        const want = (strokes.get(spine.strokeId)!.lengthDots ?? 0) * nuqtaUnits;
        if (want <= 0) continue; // the schema did not author a length for this stroke
        const got = spine.points
          .slice(1)
          .reduce(
            (n, p, i) => n + Math.hypot(p.x - spine.points[i].x, p.y - spine.points[i].y),
            0
          );
        // The same 0.5x-2x band scripts/deriveStrokeSpines.py gates on. If the
        // script's band is retuned, retune this with it — they are one decision.
        expect(got / want, `${family} ${spine.strokeId}`).toBeGreaterThanOrEqual(0.5);
        expect(got / want, `${family} ${spine.strokeId}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it.each(all)("$family: every spine has at least two points and a positive radius", ({ table }) => {
    for (const entry of Object.values(table.glyphs)) {
      for (const spine of entry.spines) {
        expect(spine.points.length).toBeGreaterThanOrEqual(2);
        for (const p of spine.points) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
          expect(p.radius).toBeGreaterThan(0);
        }
      }
    }
  });

  it("coverage has not silently collapsed", () => {
    // CHARACTERIZATION — fill these in from Task 4's report, then treat a
    // change as a prompt to look rather than as a failure to suppress.
    const counts = Object.fromEntries(
      all.map(({ family, table }) => [
        family,
        Object.values(table.glyphs).reduce((n, g) => n + g.spines.length, 0),
      ])
    );
    for (const [family, n] of Object.entries(counts)) {
      expect(n, `${family} produced no spines at all`).toBeGreaterThan(0);
    }
    expect(counts).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/strokeSpines/spineTable.test.ts`
Expected: FAIL — no snapshot yet, and any real data problem surfaces here.

- [ ] **Step 3: Fix what it finds, then write the snapshot**

Any failure here is a generator bug, not a test bug — go back to Task 3 and fix it. In particular, a containment failure means the rasterization transform and the font-unit round trip disagree, which would make every downstream anchor wrong.

Run: `npx vitest run src/lib/strokeSpines/spineTable.test.ts -u`

- [ ] **Step 4: Note the change of role on the old test**

In `src/lib/strokeSchema/spineError.test.ts`, add to the header comment:

```
 * SINCE 2026-08-13 THIS MEASURES THE SEED, NOT THE SHIPPED MAPPING.
 * Stretch handles now take their axis from the generated spine tables
 * (src/data/strokeSpines/, see spineTable.test.ts); mapNormToRealBox survives
 * only as the seed hint the offline matcher starts from. The numbers below are
 * still the reason that replacement happened, so they stay pinned here.
```

- [ ] **Step 5: Run everything and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`

```bash
git add src/lib/strokeSpines/spineTable.test.ts src/lib/strokeSpines/__snapshots__ src/lib/strokeSchema/spineError.test.ts
git commit -m "Verify committed spine tables against the font binaries"
```

---

### Task 7: Convert a spine into a block's text-unit anchor

**Files:**
- Create: `src/lib/strokeSpines/anchorFromSpine.ts`
- Create: `src/lib/strokeSpines/anchorFromSpine.test.ts`

**Interfaces:**
- Consumes: `StrokeSpine` from `./types`.
- Produces: `spineToBlockSpace(spine, opts): SpineAnchor | null` where
  `opts = { gx: number; gy: number; fontSize: number; unitsPerEm: number }` and
  `SpineAnchor = { anchor: {x,y}; dragOrigin: {x,y}; points: {x,y}[]; bandWidth: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/strokeSpines/anchorFromSpine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spineToBlockSpace } from "./anchorFromSpine";
import type { StrokeSpine } from "./types";

const spine: StrokeSpine = {
  strokeId: "S_BODY_1",
  zoneIndex: 0,
  points: [
    { x: 100, y: 200, radius: 40 },
    { x: 300, y: 260, radius: 60 },
    { x: 500, y: 200, radius: 50 },
  ],
};

const opts = { gx: 10, gy: 90, fontSize: 100, unitsPerEm: 1000 };

describe("spineToBlockSpace", () => {
  it("scales by fontSize/unitsPerEm, offsets by the pen origin, and flips Y", () => {
    const out = spineToBlockSpace(spine, opts)!;
    // 100 font units at 100px/1000upm = 10px, plus gx 10 => 20.
    // y is font-units-up; canvas is down, so 200 => 90 - 20 = 70.
    expect(out.anchor).toEqual({ x: 20, y: 70 });
    expect(out.dragOrigin).toEqual({ x: 60, y: 70 });
    expect(out.points).toHaveLength(3);
    expect(out.points[1]).toEqual({ x: 40, y: 64 });
  });

  it("sizes the band from the widest radius on the spine, not a constant", () => {
    // Widest radius 60 units = 6px, so a full stroke width of 12px.
    expect(spineToBlockSpace(spine, opts)!.bandWidth).toBeCloseTo(12, 6);
  });

  it("keeps the band usable when a spine is hairline thin", () => {
    const thin: StrokeSpine = {
      ...spine,
      points: [
        { x: 0, y: 0, radius: 0.01 },
        { x: 10, y: 0, radius: 0.01 },
      ],
    };
    expect(spineToBlockSpace(thin, opts)!.bandWidth).toBeGreaterThanOrEqual(4);
  });

  it("returns null for a degenerate spine rather than an unusable axis", () => {
    expect(spineToBlockSpace({ ...spine, points: [spine.points[0]] }, opts)).toBeNull();
    expect(
      spineToBlockSpace(
        { ...spine, points: [spine.points[0], { ...spine.points[0] }] },
        opts
      )
    ).toBeNull();
  });

  it("scales with fontSize", () => {
    const big = spineToBlockSpace(spine, { ...opts, fontSize: 200 })!;
    expect(big.anchor.x).toBe(10 + 20);
    expect(big.bandWidth).toBeCloseTo(24, 6);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/strokeSpines/anchorFromSpine.test.ts`
Expected: FAIL — cannot resolve `./anchorFromSpine`.

- [ ] **Step 3: Implement**

Create `src/lib/strokeSpines/anchorFromSpine.ts`:

```ts
import type { StrokeSpine } from "./types";

export type SpineAnchor = {
  anchor: { x: number; y: number };
  dragOrigin: { x: number; y: number };
  /** The whole spine in block-text units, stored on the handle for change 2's later use. */
  points: { x: number; y: number }[];
  bandWidth: number;
};

/** Below this the axis is too short to displace anything meaningfully. */
const MIN_AXIS_PX = 1e-3;
/** A hairline stroke still needs a grabbable band. */
const MIN_BAND_PX = 4;

/**
 * A spine in font units becomes an axis in the block's text units.
 *
 * `gx`/`gy` come straight off the glyph's own GlyphHitBox (ShapedText.tsx),
 * which already carries the pen origin — the same origin the renderer draws
 * that glyph at. The Y negation is the font's y-up convention against canvas
 * y-down, the one flip mapNormToRealBox used to perform.
 *
 * Band width comes from the spine's own widest radius rather than the old
 * hardcoded 20: radius is the distance to the outline, so twice it is the
 * local stroke width, which is the region a stroke edit should actually reach.
 */
export function spineToBlockSpace(
  spine: StrokeSpine,
  opts: { gx: number; gy: number; fontSize: number; unitsPerEm: number }
): SpineAnchor | null {
  const { gx, gy, fontSize, unitsPerEm } = opts;
  if (!(unitsPerEm > 0) || !(fontSize > 0)) return null;
  if (spine.points.length < 2) return null;

  const scale = fontSize / unitsPerEm;
  const points = spine.points.map((p) => ({ x: gx + p.x * scale, y: gy - p.y * scale }));

  const anchor = points[0];
  const dragOrigin = points[points.length - 1];
  if (Math.hypot(dragOrigin.x - anchor.x, dragOrigin.y - anchor.y) < MIN_AXIS_PX) return null;

  const widest = spine.points.reduce((m, p) => Math.max(m, p.radius), 0);
  const bandWidth = Math.max(MIN_BAND_PX, widest * 2 * scale);

  return { anchor, dragOrigin, points, bandWidth };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/strokeSpines/anchorFromSpine.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/strokeSpines/anchorFromSpine.ts src/lib/strokeSpines/anchorFromSpine.test.ts
git commit -m "Convert a font-unit spine into a block-space stretch axis"
```

---

### Task 8: Attach the spine to the catalog

**Files:**
- Modify: `src/lib/strokeSchema/deriveCatalog.ts`
- Modify: `src/lib/strokeSchema/glyphLookup.ts`
- Test: `src/lib/strokeSchema/glyphLookup.test.ts`

**Interfaces:**
- Consumes: `loadSpineTable`, `getSpine`, `getSpineTableIfLoaded` (Task 5).
- Produces: `StretchDefinition.spine?: StrokeSpine`, and `useGlyphSchemaCatalog(shapableText, glyphs, font?, fontFamily?)` — a fourth optional parameter. Existing three-argument callers keep working and simply get no spines.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/strokeSchema/glyphLookup.test.ts`:

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { loadSpineTable } from "../strokeSpines/registry";

describe("useGlyphSchemaCatalog spine attachment", () => {
  it("attaches a spine when the font has a table entry for that glyph", async () => {
    const table = await loadSpineTable("TahaNaskhRegular");
    const [glyphIdStr, entry] = Object.entries(table!.glyphs)[0];
    const spine = entry.spines[0];

    // One glyph, the exact id the table has an entry for. The schema lookup
    // still runs off the source character, so use the letter that schema
    // describes.
    const glyphs = [{ g: Number(glyphIdStr), cl: 0, ax: 500, dx: 0, dy: 0 }];

    const { result } = renderHook(() =>
      useGlyphSchemaCatalog("ب", glyphs as never, null, "TahaNaskhRegular")
    );

    await waitFor(() => {
      const defs = result.current[0] ?? [];
      const withSpine = defs.find((d) => d.strokeId === spine.strokeId);
      expect(withSpine?.spine?.points).toEqual(spine.points);
    });
  });

  it("leaves spine undefined for a font with no table", async () => {
    const glyphs = [{ g: 1, cl: 0, ax: 500, dx: 0, dy: 0 }];
    const { result } = renderHook(() =>
      useGlyphSchemaCatalog("ب", glyphs as never, null, "Ruqaa")
    );
    for (const def of result.current[0] ?? []) expect(def.spine).toBeUndefined();
  });
});
```

If `@testing-library/react` is not already a devDependency, install it in this step: `npm i -D @testing-library/react` — check `package.json` first rather than assuming.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/strokeSchema/glyphLookup.test.ts`
Expected: FAIL — `useGlyphSchemaCatalog` takes three parameters and no definition has `spine`.

- [ ] **Step 3: Add the field**

In `src/lib/strokeSchema/deriveCatalog.ts`, add to `StretchDefinition` (after `dragNorm`):

```ts
  /**
   * The stroke's spine on this specific font's real glyph, from the generated
   * tables in src/data/strokeSpines/ — attached by useGlyphSchemaCatalog, not
   * by deriveStretchCatalog, since it is the only place that knows the font.
   *
   * Present = the axis is measured against real ink. Absent = the offline
   * matcher could not verify a match for this stroke on this font, and the
   * stroke offers no handle at all. `anchorNorm`/`dragNorm` remain only as the
   * offline matcher's seed; nothing at runtime maps them any more.
   */
  spine?: StrokeSpine;
```

Import the type: `import type { StrokeSpine } from "../strokeSpines/types";`

- [ ] **Step 4: Attach it in the hook**

In `src/lib/strokeSchema/glyphLookup.ts`, add the parameter and a small effect-backed load. The hook currently returns a `useMemo`; make the table a piece of state so the catalog recomputes once it arrives:

```ts
export function useGlyphSchemaCatalog(
  shapableText: string,
  glyphs: HarfBuzzGlyph[],
  font?: Font | null,
  fontFamily?: string
): Record<number, StretchDefinition[]> {
  const [spineTable, setSpineTable] = useState<SpineTable | null>(
    fontFamily ? getSpineTableIfLoaded(fontFamily) : null
  );

  useEffect(() => {
    if (!fontFamily) {
      setSpineTable(null);
      return;
    }
    let cancelled = false;
    void loadSpineTable(fontFamily).then((t) => {
      if (!cancelled) setSpineTable(t);
    });
    return () => {
      cancelled = true;
    };
  }, [fontFamily]);

  return useMemo(() => {
    // ...existing body unchanged, except both places that build `result[i]`...
  }, [shapableText, glyphs, font, spineTable]);
}
```

Both `result[i] = deriveStretchCatalog(schema).map(...)` sites become:

```ts
      result[i] = deriveStretchCatalog(schema).map((d) => ({
        ...d,
        cluster,
        spine: getSpine(spineTable, glyphs[i].g, d.strokeId, d.zoneIndex) ?? undefined,
      }));
```

- [ ] **Step 5: Thread the font family from the caller**

Find every `useGlyphSchemaCatalog(` call site (`grep -rn "useGlyphSchemaCatalog(" src/`) and pass the block's `fontFamily` as the fourth argument. Do not change the signature to required — a caller that cannot supply it should degrade to no spines rather than fail to compile.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/strokeSchema/`
Expected: PASS, including the pre-existing `glyphLookup.test.ts` cases unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/lib/strokeSchema/deriveCatalog.ts src/lib/strokeSchema/glyphLookup.ts src/lib/strokeSchema/glyphLookup.test.ts package.json package-lock.json
git commit -m "Attach each font's real stroke spine to the stretch catalog"
```

---

### Task 9: Create handles from the spine

**Files:**
- Modify: `src/types.ts:19-50`
- Modify: `src/App.tsx:745-848`

**Interfaces:**
- Consumes: `spineToBlockSpace` (Task 7), `StretchDefinition.spine` (Task 8), `GlyphHitBox.glyphId`/`gx`/`gy` (already present, `src/components/ShapedText.tsx:111-120`).
- Produces: handles whose `anchorX`/`anchorY`/`dragOriginX`/`dragOriginY`/`bandWidth`/`spine` come from real ink.

- [ ] **Step 1: Add the field to the handle type**

In `src/types.ts`, add to `GlyphStretchHandle` after `lengthDots`:

```ts
  /**
   * The stroke's spine in this block's text units, captured at creation from
   * the generated tables (src/data/strokeSpines/). Nothing reads it yet —
   * displacement still uses the anchor->drag axis, which is this polyline's
   * two ends. It is stored so change 2 (spine displacement, `axis: "path"`)
   * has its input without a second migration, and so a handle stays
   * self-describing across save/load. Absent on every handle created before
   * re-anchoring, and on any created for a stroke with no verified match.
   */
  spine?: { x: number; y: number }[];
```

- [ ] **Step 2: Write the failing test**

There is no test harness that mounts `App.tsx`, and adding one is out of scope. The behaviour is covered by Task 10's end-to-end test, which constructs the handle exactly as `setStretchFactor` does. Write that test first — go do Task 10's Steps 1-2 now, confirm it fails, then return here. This is the one place in this plan where the failing test lives in a different task, and it is called out rather than skipped.

- [ ] **Step 3: Use the spine in `setStretchFactor`**

In `src/App.tsx`, replace the block from `const box = (glyphBoxesByBlock[blockId] ?? [])...` through `const bandWidth = ...` (currently lines 784-802) with:

```ts
      const box = (glyphBoxesByBlock[blockId] ?? []).find((b) => b.glyphIndex === glyphIndex);

      // The axis comes from this font's real glyph, not from a proportion of
      // its bounding box. Phase C measured that proportion at median 0.37
      // nuqta / p90 1.43 from the ink it claimed to describe; the spine is
      // sampled off the glyph's own medial axis. See
      // docs/superpowers/specs/2026-08-13-stroke-spine-reanchoring-design.md.
      //
      // No spine means the offline matcher could not verify a match for this
      // stroke on this font, and we create nothing — deliberately, rather than
      // falling back to the mapping this replaced. Absence is the out-of-scope
      // mechanism, the same one nuqtaEmRatio's null already is.
      if (!definition.spine || !box) return;

      // unitsPerEm comes from the spine table rather than from shaping state,
      // which App.tsx does not hold. Safe because a definition.spine only
      // exists if that table was loaded to produce it.
      const upm = getSpineTableIfLoaded(block.fontFamily)?.unitsPerEm;
      if (!upm) return;

      const placed = spineToBlockSpace(definition.spine, {
        gx: box.gx,
        gy: box.gy,
        fontSize: block.fontSize,
        unitsPerEm: upm,
      });
      if (!placed) return;

      const anchorPoint = placed.anchor;
      const dragOriginPoint = placed.dragOrigin;
      const dragPoint = {
        x: anchorPoint.x + (dragOriginPoint.x - anchorPoint.x) * definition.maxFactor,
        y: anchorPoint.y + (dragOriginPoint.y - anchorPoint.y) * definition.maxFactor,
      };
      const bandWidth = placed.bandWidth;
```

Add the two imports this needs at the top of `App.tsx`: `spineToBlockSpace` from `./lib/strokeSpines/anchorFromSpine` and `getSpineTableIfLoaded` from `./lib/strokeSpines/registry`.

Note the early `return`s replace what used to be a fallback (`box ? mapNormToRealBox(...) : { x: block.x, y: block.y }`). That fallback placed a handle at the block's origin when no box was available, which was never meaningful; creating nothing is both more honest and what the gate decision requires.

- [ ] **Step 4: Store the polyline on the handle**

In the same function's `upsertGlyphEdit` updater, add to the new handle object after `lengthDots: definition.lengthDots,`:

```ts
              spine: placed.points,
```

- [ ] **Step 5: Remove the now-dead import**

`mapNormToRealBox` is no longer used in `App.tsx`. Remove it from the import list. Leave `schemaGeometry.ts` itself alone — `deriveStretchCatalog` still calls `normalizePoint`, and `spineError.test.ts` still measures `mapNormToRealBox`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all green, and Task 10's end-to-end test now passing.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/App.tsx
git commit -m "Create stretch handles from the real glyph's spine"
```

---

### Task 10: End-to-end test on real fonts

**Files:**
- Create: `src/lib/strokeSpines/endToEnd.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `src/lib/strokeSpines/endToEnd.test.ts`. Copy the `shapeReal` helper verbatim from `src/lib/justify.test.ts` (lines 1-119) — the `createRequire` loading of harfbuzzjs is mandatory, since a static ESM import throws under Vitest's Node ESM loader before any test code runs. Do not invent a second loading mechanism.

```ts
/**
 * The whole re-anchoring path, on real fonts and real shaping.
 *
 * This is the suite that would have caught the failure re-anchoring exists to
 * fix: a fabricated-fixture version of it would pass while every anchor landed
 * in empty space. Same precedent as diacritics.test.ts and joinPins.fonts.test.ts.
 */
import { describe, it, expect } from "vitest";
import { loadSpineTable, getSpine } from "./registry";
import { spineToBlockSpace } from "./anchorFromSpine";
import { deriveStretchCatalog } from "../strokeSchema/deriveCatalog";
import { getStrokeSchema } from "../strokeSchema/registry";
import { classifyJoiningForms } from "../arabicJoining";
import { contoursToPolygons, splitContours } from "../glyphContours";
import { pointInPolygon } from "../svgPath";
import { applyGlyphEdit } from "../glyphEdits";
import { computeJoinPins, PIN_RADIUS_NUQTA } from "../joinPins";
import { nuqtaPx } from "../nuqta";

// ...shapeReal, copied from justify.test.ts...

const FONT_SIZE = 120;
const CASES = [
  { family: "TahaNaskhRegular", file: "TahaNaskh-Regular.ttf", word: "بسم" },
  { family: "Amiri", file: "Amiri.ttf", word: "حرف" },
  { family: "Kufi", file: "Kufi.ttf", word: "سلام" },
];

describe.each(CASES)("$family / $word", ({ family, file, word }) => {
  it("places every anchor it creates on real ink", async () => {
    const table = await loadSpineTable(family);
    expect(table).not.toBeNull();
    const { glyphs, font, unitsPerEm } = await shapeReal(word, file);
    const classified = classifyJoiningForms(word);

    let checked = 0;
    let penX = 0;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      const scale = FONT_SIZE / unitsPerEm;
      const gx = (penX + (g.dx ?? 0)) * scale;
      const gy = -(g.dy ?? 0) * scale;
      penX += g.ax ?? 0;

      const entry = classified[g.cl ?? 0];
      if (!entry?.form) continue;
      const schema = getStrokeSchema(
        entry.codepoint.toString(16).toUpperCase().padStart(4, "0"),
        entry.form
      );
      if (!schema) continue;

      const glyphObj = font.glyphs.get(g.g);
      if (!glyphObj) continue;
      const polygons = contoursToPolygons(
        splitContours(glyphObj.getPath(gx, gy, FONT_SIZE).commands)
      );

      for (const def of deriveStretchCatalog(schema)) {
        const spine = getSpine(table, g.g, def.strokeId, def.zoneIndex);
        if (!spine) continue;
        const placed = spineToBlockSpace(spine, { gx, gy, fontSize: FONT_SIZE, unitsPerEm });
        if (!placed) continue;
        checked++;
        const inside = polygons.some((p) => pointInPolygon(placed.anchor.x, placed.anchor.y, p));
        expect(inside, `${family} ${def.strokeId} anchor off ink`).toBe(true);
      }
    }
    // A run that silently checked nothing would pass vacuously.
    expect(checked, "no spine-backed handles were exercised").toBeGreaterThan(0);
  });

  it("still moves a pinned join by 0px at every factor", async () => {
    const { glyphs, font, unitsPerEm } = await shapeReal(word, file);
    const nuqta = nuqtaPx(family, FONT_SIZE);
    expect(nuqta).not.toBeNull();
    const pins = computeJoinPins({
      glyphs,
      font,
      fontSize: FONT_SIZE,
      unitsPerEm,
      pinRadius: nuqta! * PIN_RADIUS_NUQTA,
    });

    for (const [glyphIndex, glyphPins] of pins) {
      for (const pin of glyphPins) {
        for (const factor of [1, 1.25, 1.5, 2]) {
          const handle = {
            id: "h",
            anchorX: pin.x - 50,
            anchorY: pin.y,
            dragOriginX: pin.x + 50,
            dragOriginY: pin.y,
            dragX: pin.x + 100,
            dragY: pin.y,
            bandWidth: 60,
            factor,
            minFactor: 1,
            maxFactor: 2,
          };
          const moved = applyGlyphEdit(
            pin.x,
            pin.y,
            { glyphIndex, stretches: [handle] },
            0,
            glyphPins
          );
          expect(Math.hypot(moved.x - pin.x, moved.y - pin.y)).toBeLessThan(1e-6);
        }
      }
    }
  });
});
```

Confirm the exact font filenames in `public/fonts/` before running — `ls public/fonts/` — and fix `CASES` to match. Do not guess.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/strokeSpines/endToEnd.test.ts`
Expected: FAIL. Before Task 9 the first test fails on the missing `spine` wiring; the second should already pass, since join pinning shipped in phase A — if it fails, stop and investigate, because that is a regression in shipped behaviour, not a gap in this feature.

- [ ] **Step 3: Return to Task 9, then re-run**

Run: `npx vitest run src/lib/strokeSpines/endToEnd.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/strokeSpines/endToEnd.test.ts
git commit -m "Check the re-anchored axis lands on ink across three real fonts"
```

---

### Task 11: Documentation and the hand-verification pass

**Files:**
- Modify: `CLAUDE.md` (the stroke-schema section, and the "adding a font" checklist)
- Modify: `PROGRESS.md`
- Create: `src/components/guide/sections/` — only if the coverage report shows a user-visible gap

- [ ] **Step 1: Update the "adding a font" checklist**

`CLAUDE.md` says a font is a five-place edit. Make it six, adding: regenerate that font's spine table with `python3 scripts/deriveStrokeSpines.py <Family>`, and note the distinct failure mode — omitting it means the font shows no schema-backed stretch handles at all, and `spineTable.test.ts`'s SHA-256 check is what catches a *stale* table for a font that already had one.

- [ ] **Step 2: Rewrite the axis-derivation bullet**

In the stroke-schema section, the bullet beginning "**No manual dragging — the axis is auto-derived from the schema's own geometry**" describes the mapping this replaced. Rewrite it to describe the spine tables, keeping the history in one sentence (the proportional mapping existed, Phase C measured it, it is now only the offline matcher's seed). Fix the two stale references to `addStretchHandle` — the function is `setStretchFactor`, and the name has been wrong in this file since before this work.

- [ ] **Step 3: Update the blocked list**

In `PROGRESS.md`, move schema-driven stroke spines and `protectedZones` out of "Blocked on a design" into "Not built yet": their prerequisite now exists in code, not just in a spec. Add a Shipped entry dated to the merge. Record the coverage number and say plainly that some letter/font combinations offer no handle where they used to — that is the gate working, and it is the one user-visible regression in this change.

- [ ] **Step 4: Hand-verify in a browser**

`npm run dev`, then check by hand. Konva's hover-mounted handles do not take scripted drags, so these cannot be automated:

1. A handle appears on the stroke its label names — check one letter each in TahaNaskh (Naskh), Thuluth, Kufi and Urdu.
2. Stretching a connector no longer drags unrelated parts of the letter.
3. The `حرف` cleft repro in Amiri is no worse than its current "almost imperceptible".
4. A stroke whose entry the gate rejected offers no slider, and the Morph panel says nothing misleading about it.

Record what was checked, and what was not, in `PROGRESS.md`'s "Verification debt" section. Do not claim more than was actually clicked.

- [ ] **Step 5: Full verification loop and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`

```bash
git add CLAUDE.md PROGRESS.md src/components/guide/
git commit -m "Document stroke-spine re-anchoring and record what was verified by hand"
```
