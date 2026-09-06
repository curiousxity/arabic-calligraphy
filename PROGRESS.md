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
  Affects per-glyph transforms and diacritic overrides alike. Both are now
  re-validated each render and dropped rather than misapplied — overrides
  against whether the glyph is still a mark, transforms against the `glyphId`
  they were made for. A transform saved before 2026-08-19 carries no
  `glyphId` and cannot be checked, so it keeps the old behaviour.
- **Per-glyph tools do not apply to text-on-path blocks.** Their glyphs are
  rotated to a curve tangent, which the straight-bounding-box maths behind
  those tools assumes away.
- **A turned glyph pivots off-centre when it is a PUA preset honorific.** That
  branch draws override art whose centre differs from the metrics walk's
  font-glyph box, which is the box the pivot comes from. Pre-existing for the
  move and scale handles; the rotate handle makes it visible.
- **`StrokeCutHoverHandles` is glyph-transform-blind.** It builds its rails
  from the bare pen origin, so on a letter that has been moved, scaled or
  turned its dots sit where the letter would be untransformed. Pre-existing;
  rotation widens the gap.
- **Straight-stroke stretching is plain-text only, and stays that way.** Not
  the tangent reason above: Shape Fill and Curve both renormalise the run to a
  fixed span, so an added advance is divided straight back out. Declined
  rather than deferred — CLAUDE.md, "Deferred features", carries the argument.
- **Qahiri renders no tashkeel at all.** The font has no glyph for fatha,
  sukun or dammatan (its cmap answers 0 for each), so
  `stripUnsupportedDiacritics` drops them before shaping and typed marks
  simply disappear. Not a detection failure and not fixable here — the
  glyphs would have to be added to the font.
- **Cloud sync has no conflict resolution** beyond overwrite-by-name. Same
  project name saved from two devices: last write wins.

## Verification debt

Things that pass tests but have not been exercised by a human.

Everything this section used to list belonged to the stroke-stretch
subsystem and went with it on 2026-08-14 (see Shipped). What survives is a
fact about the tooling: scripted **hovers** reach Konva's hover-mounted
overlays, and — **corrected 2026-08-14 by the Playwright harness** —
scripted **drags** reach them too. Every earlier claim that drags were
unverifiable was written against extension-injected synthetic events;
Playwright drives real CDP input, and both a plain block drag and a
diacritic move-handle drag now pass in CI-able tests. The two overlay
defects that once forced those gestures into an unnatural shape were fixed
on 2026-08-19 (see Shipped), so the harness now drags in ordinary
interpolated steps; the mechanics are in `CLAUDE.md`'s "End-to-end tests".

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
  of the handles. Both drags are now covered: the diacritic move handle by
  `e2e/diacritics.spec.ts` and the per-glyph move dot by
  `e2e/glyph-transform.spec.ts`.

---

## Shipped

### 2026-09-06 — Per-glyph move, scale & rotate on Shape Fill

**Move, scale & rotate glyph** in Typography now arms on a Shape Fill block as
well as on plain text. All four dots work, the transform renders inside the
tiled draw loop, and a mirror of such a block draws the moved letters too.

Two things were decided rather than inherited, and both are in CLAUDE.md,
"Per-glyph move, scale & rotate → On Shape Fill":

- **One handle per letter, not one per tile.** A large silhouette tiles a
  short run into tens of thousands of instances; a listening hit rect on each
  is a frozen tab. The cap costs nothing, because a transform is keyed by
  glyph index and so already applies to every repetition — the model the
  Diacritic tool has always shipped. What it costs is that the handle sits on
  one designated tile near the middle of the shape.
- **The transform is applied outside the row's own fit scale**, so a stored
  offset moves the letter by the same amount on every row rather than by
  whatever that row happened to be compressed to.

A live defect went with it: `ShapeFillText`'s drag pin returned *layer*-space
coordinates where Konva's `dragBoundFunc` contract is absolute, so pressing an
armed silhouette teleported the block — measured at 37px at the default 275%
zoom. Only a press on the silhouette itself could ever see it; a press on a
handle cancels the bubble and never starts a block drag.

