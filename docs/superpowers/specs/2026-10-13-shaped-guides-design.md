# Shaped guides with attached text

Date: 2026-10-13. Status: implemented on branch `shaped-guides`.

The third of three Kelk-gap projects, in build order:

1. spacing (shipped);
2. multi-line verse (shipped);
3. shaped guides (this spec).

## Goal

Let a calligrapher place a helper shape — circle, ellipse, arc, wave,
straight line, or a freehand pen curve — and attach text to it. Several texts
can share one guide, each at its own size and at its own place along it. The
guide is a construction line: it is never exported.

**Success** means all of the following hold:

1. **Two texts share a circle.** Place a circle guide and attach
   `بسم الله` outside it, along the top. Attach `وحده` flipped along the
   bottom, so it reads upright. Both keep their font sizes.
2. **Dragging the guide** moves both texts with it.
3. **Dragging a text** slides it along the circle, and one undo puts it back.
4. **A PNG export** shows both texts and no guide.
5. **A text longer than the circle** shrinks just enough to fit one full turn.
6. **Deleting the guide** leaves both texts in place as ordinary Curve blocks.
7. **Old saves** load and render unchanged.

**What the user said:**
- Text bends along the guide.
- v1 offers circle and ellipse, arc, wave and straight line, and a freehand pen curve.
- Each text chooses outside or inside, and can flip so bottom text reads upright.
- Text slides along the guide by dragging, and by a Position slider.
- Text too long for its guide shrinks to fit.

**Assumed, open to correction:**
- Moving or editing a guide carries its texts with it.
- Deleting a guide keeps its texts as Curve blocks on the same shape.
- Gap is measured in units of font size.

## Approach

There are two parts:

- **A guide is a new `guide` block type.** Its shape is an SVG path `d`, the
  same representation Curve blocks use.
- **An attached text is a `textPath` (Curve) block** with a `guide`
  reference. It takes its curve from the guide on every render, the way a
  mirror looks up its source.

Rejected alternatives:

- **Bending plain text blocks in `ShapedText`.** This puts the riskiest
  change into the most-used renderer. The drag-based per-letter tools would
  be meaningless on a curve anyway.
- **Guides as document-level overlay state, like ruler guides.** This needs
  new state in save, load, undo and selection, and makes guides harder to
  select and edit.

## Data

```ts
// src/types.ts
export type GuideShape = "circle" | "ellipse" | "arc" | "wave" | "line" | "pen";

export type GuideBlock = BlockCommon & {
  type: "guide";
  guideD: string;          // SVG path in the block's local space
  guideShape: GuideShape;
  /** Shape parameters the panel edits; `guideD` is regenerated from them (not for pen). */
  guideParams?: { width?: number; height?: number; sweep?: number; angle?: number; amplitude?: number };
  guideEditMode?: boolean; // pen point editing active
};

export type GuideAttachment = {
  id: number;                       // the guide block's id
  offset: number;                   // 0..1 along the guide (un-flipped direction)
  align: "start" | "center" | "end";
  side: "outside" | "inside";
  flip: boolean;
  gap: number;                      // × font size
};

// TextPathBlock gains:
guide?: GuideAttachment;
```

- `GuideBlock` joins the `Block` union. It inherits `BlockCommon`'s unused
  text and font fields, as `ImageBlock` does.
- A `textPath` block with `guide` set:
  - ignores its own `textPathD`;
  - draws at the guide's `x`, `y` and `rotation`;
  - keeps its own `fontSize`.

  Without `guide`, a Curve block behaves exactly as it does today.
- There is no save-format bump. The fields are optional, and old saves load
  unchanged.
- An attachment whose guide id does not resolve is handled on load, and by
  the same orphan effect mirrors use. Such a block becomes a plain Curve
  block, keeping its last-known shape. **For this to work, the guide's
  current `guideD` is written into the text's `textPathD` whenever a guide
  is deleted or a text is detached.**

## Guide shapes (`src/lib/guideShapes.ts`, pure)

`guidePathD(shape, params) → string`. The shapes build on the existing
`arcPathD`, `wavePathD` and `circlePathD` where those fit.

