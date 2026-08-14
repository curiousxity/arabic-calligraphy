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

- **Per-glyph edits are keyed by glyph index**, so editing text *before* an
  edited letter can shift which letter the edit lands on after re-shaping.
  Affects per-glyph transforms and diacritic overrides alike. Diacritic
  overrides are re-validated each render and silently dropped if they land on
  a base letter; glyph transforms are not.
- **Per-glyph tools do not apply to text-on-path blocks.** Their glyphs are
  rotated to a curve tangent, which the straight-bounding-box maths behind
  those tools assumes away.
- **Thuluth gets no per-mark diacritic handles.** It encodes its marks in the
  Private Use Area with no positioning offsets, defeating both signals
  `findDiacriticGlyphIndices` uses, so its marks read as base letters. Reading
  the font's GDEF glyph classes would fix it, but that detector is shared by
  every diacritic feature.
- **Cloud sync has no conflict resolution** beyond overwrite-by-name. Same
  project name saved from two devices: last write wins.
- **A diacritic handle unmounts while the pointer is on it.** Found
  2026-08-14 by the Playwright harness and reproduced from measurements, not
  inferred. The hover hit rect and the handle are sibling Konva nodes, so
  the moment the mounted handle covers the pointer the next mouse move fires
  `mouseleave` on the rect and the handle vanishes — it is present on
  exactly every other move. The same race kills a slow drag outright: a
  first step under ~20px (at default zoom) leaves the gesture attached to a
  destroyed node and nothing happens, while 20px+ completes normally. Not a
  regression — it is almost certainly what earlier passes were seeing when
  they concluded handle drags "land on the block underneath". Full mechanics
  and the measured numbers in `CLAUDE.md`'s "End-to-end tests"; unfixed
  because the fix belongs in `DiacriticHoverHandles`, not in the harness.
- **Clearing a block's text logs a console error.** `shapeText` calls
  `JSON.parse` on an empty shaping result and throws `Unexpected end of JSON
  input`. Caught and non-fatal — the block simply draws nothing, which is
  correct — but it means an empty textarea is noisy in the console.

## Verification debt

Things that pass tests but have not been exercised by a human.

Everything this section used to list belonged to the stroke-stretch
subsystem and went with it on 2026-08-14 (see Shipped). What survives is a
fact about the tooling: scripted **hovers** reach Konva's hover-mounted
overlays, and — **corrected 2026-08-14 by the Playwright harness** —
scripted **drags** reach them too. Every earlier claim that drags were
unverifiable was written against extension-injected synthetic events;
Playwright drives real CDP input, and both a plain block drag and a
diacritic move-handle drag now pass in CI-able tests. The gestures need
shaping to survive the overlay's own unmount behaviour — see the two
defects under Known limitations, and the mechanics in `CLAUDE.md`'s
"End-to-end tests" — but they are no longer out of reach.

- **Browser pass 2026-08-14, after the removal.** All passing: the app boots
  with no console errors and no right-hand panel (the canvas now spans the
  full remaining width); a plain text block renders; the relocated
  **Move & scale glyph** checkbox sits in Sidebar → Typography under its own
  "Move & scale" heading and arms the three dots — hovering `ر` in `حرف`
  shows blue, gold and green exactly as before the move; diacritic handles
  still arm, `حَرْف` showing the red/blue/gold trio on hovering its fatha.
  Old-save migration checked end to end: a hand-built v4 payload carrying
  `glyphEdits`, `glyphRigValues`, `glyphMaskEdit`, `glyphEditTool`,
  `selectedGlyphIndex`, `kashidaAmount`, `kashidaEditMode` and an embedded
  `glyphRigs` loaded cleanly, and re-saving wrote version 5 with every one of
  those fields gone and no `glyphRigs` key.
- **The dot drags, revisited.** That pass attempted them with
  extension-injected synthetic events and they moved the *block* instead —
  which the Playwright work then showed is an artifact of those events, not
  of the handles. The diacritic move-handle drag is now covered by
  `e2e/diacritics.spec.ts`; a per-glyph move/scale dot drag test is still
  unwritten.

---

## Shipped

<!-- ---- STREAM-E: styles & palettes — add your Shipped entry here ---- -->
<!-- ---- /STREAM-E ---- -->
<!-- ---- STREAM-F: ink & surface — add your Shipped entry here ---- -->
<!-- ---- /STREAM-F ---- -->
<!-- ---- STREAM-G: font upload — add your Shipped entry here ---- -->
<!-- ---- /STREAM-G ---- -->