### 2026-09-06 — Square kufi: painting cells by hand

**Paint cells** in the Square Kufi panel puts a lattice over the block: click
or drag to fill squares, click ink to cut it away, and a whole drag is a single
undo. It is how a panel is actually finished — closing a gap, squaring a
corner, tying two lines together — and painted squares are free to break the
one-square grammar the generated alphabet keeps.

An edit is remembered against the *letter nearest it* and an offset from that
letter's own box, not against a grid coordinate, so it survives rewrapping the
panel and every spacing dial; retyping the letter it sits on lets it go, and
the panel says how many were dropped. Cells painted outside the panel grow the
block, which now reports the larger box so they export. See CLAUDE.md, "Square
kufi → Hand-painted cells", for the anchoring scheme, the ownership rule and
the origin-offset trap.

A mirror of a hand-edited block draws the edits too — that one prop line
belonged to a different stream and was landed with the merge.

### 2026-09-06 — A fourth per-glyph handle: rotate

Ticking **Move, scale & rotate glyph** in Typography now shows four dots on a
hovered letter rather than three. The new one, set diagonally past the
letter's upper-outer corner, turns it about its own centre. Neighbours never
shift, exactly as with move and scale.

The design decision worth knowing is that the turn is applied *inside* the
scale, which keeps the rotation pivot independent of the scale being dragged.
The alternative would have reintroduced the scale-handle convergence bug this
file already records — and, being zero-valued at rotation 0, would have passed
every test that existed. CLAUDE.md, "Per-glyph move, scale & rotate", carries
the argument and names the one assertion that discriminates; it was verified
to fail against the rejected variant, as was the e2e test guarding the dot's
placement clear of below-baseline marks.

`rotation` is optional on `GlyphTransform`, so a project saved before today
renders byte-for-byte as it did and the layout payload's version is unmoved.
A turned letter is not counted in the block's reported width, so it can
overhang the page margin and Fit to width will not see it — the same limit
move and scale already have, now stated in the guide.

### 2026-09-05 — Square kufi

A sixth block type: **Square Kufi**, the block's text set as strokes on a
lattice — الكوفي المربع, the hand worked into brick and tile. Add it from Block
Controls, type Arabic into Content as with any block, and press **Fit to
square** to wrap the run into the panel the style is named for; Panel width,
Line gap and Word gap are the three spacing dials. It mirrors and makes
medallions like any other block, and because the whole composition is one
merged shape, an outline or a metallic gradient runs across the panel rather
than letter by letter.

It is the only block type that **loads no font**: a square-kufi letter is its
cells, so `lib/squareKufiAlphabet.ts` is a hand-authored table of every letter
in every joining form and there is nothing to shape. Typography's font picker
is hidden for the type accordingly. The alphabet's structural rules — one
connected stroke, never two cells thick, join ink where each form claims a join
— are asserted over every form in `squareKufi.test.ts` rather than eyeballed;
`e2e/square-kufi.spec.ts` drives the feature through the sidebar. See CLAUDE.md,
"Square kufi", for the two conventions the alphabet commits to and why.

**Dots and tashkeel are not drawn**, matching the style, so ب/ت/ث share one
shape. That is deliberate and is recorded under CLAUDE.md's Deferred features
alongside the boustrophedon and spiral compositions, neither of which is built.
(Hand-editing individual cells was listed there too, and shipped on
2026-09-06 — see above.)

### 2026-08-21 — Diacritic detection: two more fonts, and the dots it was flagging

`findDiacriticGlyphIndices` gains the shaped text as a third argument and
spends it as a per-cluster allowance: the number of combining marks actually
typed in a cluster's source span caps how many of that cluster's glyphs the
weaker signals may claim. Full mechanism and the traps: CLAUDE.md,
"Per-instance diacritic control".

**It went in to fix Thuluth and found three more defects on the way.** The
plan of record was to read the font's GDEF glyph classes; measuring first
killed that — **Thuluth has no GDEF table at all** (nor does ThuluthDeco, nor
HarfCanvasDiwani), and where GDEF does exist it classes a letter's dots as
marks exactly like tashkeel, so it answers neither half of the problem. What
Thuluth's marks do have is a zero advance, which is now the third signal.

