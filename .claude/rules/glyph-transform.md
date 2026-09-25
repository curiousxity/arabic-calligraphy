---
paths:
  - "src/lib/glyphTransform*.ts"
  - "src/lib/diacriticPlacement*.ts"
  - "src/components/GlyphTransformHoverHandles.tsx"
  - "e2e/glyph-transform.spec.ts"
---

# Per-glyph move, scale & rotate (`src/lib/glyphTransform.ts`, `GlyphTransformHoverHandles.tsx`)

Text **and Shape Fill** blocks support rigidly moving a single shaped glyph,
stretching or shrinking it as a whole in x or y, and turning it — a second
per-glyph system alongside `diacriticOverrides` (uniform scale plus vertical
offset, marks only). Ticking "Move, scale & rotate glyph" in Sidebar →
Typography arms it; hovering a letter then shows four dots — blue to move,
gold to scale x, green to scale y, purple to turn.

`GlyphTransform` (`types.ts`: `offsetX`/`offsetY`/`scaleX`/`scaleY`, all
defaulting to the identity) is applied in `ShapedText.tsx`'s
`drawWarpedGlyphRun` as a `ctx.translate`/`ctx.scale` pair placed inside the
existing `ctx.translate(gx, gy)` — which is what makes the pivot the glyph's
**pen origin** (on the baseline, at the start of its advance) with no pivot
arithmetic, so a scaled letter keeps sitting on the baseline. It is the
**outermost** transform relative to a diacritic override: a mark carrying
both is first placed by its override in the glyph's own pre-transform space
and then moved/scaled by the transform, never the reverse. That ordering is
load-bearing rather than cosmetic — reversing the two `ctx` blocks multiplies
the transform's offset by the diacritic's scale, which no adapter can invert,
so `DiacriticHoverHandles` could no longer read a drag back as an unscaled
`offsetY`.

**`penX += advance` is never touched** — a moved or widened glyph does not
reflow its neighbours, matching what `hidden` already guarantees on
diacritic overrides.

**Every box the metrics memo emits is now raw**, and the overlay folds the
transform in itself. `ShapedText.tsx` used to emit a second,
transform-folded `glyphTransformedHitBoxes` list beside the raw
`glyphHitBoxes` purely for this overlay; that list is gone, along with
`activeGlyphTransforms` from the memo's dependency array — which is what
stops the expensive walk (one `getPath(...).getBoundingBox()` per glyph)
re-running on every frame of a drag. The block-level `bounds` in that same
loop are raw for a *different* reason and always were: they must stay based
on the untransformed run, or transforming one glyph would resize the block
and shift every other glyph on canvas.

**Both overlays now take placements, not boxes.** `GlyphTransformHoverHandles`
takes `GlyphTransformPlacement[]` (`lib/diacriticPlacement.ts`) exactly as
`DiacriticHoverHandles` takes `DiacriticPlacement[]`: each carries the glyph's
**raw** box, its pen origin, and a matched `toCanvas`/`toLocal` adapter, so all
of the overlay's arithmetic — hover, hit rect, the two rails, all four dots,
and every drag readback — stays in the placement's own local space. Two
things about that shape are load-bearing:

- **The box is raw and the transform arrives as a separate prop.** A
  pre-folded box would make the producing memo depend on the live drag value,
  which on Shape Fill means rebuilding and re-mapping the whole tiled instance
  array every frame — the same reason `diacriticPlacements`' dep list
  deliberately excludes `diacriticOverrides`.
- **Hover and drag state are keyed on `placement.key`, never on
  `glyphIndex`.** On a tiling renderer an index-keyed hover lights every
  repetition of that letter at once. (With the Shape Fill cap below the two
  coincide *there*; the rule still holds, and `e2e/glyph-transform.spec.ts`
  falsifies it against an uncapped build.)

`unitScaleX`/`unitScaleY` on a placement say how many canvas px one local unit
spans, and the dots' gaps are divided by them. On plain text they are absent
(local space *is* canvas px); on Shape Fill a compressed row's local unit is a
fraction of a pixel, and a gap left at face value there puts both scale dots
inside the letter.

A mark that itself carries a transform gets `makeGlyphTransformAdapter`
(`lib/diacriticPlacement.ts`) as its placement adapter instead of the plain
`makeOffsetAdapter`, which is how its handles reach the mark where it is
actually drawn while its `offsetY` stays in unscaled text units. The adapter
reduces to exactly `makeOffsetAdapter` at the identity transform, which is
the case for almost every glyph.

Scales are clamped to 0.2–4 in `glyphTransform.ts`, both when reading a drag
and when resolving a stored value, so a corrupted project file cannot
produce a glyph too small to grab and fix.

`GlyphTransformHoverHandles` mounts **before** `DiacriticHoverHandles` in
`ShapedText`'s JSX: Konva routes a pointer to the topmost listening shape,
these rects are glyph-sized, and a mark's hit target is smaller and sits
inside one. Mounted later they would steal hover from every mark.

