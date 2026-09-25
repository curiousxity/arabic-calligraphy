---
paths:
  - "src/lib/blockFill*.ts"
  - "src/data/textures/**"
  - "e2e/ink-surface.spec.ts"
---

# Ink & surface (`src/lib/blockFill.ts`, `src/data/textures/`)

Two independent halves: a block's ink can be a **gradient** (the metallic
presets are the point of it), and the page can carry a **paper texture**.

## Block fill

`BlockCommon` gains an optional `fill?: BlockFill`
(`solid` / `linear` + angle / `radial` + stops), re-exported through
`types.ts` from `lib/blockFill.ts`, which owns the type and all of the maths.

**Absent means today's behaviour, and that is load-bearing.** `color` is not
migrated and not removed: choosing *Flat colour* in the UI writes `color` and
clears `fill`, so a block only ever carries `fill` while it is actually a
gradient, and every project saved before this feature renders byte-identically.
`resolveFill(fill, color)` is the single place that decision lives (it also
degrades a gradient with fewer than two stops back to a solid, which is a
state the stop editor can briefly produce).

`makeCanvasFill(ctx, fill, bounds)` builds the `fillStyle` from the **block's
run bounds**, so one sweep spans the whole word rather than restarting inside
each letter.

**The hard part is that all three renderers fill inside per-glyph
transforms.** A canvas path is converted to device space as each segment is
added, but a gradient `fillStyle` is read through the CTM *at fill time* — so
a gradient set up in block space and filled inside a glyph's own translate /
rotate / scale would restart per glyph (catastrophic on a Shape Fill block,
where the run is tiled into hundreds of instances). `createBlockFillPainter`
is the answer: built while the ctx is still in the block's space, it captures
that matrix and, for each `fill()`, resets the transform to it and restores
afterwards. The already-traced path does not move; only the gradient's frame
of reference does. **A solid fill takes none of this path** — it is a plain
`ctx.fill()`, unchanged.

Its `strokeWithFill` (faux bold, the one stroke that uses the fill style)
therefore takes *two* widths: `local` in the caller's own space and `block`
in the block's, because `lineWidth` is read in whatever space is current when
the stroke is issued.

Each renderer builds one painter per draw at the point it used to set
`ctx.fillStyle`:

- **`ShapedText`** after the run-centring translate and the italic shear, so
  the gradient shears with the text. Its second (outline) pass fills too, and
  `ctx.restore()` has popped the style by then — hence the explicit
  re-assignment before that call, which was previously filling with whatever
  style the shared context happened to be carrying.
- **`ShapeFillText`** in the silhouette's own pre-tile space, bounds
  `0,0,shapeWidth,shapeHeight`.
- **`TextOnPathText`** in the Shape's space, bounds the curve's bounding box,
  before the glyph loop rotates each letter to its tangent.

`CanvasStage.tsx` and `MirrorBlockView.tsx` pass `fill` alongside `color`.
That was **not** in stream F's ownership table and no other Phase 2 stream
owns those files — the prep commit's anchors covered the page-surface seam but
not this one. Recorded here rather than silently; it is one prop line in each
of four places.

## SVG export — the spike, and what it found

`react-konva-to-svg` does **not** drop a canvas gradient: svgcanvas emits a
real `<linearGradient gradientUnits="userSpaceOnUse">` in `<defs>`. But it
bakes path points into the document's **root** space and leaves gradient
coordinates *untransformed*, so there a gradient is read in root space rather
than through the CTM — the opposite convention to a real canvas.

So nothing rasterizes and the Export panel needs no warning. Instead
`createBlockFillPainter` detects that context by its own `getSerializedSvg`,
pre-multiplies the gradient geometry by the block matrix (`mapGeometry`), and
skips the transform-reset dance entirely. `e2e/ink-surface.spec.ts` pins both
halves: the def exists with the preset's own stops, *and* its coordinates land
inside the exported viewBox — a regression here would leave the def present
and the letters flat.

## Paper surfaces

`src/data/textures/` — every texture is **generated arithmetic**, never a
photograph: `_noise.ts` has tileable value noise, fbm and speckle, and
`defs/*.ts` compose them into parchment, laid paper, washi and linen. Zero
bytes of assets. Two things about it:

- **`defs/` is a folder of its own** because `index.ts` globs it eagerly; a
  flat glob of the folder would pick up the registry itself (an import cycle
  that boots to a blank page — it did), the shared helpers, and the test file.
- **Seamlessness is the one defect that is invisible in a single tile and
  ruins the whole page.** `tileNoise` takes separate x/y lattice sizes for
  exactly this reason: stretching a feature by scaling the *coordinate*
  instead throws the lattice out of phase with the tile. `textures.test.ts`
  asserts `grain(0, v) === grain(1, v)` on every texture, which is what caught
  `Math.sign` flipping on floating-point dust at linen's tile edge.

**A new document opens on bare paper** — the flat background colour, no
texture. A surface is a choice the user makes, not something a fresh canvas
arrives already wearing.

This reversed on 2026-08-21. The 2026-08-20 interface pass had opened new
documents on `washi`, arguing that flat white under a 40px grid reads as graph
paper — but that argument was about the *grid*, and the same pass fixed the
grid directly by drawing it as a one-device-pixel hairline at any zoom instead
of ~2.75px at the default 275%. With the grid no longer shouting, a texture
was no longer needed to drown it out.

**The zoom caveat survives the reversal and still governs picking a texture.**
A surface is drawn in *document* space, so the stage's scale magnifies its
grain along with everything else, and a fresh canvas opens at **275%**. At
that zoom parchment's mottling and laid-paper's chain lines both smear into
blotches that read as staining; washi's fibres are fine enough to survive it.
Compare on screen at that zoom rather than choosing from the names — and if a
texture is ever made the default again, compare it the same way.

`readArtboardSurface` was not touched by either change, so a saved project
keeps whatever surface it holds, washi included. The related trap in `e2e/` is
still live and is about textures generally, not about the default: paper grain
lands inside a block's own bounding box and inflates any colour count taken
there, so the three tests in `ink-surface.spec.ts` that measure ink ask for
`chooseSurface(page, "")` explicitly rather than trusting the default. A test
that measures a *delta* against a baseline is the fragile kind — a textured
baseline can be high enough that a real gradient no longer clears it.

The surface is App state (`artboardSurface: { textureId, tint }`), **not**
part of `ArtboardConfig` — a freeform canvas gets paper too. It is saved with
the document and read back tolerantly (`readArtboardSurface`), but it is
**not in the undo snapshot**: `EditorSnapshot` sits outside this stream's
anchors. Worth revisiting.

It reaches the canvas through the prep commit's `surfaceRectProps` seam —
props spread last into the existing `#artboard-background` rect, as
`fillPriority: "pattern"` plus a `fillPatternImage`. Because it is that same
rect, the export path's existing "hide the background when transparent" rule
suppresses the texture with no export-side change at all. The tint is **baked
into the tile's pixels** rather than layered under them, since Konva picks
either a colour or a pattern for a shape, never both.

<!-- ---- /STREAM-F ---- -->