- **Yekan was broken the same way** and had never been recorded: 0 of 3 marks
  detected on `حَرْفٌ`. ThuluthDeco likewise.
- **Letter dots were being flagged as diacritics.** NotoSans, Ruqaa, Kufi2 and
  Qahiri draw a letter's dots as a separate zero-advance GPOS-attached glyph,
  which the old fallback read as a mark. Typing the unmarked word `حرف` in
  NotoSans armed the per-mark overlay on the ف's dot — and its hide button
  would have erased the dot.
- **A base letter could be flagged too**: NotoSans's reh final form carries a
  nonzero `dx` and shares the sukun's cluster in `حَرْفٌ`.

Measured across all 17 bundled fonts before and after. `diacritics.test.ts`
covers all four cases against real harfbuzzjs and real fonts, and
`e2e/diacritics.spec.ts` pins the two user-visible ends — the overlay arms on
Thuluth, and never arms on an unmarked word in Noto Sans. Both new e2e tests
were confirmed to fail against the previous detector.

### 2026-09-06 — Two ways a stretch went missing

Both found while planning the remaining work (see "Not built yet"), both
confirmed against the tree before being believed, and both are the same class
of defect: a stroke cut that exists in state but never reaches the canvas.

- **Fit to width dropped every cut on the block.** It mutates the block's
  text, and a `StrokeCut` is keyed by an offset into that text — so the cuts
  survived the write pointing at whatever the inserted tatweels had pushed
  into their old offsets, and `buildCutPlan`, which resolves by cluster *and*
  `glyphId`, then dropped them. The stretch vanished, and the fit also came
  out narrower than it promised, because `cutWidthForBlock` had already
  counted those cuts into the width it solved for. `setKashidaAtSlot` — the
  other text mutation — had remapped from the start; this was the asymmetry.
  `solveFitToWidth` now reports the insertions it made (`edits`, highest
  offset first, which is the only order a remap can replay them in) and the
  handler folds `remapCutsAfterInsert` into the same patch, so it stays one
  `pushHistory()`.
- **A mirror drew its source unstretched.** `MirrorBlockView` forwarded
  `diacriticOverrides` and `glyphTransforms` to `ShapedText` but not
  `strokeCuts`, so the reflection ignored the cuts and its rAF-settled hit
  `Rect`, measured off that content, came out too small with it. One prop
  line — the same omission this file already had once with `fill`.

Both regression tests were **verified failing before the fix**, which took two
attempts on the first one: the obvious assertions (cut count, total ink) pass
in both worlds, because the cuts stay in state either way and a fit adds
enough tatweel ink to swamp one lost stretch. What actually discriminates is
the character each cut points at.

Also here: `strokeCuts.ts`'s header described a superseded predicate, claimed
the module had no application consumer, and restated a dozen coverage figures
that belong in `docs/archive/stroke-zone-coverage.md`. Rewritten to the
shipped state with the numbers deleted rather than refreshed, and four
references to a CLAUDE.md heading that no longer exists were retargeted.

### 2026-08-21 — Straight-stroke extension: shipped

A ten-task plan to let a calligrapher lengthen a letter's own straight
strokes by cutting the outline and bridging the gap reached Task 3, its own
go/no-go coverage measurement, placed deliberately before any UI work, and
**stopped there** — no tested `maxSlope` cleared all four gate fonts.

**Resumed the same day.** The predicate was diagnosed as conflating two
opposite defects behind one knob (inclined stems rejected, curve vertices
accepted) and was replaced rather than retuned: detection now sweeps the
stroke's own axis, and straightness is measured as per-edge bow away from a
chord. Re-measured, **isolated-letter coverage clears 60% on all four gate
fonts (75–86%)** — the half that structurally failed before, and the
capability tatweel cannot provide. Amiri's join coverage remains the one
gate failure and is accepted as a known per-font limitation, that half being
the one tatweel kashida already covers everywhere.

