# Progress

What has shipped, what is known-broken, and what is deliberately not built
yet.

**What belongs here, and what does not.** This file is the *chronological and
status* record. It does not explain how anything works — that is `CLAUDE.md`,
which is organised by subsystem — and it does not argue for designs, which is
`docs/superpowers/specs/`. When a limitation has a full write-up elsewhere,
link it rather than restating it, or the two copies will drift and the wrong
one will be believed.

Version numbering: `package.json`'s patch is bumped automatically on every
commit by a pre-commit hook, so version numbers count commits rather than
releases. Minor and major bumps are deliberate and hand-made.

Current: **0.1.x**, pre-1.0, actively developed.

---

## Known limitations

Real, reproducible, and currently unfixed. Each says whether it is a
regression, and what it would take to fix.

### Stroke stretching

- **Strokes deform instead of extending.** A stretch zone that the schema
  describes as following a curve is collapsed to a straight chord, so a
  feh's eye loop shears sideways and its counter pinches shut instead of
  growing around its curve. Separately, `ra-final`'s protected terminal is
  where displacement is *greatest* — the protection is inverted.
  **Blocked**, not merely unbuilt: both fixes need the schema's node
  coordinates mapped accurately onto real glyphs, and that mapping was
  measured on 2026-08-13 and is not accurate enough (median 0.37 nuqta, p90
  1.43, only 14.5% of mapped nodes landing inside the ink at all). See
  "Blocked on a design" below.
- **A trace of the join cleft remains.** Pinning joins made this much better
  — "almost imperceptible" on the original repro — but not zero. The pin is
  a point at the centre of the overlap while a seam is a region, so ink
  toward the edges still moves slightly. `PIN_RADIUS_NUQTA` is the dial;
  widening it also makes strokes unresponsive near their own joins, and no
  test can see that tradeoff. Accepted at its current setting.
- **Some letter pairs get no join protection at all.** Detection needs the
  two glyphs' outlines to physically overlap. Measured across 7 fonts × 6
  words, 5 pairs abut without overlapping and go unpinned, keeping the older
  tearing behaviour. Not a regression. Widening detection is new design work
  — a dilation radius large enough to catch abutting letters starts
  inventing joins between letters that merely pass near each other.
- **Thuluth gets no join protection on vocalized text.** It encodes its
  marks in the Private Use Area with no positioning offsets, defeating both
  signals the mark detector uses, so its marks read as base letters. The
  same blind spot stops the per-mark diacritic overlay arming on that font.
  One fix — reading the font's GDEF glyph classes — would solve both, but it
  touches a detector several features share.
- **Only plain text blocks get join pins.** Shape Fill tiles its run through
  a per-tile affine transform; pins in that space are separate work.
- **The kashida dial does not widen a run, so "Fit width" can never fit.**
  Verified in a browser 2026-08-13 on `بسم` in two fonts: cranking every
  stretch to its maximum leaves the ink's horizontal extent unchanged to
  within a pixel, and the app's own measurement has it *shrinking* slightly
  (60.505px at dial 0 → 60.105px at 100). Fit width therefore always reports
  "Reached maximum stretch", and applying its answer makes the block
  marginally narrower. The solver is not at fault — it measures what the
  renderer draws. The derived stretch axes point inward, and the run's
  outermost ink belongs to glyphs no interior stroke handle touches, since
  `penX += advance` never moves. Same root cause as the two blocked changes
  below: the schema→glyph mapping. Note this also falsifies
  `solveKashidaAmount`'s stated invariant that width is monotonically
  non-decreasing in the dial.

### Elsewhere

- **Glyph edits are keyed by glyph index**, so editing text *before* an
  edited letter can shift which letter the edit lands on after re-shaping.
  Affects stretch handles, per-glyph transforms and diacritic overrides
  alike. Diacritic overrides are re-validated each render and silently
  dropped if they land on a base letter; the others are not.
- **Stretch, glyph transforms and glyph rigs do not apply to text-on-path
  blocks.** Their glyphs are rotated to a curve tangent, which the
  straight-bounding-box maths behind those tools assumes away.
- **Cloud sync has no conflict resolution** beyond overwrite-by-name. Same
  project name saved from two devices: last write wins.

## Verification debt

Things that pass tests but have not been exercised by a human. Konva's
hover-mounted handles do not take scripted drags reliably, so anything
driven by them is unverifiable in CI by design.

- **Verified by hand 2026-08-13:** the join cleft on the original repro
  (much improved, see above); nuqta snap increments; the Alt bypass; the
  typed-precision field.
- **Verified by hand 2026-08-13, second pass:** nuqta snapping on Shape Fill
  blocks — passes, snapping to the correct half-nuqta grid off `lengthDots`
  (1.13 → 1.11, 1.27 → 1.22, 1.41 → 1.44). The auto-justify "fit to
  composition" round trip — **fails**, see the kashida entry under Known
  limitations. Quantization was not the cause; the two formulas are in step.

---

## Shipped