- Every closed shape runs **clockwise in screen space, starting at the top
  centre**. A position of 0 is therefore the top. Text placed along the top,
  not flipped, reads right to left the way Arabic is written, running
  left-to-right in glyph order as the existing Curve renderer expects. The
  first test confirms this direction against real shaping.
- **Circle and ellipse** use four cubic segments per turn.
- **Arc** is a centred circular arc with an adjustable `sweep` (10°–350°),
  symmetric about the top.
- **Line** is a straight segment of length `width` at angle `angle`.
- **Wave** reuses `wavePathD`.
- **Pen** is edited through the generalised pen overlay (see UI), and its
  `guideD` is stored directly.
- `isClosedPath(cmds)` is true when the path ends at its start point or has
  a `Z`.

## Placement (`src/lib/guidePlacement.ts`, pure)

```ts
guideGlyphPlacements({
  glyphs, fontSize, unitsPerEm, ascender,   // ascender in font units
  arcTable, length, closed, attachment,
}) → { placements: CurveGlyphPlacement[]; size: number; shrink: number } | null
```

- **Natural size.** The natural length is `L = Σ ax × fontSize / upm`, and
  the available length is `A = length`. The text shrinks only if it is too
  long: `shrink = min(1, A / L)`, and `size = fontSize × shrink`.
- **Anchor and alignment.** `anchor = offset × length`. The text's start is
  then:
  - for `start`: `anchor`;
  - for `center`: `anchor − L′/2`;
  - for `end`: `anchor − L′`.

  Here `L′ = L × shrink`.
- **Flip** walks the guide in reverse, using an arc table built with
  `reversed = true`. The un-flipped anchor `s` maps to `length − s`, so the
  Position value names the same point on the guide either way.
- **Closed guides.** Arc positions wrap modulo `length`.
- **Open guides.** The start is clamped to `[0, length − L′]`, so the text
  never runs past an end.
- **Side.** Let "rise" be the side of the reading direction that the
  glyphs' up points to.
  - If `side === "inside"` XOR `flip`, the text **hangs**: the baseline
    offset is `−(ascender × size / upm + gap × fontSize)`.
  - Otherwise it **rises**: the baseline offset is `+gap × fontSize`.

  With this rule, a flipped text on the bottom of a circle that is set to
  "outside" sits outside the circle and reads upright.
- Placements use the existing `CurveGlyphPlacement` type and
  `pointAtArcLengthFromTable`. That way the Next Shape overlay, which already
  outlines Curve glyphs from placements, works unchanged on attached text.
- Imports `textPath.ts` and `svgPath.ts` only, never `./harfbuzz`.

`projectToGuide(arcTable, length, point) → offset`

- Returns the arc position nearest to `point`, by sampling the arc table and
  then refining between the two nearest samples. The result is normalised to
  0..1 in the un-flipped direction.
- The drag handler then applies `align`. The text's anchor is the point
  being dragged, so the dragged text stays under the pointer.

## Rendering

- **`GuideView.tsx`** draws a guide block as a thin dashed `Path`. The line
  width is `1 / stageScale`, so it stays one pixel at any zoom. It has a
  wide, transparent hit stroke so it can be selected.
  - It carries the `EXPORT_HIDDEN` name, so exports skip it.
  - It is drawn above every non-guide block. This order is fixed, not
    controlled by the Layers z-order.
- **`TextOnPathText`** gets three new props: `guidePath` (`{ d, closed }`),
  `guideAttachment`, and `guideOrigin`. When these are present, it places
  glyphs with `guideGlyphPlacements` instead of `curveGlyphPlacements`.
  - It is positioned at the guide's origin and rotation.
  - The draw loop and the Next Shape overlay both consume the placements, as
    they do today.
- **`CanvasStage`** resolves each attached text's guide and passes these
  props. `blockRenderProps` passes them too, so mirrors of attached text
  follow it.
  - Arc tables are memoised per guide (`guideD` plus reversed flag) and
    shared by every text on that guide.

## Interaction

- **Dragging an attached text** slides it along the guide.
  - The text's Konva node gets a `dragBoundFunc`. On each frame it projects
    the pointer onto the guide, keeps the node at the guide's origin, and
    reports the new offset.
  - The new offset is written through the same move-history path ordinary
    drags use, so a slide is one undo step.
  - Snapping is skipped for attached texts.