**Tasks 4–10 then built the feature.** Typography → **Stretch strokes** arms
an on-canvas handle on every detected stroke; dragging it along the stroke
lengthens the letter itself, in half-nuqta steps (Alt for free amounts). The
outline is cut and bridged at the stroke's own weight, the run's advance grows
with it, and Fit to width accounts for it. Kashida steps remap cuts rather
than dropping them. `e2e/stroke-cuts.spec.ts` asserts the thing that matters —
the drawn ink and the measured box both get wider — which is exactly what the
removed Morph kashida dial never did.

**Known limits, all deliberate:** plain text blocks only (shape fill and
curved text are excluded the way every per-glyph tool excludes them); Amiri's
joins are below the gate's bar; and one short false-positive zone survives in
NotoSans seen. Numbers and the reproducible spot-check:
`docs/archive/stroke-zone-coverage.md`, "Second pass"; the design argument,
the mechanism and its traps: CLAUDE.md, "Straight-stroke cut detection".

### 2026-08-21 — New documents open on bare paper again

Reverses one of the seven changes in the 2026-08-20 interface pass. That pass
opened a new document on `washi` because flat white under a 40px grid read as
graph paper — but the argument was about the grid, and the same pass fixed the
grid directly by drawing it as a one-device-pixel hairline at any zoom instead
of ~2.75px at the default 275%. With the grid no longer shouting, a texture is
not needed to drown it out, and a surface goes back to being a choice the user
makes.

Only the default moved. `readArtboardSurface` is untouched, so a saved project
keeps whatever surface it holds. The zoom caveat that picked washi over the
other textures still governs choosing one — see CLAUDE.md, "Ink & surface".

### 2026-08-21 — CI deploy reaches production

The GitHub Actions deploy had never once succeeded. Every run since it was
added on 2026-08-19 passed lint, the unit suite and the build, then failed at
the `wrangler-action` step with `it's necessary to set a CLOUDFLARE_API_TOKEN`.
The breakage was invisible from outside: the live site was current throughout,
because it was being published by hand with `npm run build && npx wrangler
deploy`.

Only `CLOUDFLARE_API_TOKEN` existed as a repository secret —
`CLOUDFLARE_ACCOUNT_ID` had never been added at all. Adding it and re-pasting
the token cleared it, and run `32486702539` both uploaded and attached
`harf.hash.immo` as a custom domain. Which of the two changes was the actual
fix is not known; both moved before the first green run. See CLAUDE.md,
"Deployment".

### 2026-08-20 — Interface pass: contrast, focus, targets, and paper

A design review of the running app, measured in the browser rather than
eyeballed, and the seven fixes it produced. The numbers below are before →
after, taken the same way both times.

- **Block Controls** was one centred `flex-wrap` of twelve identical icon
  chips that wrapped **8 / 1 / 3** at the sidebar's own width, stranding the
  ornament button alone on a line. Now three labelled groups on fixed grids —
  Add · Selected · History — which cannot orphan, and which put the
  destructive Delete somewhere other than first. See CLAUDE.md, "Sidebar
  structure".
- **Light-theme icon contrast: 2.95:1 → 4.0:1.** The gold on the chip
  background sat just under the 3:1 WCAG asks for meaningful non-text UI.
  `--accent` moves to `#8f6415` in the light palette only; the dark theme was
  already at 4.94:1.
- **Keyboard focus** was Chrome's default blue 1px ring on every control but
  two text inputs. One `:focus-visible` rule now paints it in the app's own
  gold.
- **Controls below the 24×24 target floor: 34 → 0.**
- **Sidebar height: 3786px → 2183px** (4.0 → 2.3 screens at 950px). Three of
  the four character keyboards are collapsible and start closed; إعراب stays
  open.
- **Labels** name the outcome in sentence case — "Add shape fill", not
  "Upload SVG for Shape Fill".
- **The canvas reads as paper, not graph paper.** The grid draws as a
  one-device-pixel hairline at any zoom instead of ~2.75px at the default
  275%, and a new document opens on washi. Washi specifically, because a
  surface magnifies with the stage and it is the one whose grain survives
  that zoom — compared on screen, not chosen from the names.