Reverse chronological. Dates are commit dates.

### 2026-08-13 — Per-stroke editing, phases A and B

The design's changes 3, 5 and 1. Full spec:
`docs/superpowers/specs/2026-08-12-per-stroke-editing-design.md`.

- **Fixed: stretching overshot its own axis.** Displacement along a stretch
  axis was unbounded and signed, so outline points past the drag origin
  travelled *further* than the drag itself and points behind the anchor
  travelled backwards. This was half the cause of the cleft at letter joins.
  Note this also changed how saved glyph-rig values render, deliberately —
  the same bug lived in the same shared function.
- **Fixed: stretching tore the seam between letters.** Joins are now found
  from where adjacent glyph outlines physically overlap and displacement is
  guarded to zero there, on the net result rather than per handle.
- **Fixed: any tashkeel silently disabled join protection entirely.** Found
  at the merge gate. HarfBuzz interleaves mark glyphs between base letters,
  and pairing was purely positional, so one diacritic destroyed adjacency
  and no join was found anywhere in the word. Pairing now skips marks.
- **Fixed: a font's shaper rounding noise could delete real joins.** Found
  by the re-review of the fix above. The shared mark detector reads any
  nonzero positioning offset as mark attachment, and one font emits offsets
  of 1–4 units out of 2048 on real letters. Marks are now only skipped when
  they also carry zero advance.
- **New: stretch measured in nuqta.** Snaps to whole and half nuqta off a
  per-font measured table, reading in calligraphers' units. Advisory — a
  checkbox, an Alt bypass, and a typed field that stays exact. Off-grid
  values round-trip through save/load untouched.
- **Internal: one kashida formula.** It had been duplicated in a state
  mutator and a pure solver that had to be kept in step by hand; quantization
  was exactly the change that would have split them.

### 2026-08-13 — Phase C measurement (investigation)

Measured the schema→real-glyph mapping across all 105 schemas × 5 fonts and
**stopped** changes 2 and 4 on the result. Committed as a characterization
test so an improved mapping fails loudly and prompts a re-run.

### 2026-08-12 — Font library and diagnosis

- Replaced a dead Diwani font that mapped zero Arabic codepoints (its cmaps
  were 8-bit legacy tables) with a renamed, OFL-compliant modified build.
- Added offline font tooling: nuqta measurement, PUA glyph merging, sample
  rendering.
- Removed the Shape Warp block type and image tracing with it.
- Diagnosed the stretch engine's defects and wrote the design that phases A–C
  above implement.

### 2026-08-10 → 08-12 — Feature run

Per-glyph move and scale · per-instance diacritic control, extended to Shape
Fill blocks · text on an arbitrary curve, with a pen tool · bounds-aware
snapping with equal-spacing hints · kashida auto-justify to a target width ·
export presets, clipboard copy and export-all · in-app searchable user guide ·
history thumbnails you can jump into · template wizard · optional Supabase
project sync.

### 2026-07 — Foundations

Multi-select, grouping, alignment, image import, named saves, ruler guides
and templates · shape fill and warp controls · real layer grouping · JPEG and
transparent export · font-wide honorific glyphs · the Morph Glyph Editor.

### 2026-03 — Initial build

Canvas, HarfBuzz shaping, block model, PNG/PDF export.

---

## Blocked on a design

Not "unbuilt" — these have a known blocker and a known prerequisite.

- **Schema-driven stroke spines, and enforcing protected zones** (changes 2
  and 4). Blocked on the Phase C measurement above. The prerequisite — a
  re-anchoring design — now **exists but is unbuilt**:
  `docs/superpowers/specs/2026-08-13-stroke-spine-reanchoring-design.md`
  matches the schema's stroke skeleton against the real glyph's medial axis
  offline and ships the result as a per-font table, omitting any match it
  cannot verify. Building that unblocks both changes. The Phase C measurement
  already ruled out the three cheaper explanations — style distance from
  Naskh, per-form skeleton reuse, and compound letters — so there is no quick
  win hiding in it.
- **Advance-level kashida elongation**, which is what the dial would need to
  widen a run at all (see the kashida entry under Known limitations).
  Re-anchoring does **not** fix it: displacing outline points never moves
  `penX += advance`, so neighbouring letters never separate. Not yet designed.

## Not built yet

Identified as valuable, deliberately deferred. `CLAUDE.md`'s "Deferred
features" section carries the reasoning for each; the short list:

- Join pins, per-glyph move/scale, and stretch handles on Shape Fill and
  text-on-path blocks
- Per-glyph rotation
- Join detection for letters that abut without overlapping
- Mark detection via GDEF glyph classes, for fonts using PUA-encoded marks
- Diwani and Ruq'ah support for per-stroke editing, and the per-style schema
  override layer that would come with it
- Parametric letterform rendering — examined and rejected, because the
  schemas carry no joining geometry and drawing from skeletons would forfeit
  the seamless joining this tool exists to protect
- Image trace, removed along with the Shape Warp block type
