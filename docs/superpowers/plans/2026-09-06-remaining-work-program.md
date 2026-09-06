# Remaining work — program plan (2026-09-06)

Produced by a 28-agent planning workflow: one investigator per work item reading the
real code, two adversarial critics per plan (documented-constraint violations, hidden
coupling), then synthesis. Scope was the seven "Deferred features" in `CLAUDE.md` plus
the two `PROGRESS.md` known limitations that are fixable in code.

**Five of the nine were dropped on the critiques.** Two live defects the investigation
turned up are now the highest-value work in the repo; both were confirmed by hand
against the tree before this document was written.

---


## 1. What is left

Most of what is left is not worth building. Nine items were investigated; after the critiques, four survive as features, two survive as small corrective fixes, and five are dropped outright. The pattern is consistent: the items framed as *generalisations* ("make this tool work on the other block types", "one stable key replaces three", "restore the traced-image input") all turn out to be blocked on a property of the target renderer that the framing hides — Shape Fill and Curve both renormalise their run to a fixed span, Shape Fill's scanline layout is single-span so a multi-region trace fills as one clipped band, and the anchor-keying scheme cannot be migrated onto existing saves because index→offset needs shaping. Meanwhile the genuinely valuable work is small and unglamorous: two live data-loss bugs (Fit to width silently discards every stroke cut on the block; a mirrored text block never receives its source's stroke cuts at all), one square-kufi feature that is cheap because that block type loads no font, and one per-glyph handle that the repo has already half-designed. The honest shape of the remainder is **one week of high-value fixes, one contained feature, and a long tail that should be declined rather than scheduled.**

## 2. Recommendation table

| id | description | verdict | effort | user value | depends on |
|---|---|---|---|---|---|
| `edit-survival` | Fit to width stops discarding stroke cuts; mirrors receive them | **build** | S | high | — |
| `kufi-cell-edit` | Hand-paint individual cells on a square-kufi panel | **build** | M | high | — |
| `glyph-rotation` | Fourth handle: rotate a single glyph | **build-with-caveats** | M–L | medium | — |
| `stroke-cuts-docs` | Correct the stale `strokeCuts.ts` header and three dead cross-references | **build** (docs only) | XS | low | — |
| `kufi-boustrophedon` | Snaking return lines for square kufi (spiral dropped) | **build-with-caveats** | M | medium | `kufi-cell-edit` (same placement pass) |
| `glyph-tools-shapefill` | Per-glyph move & scale on Shape Fill (text-on-path dropped) | **build-with-caveats** | L–XL | medium | `glyph-rotation` (same overlay) |
| `stroke-cuts-shapefill` | Straight-stroke stretching on Shape Fill / text-on-path | **do-not-build** | — | — | — |
| `kufi-dots` | Dots (iʿjām) and tashkeel in square kufi | **do-not-build** | — | — | — |
| `kufi-spiral` | Spiral square-kufi compositions | **do-not-build** | — | — | — |
| `image-trace` | Trace a raster image into a Shape Fill silhouette | **do-not-build** | — | — | — |
| `glyph-key-stability` | Full source-offset anchor scheme for all per-glyph edits | **do-not-build** | — | — | — |
| `cloud-conflicts` | Compare-and-swap conflict resolution for cloud saves | **do-not-build** | — | — | — |

## 3. Do not build

**`stroke-cuts-shapefill` — the feature is structurally impossible on both targets.** `computeShapeFillLines` sets `fitScaleX = lineWidth / (reps × effectiveAdvance)` and `TextOnPathText` sets `fitScale = curveLen / naturalAdvance`. Cuts never touch `g.ax`, so the implementer faces a two-horn dilemma: feed the added advance into `totalAdvance`/`naturalAdvance` and the renderer divides it straight back out, or leave it out and cut glyphs grow into their neighbours' slots. Neither is elongation, and the feature's own assertion ("the advance grows monotonically with `d`") cannot hold. This is the same reason Fit to width is text-only. **What survives is only the documentation half** — see `stroke-cuts-docs`.

**`kufi-dots` — the design core is unsolved, and the plan's own tests could not have caught it.** The proposed uniform block-wide dot band puts ز's single dot eight rows above a one-row letter in any panel containing an alef, so dot *ownership* — which letter a dot belongs to — becomes unreadable, which is the entire point of iʿjām. The load-bearing clearance test was also vacuous in both directions (the falsification check at `CLEARANCE = 1` degenerates to "within 0 cells", and the uniform band satisfies the dot↔letter clause at any horizontal gap). Fixing it means per-letter hugging plus vertical-overlap-aware separation, and dot-driven widening at three gap paths the plan addressed one of. CLAUDE.md's position — traditional square kufi omits the iʿjām, so dotless is correct for the style — remains the right one. The tashkeel half was already correctly rejected by the investigator as invention, not implementation.

**`kufi-spiral`** — needs `band = ascent + descent` before line breaking and the band from the lines, a circular dependency; needs `rows` redefined (today it is `lines.length × lineHeight + gaps`, a stacked-lines formula that would silently clip every leg below the first ring); needs per-segment wrap limits that interact badly with `breakIntoLines`' deliberate over-wide-single-letter case; and needs its own fit search inside a sweep budget that has already been wrong twice. Boustrophedon delivers the recognisable half at a fraction of the cost.

**`image-trace` — it would ship visibly broken for exactly the images people trace.** `computeShapeFillLines` is single-span: it takes the leftmost and rightmost in-shape samples of a scanline and lays one contiguous run between them. A logo with four separate regions therefore gets one band stretched across all four plus the gaps, which `targetCtx.clip()` then chops into glyph fragments, with each row's auto-scale fitted to the union width rather than to any region. The investigator's headline "4.6% of the shape is filled with text where it should be empty" is half wrong for the same reason — the nonzero `clip()` already prevents leakage — and the proposed decisive e2e assertion (no ink outside the silhouette) passes today with none of the work done. Making tracing good means multi-span scanlines, a hit test whose winding rule matches the clip, and memoizing a `computeShapeFillLines` that currently runs inside `sceneFunc` on every repaint against a ~1000-point machine-traced outline. That is a rewrite of Shape Fill's render math, which CLAUDE.md explicitly declines. Ornaments plus SVG upload already cover the need.

