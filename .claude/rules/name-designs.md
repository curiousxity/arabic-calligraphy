---
paths:
  - "src/lib/nameDesign*.ts"
  - "src/components/NameDesignDialog.tsx"
  - "e2e/name-design.spec.ts"
---

# Name designs (`src/lib/nameDesign.ts`, `NameDesignDialog.tsx`)

Content → **Name designs** opens a two-step wizard: see the block's own text
written in every style, then set it into a composition — a muthanna pair, a
medallion, or a frame. It is the "type your name, get it in Arabic
calligraphy" flow the name-calligraphy sites are built around, assembled out
of parts this app already had.

**It introduces no new primitive.** A muthanna and a medallion are both
`buildMirrorBlock`; a frame is an ordinary image block carrying an ornament's
own SVG, the same way `OrnamentPicker` already inserts one. What
`lib/nameDesign.ts` adds is the arithmetic that turns a *measured* run into
placements that don't collide — which is the whole difference between "add a
mirror" (a fixed 180px nudge the user then drags) and "compose this name".

- **Pure, with measurement injected**, exactly as `fitToWidth.ts` is and for
  the same reason: `harfbuzz.ts`'s static harfbuzzjs import throws under
  Vitest's Node ESM loader before any test code runs, so the module takes a
  `RunBox` the caller measured. The async half is `measureShapedRun` in
  `lib/measureShapedText.ts` — `measureShapedWidth` now delegates to it, since
  a composition needs the height too.
- **The run is measured in the *new* font**, not the block's current one.
  Every layout spaces itself by how wide the name draws, and that is a
  property of the style just chosen. If shaping fails the design is still
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
- **Frames go behind, reflections in front.** `NameDesignPlan.placement` says
  which, and `App.tsx` splices accordingly — blocks render in array order, so
  a frame appended at the end covers the name it is meant to surround. The
  frame's colour is **baked in at insert** (it is a rasterized image), which
  is why the wizard offers the swatches before Create rather than after.
- **The gallery previews in CSS, not on canvas.** Every bundled font has an
  `@font-face` rule and an uploaded one gets a `FontFace` from its own bytes,
  so 17 styles cost no shaping and no rasterization — the same trick
  `FontSelectRow` uses. `Sidebar.tsx` hoists one `fontChoices` list feeding
  both the Typography picker and this gallery, so a family cannot appear in
  one and not the other (which would render a name under the wrong name).
- **One `pushHistory()` covers the style change and the added blocks**, so a
  whole design is a single undo. The block is captured **by id** — solving is
  async and the selection can change while it runs, the same hazard
  `fitSelectedBlockToWidth` documents beside it. A design that changes nothing
  (Single, in the font the block already carries) skips the write entirely, so
  it costs no undo step — the same no-op rule that handler follows.
- **Only the layouts that place a companion block are measured.** `single`
  reads `request.run` nowhere, so `applyNameDesign` skips the `await` for it
  rather than making the style change wait behind a first-use font download
  (`Urdu.ttf` is 12.8 MB).
- **`normalizeRunBox` is the only place the run floors are applied.**
  `buildNameDesign` runs it over its input — it is idempotent, so App's own
  normalize costs nothing — and the placement formulas then read
  `run.width`/`run.height` directly instead of each re-flooring.
- **The `RunStyle` terms come from `runStyleForBlock`** in `lib/fitToWidth.ts`,
  shared with `fitSelectedBlockToWidth`. Written out at both call sites, a new
  term joining `styledRunWidth` reaches one and silently not the other — both
  still compile, both still produce a plausible number. That already happened
  once: `cutWidth` (straight-stroke cuts) landed inline at the fit handler
  while the name-design one went on measuring without it, which is why the
  helper now takes it as a **required** argument. It is an argument rather than
  another field read off the block because summing cuts needs the nuqta table
  `fitToWidth.ts` deliberately keeps out — `App.tsx`'s `cutWidthForBlock` owns
  that half.
- **`NameDesignSelection` lives in `lib/nameDesign.ts`**, as
  `Omit<NameDesignRequest, "source" | "run">`, not in the dialog: the state
  layer must not import a domain type back out of a component, and the `Omit`
  makes a new request field a type error at the wizard rather than a silent
  omission.
- Plain text only, gated in `Sidebar.tsx`: a Shape Fill run is auto-scaled to
  its silhouette and a Curve run to its curve, so a measured run width has
  nothing to act on there — the same reason Fit to width is text-only.

Deliberately **not** built: Latin→Arabic transliteration and a name
dictionary (typing the Arabic is the app's own input model, and a phonetic
guess at "Mohammed" is a different product), and a library of ready-made
artwork.
