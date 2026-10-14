# Stacked compositions (tarkib) — design

**Date:** 2026-10-14
**Status:** approved in conversation; awaiting written review
**Scope:** renderer side only. Font-side stacking alternates are a later
project (see "Ceiling and future").

## Goal

Stacked Diwani name compositions that stand next to hand-drawn ones. In
the reference piece ("Mosbeh", مصبح) the letters sit on separate
baselines, the connecting strokes between them are long free curves at
constant pen weight, and the whole fills a teardrop with the م's tail
curling back under the rest.

What that piece *is*: letter bodies placed freely and barely distorted,
**joins redrawn as curves**, and a silhouette aimed at. The joins are where
all the difficulty lives; the other two are modest.

## Decisions already made

- **A bake, not live text.** Converting a text block produces a new block
  type holding the letters as outline pieces. One-way: editing the
  spelling means converting again from a fresh text block. Undo of the
  conversion brings the text block back. The user accepted this
  ("point of no going back"), and it removes every text-offset remap,
  cluster lookup, glyph-id checksum and re-shaping concern the live
  subsystems carry.
- **Move and rotate letters; never scale.** Per removed-subsystems.md.
- **No liquify.** A displacement field changes stroke *weight*, and weight
  is what separates calligraphy from warped type.
- **No packing solver.** The container is a guide the user arranges
  against, not a target the app solves for.
- **Approach A** (cut-face joins on baked pieces) with Approach B
  (tatweel replacement) as the fallback where the detector finds no zone.
  Approach C (skeleton + nib for whole letters) is recorded as future
  work.

## Evidence

`scripts/measureStrokeZones.mjs`, run 2026-10-14, join coverage at
tatweel-legal slots: UKIJ Diwani 100% (n=9), HarfCanvasDiwani 67%,
Ruqaa 89%, Thuluth 75%, Amiri 44%. The main Diwani face is fully covered
by Approach A; the fallback matters for the others.

## 1. Data model

A new block type, `StackBlock` (`type: "stack"`), in the `Block` union.
Geometry is stored in **font units**, as stroke cuts are, so `fontSize`
is a single scale factor.

```ts
type StackBlock = BlockCommon & {
  type: "stack";
  source: { text: string; fontFamily: string; featureTags?: string }; // provenance only
  nib: { width: number; minFraction: number };  // font units; floor as a fraction of width
  pieces: StackPiece[];
  joins: StackJoin[];
};

type StackPiece = {
  id: string;
  cmds: SvgCmd[];           // outline, already cut at its faces, piece-local
  x: number; y: number;     // placement, font units, relative to block origin
  rotation: number;         // radians, about the piece's own origin
  role: "letter" | "mark";
  parentId?: string;        // marks: the letter they ride with
  faces: CutFace[];         // the piece's cut faces, piece-local
};

type StackJoin = {
  id: string;
  kind: "join" | "tail";
  from: { pieceId: string; faceIndex: number };
  to?:  { pieceId: string; faceIndex: number };           // join only
  end?: { x: number; y: number; angle: number };          // tail only, block-space
  bow: number;              // 0 = tangent-matched default
  fallback?: true;          // made from an inserted tatweel (Approach B)
};

type CutFace = { a: Pt; b: Pt; tangent: number };
```

Not stored: anything keyed by text offset or cluster, glyph ids, or any
font-size-dependent number. `BlockCommon`'s required `text`/`fontFamily`
are carried for the layer name; `fontSize` is the scale. Pieces carry
their own outline rather than a glyph reference so the block survives a
font file changing or a custom font being removed. A short name is a few
KB of path commands.

## 2. Conversion (`src/lib/stackConvert.ts`, pure)

"Convert to stacked composition" on a selected plain text block. One
`pushHistory()`. The shaped run is passed in; the module never imports
`./harfbuzz`.

1. **Take the run as it renders now** — font, Next Shape alternates,
   kashida, stroke cuts, diacritic overrides all applied. The user rule:
   finish letter choices and spacing before converting.
2. **Find each join.** For each adjacent letter pair, run
   `findCutZonesSwept` on the earlier letter's outline and take the zone
   nearest its trailing edge (the coverage script's join window). Cut
   there; the two crossing points and the zone angle become the
   `CutFace`.
3. **Fallback.** No zone: insert a tatweel at the slot through the
   existing kashida edit path, re-shape, cut the tatweel at its middle
   (always legal, it is straight by construction). Tag the join
   `fallback`. The join then starts horizontal on the baseline.
4. **Split into pieces.** Each letter's outline, cut faces opened to zero
   width, becomes a `StackPiece` at its pen position. Zero-advance mark
   glyphs become `role: "mark"` pieces parented to their letter. Dots
   that are contours inside a letter outline stay inside it — no outline
   splitting in this project.
5. **Create joins**, `bow: 0`.

**Identity invariant:** immediately after conversion the block renders
pixel-identical to the text block, because every default join between
two un-moved faces is the straight segment that was cut out.

Nib `width` comes from `nuqta.ts`'s per-font table (the nuqta is the nib
width by definition); `minFraction` defaults to 0.15.

Not convertible in v1: Shape Fill, Curve, verse lines, mirrors, guides.

## 3. Join synthesis (`src/lib/stackJoin.ts`, pure)