**`glyph-key-stability` (full scheme) — the framing is false and the residue is large.** All three existing mitigations must stay (the `findDiacriticGlyphIndices` filter is a correctness guard against arming a hide button on a letter's dot; the `glyphId` checksum still catches residue; legacy `glyphIndex` entries can never be migrated on load because index→offset needs shaping and `applyParsedLayoutPayload` is synchronous), so net code goes up. Worse, `sourceIndex = shapableToSource[g.cl]` is the *base letter's* offset for every glyph in a cluster, so two identical marks on one base cannot be told apart by the anchor — delete the first and the second resolves as `nth 0` and inherits the dead override, which is worse than today. And matching on `glyphId` would newly drop diacritic overrides across a font change, which they survive today. The cheap, contained subset is worth doing and is item `edit-survival`.

**`cloud-conflicts`** — ships dark (`VITE_SUPABASE_URL`/`ANON_KEY` are absent in production, `supabase` is `null`, every cloud control is hidden behind `cloudConfigured`), and as designed the CAS is largely decorative: bases seeded from `listCloudProjects` on boot mean a user who never opened a project still passes the check and clobbers their other device, while a name not in this session's list raises a conflict dialog for a project they alone authored. Both error modes point the wrong way. Revisit only if cloud is actually turned on — and then design the base as *provenance* (set only by a successful load), not as a list snapshot.

## 4. Sequencing

**Wave 1 — three parallel streams.** These touch disjoint subsystems and can run under a file-ownership contract of the kind `PARALLEL-PHASE-1.md` already establishes.

- **Stream A — `edit-survival` + `stroke-cuts-docs`.** Owns `src/lib/fitToWidth.ts`, `src/lib/strokeCuts.ts`, `src/components/MirrorBlockView.tsx`, `e2e/stroke-cuts.spec.ts`, and the `fitSelectedBlockToWidth` region of `App.tsx`.
- **Stream B — `kufi-cell-edit`.** Owns `src/lib/squareKufi.ts`, `src/components/SquareKufiText.tsx`, the new overlay, `src/hooks/useExport.ts`, `e2e/square-kufi.spec.ts`, and the square-kufi handler region of `App.tsx`.
- **Stream C — `glyph-rotation`.** Owns `src/lib/glyphTransform.ts`, `src/lib/diacriticPlacement.ts`, `src/components/GlyphTransformHoverHandles.tsx`, `src/components/ShapedText.tsx`, `e2e/glyph-transform.spec.ts`, `e2e/harf.ts`.

**Ownership conflicts that need a contract, not goodwill:**

- **`src/components/MirrorBlockView.tsx`** — Stream A adds `strokeCuts` (text branch), Stream B adds `kufiCellEdits` (squareKufi branch). One line each on different branches. Give the whole file to Stream A and have it land Stream B's line too, in the prep commit.
- **`src/App.tsx`** — Streams A and B both add code. `glyph-rotation` deliberately needs *no* App change (`updateGlyphTransform` takes a generic `Partial<GlyphTransform>`, `mergeGlyphTransform` already handles staleness, `resetGlyphTransforms` already clears the array). Anchor Stream A to the `fitSelectedBlockToWidth` callback and Stream B to a new handler block placed immediately after the existing `supports*` guards. Note the declaration-order trap: both streams' handlers must be defined above their first reference.
- **`src/components/Sidebar.tsx`** — Stream B edits the Square Kufi type panel, Stream C renames the Typography "Move & scale glyph" section. Different panels, hundreds of lines apart; anchor comments suffice.
- **`CLAUDE.md` / `PROGRESS.md`** — assign section ownership explicitly. Stream A owns "Straight-stroke cut detection" and "Deferred features"' stroke bullet; Stream B owns "Square kufi"; Stream C owns "Per-glyph move & scale" and the `Per-glyph rotation` deferred bullet. Whoever lands second rebases their own section only.

**Wave 2 — two parallel streams, serialised behind Wave 1.**

- **`kufi-boustrophedon`** must follow `kufi-cell-edit` because both rewrite `layoutSquareKufi`'s placement pass, and cell-edit is the one that defines `placements` — a composition mode that rotates lines must emit placements in its own frame, which is far easier to get right on top of an API than beside one.
- **`glyph-tools-shapefill`** must follow `glyph-rotation` because both rewrite `GlyphTransformHoverHandles`. Rotation settles the rail geometry and the pivot; the Shape Fill port then only has to add an adapter and a key change, instead of two people simultaneously reworking the three drag readbacks CLAUDE.md records as having shipped wrong twice.

These two Wave 2 streams touch disjoint renderers (`squareKufi.ts`/`SquareKufiText.tsx` versus `ShapeFillText.tsx`/`GlyphTransformHoverHandles.tsx`) and can run in parallel under the same `App.tsx` / `Sidebar.tsx` / docs contract as Wave 1.

Nothing else serialises. If time runs short, cut from the bottom: `glyph-tools-shapefill` first, then `kufi-boustrophedon`.

## 5. Per-item plans

---

### 5.1 `edit-survival` — stop losing per-glyph edits (S, build)

Two live defects, verified in the tree.

1. `fitSelectedBlockToWidth` (`src/App.tsx:2310`) ends with `if (result.text !== text) updateBlock(id, { text: result.text });` — no cut remap. Every `strokeCut` on the block is then dropped by `buildCutPlan`'s `glyphId` checksum, and `cutWidthForBlock` had already fed those cuts into `runStyle`, so the fit both loses the stretch and undershoots the width it promised.
2. `MirrorBlockView.tsx:177-178` passes `diacriticOverrides` and `glyphTransforms` to `ShapedText` but **not** `strokeCuts` — so a mirrored block renders its source unstretched, and its rAF-settled drag `Rect` is measured off the uncut content. This is the same one-prop-line omission CLAUDE.md already records happening once with `fill`.

**Steps**

1. In `src/lib/fitToWidth.ts`, have `solveFitToWidth`'s result carry `edits: Array<{ index: number; delta: number }>` — the per-slot insertions the final `applyDistribution` performed, in `applyDistribution`'s own order (highest text offset first, which is already how it sorts at line 65-67 and is exactly the order a remap must run in). Do **not** change `applyDistribution`'s signature; add a sibling that returns the list, or compute it in the solver from `slots` + `counts`, whichever keeps the existing tests untouched.
2. In `fitSelectedBlockToWidth`, fold the remap into the same patch: walk `result.edits` in order applying `remapCutsAfterInsert(cuts, edit.index, edit.delta)`, and write `updateBlock(id, { text: result.text, strokeCuts: remapped })`. One patch, one `pushHistory()`, and the existing no-op skip is preserved.
3. Add `strokeCuts={source.strokeCuts ?? []}` to `MirrorBlockView.tsx`'s `ShapedText` mount.
4. Record, in CLAUDE.md's "Straight-stroke cut detection → Kashida coexistence" paragraph, the space mismatch that this fix does *not* close: `KashidaSlot.index` is an offset into `block.text`, `StrokeCut.cluster` is an offset into `shapableText` (post-`stripUnsupportedDiacritics`), so `remapCutsAfterInsert` is off by the number of stripped marks in a font that strips any — Qahiri, which has no glyph for fatha/sukun/dammatan. Closing it needs a shapable→source index map threaded from the shaping hook up to `App.tsx`, which is the full anchor scheme this program declines. Documenting it is the correct answer; do not build the plumbing for it here.

**Files:** `src/lib/fitToWidth.ts`, `src/lib/fitToWidth.test.ts`, `src/App.tsx`, `src/components/MirrorBlockView.tsx`, `CLAUDE.md`, `PROGRESS.md`.
**New files:** none.

**Risks.** The remap must run highest-offset-first or every slot after the first lands wrong — the same discipline `applyDistribution` itself follows and for the same reason. `remapCutsAfterInsert`'s existing tests (`strokeCuts.test.ts:710`) pin its per-call behaviour and must stay green.

**Tests.** Unit: extend `fitToWidth.test.ts` to assert the returned `edits` are descending by index and that their deltas sum to the tatweel count. Unit: extend `strokeCuts.test.ts` for a multi-edit remap applied in that order. **e2e (`e2e/stroke-cuts.spec.ts`, this stream's own file): make a cut, click Fit to width, assert via `getBlocks` that `strokeCuts.length` is unchanged and via `inkPixels` that the run is still wider than unstretched — confirm this test fails before the change.** Extend `e2e/mirror.spec.ts` to mirror a block carrying a cut and assert the mirror's ink is wider than an uncut mirror. Then the standard loop: `npx tsc --noEmit -p tsconfig.app.json`, `npx tsc --noEmit -p e2e/tsconfig.json`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e`.

---

### 5.2 `stroke-cuts-docs` — correct the record (XS, build)

Ride along with 5.1. `src/lib/strokeCuts.ts`'s header is stale three ways and is the first thing anyone picking up stroke work reads: it says "This module has no application consumer" and "The only caller is `scripts/measureStrokeZones.mjs`" (contradicted by `ShapedText.tsx`, `App.tsx:126`, `types.ts`, `StrokeCutHoverHandles.tsx`); it describes the **superseded** vertical-only `maxSlope` predicate as the mechanism, when the shipped detector is `findCutZonesSwept` with per-edge bow; and it restates a dozen pre-amendment coverage figures inside the module, against CLAUDE.md's rule that `docs/archive/stroke-zone-coverage.md` is "the single home for them".

**Steps.** Rewrite the header to describe the shipped state, **delete** the numbers (do not refresh them) and point at the archive's "Second pass: the axis-relative predicate (2026-08-21)" section. Fix the four dangling references to a CLAUDE.md heading "Straight-stroke cut detection (kept, unused)" that no longer exists (`strokeCuts.ts`, `docs/archive/stroke-zone-coverage.md:403`, `docs/superpowers/specs/2026-08-21-straight-stroke-extension-design.md:28`, `docs/superpowers/plans/2026-08-21-straight-stroke-extension.md:24`). Add **one clause** to the spec's Out-of-scope list — `— see CLAUDE.md, Deferred features` — and put the actual advance-renormalisation argument in CLAUDE.md's Deferred-features entry, once. Add one line to PROGRESS.md's Known limits pointing there; PROGRESS.md currently attributes the exclusion to the per-glyph-tool tangent reason, which is not the real one.

**Tests.** None. Run the loop anyway.

---

### 5.3 `kufi-cell-edit` — hand-paint cells (M, build)

The best item in the set: high value (it is how a calligrapher actually finishes a panel), and cheap because this block type loads no font — no shaping, no coordinate adapters, no async.

**The key decision, corrected.** Do **not** key edits by absolute grid `(x, y)`: `ascent`/`descent` are block-wide, `cols = Math.max(opts.columns, ...lineWidths)`, and each line is laid flush-right from `cursor = cols`, so nearly every text edit *and* the Panel width, Line gap, Word gap and Fit-to-square controls invalidate every absolute key. Anchor to the **letter**: `{ unitIndex, unitKey?, dx, dy, on }` with `dx/dy` in cells relative to that unit's placed box. And `unitKey` must be a fingerprint of the **resolved `KufiForm`** — `rows.join("|") + "|" + base` — not `skeleton:form`. The alphabet's `all()` helper gives feh/heh/tah one `KufiForm` across all four joining forms and `TOOTH_INITIAL`/`TOOTH_MEDIAL` are shared objects across beh/noon/yeh, so a `skeleton:form` key drops edits when typing the next letter of a word changes the requested form while the drawn box is literally the same object. The form fingerprint is the faithful analogue of `glyphId` (identity of what is drawn), and it removes the need to touch `squareKufiAlphabet.ts` at all.

**Steps**

1. `src/lib/squareKufi.ts`: thread `index: number` and `key: string` (the form fingerprint) onto `KufiUnit` via `makeUnit`/`resolveWords`, with a counter running across all words in logical order. The lam-alef branch keys like any other unit.
2. Emit `placements: KufiPlacement[]` (`{ unitIndex, unitKey, x, y, width, height, baselineY }`) **from inside the existing `lines.forEach` at line 362**, in the same pass that writes the cells — never re-derived in a second pass, or every hand edit lands a cell or two off while still type-checking. Anchor `dy` to `baselineY`, not to the box top: box top is `lineTop + (ascent - formAscent(form))` and moves with the form even when the skeleton does not. Add `placements: []` to **both** `empty` early returns.
3. Gate the placements build behind an option. `squareColumnTarget` runs up to `COLUMN_SWEEP_BUDGET` + refinement layouts per Fit-to-square press, and `Sidebar.tsx` lays out twice per render; none of them read placements, and per-unit allocation across that sweep is exactly the cliff CLAUDE.md records being wrong about twice.
4. Add `applyCellEdits(layout, edits) => { cols, rows, cells, originX, originY, applied, dropped }`, pure, in the same module. Resolution: index `placements` **by `unitIndex` field, not array position**; drop when no placement matches, or when `edit.unitKey !== undefined && placement.unitKey !== edit.unitKey`; **an edit with no `unitKey` still applies** (the `glyphId`-optionality rule, and the case a naive "always check the key" implementation breaks). Clamp `|dx|,|dy|` to `KUFI_EDIT_REACH` (8). Cells outside the grid grow it to the union and report `originX`/`originY` (≤ 0).
5. `src/types.ts`: `kufiCellEdits?: KufiCellEdit[]` and `kufiCellEditMode?: boolean` on `SquareKufiBlock` (the `textPathEditMode`/`diacriticEditMode` precedent — do not invent a rule about BlockCommon). Both optional, absent means today's rendering, no payload version bump.
6. `SquareKufiText.tsx`: compose between the `layout` and `rings` memos. **Set `x={composed.originX * cell} y={composed.originY * cell}` on both the hit `Rect` and the `Shape`** and draw at plain `cx * cell` in that shifted frame — do *not* keep the nodes at 0,0 and offset the draw, or Konva's self-rect excludes the grown ink and `getBlocksBoundingBox` under-reports to `exportBox` (cells cropped out of every PNG/PDF on a freeform document), to `buildSnapTargets`, to Align & Arrange, and to MirrorBlockView's settle loop. Pass `createBlockFillPainter` bounds at the same origin, or one gradient stops spanning the composition.
7. Add `kufiOptionsFor(block)` to `squareKufi.ts` and route **every** layout call site through it — `SquareKufiText`, both Sidebar calls (the `cols × rows` readout at 2279 and `bandColumns` at 2297), `App.tsx`'s ghost preview (1785) and `fitSelectedKufiToSquare` (1826), and the new overlay. Cell edits are composited *after* layout and feed nothing back, so Fit-to-square and the slider bound need no change — but the shared helper is what keeps a future mode (see 5.5) from drifting them.
8. New `src/components/KufiCellEditOverlay.tsx`: **one** transparent hit `Rect` over the panel plus padding, one `Shape` drawing the lattice at `1 / stageScale`, one highlight `Rect` with **`listening={false}`**. No node per cell (a padded 60×60 panel is thousands of listening nodes). Because there are no hover-mounted sibling handles, the Konva `mouseleave`/`compareShape` race the other three overlays document structurally cannot occur — record that, and do not reintroduce per-cell nodes without re-reading it. Use `onMouseDown`/`onMouseMove` with `getRelativePointerPosition()` and `e.cancelBubble = true` (the `TextPathEditOverlay` idiom); pass `rotation={block.rotation ?? 0}`; end the stroke on a **stage-level mouseup** (Konva does not capture the pointer, so a fast drag leaving the rect otherwise strands paint mode on). The overlay computes its own layout via `kufiOptionsFor`, and resolves pointer→cell in the **generated** frame while draw happens in the composed frame — state which frame each side is in, or painting drifts by the origin as soon as one edit grows the grid.
9. `CanvasStage.tsx`: mount beside `SquareKufiText`, guarded by `block.kufiCellEditMode && block.id === selectedId && !effectivePanMode`, `id={\`kufi-cell-edit-layer-${block.id}\`}` — the `TextPathEditOverlay` pattern. Mounting from CanvasStage (not from inside `SquareKufiText`) is what guarantees a mirror can never grow an editor. This also means the CanvasStageProps declarations, destructuring, App call-site props, and converting the squareKufi branch to a Fragment with `key` moved off `SquareKufiText`.
10. `useExport.ts`: add `kufi-cell-edit-layer-` to the `editOverlayNodes` predicate, or the lattice is baked into all four export formats.
11. `App.tsx`: `supportsKufiCellEdits` guard beside the existing three. `beginKufiCellEdit()` is a bare `pushHistory()` on mousedown; **`setKufiCell` must call `setBlocks` directly and push no history** — `updateBlock`/`updateSelectedBlock` both `pushHistory()` unconditionally, which would give one undo entry per painted cell instead of one per stroke. Removing an edit whose requested state equals the generated state (the `setStrokeCut` zero-is-a-removal rule) is what keeps the array from growing as the user paints and unpaints.
12. Sidebar Square Kufi panel: arming `CheckboxRow`, an edit count, a "Clear hand edits" button, and a notice when `dropped > 0`. Guide + CLAUDE.md + one PROGRESS line.

**Files:** `src/lib/squareKufi.ts`, `src/lib/squareKufi.test.ts`, `src/types.ts`, `src/components/SquareKufiText.tsx`, `src/components/CanvasStage.tsx`, `src/components/MirrorBlockView.tsx` (one prop line — see the Wave 1 contract), `src/components/Sidebar.tsx`, `src/App.tsx`, `src/hooks/useExport.ts`, `src/components/guide/sections/square-kufi.tsx`, `e2e/square-kufi.spec.ts`, `CLAUDE.md`, `PROGRESS.md`.
**New files:** `src/components/KufiCellEditOverlay.tsx`.

**Risks.** The origin-offset sign is the silent one — get it wrong and every existing square-kufi block shifts on load. Placements drifting from the draw loop is the other, and only test (1) below catches it. Painted cells legitimately break the alphabet's grammar (2×2, disconnected islands) — that is the point; do **not** validate paint against it and do not weaken the four structural assertions, which check the authored table that cell edits never pass through. While armed, the panel cannot be dragged; say so in the guide.

**Tests.** All pure vitest, in the existing suite — the real-harfbuzz rule does not bind (no font, nothing shaped), and this module's own convention is structural assertions over the real layout function. (1) **Load-bearing:** for a wrapped multi-word text, every unit has exactly one placement and every `#` in a form's rows has ink at `(placement.x + c, placement.y + r)` in the composed grid. (2) The point of slot anchoring: one edit, laid out at `columns: 0`, at a wrapping width, and at a different `wordGap`, resolves onto the same letter in all three at different absolute coordinates. (3) A mismatched `unitKey` is dropped and counted. (4) An edit with **no** `unitKey` still applies. (5) An out-of-grid edit grows the grid with the expected `originX/originY` and leaves every generated cell in the same position relative to its letter. (6) `cellRings` still closes over an erase that punches a hole (hole ring wound against its outer) and over a paint that creates a diagonal pinch — the pinch branch has no test today. (7) `dx` beyond `KUFI_EDIT_REACH` is rejected. **e2e:** paint a cell (assert `getBlocks` shows one entry and `inkPixels` rises); drag three cells and assert one Ctrl+Z restores all three; move the Panel width slider and assert the edits still draw; click a painted cell again and assert the entry is *removed* rather than stored as a no-op; assert an un-edited block's client box is unchanged and an edit above/left still exports.

---

### 5.4 `glyph-rotation` — a fourth handle (M–L, build-with-caveats)

**The correction that makes this tractable: apply the rotation *inside* the scale, about the glyph's raw box centre.** The investigator's plan put rotation outside the scale, which forces a scale-dependent pivot (`(boxCentreX − gx) × scaleX`) — and because the scale handles snapshot `pivotX/pivotY` at `onDragStart` and measure from that frozen point every frame, a moving pivot reintroduces exactly the "asking for 2× lands near 1.45×" divergence CLAUDE.md memorialises. It is zero at rotation 0, so every existing test and the current e2e drag stay green while the defect ships.

With `ctx.translate(gx,gy) → translate(offsetX,offsetY) → scale(sx,sy) → [rotate sandwich about the raw box centre] → [diacritic override] → draw`:

- the rotation pivot is **raw and scale-independent**, so `glyphPivot` never depends on the transform being dragged;
- the scale handles' pivot stays `gx + offsetX` / `gy + offsetY` — **unchanged**, so the three drag readbacks that shipped wrong twice are not touched at all;
- the scale rails stay axis-aligned in local space, so `SCALE_HANDLE_GAP` stays in the same space as `startDistance` and `scaleFromHandleDrag` needs no signed-axis generalisation — **`signedDistanceAlongAxis` and the whole adapter-model port of `GlyphTransformHoverHandles` are not needed**, which is most of the cost the original plan carried;
- rotation is still the outermost transform *relative to the diacritic override*, so a mark carrying both keeps its override in the glyph's own pre-transform space and `makeGlyphTransformAdapter` can still invert a drag into an unscaled `offsetY`.

The visible consequence: at a non-uniform scale a rotated glyph is stretched along the block's axes rather than along its own. That is an aesthetic choice, not a defect — see open question 7.3.

**Steps**

1. `src/types.ts`: `rotation?: number` on `GlyphTransform` (degrees, optional — absent means today's rendering, no payload bump).
2. `src/lib/glyphTransform.ts`: `rotation` on `ResolvedGlyphTransform`, normalised (non-finite → 0, wrapped into (−180, 180]) with the same defensive argument `clampScale` makes. Add pure `glyphPivot(box, gx, gy)` returning the **raw** box centre relative to the pen origin. Add `rotationFromHandleDrag(pivot, startPointer, currentPointer, startRotation)` returning `startRotation` unchanged on the first frame (the no-jump property `scaleFromHandleDrag`'s tests already pin) and normalising the result. Extend `transformedBox` to rotate the raw box about that pivot, take the AABB, then scale about the pen origin and translate — identical output at rotation 0, so all six existing assertions stay verbatim as the regression guard.
3. `src/components/ShapedText.tsx`: emit `pivots` from the **same** font walk in `glyphMetrics` (the `raw` box is already there, and it is post-cut, which the draw loop's own `getBoundingBox()` would not be). Append the pivot map as the **last** positional parameter of `drawWarpedGlyphRun` (it already takes 16, with `painter`/`cutPlan` last, and both call sites pass positionally) and insert the rotation sandwich, guarded on non-zero rotation so the common path is unchanged instruction-for-instruction. Do not touch `penX += advance`; keep block `bounds` **raw**.
4. `src/lib/diacriticPlacement.ts`: `makeGlyphTransformAdapter` gains `rotationDeg` + pivot, composing scale∘rotate with an exact inverse, still reducing to `makeOffsetAdapter` at the identity.
5. `GlyphTransformHoverHandles.tsx`: add the fourth dot. **Not below the box centre** — that is where kasra/kasratan/shadda-kasra live, and `DiacriticHoverHandles` mounts *after* this component with a generous `fontSize * 0.5` vertical margin, so Konva would route the pointer to the mark's rect and the rotate dot could never be grabbed. Put it diagonally outward at the box's upper-leading corner in a fourth colour (e.g. `#a855f7` — `#38bdf8`, `#d4af37`, `#22c55e`, `#ef4444`, `#9ca3af` and StrokeCut's `#f97316` are taken), and export that constant from `e2e/harf.ts`. Widen the hit `Rect` to cover it. The rotate handle free-drags (no `dragBoundFunc`), so compute **everything in group space** — pivot from `box`/`gx`/`gy` plus offsets and the resolved scale, pointer from `e.target.position()`. Do not reach for `getAbsoluteTransform()`; that is only needed by the scale handles' `dragBoundFunc`, and mixing the two spaces is what previously teleported a handle sideways. Every write goes through the existing single `applyPatch` so `glyphId` is stamped.
6. `Sidebar.tsx`: rename to "Move, scale & rotate glyph", update the helper text and the reset button label — and update `e2e/glyph-transform.spec.ts`'s `getByLabel("Move & scale glyph")` **in the same commit**.
7. Docs: CLAUDE.md's "Per-glyph move & scale" section records the inside-the-scale composition, the raw pivot, and the rotation-0 identity; **delete the `Per-glyph rotation` bullet from Deferred features** in the same commit, or the repo asserts the feature is deferred and shipped at once. Guide: three dots become four, plus the honest caveat that a rotated letter (like a moved or scaled one) does not change the block's measured width, so Fit to width can be exceeded. Record two known limits: `StrokeCutHoverHandles` builds its rails from bare `gx`/`gy` and is glyph-transform-blind (pre-existing for offset and scale; rotation widens it), and the PUA preset-honorific branch draws override art whose centre differs from the metrics memo's font-glyph box.

**Files:** `src/types.ts`, `src/lib/glyphTransform.ts` + test, `src/lib/diacriticPlacement.ts` + test, `src/components/ShapedText.tsx`, `src/components/GlyphTransformHoverHandles.tsx`, `src/components/Sidebar.tsx`, `src/components/guide/sections/glyph-editing.tsx`, `e2e/glyph-transform.spec.ts`, `e2e/harf.ts`, `CLAUDE.md`, `PROGRESS.md`.
**New files:** a dated spec under `docs/superpowers/specs/` carrying the pivot argument and the open questions.

**Risks.** A fourth sibling under the same per-glyph `Group`: if the hover handlers ever drift onto the hit `Rect`, or the rect stops covering the new dot's rest position and drag reach, the every-other-frame flicker and the death of a small-first-step drag both return — measured symptoms, not theory. Three `resolveGlyphTransform` tests assert with whole-object `toEqual` and break the moment `rotation` is added; trivial, easy to misread as a regression. A rotated glyph is in neither `styledRunWidth` nor the block's raw `bounds`, so it can overhang the page margin — the same limit offset and scale already have.

**Tests.** Unit: rotation normalisation (wrap, NaN→0); `glyphPivot` is the raw box centre and is unaffected by the transform's own offset *and* by its scale; `transformedBox` at 90° swaps width and height about that pivot and at 0° returns today's results (keep all six existing assertions); `rotationFromHandleDrag` returns exactly `startRotation` on a zero-move first frame, reads a quarter turn as 90, and wraps rather than accumulating. **The test that catches the rejected design:** `scaleFromHandleDrag` round-trips to the requested scale with `rotation = 30` and `startScale = 1.8` set simultaneously — verify it fails against the outside-the-scale variant. Adapter round-trip with rotation *and* non-unit scale together, asserting a canvas drag still reads back as an **unscaled** `offsetY`, and that the adapter still equals `makeOffsetAdapter` exactly at the identity. e2e: the rotate dot survives eight sub-pixel moves; an arc drag records non-zero `rotation` with a `glyphId` stamped while `block.rotation`/`x`/`y` are untouched; the rotate dot remains the topmost `hitTargetAt` on a glyph carrying a below-baseline mark with the diacritic overlay armed; the two existing tests pass unmodified apart from the label rename.

---

### 5.5 `kufi-boustrophedon` — snaking return lines (M, build-with-caveats)

Spiral is dropped (§3). Boustrophedon alone is coherent and shippable.

**Steps**

1. Decide and write the turn convention into the module header before any code: **return lines are rotated 180°, never mirrored** (a mirrored Arabic letter is not a letter). Record the rejected alternative the way `squareKufiAlphabet.ts` records its two conventions.
2. Extract the placement pass into a `placeLine(dest, …, turns: 0|2)` that renders a line into its own tight sub-grid and blits it under `turns`. Commit alone; the three existing ASCII assertions must be untouched. This is the whole safety margin.
3. **Correct the rotated-baseline arithmetic.** A 180°-turned line's baseline row is at `bandTop + descent`, **not** at the top of its band: band height is `ascent + descent`, the baseline sits at `ascent − 1`, and `(ascent + descent − 1) − (ascent − 1) = descent`. `descent` is 1 for any block containing ر و م ج ح ه — most real phrases — so the investigator's stated rule would land every bridge one row short. Write the test as `baselineRowOf(turns=2) === descent` with a fixture that actually contains a descender.
4. **Reserve gutter columns**: `cols = max(opts.columns, ...lineWidths) + 2`, even lines flush right against column `cols − 2`, odd lines flush left from column 1. Columns 0 and `cols − 1` are then always empty, which makes the turn bridge's vertical run *structurally* unable to sit adjacent to a descender and produce a 2×2. The composed-grid 2×2 test becomes the guard, not the design.
5. The turn bridge: from line k's baseline-row end cell, a single-width horizontal run out to the gutter column, then a single-width vertical run down that column to line k+1's baseline row. Single-cell-wide throughout — that is the grammar, and it is the same primitive the letter joins already use.
6. Add `kufiComposition?: "lines" | "boustrophedon"` to `SquareKufiBlock` and `composition` to `SquareKufiOptions`, normalised by **whitelist fallback to `"lines"`** (it is a string union, not a numeric clamp).
7. **Handle `kufiColumns === 0`.** `addSquareKufiBlock` creates every block with `kufiColumns: 0` and `breakIntoLines` reads `limit = columns > 0 ? columns : Infinity`, so a fresh block is one unwrapped line and switching mode would visibly do nothing. Switching away from `lines` on a zero-column block must set a wrap width (the answer `squareColumnTarget` would give) inside the same `pushHistory()`, so the mode change is one undo. Do this in `App.tsx`, not the Sidebar.
8. Thread `composition` through `kufiOptionsFor` (built in 5.3) so all six layout call sites agree by construction — including `bandColumns`, whose stale value is what produced the documented pinned-thumb bug.
9. `Sidebar.tsx` `SelectRow` at the top of the Square Kufi panel; `MirrorBlockView` prop; guide subsection written for a calligrapher (the return lines are read by turning the panel; the stroke turns the corner with the reading); CLAUDE.md's Square kufi section gains the convention, the corrected baseline rule, the gutter, and — honestly — the consequence that alternating 180° rotations put baselines on two alternating lattice rows and make inter-line whitespace alternate. Remove the item from **both** places that currently call it deferred.

**Files:** `src/lib/squareKufi.ts` + test, `src/types.ts`, `src/components/SquareKufiText.tsx`, `src/components/CanvasStage.tsx`, `src/components/MirrorBlockView.tsx`, `src/components/Sidebar.tsx`, `src/App.tsx`, `src/components/guide/sections/square-kufi.tsx`, `e2e/square-kufi.spec.ts`, `CLAUDE.md`, `PROGRESS.md`.

**Risks.** The bridge is the one place this can produce a defect that reads as a font bug; the gutter is the mechanism, the composed-grid test is the guard. A rotated line's letters are upside down — authentic, and it will be reported as a bug without the guide text.

**Tests.** Composed-grid invariants over ~8 real phrases at several widths, in both modes: **no 2×2 anywhere** (verified as 0 today on `لا اله الا الله محمد رسول الله` at 24 columns, so it is a real invariant); every line's ink present; nothing clipped by `set`'s bounds check. **Turn connectivity, explicitly 4-connected** (reuse `connectedCount`'s neighbour rule — an 8-connected fill would pass a bridge that only meets the next letter corner to corner): flood-fill from line k's last drawable cell reaches line k+1's first. Baseline-row arithmetic per point 3. e2e: set a wrapping width first (a default block is one line and the mode is a no-op), then assert total ink rises by the bridge cells and redistributes between the block box's halves; extend the mirror test to a boustrophedon source, which is the only cheap guard against the dropped prop.

---

### 5.6 `glyph-tools-shapefill` — per-glyph move & scale on Shape Fill (L–XL, build-with-caveats, lowest priority)

Text-on-path is **dropped**: `TextOnPathText` has no metrics pass, no hit boxes, no `isSelected` prop and no overlay of any kind, and `offsetX` on a curve has undefined semantics (along the tangent, or along arc length?) that CLAUDE.md has deferred twice. Do not start it without a spec answering that.

**The decision that must be made before Phase 1, not after: cap the placements to one per glyph index.** Worked from the real loop — a 3000-tall silhouette at `fontSize` 20 gives `lineH = 26` → ~115 rows, a 2000-wide row with a 4-glyph run at `totalAdvance` ~40 gives 50 reps → **~23,000 Konva rects**. That is a hard freeze, not a cliff, and "measure a hostile block before shipping" is deferred discovery. One placement per glyph index — attached to the instance nearest the silhouette's centre — caps it at the glyph count. The cost is that the handle may not be on the tile the user is looking at; the benefit is that it matches the semantics the feature actually has, since **one edit applies to every tiled repetition** (the model `diacriticEditMode` already established and CLAUDE.md already documents).

**Steps**

1. Move `activeGlyphTransforms`' inline filter into `glyphTransform.ts` as pure `filterActiveGlyphTransforms(transforms, glyphs)` (keep an entry with no `glyphId`, keep a matching one, drop a mismatched one) and make **both** `ShapeFillText`'s draw loop and its placements memo consume it — otherwise the `glyphId` staleness rule does not exist on the new renderer and the extraction is dead code.
2. Rework `GlyphTransformHoverHandles` to take placements carrying the **raw** box plus the resolved transform (not a pre-folded box) and a `PlacementAdapter`. A pre-folded box makes the placements memo depend on the live drag value, which on Shape Fill rebuilds and re-maps the whole instance array per frame — the reason `diacriticPlacements`' dep list deliberately excludes `diacriticOverrides`. Key hover and drag state on **`placement.key`** (`hoveredKey`/`draggingKey`, as `DiacriticHoverHandles` does), never on `glyphIndex`. Keep the pivot as `penOrigin + offset`, keep the `dragStartRef` snapshot, keep the handlers on the per-placement `Group`, keep the signed gap negative on the y rail. **Gate: `e2e/glyph-transform.spec.ts` must pass unchanged before a line of Shape Fill code is written** — it is the only thing that can see the two pointer-plumbing defects.
3. `ShapeFillText` draw loop: apply the transform **between `rotate(rotRad)` and `scale(scX, scY)`**. This satisfies the wrapping constraint (transform outside the diacritic override, so the adapter can still invert a mark drag) *and* makes a stored `offsetX` render at a uniform magnitude across rows — placing it inside the row's `scale` would make the same offset draw differently on every row, since `scX` is a per-line fit factor. State the choice; it is not forced by the diacritic constraint. Do not touch `penX`/`totalAdvance`. Fold the glyph's mean scale into the faux-bold `block` width for `strokeWithFill`.
4. Widen the `glyphInstances` memo gate to `!diacriticEditMode && !glyphTransformMode`, add it to the deps, and build capped placements over it.
5. **Fix `ShapeFillText`'s `dragBoundFunc` pin to absolute space** rather than widening the existing layer-space bug. Konva's contract is absolute stage coordinates; the current `() => ({ x, y })` uses the block's layer-space props, so at the default 275% zoom pressing an armed silhouette teleports the block. Capture `group.getAbsolutePosition()` at drag start, or drop the pin and rely on the dots' `cancelBubble`.
6. Compose adapters where a mark on a transformed glyph needs handles at the mark's drawn position; mount `GlyphTransformHoverHandles` before `DiacriticHoverHandles`, both before the corner resize `Circle`.
7. Widen `supportsGlyphTransforms` to `text | shapeFill` in the **same commit** as the renderer, and add `glyphTransforms={source.glyphTransforms}` to `MirrorBlockView`'s shapeFill branch.
8. Docs: extend "Per-glyph move & scale"; **correct the diacritic section's claim that the Diacritic tool checkbox "is also what gates `glyphInstances`'s memo and the block's `dragBoundFunc` pin"** — both gate-widenings falsify it; narrow the Deferred-features entry to text-on-path only. Guide: say plainly that one adjustment applies to every tiled repetition and that the handle sits on one designated tile.

**Files:** `src/lib/glyphTransform.ts` + test, `src/lib/diacriticPlacement.ts` + test, `src/components/GlyphTransformHoverHandles.tsx`, `src/components/ShapedText.tsx`, `src/components/ShapeFillText.tsx`, `src/components/CanvasStage.tsx`, `src/components/MirrorBlockView.tsx`, `src/components/Sidebar.tsx`, `src/App.tsx`, `src/components/guide/sections/glyph-editing.tsx`, `e2e/glyph-transform.spec.ts`, `e2e/harf.ts` (if `chooseSurface` is promoted — it is currently private to `ink-surface.spec.ts`, and bare paper is the default since 2026-08-21, so the call is defensive), `CLAUDE.md`, `PROGRESS.md`.

**Risks.** The overlay port is the whole risk and no unit test can see it fail; only the existing e2e spec can. The two overlays armed simultaneously on one block put a mark's generous hit rect over the base glyph's move dot — decide and test. `makeShapeFillInstanceAdapter` ignores the italic shear, an accepted approximation for marks that a stacked glyph transform makes more visible.

**Tests.** Pure affine tests for adapter composition (round-trip, reduction to the outer adapter at the identity, finite at degenerate zero scales) and for `filterActiveGlyphTransforms`' three cases including the no-`glyphId` carve-out. `scaleFromHandleDrag` at a gap derived from a compressed row (non-unit gap) and at a non-zero offset, asserting the first frame returns exactly `startScale`. e2e: hovering one instance mounts exactly 3 dots, not 3×N; a bounded-node assertion (a 3000×3000 silhouette at `fontSize` 20 mounts fewer than N rects); a small-first-step drag records a transform while the block's `x`/`y` are unchanged; the 8-alternating-0.5px-move survival check.

## 6. Constraints this program must not break

> "For the same reason the drag's pivot is `gx + offsetX`, not bare `gx` — the renderer translates by the offset *before* scaling, so a moved glyph pivots there too, and using the bare pen origin reads correct at rest but drifts as the offset grows."
> — **threatened by `glyph-rotation` and `glyph-tools-shapefill`.** Both investigator plans specified the bare pen origin. The rotation fix (rotate inside the scale, raw pivot) is chosen specifically so this expression is never touched.

> "only the currently-hovered diacritic ever shows handles, which is what keeps text with many marks from becoming visual clutter."
> — **threatened by `glyph-tools-shapefill`.** Hover state keyed on `glyphIndex` on a tiling renderer lights every repetition of that letter at once. Key on `placement.key`.

> "**The hover handlers sit on the per-placement `Group`, not on the hit `Rect`** … With the handlers on the Rect … the next mousemove was a genuine Rect→Circle leave: hover cleared, the handle unmounted, and it was present on exactly every other one."
> — **threatened by `glyph-rotation` and `glyph-tools-shapefill`.** Every rework of these overlays must preserve it; `kufi-cell-edit` sidesteps it structurally with a single hit rect and must not grow per-cell nodes.

> "**no 2×2 block of ink exists** (stroke = gap = one unit is the entire grammar; a 2×2 is a stroke at double weight)"
> — **threatened by `kufi-boustrophedon`.** The turn bridge is the one place a composed grid can violate it, and the existing test only walks `everyForm()`. The gutter column is the mechanism; the composed-grid test is the guard. Note that `kufi-cell-edit` breaks this *deliberately* — a hand edit is allowed to; the four structural tests check the authored table, which cell edits never pass through.

> "A stretched letter has to report its real ink, or snapping, alignment and Fit to width all keep measuring the un-stretched run."
> — **threatened by `kufi-cell-edit`.** If the composed grid's origin offset is applied to the draw coordinates but not to the hit `Rect` and `Shape`, the block reports a box that no longer contains its ink, and `exportBox`, `buildSnapTargets`, Align & Arrange and MirrorBlockView's settle loop all silently under-report.

> "`App.tsx`'s `dragDiacriticOverride`/`toggleDiacriticHidden` gate on `supportsDiacriticOverrides(b)` rather than `b.type === "text"` … a narrower guard type-checks perfectly while silently discarding every edit."
> — **threatened by `glyph-tools-shapefill`** (widen `supportsGlyphTransforms` in the same commit as the renderer) **and by `kufi-cell-edit`** (a dedicated `supportsKufiCellEdits`).

> "'A few hundred passes is nothing' was wrong twice over … measured at **7.1s of blocked main thread at 1800 characters**, from a button that stays clickable while it runs."
> — **threatened by `kufi-cell-edit`** (per-unit placement allocation inside `squareColumnTarget`'s ~160-candidate sweep — gate it) **and by `glyph-tools-shapefill`** (~23,000 hit rects — cap the placements up front, not after measuring).

> "Anything that needs real shaping must use real harfbuzzjs and real fonts from `public/fonts/`, never hand-written `{ g, cl }` fixtures … a fabricated-fixture suite is exactly what let the cluster-lookup bug ship unnoticed once."
> — **threatened by `edit-survival`** if anyone asserts which glyph receives a remapped cut. Note the rule does **not** bind the square-kufi items (no font, nothing shaped) — say so rather than leaving the next reader to wonder.

> "state a fact in one place and link to it from the others. A limitation explained in full here gets one line and a pointer in `PROGRESS.md`, not a second copy that will rot."
> — **threatened by every item's doc step.** Concretely: `glyph-rotation` must delete the `Per-glyph rotation` deferred bullet, `kufi-boustrophedon` must remove the item from both places that call it deferred, `stroke-cuts-docs` must put the argument in CLAUDE.md and a *pointer* in the spec, and `glyph-tools-shapefill` must correct the diacritic section's now-false sentence about what the Diacritic tool checkbox gates.

> "Konva's `dragBoundFunc` contract requires absolute coordinates … mixing the two spaces there previously teleported the handle sideways under any block offset/pan/zoom."
> — **threatened by `glyph-tools-shapefill`** (the `ShapeFillText` pin is currently in layer space and must be fixed, not widened) **and by `glyph-rotation`** (the free-dragging rotate handle must stay entirely in group space and never reach for `getAbsoluteTransform()`).

## 7. Open questions for the maintainer

1. **Is the cloud store ever going to be turned on?** If not, `cloud-conflicts` stays dropped permanently and the "the migration is free while the table is empty" argument dies with it. If yes, do the conflict work *before* announcing sign-up, and design the CAS base as provenance (set only by a successful load), not as a boot-time list snapshot — the investigator's seeding makes the check pass in exactly the case it exists to catch.

2. **Boustrophedon return lines: 180° rotation or horizontal mirroring?** Published square-kufi panels do both. Rotation is recommended (a mirrored Arabic letter is not a letter, and it puts the two line endpoints on the same edge so the bridge is a short L), but this is an aesthetic call, and it is the only one in the program that changes what the feature *looks* like rather than how it is built.

3. **Glyph rotation at a non-uniform scale: rotate inside the scale (recommended) or outside it?** Inside means a 2×-wide letter rotated 30° is stretched along the block's axes; outside means it is a rotated wide letter. Outside is arguably more "correct" and costs the entire adapter refactor plus a moving scale pivot; inside is nearly free and identical whenever `scaleX === scaleY`, which is almost every real use. Confirm the cheap answer is acceptable before 5.4 starts.

4. **Does anyone actually want per-glyph move & scale on Shape Fill?** It is the most expensive survivor (L–XL) and its semantics are weaker than its UI implies: the gesture is on one tile, the effect is on every repetition of that letter across the silhouette. The diacritic tool already ships with exactly that and it is documented as accepted — so the precedent exists — but if nobody has asked for this, dropping it saves the largest single block of work in the program.

5. **`kufi-cell-edit`: which letter owns a cell painted deep in the blank field between two lines?** The plan uses containing-box-else-nearest, ties to the lower `unitIndex`. It is predictable but not obviously the most useful answer, and it decides where such a cell travels on rewrap. Worth trying on a real panel before it is fixed in code.

6. **Was the `image-trace` request "trace a picture" or "more silhouettes to fill"?** If the latter, the answer is more ornaments — cheap, licensable, and already integrated (dropping a file in `src/data/ornaments/` is the whole integration step). If genuinely the former, the honest quote includes multi-span scanlines in `computeShapeFillLines`, which is Shape Fill render-math work the repo has otherwise declined.

7. **Is `computeShapeFillLines` worth memoizing on its own merits?** It runs inside `sceneFunc` — every repaint, every drag frame — unmemoized and ungated, unlike the `glyphInstances` memo beside it which is explicitly gated because it is "a real amount of work". On hand-built ornaments the outline is small enough not to matter; the question is whether any user has uploaded an SVG detailed enough for it to bite today. A cheap measurement, and if it does bite it is a small standalone perf item independent of everything above.