- **Dragging a guide** moves only the guide block. Its texts follow because
  they draw at its origin. No co-mover bookkeeping is needed, and the guide
  and its texts are not grouped.
  - Snapping applies to the guide, using its rect as a snap source and
    target.
- **Deleting a guide** detaches its texts in the same `pushHistory` step.
  Each text gets:
  - `textPathD` set to the guide's `guideD`;
  - the guide's `x`, `y` and `rotation`;
  - `guide` removed;
  - `textPathReversed` set to match `flip`;
  - `textPathBaselineOffset` set to the side and gap offset it had.

  The text renders where it was, but now as an ordinary Curve block, which
  stretches its text along the curve's full length. The status line says so.
- **Attach to guide…** on a plain text block opens a small picker listing
  the guides on the canvas. Choosing one converts the block to a `textPath`
  block in one undo step, with `guide` set to `{ offset: 0, align: "center",
  side: "outside", flip: false, gap: 0.15 }`.
  - The conversion keeps `id`, `text`, the font fields, the style fields and
    `glyphAlternates`/`styleSets`.
  - It drops diacritic overrides and stroke cuts, because drag-based tools
    don't apply on curves, and the status line names what was dropped.
  - It drops `letterSpacing`/`wordSpacing`, which are text-block only.
  - It drops `verse`.
- **Add text** in the Guide panel creates an attached `textPath` block with
  the default text `نص على الدليل`, a font size of 53, and the attachment
  defaults above. The new block is selected.

## Interactions with other systems

- **Export:**
  - Guides are named `EXPORT_HIDDEN`, so PNG, JPEG, SVG, PDF, Copy PNG and
    Export All leave them out.
  - `useExport`'s freeform crop computes `getBlocksBoundingBox` over
    non-guide blocks only.
  - The history thumbnails may show guides; that is acceptable, since they
    are not exports.
- **Practice sheet:** it skips `guide` blocks. It treats attached text as it
  already treats `textPath` blocks.
- **Mirrors:**
  - `canAddMirrorBlock` is false for guides.
  - A mirror of attached text follows its source through `blockRenderProps`.
- **Snapping:** guides are ordinary snap targets and sources. Attached texts
  neither snap nor serve as targets, since their rect changes as they slide.
- **Capabilities:** add `guide` to `blockCapabilities.ts`, with no per-letter
  tools. Attached text keeps Next Shape. Fit to width, Name designs and verse
  are not offered on `textPath`, as today.
- **Layers:** a guide is listed as "Guide · Circle" (or whichever shape) and
  can be locked or hidden. A locked guide still carries its texts; locking
  stops dragging only.

## UI

- **Block Controls → Add.** A new **Add guide** button opens a small picker
  of the six shapes. The grid already holds eight buttons, so it gains a
  third row; that is accepted. Adding a guide places it through the existing
  `beginPlacement` ghost, as other Add buttons do.
- **Guide type panel** (selected tier, under Content). It shows:
  - the shape's size rows:
    - circle: diameter;
    - ellipse: width and height;
    - arc: width and sweep;
    - wave: width and amplitude;
    - line: length and angle;
    - pen: an **Edit points** toggle.
  - **Add text**;
  - a list of the attached texts, where clicking one selects it.

  Size rows are RangeRows. One `pushHistory` per gesture, as the other
  sliders do.
- **Curve type panel**, when `guide` is set, gains an **On guide** section:
  - Position slider (0–100%);
  - Start / Centre / End;
  - Outside / Inside;
  - Flip;
  - Gap;
  - a "Shrunk to N% to fit" note when shrinking applies;
  - **Detach**.

  The Curve-only rows are hidden while `guide` is set: the preset curve
  picker, pen editing, Reverse and Baseline offset. The font size row is
  shown.
- **Content panel** of a plain text block: **Attach to guide…**, shown only
  when the canvas has at least one guide.
- **The pen overlay** (`TextPathEditOverlay`) is generalised to edit any path
  `d` through callbacks. Curve blocks and pen guides both use it, and the
  Curve behaviour is unchanged.

## Out of scope (v1)