Verified: typecheck, lint, 450 unit tests, build, and the full 54-test
Playwright suite. Five e2e tests needed updating and the reason is worth
keeping: paper grain lands inside a block's bounding box, so every pixel
assertion that measures ink now asks for bare paper first.

Also: `playwright.config.ts` takes `HARF_E2E_PORT`. With `reuseExistingServer`
on and a *foreign* dev server holding 5173, Playwright silently reuses it and
all 54 tests time out against someone else's app — which is exactly what
happened during this work.

### 2026-08-20 — Name designs

Content → **Name designs**: see the selected block's text written in every
calligraphic style at once, pick one, and set it into a composition — a
muthanna pair, a medallion of N copies, or a decorative frame. The style
gallery previews in CSS (no shaping, no rasterization) and the layouts are
built from parts that already existed: a muthanna and a medallion are
`buildMirrorBlock`, a frame is the ornament library's own SVG in an image
block.

The new part is the arithmetic — `src/lib/nameDesign.ts` turns the name's
*measured* run into placements that do not collide, which is the difference
between adding a mirror and composing a design. Pure with measurement
injected, so it is unit-testable; `measureShapedRun` is the async half.
The non-obvious rule, and the one to keep in view: a medallion's radius is
set by the run's **height**, because radial copies lie along their own spokes
and crowd each other tangentially. See CLAUDE.md, "Name designs".

Plain text blocks only, for the reason Fit to width is: a Shape Fill run is
already scaled to its silhouette and a Curve run to its curve. A whole design
is one undo, style included.

Verified: 28 unit tests in `nameDesign.test.ts`, 6 Playwright tests in
`e2e/name-design.spec.ts` (gallery contents, each layout's blocks and
z-order, and the single-undo guarantee), plus the full loop — typecheck,
lint, 450 unit tests, build.

Deliberately not built, and worth recording because it is what the reference
sites lead with: **Latin→Arabic transliteration** and a curated name
dictionary. Typing the Arabic is this app's input model, and guessing at
"Mohammed" phonetically is a different product with its own failure modes.

### 2026-08-19 — Fit to width, and three overlay/shaping fixes

**Fit to width.** Typography's Kashida section gains a target field and a
**Fit** button: give it a width and it spreads tatweel kashida evenly across
every legal join until the line spans it. With a page set, the target starts
as the page's margin box; freeform documents type a number. It never
overshoots, never piles the whole total onto one join, is idempotent, and is
a single undo. Plain text only — a Shape Fill run already scales to its
silhouette and a Curve run to its curve.

This closes the elongation story the Morph removal left open. `lib/justify.ts`
was deleted with that subsystem because it could not work — the dial it drove
never moved the run's width, so there was nothing to converge on. The new
`src/lib/fitToWidth.ts` is pure with measurement injected, which is what lets
it be tested against real harfbuzzjs and real fonts; `lib/measureShapedText.ts`
is the async half. See CLAUDE.md, "Fit to width".

**Three fixes**, all previously listed under Known limitations:

- **A diacritic handle no longer unmounts under the pointer.** The hover
  handlers moved from the hit `Rect` to the `Group` that owns both it and the
  handles, so Konva — which suppresses `mouseleave` at any ancestor of the
  newly-entered shape — fires no leave for a Rect→Circle move. This kills the
  every-other-frame flicker *and* the death of any drag whose first step was
  under ~20px. The two workarounds in `e2e/harf.ts` went with it, as that
  file always said they should: `dragFromHere` now drags in 24 interpolated
  steps, which is both the honest gesture and the regression test.
- **Clearing a block's text is silent.** `shapeText` returns the empty result
  before building any HarfBuzz objects rather than letting `buffer.json()`
  parse an empty string. A "no console errors" assertion is no longer pinned
  to the boot test.
- **A stale glyph transform is dropped rather than misapplied.** Transforms
  now record the `glyphId` they were made for, and `ShapedText` re-validates
  them each render the way it already did diacritic overrides. The field is
  optional, so transforms in older saves keep their existing behaviour.

