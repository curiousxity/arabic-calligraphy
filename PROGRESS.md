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
- **Stroke-spine re-anchoring, partially checked 2026-08-14.** Passing in a
  browser: the app loads with no console errors, and the Morph panel reads
  as intended — in the default font, `حرف` shows `ر`'s stroke with a live
  1.00 input while `ح`'s and `ف`'s show "no verified stroke in this font".
  That is one of three zones, matching the predicted quarter-to-a-third.
  **Still unverified, and needing a human's hand on a real mouse:** the
  on-canvas dots. Konva's hover-mounted overlays do not respond reliably to
  synthetic mouse events, so neither the no-jump property (a dot must not
  move when its handle is created) nor "no dot where there is no spine"
  could be confirmed by automation — hovering produced no dot on either a
  spine-bearing or a spine-less letter, which is inconclusive rather than a
  result. Also unverified: whether a spine-derived handle actually stretches
  the stroke it names, and whether the `fontFamily` argument survives at the
  two call sites no test guards (see the trap in `CLAUDE.md`).
- **Second browser pass 2026-08-14, after the glyph-id fix.** Now confirmed,
  on Amiri — the font whose spines the fix recovered, and where `حرف`
  previously produced no handle at all:
  - The panel tracks the font. Switching from the default to Amiri keeps
    `ر`'s row live at 1.00, with `ح` and `ف` still reading "no verified
    stroke in this font". Both `useGlyphSchemaCatalog` call sites still pass
    `fontFamily`, checked by reading them.
  - **A spine-derived handle does stretch the stroke it names.** Typing into
    `ر`'s factor field clamps to its own `maxFactor` (1.80 → 1.30), relabels
    the row "ra arc · +1 nuqta", and visibly extends the ra's tail. `ح` and
    `ف` do not move, so the edit does not drag unrelated parts of the word.
  - One observation, not a new defect: the extension comes out as a thin
    hairline off the tail's tip rather than the stroke continuing at its
    designed weight. That is the open "strokes deform instead of extending"
    limitation above, seen on a correctly anchored stroke.
  - No console errors throughout.

  **Still needing a human's hand on a real mouse**, unchanged: everything
  involving the on-canvas dots — the no-jump property, "no dot where there is
  no spine", and dragging one. A synthetic hover again produced no dot, which
  is the tooling's limit rather than a result. The `حرف` cleft repro has also
  not been re-compared since the tables changed.
- **Covered by automation 2026-08-14, so no longer debt:** that a created
  handle's anchor lands on real ink, on three fonts and three words
  (`strokeSpines/endToEnd.test.ts`), and that every shipped spine is keyed
  to a glyph real shaping produces. The browser checks below are unaffected
  by this — a test can see the anchor, not the dot.
- **Verified by hand 2026-08-13, second pass:** nuqta snapping on Shape Fill
  blocks — passes, snapping to the correct half-nuqta grid off `lengthDots`
  (1.13 → 1.11, 1.27 → 1.22, 1.41 → 1.44). The auto-justify "fit to
  composition" round trip — **fails**, see the kashida entry under Known
  limitations. Quantization was not the cause; the two formulas are in step.

---

## Shipped

### 2026-08-14 — Spine tables keyed to the glyphs the app draws (Task 10)

Task 10's end-to-end test — real fonts, real shaping, three words — found on
its first run that one of its three cases created **zero** handles, and the
cause was not the test.

The offline generator decided which glyph a letter's spine belonged to by
walking GSUB by hand: the cmap for the base, then the single substitution
under the joining form's own feature. That diverged from HarfBuzz twice, so
**46 of 401 shipped spines were filed under glyph ids no shaping ever
emits** — dead data the app cannot tell apart from a stroke the gates
rejected. It stopped at the form feature, missing the chained contextual
substitution Amiri applies afterwards; and it never applied `isol` at all,
which killed every one of Kufi2's ten entries.

The generator now resolves the glyph by shaping, with the same settings the
app uses. That also fixed something the walk could not express: one joining
form is not one glyph — Amiri draws seven distinct ra-finals depending on
the preceding letter, each a different outline needing its own spine.

- Reachable spines: **355/401 → 486/486**, verified by shaping every letter
  in every joining context.
- Accuracy unchanged: **99.82%** of shipped spine points inside real ink,
  against 99.81% before — measured by nonzero winding on flattened outlines,
  deliberately not the generator's own raster mask.
