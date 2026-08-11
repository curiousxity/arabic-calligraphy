# Text on Path — Design

Date: 2026-08-10
Status: Approved, ready for implementation planning

## Summary

A new block type that flows shaped Arabic text along a user-defined curve
instead of a straight baseline. The curve can be built three ways — drawn
freehand with a pen tool, generated from a formula preset (arc/wave/circle),
or imported from an uploaded SVG path — all converging on the same
representation, so it's one feature with three entry points rather than
three separate features.

This is the first of four planned features (per-glyph/gradient color,
tashkeel/diacritics control, and a visible undo/redo thumbnail history are
follow-ups, each getting its own design).

## Non-goals for v1

- Stretch-tool glyph handles / glyph rigs (`GlyphStretchHandle`, `GlyphRig`)
  on text-path blocks. The anchor/drag math those tools use assumes a
  straight glyph bounding box; making it work once a glyph is rotated to a
  curve tangent is a real design problem worth its own follow-up spec, not
  something to bolt on here.
- Multi-line text following a path.
- Closed-loop wraparound (a circle preset is an open path shaped like a
  circle, not a loop text fully wraps around).
- A font-size control on text-path blocks (see "Sizing" below — curve
  length is the only size lever in v1).

## Data model

A fifth member of the `Block` discriminated union in `src/types.ts`,
`TextPathBlock` (`type: "textPath"`), sharing `BlockCommon` like the other
four, plus:

```ts
textPathD: string;                 // SVG path `d` string defining the curve
textPathReversed?: boolean;        // manual "flip direction" override
textPathBaselineOffset?: number;   // perpendicular offset of the text
                                    // baseline from the curve; default 0
                                    // (baseline sits exactly on the curve)
```

The curve is stored as a plain SVG path `d` string — the same representation
`shapeSvgPath` already uses on `ShapeWarpBlock`/`ShapeFillBlock` — rather
than a bespoke point-array type. That choice is what lets presets, SVG
upload, and freehand drawing all converge on one representation and lets the
feature reuse existing SVG-path infrastructure (`src/lib/svgPath.ts`)
wholesale instead of inventing a parallel curve format.

`fontSize` is still present (inherited from `BlockCommon`) but is not
surfaced in the UI for this block type and has no effect on rendered glyph
size (see "Sizing").

## Curve math (`src/lib/textPath.ts`, new)

Small module, built entirely on existing primitives in `lib/svgPath.ts`:

- `pathLength(cmds: SvgCmd[]): number` — flattens the path via the existing
  `pathToPolygon` (fixed-step cubic/quadratic bezier subdivision, already
  used for contour masking and hit-testing elsewhere in the codebase) and
  sums the flattened segment lengths.
- `pointAtArcLength(cmds: SvgCmd[], s: number, reversed: boolean): { x: number; y: number; angle: number }`
  — flattens once, optionally reverses the flattened point list (this is
  where both the RTL default and the manual flip toggle apply — the stored
  path itself is never reversed, only the lookup direction), builds a
  cumulative-length table, and returns the interpolated point plus the
  local tangent angle (from the flattened segment direction at that point)
  for glyph rotation.
- Preset generators — `arcPathD(width, height)`, `wavePathD(width, height)`,
  `circlePathD(width, height)` — each returns a `d` string built from a
  small fixed number of cubic-bezier segments approximating the named
  shape. These are the seed data for the preset dropdown; once created the
  user can reshape them with the same pen-tool editor used for freehand
  curves.

No new curve math beyond what the codebase already trusts for masking/hit
testing — this module is glue, not new subdivision algorithms.

## Sizing: curve length is the only control

Under "always auto-scale text to exactly span the curve" (the chosen
behavior), the effective font size is fully determined by
`curveLength / naturalAdvanceAtBaseSize` — the nominal `fontSize` field
cancels out of that ratio entirely and has zero visible effect. Rather than
leave a dead slider in the UI, the font-size control is hidden for
`textPath` blocks; a short note in its place explains that letter size is
controlled by the curve's length (drag the curve longer/shorter) or by
changing the text content. This was confirmed explicitly rather than
discovered as a bug after implementation.

## Rendering (`src/components/TextOnPathText.tsx`, new)

Modeled on `ShapedText.tsx`'s glyph loop — translate to a position, apply an
optional transform, fill the glyph outline, repeat per glyph — **not** on
`ShapeWarpText.tsx`'s per-point remap. Each glyph is drawn as a rigid unit
(translated to its curve point, rotated to the local tangent angle) rather
than having its individual outline points individually warped. This matches
how text-on-path works in every mainstream vector tool and is the simplest
of the three existing renderers to pattern-match against.

Per-block render flow:

1. Shape the text once via the existing `useShapedGlyphs` hook (same as the
   other three renderers).
2. Measure the natural total advance of the shaped run at the block's base
   `fontSize` (sum of `g.ax` advances scaled by `fontSize / unitsPerEm` —
   the same computation `ShapedText`/`ShapeWarpText` already do while
   walking their glyph loops).
3. Compute `pathLength` for `textPathD` and derive
   `effectiveFontSize = fontSize * (pathLength / naturalAdvance)` — the
   same "auto-scale to exactly span" idea `ShapeFillText` already applies
   per-row to its shape width.
4. Walk arc length from `0` to `pathLength`, placing each glyph via
   `pointAtArcLength`, exactly mirroring the existing `penX += advance`
   loop pattern in `ShapedText`/`ShapeWarpText` but through the curve
   lookup instead of straight x-axis advancement. `reversed` defaults to
   `true` (RTL text anchors to the curve's end point) XOR'd with the
   block's manual `textPathReversed` flip toggle.
5. At each glyph's placement: `ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(point.angle); ctx.translate(0, -textPathBaselineOffset);`
   then draw the glyph's outline (from `opentype.js`'s `getPath`) and
   `ctx.restore()`, same per-glyph save/restore discipline the other
   renderers use.

Stroke/shadow/opacity apply the same way they do in `ShapedText.tsx` — no
new logic needed there, just threading the existing props through.

## Curve editing UX

A per-block **"Edit Curve"** toggle (same pattern as `kashidaEditMode` /
`glyphEditTool` — a boolean flag that swaps in draggable on-canvas handles
in place of normal block chrome) enters a pen-tool mode:

- Click empty canvas: places a new anchor point. Dragging while placing
  pulls out that anchor's bezier handles (standard click-drag pen-tool
  interaction).
- Click-drag an existing anchor or handle dot: reshapes the curve.
- Enter key or a "Done" button: exits edit mode.

This is the single largest new interaction surface in the feature — the
only piece of genuinely new UI code, as opposed to math/rendering glue
built on existing primitives.

Sidebar panel for a selected `textPath` block:

- **Preset dropdown** (Arc / Wave / Circle / Custom) — regenerates
  `textPathD` from the chosen formula. Destructive to hand-edits, but
  covered by the existing undo stack like every other mutation, so no
  separate confirmation dialog.
- **Upload SVG path** button — identical flow to the existing shapeWarp SVG
  upload, writing into `textPathD` instead of `shapeSvgPath`.
- **Edit Curve** toggle, as above.
- **Flip direction** toggle — sets `textPathReversed`.
- **Baseline offset** slider — sets `textPathBaselineOffset`.
- Standard color / outline / shadow / opacity controls, reused as-is from
  the shared `ColorRow`/`RangeRow` components.
- No font-size control (see "Sizing").

## Integration points

- `CanvasStage.tsx` gets a new conditional branch rendering
  `TextOnPathText`, following the exact `commonProps` spread +
  block-specific props pattern the other three block types already use.
- The curve guide line and its edit handles live in a Konva group hidden
  from export output the same way the alignment grid
  (`Konva.Group#grid-lines`) and the shapeWarp glyph-edit handles already
  are — toggled off via `stage.findOne(...)` before `toDataURL`/SVG export
  in `useExport.ts`, on already before restoring.
- Every curve edit (drag anchor, drag handle, add anchor, apply preset,
  upload, flip direction, baseline offset change) calls `pushHistory()`
  first, matching the existing convention in `App.tsx` that nearly every
  mutating handler pushes history before changing state.
- No changes needed to `src/hooks/useUndoRedo.ts` — it's a generic
  snapshot-stack hook; `textPathD` is just another string field on the
  block that gets captured in the snapshot like any other.

## Testing

`src/lib/textPath.ts` gets a `textPath.test.ts`, following the project's
existing convention of unit-testing pure lib math
(`normalizeGlyphs.test.ts`, `svgPath.test.ts`, `warp.test.ts`). Coverage
should include:

- `pathLength` correctness against known simple paths (a straight line, a
  quarter-circle arc of known radius).
- `pointAtArcLength` at `s = 0`, `s = pathLength` (endpoints), and a
  midpoint, both `reversed: true` and `reversed: false`.
- Each preset generator (`arcPathD`/`wavePathD`/`circlePathD`) produces a
  parseable `d` string whose `pathLength` is within a sane tolerance of the
  requested width/height.

The `TextOnPathText.tsx` rendering component itself is not unit-tested —
consistent with the fact that none of the other three block renderers
(`ShapedText`, `ShapeFillText`, `ShapeWarpText`) have component-level tests
in this codebase either; verification for the component is manual
(`npm run dev`, visual check), same as those three.