### 2026-08-14 — Artboard (stream A)

A document can now have a page. Preset sizes (A5/A4/A3/US Letter at 300dpi,
Instagram square and portrait, story, X header), custom width/height in
px/mm/in at a chosen dpi, an orientation toggle and a uniform margin guide.
The page draws the background fill and the alignment grid, its edges, centres
and margin lines are snap targets, and every export crops to it — so an
Instagram-square document exports at exactly 1080 × 1080 and an A4@300dpi one
at 2480 × 3508, whatever the export scale slider says and wherever the blocks
happen to sit. The PDF finally gets real paper dimensions instead of a
hardcoded 96dpi conversion. Background colour moved into the new Artboard
panel as the page's colour.

No artboard is the default and means exactly the old behaviour; every project
saved before this loads that way. The page is undoable and saved with the
project. See CLAUDE.md, "The artboard", for how it is put together.

Verified: 30 unit tests in `src/lib/artboard.test.ts`, four browser tests in
`e2e/artboard.spec.ts` (preset fixes the exported pixel size; it stays fixed
after a block is dragged; freeform still exports content-sized; a drag near
the page edge snaps flush), plus the full typecheck/lint/test/build loop.

**Not built, and noted rather than attempted:** multiple artboards per
document; bleed and crop marks; dimming or hiding the part of a block that
overhangs the page while editing; clipping on canvas rather than only on
export. The export-scale control is inert while a page is set — that is
intended, but a "scale the page itself" affordance (export A4 at 2×) has no
home yet.

### 2026-08-14 — Muthanna & radial composition (stream B)

A fifth block type, `mirror`, that re-renders another block's content under a
reflection or a radial repetition and stays live as the source is edited.
Added from Block Controls with exactly one non-mirror block selected; a
`Mirror` type panel carries the mode, the radial count (2–16) and radius, and
a "Select source" button. How it works and why it is built this way is in
CLAUDE.md, "Mirror blocks — muthanna and radial".

Covered by `src/lib/mirror.test.ts` (radial angles/offsets, the cycle guard,
orphan filtering — 25 assertions) and `e2e/mirror.spec.ts` (a mirror draws
the source's ink *reflected*, editing the source changes it, deleting the
source removes it, a radial with 8 copies puts ink on all eight spokes).

Known gaps, all deliberate: nesting mirrors, per-copy styling, bending a
reflection to kiss the source's baseline, and "flatten to independent
blocks" are all out of scope. The Layers panel shows a mirror with the plain
text badge, since that file was not this stream's to edit.

### 2026-08-14 — Ornament & frame library (stream C)

Ten built-in shapes behind a "Shapes & frames" picker, reachable from the
add-block row and from the Shape Fill panel. Each offers **Fill with text**
(a Shape Fill block through the existing upload path) or **Insert as frame**
(an image block from a data-URL SVG). All geometry is constructed from
primitives, not traced. How it is put together, and the three traps in the
geometry, are in CLAUDE.md's "Ornament & frame library".

Verified: 30 unit tests (`src/lib/ornaments.test.ts`) — registry loads, every
ornament survives `pathToPolygon` non-degenerately and stays inside its own
viewBox, the ring's hole reads as hollow to the same ray cast Shape Fill
uses, data URLs round-trip through `atob`. Four browser tests
(`e2e/ornaments.spec.ts`) — thumbnails render, Escape closes without
touching the canvas, a filled medallion lands square with tiled ink in it,
a frame lands as an image whose baked colour is on the canvas.

Known limits, both deliberate: a frame's colour cannot be changed after
insert (it is a rasterized image — recolouring needs a vector-shape block
type), and there is no way to import ornaments of your own beyond the
existing "upload an SVG" button.
### 2026-08-14 — Tatweel kashida (stream D)

Elongation that actually elongates, replacing the inert stroke-stretch dial
removed in Phase 0. Typography now carries a **Kashida join** picker listing
every legal join in the block's text (labelled with the letter pair, «ب ـ س»)
and a 0–8 stepper that inserts real U+0640 tatweels there.

- `src/lib/tatweel.ts` — pure `findKashidaSlots` / `applyKashida` /
  `readKashida`, kept free of React and font loading so the deferred
  fit-to-width solver can call them unchanged. Slots are letter *pairs*, so
  the stepper is absolute rather than additive; lam-alef is excluded.
- 18 unit tests, of which the load-bearing ones shape with **real harfbuzzjs
  and real fonts** and assert the total advance strictly increases with the
  count in Amiri, Scheherazade and Lateef. This is the measurement the
  removed subsystem failed.