A code review then found seven issues, all fixed in the same branch and each
now covered by a test:

- The solver's estimate-and-walk search could exhaust its step budget while
  still over the target and return that text as a successful fit. Replaced
  with a binary search whose answer was always *measured* to fit, which also
  removes the divide-by-delta hole when a tatweel decomposes a ligature.
- Measurement ignored the italic shear, faux bold, the outline and `warpX`,
  so those blocks overshot the width they were fitted to. `styledRunWidth`
  adds all four, and `ShapedText` now imports the shear and bold constants
  from the fitter so they cannot drift.
- Patching a stale glyph transform revived the previous glyph's scale under
  the new glyph's id. Now a pure, tested `mergeGlyphTransform` replaces a
  definitely-mismatched entry instead of spreading over it.
- `GlyphTransformHoverHandles` still had the *same* sibling-hover defect just
  fixed next door; it now hangs its handlers on the Group too.
- The fit target field could not be cleared when a page was set.
- The `already-wider` branch strips existing kashida; the status message now
  says so instead of implying nothing happened.
- `types.ts`'s comment still denied the existence of the `glyphId` beneath it.

Verified: 47 unit tests across `fitToWidth.test.ts` and `glyphTransform.test.ts`
(even distribution, right-to-left application, never-overshoot under
non-monotonic and zero-delta measures, style widening, stale-transform
replacement, and real-font fits in Amiri, Scheherazade and Lateef), plus
`e2e/fit-to-width.spec.ts`, `e2e/glyph-transform.spec.ts` and new regression
tests in `e2e/diacritics.spec.ts` and `e2e/core.spec.ts`. The two
hover-overlay e2e tests were checked against a deliberate revert of the fix
and fail without it. Whole suite: **422 unit tests and 48 e2e** passing, plus
typecheck, lint and build.

This also closes the "per-glyph move/scale dot drag test is still unwritten"
item under Verification debt.

**Known gaps.** Fit to width inherits the glyph-index fragility every text
edit has — the guide says to fit before fine-tuning marks. There is no
fit-to-*height*, no multi-block fit, and no live re-fit as text is edited;
all three are deliberate.

<!-- ---- STREAM-E: styles & palettes ---- -->
### 2026-08-14 — Saveable styles & palettes (stream E)

A look built on one block can now be saved under a name and dropped onto
others. The Typography panel opens with a **Style** row — a dropdown of saved
styles, Apply, a name field and Save style, and a delete — plus a **Palette**
row underneath: a strip of clickable swatches with four palettes shipped
(Manuscript, Rubrication, Aged page, Neutral) and a "From canvas" button that
builds one from the colours already in the piece.

A style carries font, size, colour, opacity, outline and shadow, and
deliberately nothing else — never the text, the position, or any per-glyph
adjustment. Apply patches every selected block as a **single** undo step.
Both stores are local to the browser: not in a saved project, not in the
cloud store, matching export presets. See CLAUDE.md, "Saveable text styles &
palettes", for the design and its two spec deviations (`stroke` rather than
`strokeColor`; no `letterSpacing` field exists in this codebase).

Known v1 limit: swatches drive the *text* colour only. The stroke, shadow and
page colour rows are `FormControls.tsx`'s `ColorRow`, which no stream owns
this phase — reported as the spec anticipated rather than worked around.

Verified: 22 unit tests across `src/lib/textStyles.test.ts` and
`src/lib/palettes.test.ts` (capture→patch never touches content or position,
corrupt-JSON fallback, overwrite-by-name, defaults always present and never
written to storage), four browser tests in `e2e/styles.spec.ts` (a saved
style restyles a second block while its text and position hold; apply is one
undo; a style survives a reload; a swatch recolours the selection), plus the
full typecheck/lint/test/build loop.
<!-- ---- /STREAM-E ---- -->
<!-- ---- STREAM-F: ink & surface — add your Shipped entry here ---- -->

### 2026-08-14 — Ink & surface (stream F)

Gradient block fills, including gold/silver/copper/lapis metallic presets,
and generated paper textures for the page.

