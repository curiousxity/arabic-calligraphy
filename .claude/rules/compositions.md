---
paths:
  - "src/lib/composition*.ts"
  - "e2e/composition.spec.ts"
---

# Compositions (`src/lib/composition.ts`)

Block Controls → **Add medallion** sets the selected text block into a
radial medallion of mirrors, spaced by the run it actually draws.

**The wizard is gone (2026-10-16).** Content → Compositions opened a dialog
offering a measured muthanna pair or a medallion. It was removed because
Block Controls already had Add mirror (the muthanna); the medallion moved to
its own Add button, which calls `applyComposition({ layout: "medallion" })`
with the default copy count (the Mirror panel's Copies row changes it
after). `CompositionDialog.tsx` and its CSS went with it. **The `muthanna`
layout in `composition.ts` now has no UI**: Add mirror still uses
`buildMirrorBlock`'s fixed 180px nudge, not the measured offset. The layout
and its tests were kept, since wiring it into Add mirror for text blocks is
the obvious next step if that nudge ever bothers anyone.

**History.** This was "Name designs" until 2026-10-13: a two-step wizard
whose first step was a gallery of the text in every font, plus a `single`
layout that only changed the font. That gallery became the Typography
panel's font picker (`FontPickerDialog.tsx`, see [sidebar.md](sidebar.md)),
and with it went `single`, the request's `fontFamily` and the plan's
`patch`. The wizard never changes the source block now; it only adds blocks
around it. Saves are unaffected — a composition was always ordinary mirror
blocks.

**It introduces no new primitive.** A muthanna and a medallion are both
`buildMirrorBlock`. What `lib/composition.ts` adds is the arithmetic that
turns a *measured* run into placements that don't collide — which is the whole difference between "add a
mirror" (a fixed 180px nudge the user then drags) and "compose this text".

- **Pure, with measurement injected**, exactly as `fitToWidth.ts` is and for
  the same reason: `harfbuzz.ts`'s static harfbuzzjs import throws under
  Vitest's Node ESM loader before any test code runs, so the module takes a
  `RunBox` the caller measured. The async half is `measureShapedRun` in
  `lib/measureShapedText.ts`. If shaping fails the composition is still
  built, on `estimateRunBox` — a loose arrangement the user can drag beats no
  arrangement.
- **A medallion's radius is driven by the run's *height*, not its width.**
  Radial copies are rotated to face along their own spoke, so a copy lies
  radially: its width runs outward and its height is what crowds its
  neighbours. The tangential constraint (`2πr / count ≥ height + gap`) is what
  makes a 12-copy ring open out where a 4-copy one need not; a second term
  keeps the copies' inner ends clear of the centre, where the source block is
  still drawn. Getting this backwards produces rings that overlap at high
  counts and look fine at low ones.
- **One `pushHistory()` covers the added blocks**, so a whole composition is a
  single undo. The block is captured **by id** — measuring is async and the
  selection can change while it runs, the same hazard
  `fitSelectedBlockToWidth` documents beside it. A plan that adds nothing
  skips the write and costs no undo step.
- **`normalizeRunBox` is the only place the run floors are applied.**
  `buildComposition` runs it over its input — it is idempotent, so App's own
  normalize costs nothing — and the placement formulas then read
  `run.width`/`run.height` directly instead of each re-flooring.
- **The `RunStyle` terms come from `runStyleForBlock`** in `lib/fitToWidth.ts`,
  shared with `fitSelectedBlockToWidth`. Written out at both call sites, a new
  term joining `styledRunWidth` reaches one and silently not the other — both
  still compile, both still produce a plausible number. That already happened
  once: `cutWidth` (straight-stroke cuts) landed inline at the fit handler
  while this one went on measuring without it, which is why the helper now
  takes it as a **required** argument. It is an argument rather than another
  field read off the block because summing cuts needs the nuqta table
  `fitToWidth.ts` deliberately keeps out — `App.tsx`'s `cutWidthForBlock` owns
  that half.
- **`CompositionSelection` lives in `lib/composition.ts`**, as
  `Omit<CompositionRequest, "source" | "run">`, not in the dialog: the state
  layer must not import a domain type back out of a component, and the `Omit`
  makes a new request field a type error at the wizard rather than a silent
  omission.
- Plain text only (Add medallion is disabled otherwise, via
  `canAddMedallion` in `Sidebar.tsx`): a Shape Fill run is auto-scaled to
  its silhouette and a Curve run to its curve, so a measured run width has
  nothing to act on there — the same reason Fit to width is text-only.
- The shared dialog chrome classes are still named `nameDesign*` in
  `index.css`: the font picker, verse and guide dialogs use them.

Deliberately **not** built: Latin→Arabic transliteration and a name
dictionary (typing the Arabic is the app's own input model, and a phonetic
guess at "Mohammed" is a different product), and a library of ready-made
artwork.