Transforms are keyed by glyph index and share that scheme's fragility, but
both systems are now re-validated each render. `diacriticOverrides` are
filtered against `findDiacriticGlyphIndices`, so a stale override landing on
a base letter is dropped. A transform has no such signal — every glyph is a
legitimate target — so it instead records the **`glyphId` it was made for**,
and **`filterActiveGlyphTransforms`** (pure, in `glyphTransform.ts`) drops one
whose recorded id no longer matches the glyph at that index. It lives there
rather than inline in a renderer precisely so **both** `ShapedText` and
`ShapeFillText` run the identical rule — inlined, the rule would simply not
exist on the second renderer, and the extraction would be dead code.
`glyphId` is optional on purpose: a
transform saved before the field existed cannot be validated, so it keeps the
original behaviour of applying to whatever glyph now holds its index rather
than being silently discarded. Every write goes through
`GlyphTransformHoverHandles`' one `applyPatch` helper, which is what keeps the
four drag handlers from each having to remember to stamp it.

A scale-handle drag snapshots the dot's starting distance from the pivot at
`onDragStart` rather than reading it from the live hit box: the box already
carries the transform the drag is updating, so reading it live makes the
scale converge to the wrong value (asking for 2× lands near 1.45× at typical
geometry). For the same reason the drag's pivot is `gx + offsetX`, not bare
`gx` — the renderer translates by the offset *before* scaling, so a moved
glyph pivots there too, and using the bare pen origin reads correct at rest
but drifts as the offset grows.

`scaleFromHandleDrag` then recovers the glyph's unscaled extent from that
snapshot (`(startDistance - gap) / startScale`) and inverts the dot's own
rest formula, so the dot stays exactly `gap` beyond the glyph's edge for the
whole gesture and the first frame returns the starting scale unchanged — no
jump on mouse-down, and no drift when an already-scaled glyph is dragged a
second time. The `gap` argument is **signed along each dot's rail**: positive
for the x dot, negative for the y dot, which sits above the glyph while
canvas y grows downward.

**Rotation is the fourth handle, and it goes *inside* the scale.** The full
composition is `translate(gx, gy) → translate(offset) → scale → rotate about
the glyph's raw box centre → [diacritic override] → outline`. Putting the
turn outside the scale is the plausible alternative, and it is the one thing
in this feature that would have shipped looking correct:

- **The pivot must not depend on the scale.** Outside the scale the pivot
  becomes `(boxCentreX − gx) × scaleX`, and the scale handles snapshot
  `pivotX`/`pivotY` once at `onDragStart` and measure from that frozen point
  every frame. A pivot that moves under them is exactly the "asking for 2×
  lands near 1.45×" divergence recorded below — reintroduced by a different
  route. It is **zero at rotation 0**, so every pre-existing test and both
  pre-existing e2e drags stay green while the defect ships. The guard is
  `glyphTransform.test.ts`'s "round-trips with a rotation and a non-unit
  start scale set together", which was verified to fail against an
  outside-the-scale `transformedBox` and is the only assertion in the suite
  that does.
- **Nothing else had to change.** The scale rails stay axis-aligned in local
  space, `SCALE_HANDLE_GAP` stays in the same space as `startDistance`, and
  `scaleFromHandleDrag` needs no signed-axis generalisation — so the three
  drag readbacks that shipped wrong twice are not touched at all.
- **The visible cost** is that at a *non-uniform* scale a turned letter is
  stretched along the block's axes rather than its own. Deliberate, and
  identical either way whenever `scaleX === scaleY`, which is almost every
  real use. The guide says so.

`transformedBox` rotates the raw box about its centre and takes the AABB
*before* scaling. Two consequences worth knowing: the operation leaves that
centre exactly where it was, so **the drawn box's centre is the rotation
pivot** at any scale, offset or angle — which is why `GlyphTransformHoverHandles`
needs no pivot threaded through it and the rotate drag reuses the point the
move dot already sits on; and the half-extent stays proportional to `scaleX`,
which is what keeps the scale-handle round trip exact.

The pivots the *renderer* needs are a different matter: they come from
`ShapedText`'s `glyphMetrics` walk, appended as the last positional parameter
of `drawWarpedGlyphRun`. They must come from there rather than a
`getBoundingBox()` inside the draw loop, because the metrics boxes are
**post-cut** — a surgically lengthened letter has to turn about the centre of
what it is, not the centre of what it was.

Wherever that centre is taken, it is taken through **`glyphPivot`**, never
restated: both renderers' draw loops and `ShapeFillText`'s placement adapter
call it, so "where a letter turns" cannot drift between them. Restating it is
the same shape of mistake as inlining `filterActiveGlyphTransforms` would
have been — the rule would simply not exist on the second renderer, and the
divergence is subtle rather than a crash.

The rotate dot sits **diagonally past the box's upper-outer corner, never
below it**. Kasra, kasratan and shadda-kasra all hang under the baseline, and
`DiacriticHoverHandles` mounts *after* this component with a generous
`fontSize * 0.5` vertical margin — so a dot below centre lands under a mark's
hit rect, and Konva routes the pointer to the topmost listening shape. The
symptom is not a dot that fails to work but one that hands the gesture to the
mark instead, recording a diacritic override. `e2e/glyph-transform.spec.ts`
pins that by asserting the *drag*, and was verified to fail (`Rect.diacritic-hit`)
against a below-centre placement.