- `src/lib/blockFill.ts` (pure, unit-tested) owns `BlockFill`, the gradient
  geometry, the presets, and `createBlockFillPainter` — the piece that keeps
  one gradient spanning a whole block while the renderers keep filling inside
  per-glyph transforms.
- All three text renderers resolve their fill through it. Solid fills take an
  unchanged code path, and `fill` is only ever written for a gradient, so
  older saves render identically.
- SVG export keeps gradients as real vector gradients — see the coordinate-
  space note in CLAUDE.md's "Ink & surface" section; nothing rasterizes.
- Four generated, seamless paper textures (`src/data/textures/`) reach the
  page through the prep commit's `surfaceRectProps` seam.
- Covered by `src/lib/blockFill.test.ts`, `src/data/textures/textures.test.ts`
  and `e2e/ink-surface.spec.ts`.

**Known gaps.** The page surface is saved with the document but is *not* in
the undo snapshot (`EditorSnapshot` was outside this stream's anchors), and
`CanvasStage.tsx` / `MirrorBlockView.tsx` needed a one-line `fill` pass-through
that the Phase 2 ownership table did not allocate to anyone.

<!-- ---- /STREAM-F ---- -->
<!-- ---- STREAM-G: font upload — add your Shipped entry here ---- -->
### 2026-08-14 — User font upload (stream G)

The font list is no longer fixed. **Typography → Upload a font…** takes a
`.ttf`/`.otf` from the user's machine, validates it with the already-vendored
opentype.js, stores the bytes in IndexedDB, and registers both a shaping URL
and a runtime `FontFace` — so the font appears in the picker (marked
*uploaded*, previewed in itself), shapes through HarfBuzz like any bundled
font, and survives a reload. Uploads are listed under the picker and
removable.

Fonts stay in the browser: a project saves the font *key*, never the bytes. A
key nothing can resolve renders in Noto Sans and says so, in the status row
and beside the picker, rather than substituting silently. The dialog prints
the two honest caveats — the Presets honorifics exist only in bundled fonts,
and licensing is the user's responsibility.

Mechanism, precedence rules and the "don't index `FONT_URLS` directly" trap
are in CLAUDE.md → *User-uploaded fonts*. Covered by
`src/lib/customFonts.test.ts` (23 tests against real fonts from
`public/fonts/`, including a truncated copy) and `e2e/font-upload.spec.ts`
(upload → pick → re-render, save/reload round-trip, delete → notice,
non-font rejected).

Known limits, all deliberate: no WOFF/WOFF2 (harfbuzzjs wants uncompressed
bytes), no font bytes in cloud saves, no Google-Fonts browsing, and no PUA
honorific injection into an upload.
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
features" section carries the reasoning for each. All of it was re-planned on
2026-09-06 against the real code, one investigator and two adversarial critics
per item — `docs/superpowers/plans/2026-09-06-remaining-work-program.md` holds
the result, and most of it came back **declined**.

Still open, in the order that plan sequences them:

- Boustrophedon square-kufi compositions

Per-glyph rotation, hand-editing square-kufi cells, and per-glyph
move/scale/rotate on Shape Fill all shipped on 2026-09-06 and have left this
list. Text-on-path was dropped from that last item rather than deferred with
it: `offsetX` on a curve has no defined meaning until a spec answers whether
it runs along the tangent or along arc length.

Declined there, with the reason in the plan: straight-stroke stretching on
Shape Fill/Curve (both renormalise the span), image trace (Shape Fill's
scanline layout is single-span, so a multi-region trace fills as one band),
dots and tashkeel in square kufi (dot ownership is unreadable under a
block-wide band), spiral compositions, a unified per-glyph keying scheme (its
existing saves cannot be migrated), and cloud conflict resolution (ships dark
— Supabase is not configured in production).

Mark detection via GDEF glyph classes was **evaluated and rejected** rather
than deferred: the fonts that need arming carry no GDEF table at all, and
where it exists it classes a letter's dots as marks exactly like tashkeel.
See CLAUDE.md, "Per-instance diacritic control".
