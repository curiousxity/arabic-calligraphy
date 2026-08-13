# Stroke spine re-anchoring

**Status:** designed 2026-08-13, not started.
**Unblocks:** changes 2 and 4 of
`2026-08-12-per-stroke-editing-design.md` (spine displacement and
`protectedZones` enforcement), which Phase C stopped.
**Does not fix:** the kashida dial's failure to widen a run — see
"What this does not solve" below.

## The problem

A stretch handle's axis is derived by normalizing the schema's own node
coordinates against the schema's bounding box, then mapping that proportion
onto the real glyph's bounding box (`schemaGeometry.ts`'s `normalizePoint` /
`mapNormToRealBox`). Phase C measured how far the result lands from real ink,
across all 105 schemas × 5 fonts:

    landed inside ink   14.5%
    median 0.37 nuqta   p90 1.43   p99 2.98   max 4.68

A stroke feature is about one nuqta thick, so at p90 the mapped node sits more
than a whole stroke-width from the stroke it is supposed to describe. Phase C
also ruled out the three cheaper explanations: it is not distance from Naskh
(Kufi has the best median of the five fonts), not per-form skeleton reuse (all
four joining forms sit in one band), and not only compound letters (a
single-component glyph still lands outside the ink 90% of the time). The
mechanism itself is what is inaccurate — the schema's box and the font's box
are not in correspondence beyond "same letter, roughly this region".

Everything downstream inherits that error: the auto-derived contour mask, the
band the displacement falls off across, and — once changes 2 and 4 are built —
which part of a letter gets frozen as protected. Change 4 is why this cannot
simply be shipped anyway: a protected zone in the wrong place does not fail to
protect, it freezes the wrong part of the letter, which is a new failure mode
rather than a fixed one.

## The idea

Stop mapping one bounding box onto another. Match the schema's stroke
skeleton against the **real glyph's medial axis**, which is the same kind of
object, and store the result.

The key improvement is in what the remaining approximation is. Today a node's
position is a 2-D proportion within a box that does not correspond. After this,
it is a 1-D arc-length proportion **along a curve that is already correct** —
so the error reduces to "did we match the right branch" plus "is the
parameterization aligned along it", both far better conditioned. Branch
matching can fail, and where it does we ship nothing rather than a guess.

## Decisions taken

| Question | Decision |
|---|---|
| Scope | Re-anchoring only. Advance-level kashida elongation is a separate design. |
| Where it runs | Offline script, committed table. `public/fonts/` is a closed set. |
| Poor matches | Omitted. The feature goes dark for that stroke, as `nuqta.ts` already does with `null`. |
| Existing saves | Untouched. A saved handle keeps its stored coordinates. |

## Architecture

### The artifact

`scripts/deriveStrokeSpines.py`, beside the existing `measureNuqta.py` /
`mergePuaGlyphs.py` / `renderFontSample.py` tooling, emits one JSON file per
font into `src/data/strokeSpines/<FontFamily>.json`.

**Keyed by glyph id, not by letter.** The obvious key is
`(font, baseLetter, joiningForm)`, matching the schema registry. The better one
is the font's own glyph index: a spine is a property of an *outline*, and the
outline is whatever HarfBuzz actually selected. Keying on the glyph id means
nothing has to trust that `classifyJoiningForms` agrees with the font's GSUB,
and a font that fuses or substitutes unexpectedly either has an entry for the
glyph it really drew or has none. `useGlyphSchemaCatalog` already holds
`glyph.g`, so the lookup is free.

Each entry stores, per `(strokeId, zoneIndex)`, a **polyline in font units** —
not two endpoints. Endpoints alone would re-block change 2 the moment
`axis: "path"` needs a real path, and the polyline is what the matching
produces anyway. Anchor and drag are its ends. Each point carries the medial
axis's distance-to-boundary at that point, which `medial_axis` returns for
free.

```json
{
  "font": "TahaNaskhRegular",
  "unitsPerEm": 2048,
  "fontSha256": "…",
  "glyphs": {
    "417": {
      "schemaGlyph": "SEEN_MEDIAL",
      "spines": [
        {
          "strokeId": "S_CONNECT_1",
          "zoneIndex": 0,
          "points": [[312, -14, 41], [388, -9, 44], [451, -6, 40]]
        }
      ]
    }
  }
}
```

Point triples are `[x, y, radius]` in font units.

**Loaded per font, lazily.** 15 fonts × ~120 glyphs × ~3 strokes is too much
for the main bundle. `src/lib/strokeSpines/registry.ts` uses `import.meta.glob`
with dynamic import — the same auto-discovery convention as
`strokeSchema/registry.ts` and the guide registry, so dropping a file in is
again the whole integration step — and fetches only the font in use. A font
with no file behaves exactly like a font missing from `NUQTA_EM_RATIO`: the
feature goes dark rather than guessing.