- `e2e/tatweel.spec.ts` — 4 tests: the stepper widens the ink extent on the
  live canvas, lam-alef is never offered, undo reverts a step, a saved
  project round-trips the tatweels.
- Guide page "Stretching joins (kashida)", including the warning to apply
  kashida before fine-tuning marks.

Known limitation, inherited and deliberate: kashida is a text edit, so it
shifts the glyph indices that per-glyph mark and move/scale overrides are
keyed by — the same fragility any typed edit has. Documented, not
engineered around. Fit-to-width remains deferred; it needs stream A's
artboard as its target.

### 2026-08-14 — Playwright e2e harness (stream P)

Seven browser tests, `npm run e2e`, ~4s wall clock, stable across repeated
runs. Boot with no console errors; typing puts ink on the stage; a block
drag moves the block by the drag delta; hovering a diacritic mounts its
handles; dragging the move handle records an override; undo/redo round
trips; Export PNG downloads a real file.

The point of the stream was to settle whether automation can reach Konva's
hover-mounted overlays at all. **It can** — trusted CDP input drives both
the plain drag and the small-target handle drag. That corrects the standing
assumption recorded under Verification debt, and it turned up two real
defects in the diacritic overlay along the way (see Known limitations).

`src/lib/testBridge.ts` is the only production file this added: a dev-only,
read-only `window.__HARF__`, absent from `dist/`. Design and traps in
`CLAUDE.md`'s "End-to-end tests"; spec in
`docs/superpowers/specs/2026-08-14-stream-p-playwright.md`.

### 2026-08-14 — The Morph Glyph Editor subsystem removed

The Morph panel and its whole engine are gone: the Stretch tool, the stroke
schemas (105 JSONs), the per-font stroke spines (30 tables), glyph rigs, join
pins, the per-font nuqta table and nuqta snapping, the block-level Kashida
dial, the tatweel-gap Kashida tool, Fit width / auto-justify, and
By-stroke/Lasso mask editing. The suite drops from ~350 tests to 195; that is
the point, not a regression.

The reason is that the stack's central promise was measured inert. Everything
under "Stroke stretching" in Known limitations is therefore **resolved by
removal**, not by repair — recorded here so the measurements are not lost:

- The kashida dial did not widen a run. Verified in a browser 2026-08-13 on
  `بسم` in two fonts: cranking every stretch to maximum left the ink's
  horizontal extent unchanged to within a pixel, and the app's own
  measurement had it *shrinking* (60.505px at dial 0 → 60.105px at 100). Fit
  width could therefore never fit. Root cause: displacing outline points
  never moves `penX += advance`, so neighbouring letters never separate.
- Strokes deformed instead of extending — a curved zone was collapsed to a
  straight chord, and `ra-final`'s protected terminal was where displacement
  was greatest.
- Coverage was thin. Taking a letter as a given font actually draws it, only
  ~14% of the 145 authored stretch zones had a verified spine and therefore a
  handle (3% ThuluthDeco to 28% Kufi, over 3,775 zone × drawn-glyph
  combinations).
- The join cleft was improved by pinning but never eliminated, 5 of 42
  measured letter pairs got no pin at all, and a handle created under one
  font silently stopped acting after a font change.

What survives: per-glyph move & scale (its arming checkbox relocated from the
Morph panel to Sidebar → Typography), diacritic overrides, warp,
`lib/arabicJoining.ts` (kept deliberately consumer-less for the tatweel
stream), and `projectOntoAxis`, moved to `src/lib/dragAxis.ts`. The offline
Python tooling stays in `scripts/`.

Recovery: `docs/archive/nuqta-measurements.md` holds the per-font nuqta table
and the pre-removal SHA `fbe942cadec8c82596948309248a99a1fbb21f90`. See
`CLAUDE.md`'s "Removed subsystems" for the mechanics, including how an old
saved project is migrated.

Tatweel-based elongation (Phase 1 stream D) replaces the elongation story
with one that works.

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

Nothing currently. The two entries that lived here — enforcing the schema's
protected zones, and advance-level kashida elongation — went with the stroke
subsystem on 2026-08-14. Tatweel-based elongation replaces the second.

## Not built yet

Identified as valuable, deliberately deferred. `CLAUDE.md`'s "Deferred
features" section carries the reasoning for each; the short list:

- Per-glyph move/scale on Shape Fill and text-on-path blocks
- Per-glyph rotation
- Mark detection via GDEF glyph classes, for fonts using PUA-encoded marks
- Image trace, removed along with the Shape Warp block type