- Snapping straight (unbent) blocks onto a guide.
- Text that continues from one guide to another.
- Guides made from SVG upload.
- Guide-to-guide boolean operations.
- Per-letter drag tools on attached text.
- Drawing guides in history thumbnails differently.

## Testing

- **`guideShapes.test.ts`:**
  - each shape builds a parseable path;
  - closed shapes report closed;
  - a circle's length matches 2πr to within 1%;
  - a circle's arc position 0 is at the top centre, and the next sample lies
    to its right (clockwise);
  - an arc's sweep sets its length.
- **`guidePlacement.test.ts`**, using real harfbuzzjs and Amiri via the
  `shapeReal` pattern:
  - natural size is kept (`shrink === 1`) when the text fits;
  - shrink is `A/L` when the text is too long, on both a closed and an open
    guide;
  - with start, centre and end alignment, the anchor sits at the text's
    first glyph, its middle, or its end;
  - on a closed guide, a text spanning the seam wraps continuously, with no
    jump in placement positions apart from the modulo;
  - on an open guide, the start is clamped at both ends;
  - flip keeps the anchor point the same and reverses the glyph order along
    the guide;
  - inside and outside put the glyphs on opposite sides of the line, and
    flip with outside on the bottom of a circle lands outside the circle;
  - `projectToGuide` finds the nearest point on a circle and on an ellipse
    to within 0.5 px.
- **e2e (`e2e/guides.spec.ts`):**
  - add a circle guide and attach two texts;
  - check that guide pixels are absent from a PNG export, coarsely, by ink
    near the guide away from the texts;
  - drag the guide and check that both texts' positions follow;
  - drag a text and check that its offset changes, and that one undo
    restores it;
  - delete the guide and check that both texts become `textPath` blocks
    without `guide` that still draw ink;
  - convert a plain text block with **Attach to guide…**.

## Docs

- `.claude/rules/guides.md`, with `paths:` covering `guideShapes*`,
  `guidePlacement*`, `GuideView.tsx` and the guide panel.
- One index line in `CLAUDE.md`, and a mention of the `guide` block type in
  its Block union paragraph.
- A paragraph in `text-on-path.md` on the guide-attached mode.
- `guide/sections/guides.tsx`.
- A `PROGRESS.md` entry.

## Decisions made during planning and build

These were settled after the design above was approved. Where they differ
from it, they win.

1. **Guide paths are centred on the block origin.** The guide's `x`, `y` and
   `rotation` place it, so rotation pivots on its centre.
2. **A line guide has no angle parameter.** Its angle is the block's own
   rotation, set in the Transform panel.
3. **Pen guides reuse `TextPathEditOverlay` unchanged.** It already edits
   any `d` through `onChange`, so it was not generalised.
4. **Baseline-offset sign follows the renderer.** A positive offset moves
   glyphs down in the glyph frame. Rising is `−gap`, and hanging is
   `+(ascent + gap)`.
5. **"Start" alignment is where reading begins.** For Arabic, that is the far
   end of the visually ordered run. This was changed in review: the original
   choice, the first glyph in walking order, read backwards.
6. **Sliding keeps the grab offset** taken on the first frame, so the text
   does not jump under the pointer.
7. **The shrink note uses non-persisted renderer feedback.**
   `TextOnPathText` reports `onGuideLayout`, and App holds a `Map` that is
   neither saved nor undoable.
8. **Detaching approximates the hang offset** with an ascent of
   0.8 × font size (`DETACH_ASCENT`).
9. **An attached text's `textPathD` is set to the guide's path** when it is
   created, so the orphan fallback has a sensible curve.
10. **Hit areas.** An attached text's hit box is its letters' extent, not the
    guide's box, and the guide's path does not hit-test its interior
    (`fillEnabled={false}`). The e2e suite found both. Without them, a circle
    guide swallowed every click inside it.
11. **`circlePathD` in `textPath.ts` is an open 270° arc.** Guides build
    their own closed shapes and do not reuse it.
12. **An attached text's own geometry is kept in sync with its guide**
    (`syncAttachedToGuides`, an effect with no history). Both the Delete key
    and the Layers delete route detach a deleted guide's texts. A dragged
    guide carries its texts as co-movers. A slide is one undo step.