### The offline algorithm

Per font, per glyph:

1. **Outline → mask.** Flatten the contours with a fonttools pen and rasterize
   to a binary mask at em → 512px, filling by nonzero winding so counters stay
   holes.
2. **Medial axis.** `skimage.morphology.medial_axis` returns the skeleton and
   the distance-to-boundary at every skeleton pixel.
3. **Prune** spur branches shorter than half a nuqta. The threshold is in the
   letterform's own units because `NUQTA_EM_RATIO` already exists.
4. **Graph.** Endpoints and junctions become vertices, the pixel runs between
   them become branch edges. Disconnected components fall out naturally, which
   is how dots separate from the body.
5. **Match schema strokes to branches.** Score each (stroke, branch) pair on
   distance from the current proportional mapping's seed, orientation
   agreement, length ratio against `lengthDots × nuqta`, and a component-class
   check (a `DOT` component may only match a small isolated component; a body
   stroke may not). Solve as an assignment problem with an explicit "no match"
   option above a cost threshold, so a glyph may have some strokes anchored and
   others omitted rather than all-or-nothing.
6. **Sample the zone.** A stretch zone spans `fromNode → toNode`, a sub-span of
   the stroke's nodes. Take that span's arc-length proportion within the schema
   stroke and cut the corresponding arc-length span out of the matched branch.

Dev-only Python dependencies: numpy, Pillow, scikit-image, alongside the
existing fonttools. Documented in `scripts/FONTS.md`. Nothing new ships to the
browser.

**Known gotcha, inherited:** `Kufi2.ttf` and `NotoSans.ttf` are variable fonts
whose `gvar` glyph count disagrees with `maxp`, and fontTools throws on
`getGlyphSet()` until `gvar` is dropped. Any new offline font tooling hits this.

### The quality gate

Phase C's metric is unusable here. A spine sampled off the medial axis is
inside the ink *by construction*, so distance-to-ink scores a perfect zero even
when the wrong branch was matched. Containment stops being evidence and becomes
an assertion.

What can actually go wrong is the match, so the gate targets that. An entry
ships only if all four hold:

- **Length agreement** — the matched span's length against
  `lengthDots × nuqta`, within roughly 0.5×–2×. A tooth matched to a body
  stroke fails immediately.
- **Assignment margin** — the cost gap between the best branch and the
  runner-up. An ambiguous match is exactly the case where shipping nothing is
  better.
- **Connectivity consistency** — strokes sharing a node in the schema graph
  must map to branches meeting at a junction. Violations are counted per glyph;
  a glyph over threshold is dropped wholesale, because a self-inconsistent
  match means the letter's structure was misread, not one stroke.
- **Cross-font agreement** — the same `(letter, form)` across the in-scope fonts
  should give spines that agree once normalized by em and nuqta. A font
  disagreeing with the consensus for a letter the others agree on is dropped.
  This is the strongest cheap signal available, and it is the same "two
  independent methods must agree, and where they disagree a human decides"
  discipline that produced the nuqta table.

The old proportional seed is **not** a gate — at p90 1.43 nuqta it can only
catch gross errors, so it gets a generous sanity bound and nothing more.

**Plus an eyeball pass.** The script grows a mode that renders each glyph with
its matched spines overlaid, as a per-font contact sheet, reusing
`renderFontSample.py`. Coverage is reported per font and per letter so what
went dark is visible rather than inferred. The nuqta table was accepted this
way and two fonts were dropped on the strength of it.

### What changes inside the app

Deliberately small. This makes the anchor correct; it does not touch the
displacement engine.

- **New** `src/lib/strokeSpines/registry.ts`: `getSpine(fontFamily, glyphId,
  strokeId, zoneIndex)`, async, cached per font, resolved when a block's font
  changes.
- **One join point.** `useGlyphSchemaCatalog` already holds the font family and
  each shaped glyph's `glyph.g`, so it attaches the polyline to the
  `StretchDefinition` it is already building. Nothing else in the catalog
  changes.
- **`addStretchHandle` gets simpler.** Today it maps `anchorNorm`/`dragNorm`
  onto the glyph's hit box from `glyphBoxesByBlock`. With a spine it converts
  the polyline from font units into the block's text units —
  `p × fontSize / unitsPerEm`, offset by the glyph's pen origin, the same
  transform `ShapedText` already applies per glyph — and takes `anchor` and
  `dragOrigin` from the polyline's ends. `dragX`/`dragY` still extrapolate by
  `maxFactor`. The hit box is no longer needed for spine-backed handles.
- **The handle stores the whole polyline** — `spine?: Point[]` on
  `GlyphStretchHandle`, optional and ignored by the current displacement math.
  Nothing reads it yet; it is there so change 2 has its input without a second
  migration, and so a handle stays self-describing across save/load.