- Per-font counts moved both ways and the characterization snapshot in
  `spineTable.test.ts` records it. Three fonts ship fewer spines, mostly
  because the cross-font consensus pass compares each schema stroke across
  every font and every font's rows changed.

The honest coverage figure got stricter with the denominator: taking a letter
as a font actually draws it, about **14%** of its authored zones offer a
handle (3% ThuluthDeco to 28% Kufi). The entry below's "quarter to a third"
counted one canonical glyph per form. Fewer strokes are adjustable than that
number implied; more are adjustable than actually worked.

### 2026-08-14 — Stroke-spine re-anchoring (Tasks 1–9 of 11)

Replaces the proportional schema-to-glyph mapping with a real spine measured
off each glyph's own medial axis. `docs/superpowers/specs/2026-08-13-stroke-spine-reanchoring-design.md`
is the design; `docs/superpowers/plans/2026-08-13-stroke-spine-reanchoring.md`
is the plan. 18 commits on `spine-reanchoring-design`.

**What it achieves.** 99.81% of shipped spine points lie inside real ink,
against **14.5%** for the mapping being replaced — that 14.5% is the Phase C
figure that blocked this whole effort. Measured across all 15 in-scope fonts,
independently at review, not self-reported.

**What is in.** An offline generator (`scripts/deriveStrokeSpines.py`) that
skeletonizes each glyph and matches schema strokes to branches behind five
gates; 15 committed per-font tables (`src/data/strokeSpines/`, 401 spines
across 372 glyphs); a lazy runtime registry; a suite that checks the tables
against the real font binaries including a SHA-256 staleness guard; a pure
font-units-to-block-space converter; spine attachment to the stretch
catalog; and `setStretchFactor` building handles from the spine instead of
the guess. Suite went 393 → 512 tests.

**Paused before:** Task 10 (end-to-end test on real fonts) and Task 11 (docs
+ hand verification in the browser). Everything up to and including Task 9,
plus the follow-up below, has been independently reviewed. Task 10 is done —
see the entry above, and note that its figures supersede the ones here.

**The coverage trade, which is the thing to understand about this feature.**
There are 151 authored stretch zones across the schemas, and a typical font
has a verified spine for only about a quarter to a third of them
(TahaNaskhRegular 46, Kufi 42, Amiri 36). Where there is no spine,
`setStretchFactor` creates nothing, by design — an unverifiable match must
ship nothing rather than a guess. So most strokes are no longer adjustable,
and the ones that are sit on real ink. The UI says so rather than failing
silently: a zone with no spine keeps its Morph panel row, showing its label
and a muted "no verified stroke in this font" in place of the input, and
renders no on-canvas dot.

**Both of Task 9's open items are closed** (follow-up commit, reviewed):

- The dead-slider gap is fixed as described above. `MorphGlyphEditor` no
  longer offers a control that cannot act, and `StrokeStretchHoverHandles`
  no longer positions a not-yet-created dot with the replaced proportional
  mapping — it derives the axis from the spine using the *same*
  `spineToBlockSpace` call `setStretchFactor` uses, so creating a handle
  does not move the dot. A handle saved before this change, for a zone with
  no spine in the current font, still gets its dot so it can be adjusted or
  removed.
- `box.gx ?? 0` was investigated and is **correct, not a guess** — and is
  now commented to say why. `ShapedText` declares `gx`/`gy` required and
  always populates them; `ShapeFillText`'s boxes carry no `gx`/`gy` but are
  glyph-local (from `getPath(0, 0, fontSize)`, whose pen origin *is* the
  origin), so 0 is the identity there. `App.tsx:898-899` uses the same
  convention.

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

- **Enforcing protected zones, and `axis: "path"` spine displacement**
  (changes 2 and 4). These were blocked on the Phase C measurement above.
  The prerequisite — re-anchoring — is now **built and merged as far as
  Task 9 of 11**, see the 2026-08-14 entry under Shipped: the schema's
  proportional guess is replaced by a real per-font spine measured off each
  glyph's own medial axis, and 99.8% of shipped spine points lie inside real
  ink against 14.5% for the mapping they replace. Changes 2 and 4 themselves
  are still unbuilt, but they are no longer blocked on accuracy — they are
  now blocked only on their own design work, plus the two open items in the
  2026-08-14 entry.
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