Inputs: face A and face B in block space (after their pieces' move and
rotation), `bow`, nib floor. Output: path commands.

**Centerline.** A cubic from the midpoint of A to the midpoint of B,
leaving A along its tangent and arriving along B's. Handle length is
`chord × (1/3 + bow)` on both ends, so a bend never breaks the tangent
match. A seam at a face is the one thing that would read as synthetic.

**Weight — the face vector is the nib.** Each face's vector (its `a` to
its `b`) is the pen's cross-section where the font's stroke was cut,
rotated with its piece. The join's edges are the centerline offset by
±half of a vector interpolated linearly from A's vector to B's. Across
that vector the stroke is full width; along it, it thins. This is a
broad-edge nib with no angle to measure, and the ends land on the faces
by construction. The only constant is the floor: `nib.width ×
minFraction`, so an upstroke tapers to a pen's edge, not a hairline.

**Flattening.** The offset edges are not beziers; sample the centerline
by arc length (about 24 samples for a typical join, scaled with
`fontSize` at export) and emit line segments.

**Stitching — one outline.** A legal cut crosses one contour at exactly
two points, so A's contour has a two-point bridge edge at the face and so
does B's. Splice: A up to its face → join edge 1 → B's whole contour from
its face around to its other face point → join edge 2 → back into A. The
result is **one contour** across the join, so `strokeWidth` outlines,
shadows and SVG export are seam-free. Marks stay their own contours.

**Default is identity.** Coincident faces, zero chord, zero handles, and
the splice reproduces the original contour.

**Tails** reuse the same code with face B replaced by the user's end
point and angle; the vector at the end is A's, so a tail tapers as it
turns.

## 4. Interaction

All on the selected stack block, via a pointer-resolved overlay (one
listening node, hit-tested against piece polygons) as Next Shape does.

- **Move.** Drag a letter piece. Default carries **every later piece in
  reading order** with it, so a climb is a few small lifts. Alt moves
  only that piece. Marks ride with their parent and can also be dragged
  alone.
- **Tilt.** A rotation handle on the hovered piece; about the piece's
  origin; affects that piece only; joins on both sides re-solve.
- **Bend.** A handle at each join's centerline midpoint, dragged across
  the chord, sets `bow`. Double-click resets.
- **Tails.** The stroke-cut rail on a cuttable zone that is not a join can
  be clicked to make a tail; it gets an end handle and a rotation handle.
- **Sidebar.** A `Stack` type panel: source text and font (read-only),
  nib floor, selected join's bow, "Reset layout". No text editing; the
  panel says to undo or convert again.
- **Undo.** One `pushHistory()` at drag start. Block-level snapping,
  grouping, mirrors treat the block as any other; nothing inside snaps.

## 5. Container guide

No new engine. `guidePathD` gains closed shapes — teardrop, almond,
medallion — selectable like the existing guide kinds, resized like any
guide. The guide never moves a piece. Snap-piece-to-guide is left out of
v1.

## 6. Rendering and export

`StackView.tsx`: one Konva `Shape` per block, following the three
renderers' pattern (outline before fill, own path replay — the documented
duplication). Per frame: transform each piece's commands, splice each
join, one fill pass. Fill painters, stroke, shadow and block transforms
apply unchanged. Memoised on `pieces`/`joins`/`fontSize`.

Export: no new code. PNG/JPEG through the stage; SVG/PDF through the
per-block path serialisation, fed the spliced commands.
`blockRenderProps.ts` gains the stack fields so mirrors work.
`blockCapabilities.ts` marks the block ineligible for kashida, Fit to
width, Next Shape, diacritics and stroke cuts (the tail tool is its own).

Old saves load unchanged. Older builds drop `type: "stack"` blocks through
the same filter that drops `shapeWarp`.

## 7. Testing

Vitest beside the modules; real fonts via `shapeReal`; no hand-written
glyph fixtures.

- `stackConvert.test.ts` — convert مصبح and محمد in UKIJ Diwani, Amiri,
  NotoSans. One letter piece per base letter; marks parented; a join per
  adjacent pair; fallback count pinned per font. **Identity:** the spliced
  outline equals the original run's outline to flattening tolerance.
- `stackJoin.test.ts` — synthetic faces: tangent continuity at both ends
  for any bow; width equals the face vector across it and hits the floor
  (never below) along it; a 90° climb thins then thickens monotonically;
  the splice yields one closed contour with both bridge edges gone.
- Transform tests — move and rotate a piece; the join's ends sit on the
  faces to 1e-6.
- `e2e/stack.spec.ts` — convert, drag the second letter up, bounds grow
  in y, undo restores a text block. Coarse pixels.

Neither pure module imports `./harfbuzz`.

## Ceiling and future

- **Letter bodies do not bend.** Approach C — skeletonise glyphs into
  centerline + nib so any stroke can bend with correct weight — is the
  only route to that, and is open research on Diwani's overlapping forms.
  It would operate on exactly the baked block this spec creates.
- **Fonts do not ship stacking alternates** (raised ب, the long sweeping
  م tail). Drawing them into the bundled Diwani font and exposing them
  through Next Shape is font-side work, separate from the renderer.

Both are recorded in `.claude/rules/deferred-features.md`.