- **Band width from real geometry.** Each spine point's stored radius sizes
  `bandWidth` in place of the current hardcoded 20. Used only to size the band;
  the displacement formula is untouched.
- **`deriveContourMask` improves for free.** It already samples along the
  anchor→drag segment; that segment now lies on real ink, so the auto-derived
  mask lands on the intended contour more often with no code change.

**One behaviour change to be explicit about.** A stretch zone whose entry the
gate rejected offers **no handle at all**, including on letters that have one
today. Combined with leaving saved projects untouched, an existing project can
keep a handle the editor would no longer create. That is coherent, but it needs
a line in the user guide and in `PROGRESS.md` rather than being discovered.

## Testing

`spineTable.test.ts` runs in Node with `fs` access to `public/fonts/`, as
`spineError.test.ts` and `joinPins.fonts.test.ts` already do:

- **Stale-table detection.** Each JSON stores the SHA-256 of the font it was
  generated from; the test hashes the real file and compares. A font
  regenerated without re-running the script fails loudly instead of silently
  anchoring to outlines that no longer exist. This is the highest-value
  assertion here — it makes automatic exactly the failure the "adding a font is
  a five-place edit" warning in `CLAUDE.md` exists to describe.
- **Containment.** Every spine point inside the real ink, via the same
  `contoursToPolygons` / `pointInPolygon` machinery Phase C used.
- **Length agreement** against `lengthDots × nuqta`.
- **Referential integrity** — every `(schemaGlyph, strokeId, zoneIndex)`
  resolves in the schema registry; the file's `unitsPerEm` matches the font's.
- **Coverage characterization** — counts per font and per letter, pinned so a
  regeneration that quietly loses letters is visible. Same discipline as
  `EXPECTED_COVERAGE` in `joinPins.fonts.test.ts`.

Assignment margin and connectivity are **generation-time only** — the graph is
not available at runtime. They live in the script's report, and this document
says so rather than implying the test covers them.

**End-to-end**, over a few real font × word pairs: shape, build the catalog,
construct handles as `addStretchHandle` does, assert the anchor lands on ink,
and assert the join-invariance property (0px movement at a pinned join across
every factor) still holds.

**`spineError.test.ts` keeps passing unchanged.** It characterizes
`mapNormToRealBox`, which survives as the matching seed. Its header needs one
line saying it now measures the seed rather than the shipped mapping, or the
next reader will assume it is stale.

## Rollout

1. Script against TahaNaskh alone → contact sheet → tune matching.
2. Extend to all 15 in-scope fonts; read the coverage report.
3. Wire the runtime and ship in one change. **No feature flag** — a flag means
   maintaining both geometries at once, which is precisely what was avoided for
   saved projects.
4. Hand verification (below).
5. Typecheck, lint, tests, build.

`CLAUDE.md`'s "adding a font" checklist grows a sixth place: regenerate the
font's spine file.

## Hand verification

Konva's hover-mounted handles do not take scripted drags, so these are a
human's to click through. Named here so they do not become verification debt:

1. A handle appears on the stroke its label names, for a sample across Naskh,
   Thuluth, Kufi and Urdu.
2. Stretching a connector no longer drags unrelated parts of the letter.
3. The original `حرف` cleft repro is no worse than its current "almost
   imperceptible".
4. A letter whose entry the gate rejected offers no handle, and says nothing
   misleading in the Morph panel.

## What this does not solve

- **Change 2 and change 4 are unblocked, not built.** Spine displacement
  (`axis: "path"`) and `protectedZones` enforcement remain their own work; this
  supplies their input.
- **The kashida dial still will not widen a run.** Verified in a browser
  2026-08-13: the dial leaves the rendered extent unchanged to within a pixel
  and the app's own measurement has it shrinking slightly (60.505px at dial 0 →
  60.105px at 100), so "Fit width" always reports "Reached maximum stretch".
  Re-anchoring will not fix this, and it is important not to expect it to:
  displacing outline points never moves `penX += advance`, so neighbouring
  letters do not separate and the run's outer extent stays pinned to the first
  and last glyph's outer edges. A real kashida elongates a connector and pushes
  the following letters along — an advance-level change that interacts directly
  with join pins, hit boxes, block bounds and every renderer. Its own design.
  Measured numbers in `PROGRESS.md`'s Known limitations.
- **Ruq'ah and Diwani stay out of scope**, for the reasons `nuqta.ts` records:
  no measured nuqta, and every schema declares `calligraphicModel: "naskh"`.
  `public/fonts/` holds 17 files; 15 have a measured nuqta, and those 15 are
  the in-scope set throughout this document. The nuqta is not incidental here
  — it is the unit both the spur-pruning threshold and the length-agreement
  gate are expressed in, so a font without one cannot be processed at all.
  That is the same `null`-means-out-of-scope mechanism, reused rather than
  reinvented.