The rotate handle **free-drags** — no rail, so no `dragBoundFunc` and
therefore no reason to reach for `getAbsoluteTransform()`; everything is in
the overlay's own group space, which is the space `e.target.position()`
already reports in. `rotationFromHandleDrag` reads the *change* in bearing
about the pivot rather than the bearing itself, which gives the same no-jump
first frame `scaleFromHandleDrag` guarantees and lets the dot be grabbed
anywhere on its circle.

Two known limits, both pre-existing and neither widened by much:
`StrokeCutHoverHandles` builds its rails from bare `gx`/`gy` and is
glyph-transform-blind (already true of offset and scale; rotation makes it
more visible), and the PUA preset-honorific branch draws override art whose
centre differs from the metrics memo's font-glyph box, so a turned honorific
pivots off-centre.

## On Shape Fill

`supportsGlyphTransforms` (in `lib/blockCapabilities.ts`) is
`text | shapeFill`. Widening it is
what actually makes the feature work on the tiling renderer —
`glyphTransforms` lives on `BlockCommon`, so a narrower guard type-checks
perfectly while silently discarding every edit, the trap recorded against
`supportsDiacriticOverrides`. `textPath`, `image`, `squareKufi` and `mirror`
are still out (see Deferred features), and `MirrorBlockView` passes
`glyphTransforms` on both the `text` and `shapeFill` branches so a mirror
draws the transformed letters.

- **Placements are capped to one per glyph index**, attached to the tile
  nearest the silhouette's centre. This was decided up front rather than
  discovered: a 3000-tall silhouette at `fontSize` 20 gives ~115 rows, and a
  2000-wide row with a four-glyph run gives ~50 reps — **~23,000 listening
  Konva rects**, a frozen tab rather than a slow frame. The cap costs nothing
  semantically, because a transform is keyed by glyph index and therefore
  **already applies to every tiled repetition**, exactly as
  `diacriticEditMode` has always worked. What it costs is that the handle may
  not sit on the tile the user is looking at; the guide says so.
  `e2e/glyph-transform.spec.ts` pins it against the *diacritic* overlay's
  per-tile rect count off the same instance array — verified to fail at 780
  rects with the cap removed.
- **The transform is applied between `rotate(rotRad)` and
  `scale(scX, scY)`**, and the second half of that is a choice rather than a
  consequence. Outside the diacritic override is forced (the transform must
  stay the outermost rigid transform, or the mark's adapter cannot invert a
  drag). Outside the *row's fit scale* is chosen: `scX` is a per-line factor,
  different on every row, so a stored `offsetX` placed inside it would move
  the letter by a different amount on every repetition. `penX`/`totalAdvance`
  are untouched, as everywhere else.
- **Three coordinate spaces, and the placements live in the middle one.** The
  overlay's local space for this renderer is the **row frame** — after
  `translate(gx, gy) → rotate`, before `scale(scX, scY)` — where the pen
  origin is `(0, 0)` and the glyph box is the raw box carried through the
  row's fit scale. Pre-folding the *row* scale into the placement box is safe
  (it is layout, fixed for the gesture); pre-folding the *transform* is not.
  The row frame is a similarity (rotation plus uniform `shapeScale`), which is
  why the overlay's bearings and axis-aligned rails need no generalisation.
  Its adapter is `makeShapeFillInstanceAdapter` with unit row scales, not a
  fourth builder.
- **A mark on a transformed glyph gets a composed adapter**
  (`composeAdapters`, pure and tested): row frame, then the glyph transform,
  then the row's fit scale, which is where the mark's own override lives. With
  no transform the adapter is byte-identical to the two-stage
  `makeShapeFillInstanceAdapter` this renderer has always used —
  `composeAdapters`' "reduces to the outer adapter at the identity" test is
  that claim. `diacriticInstances` splits the (potentially huge) walk over
  `glyphInstances` out of the placements memo, so composing a transform in
  during a live drag costs one pass over the *marks*, not over every tile.
- **`ShapeFillText`'s `dragBoundFunc` pin was fixed, not widened.** Konva's
  contract is absolute stage coordinates; the old `() => ({ x, y })` returned
  the block's *layer-space* props, so at the default 275% zoom pressing an
  armed silhouette teleported the block — measured at 37px. It now pins to the
  node's own pre-drag `getAbsolutePosition()`, captured at `dragstart` (with a
  lazy read as fallback, since Konva asks before it has moved the node). The
  gesture that sees this is a press on the *silhouette*, never on a dot: a
  dot cancels the bubble on mousedown, so a handle drag never starts a block
  drag and never consults the pin at all — the obvious test passes with the
  bug fully present.
- Known approximation, inherited: `makeShapeFillInstanceAdapter` ignores the
  italic shear the draw loop applies inside it, so on an italic Shape Fill
  block every handle sits a few pixels off. A stacked glyph transform makes it
  slightly more visible.
