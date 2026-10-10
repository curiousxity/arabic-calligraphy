# Next Shape on Shape Fill and Curve blocks

Date: 2026-10-10. Status: design, awaiting review. Builds on
`2026-10-10-next-shape-design.md` and the style-set toggles (`styleSets`).

## Goal

The per-letter Next Shape tool (click a letter to step through its font's
alternate shapes; Shift-click back; thumbnail strip in the sidebar) works on
Shape Fill and Curve blocks as it does on text blocks.

**What the user decided:** on Shape Fill, one pick changes that letter in
**every tile**, the way diacritic adjustments already behave there. A
per-tile choice was offered and declined.

**Success:** on a Ruqaa Shape Fill block, hovering any tile's heh outlines it;
clicking changes every heh in the silhouette; undo restores them. The same on
a Ruqaa Curve block, with the outline following the letter's tilt. Neither
freezes the tab at the largest silhouette the tiling allows.

## Why the overlay changes shape

Today `AlternateHoverHandles` mounts one listening Konva `Rect` per letter.
That cannot survive Shape Fill. A 3000-tall silhouette at `fontSize` 20 tiles
about 23,000 glyph instances, and the removed glyph-transform overlay
measured that many listening rects as a frozen tab. That feature had to cap
itself at one handle per glyph index, which is exactly what "outline the
letter you are pointing at" cannot do.

So the overlay becomes **pointer-resolved**:
- One transparent listening `Rect` spans the targets' combined bounds.
- On each pointer move it finds the target under the pointer in plain
  arithmetic: an axis-aligned box pre-check, then point-in-polygon, with the
  last match winning. That matches paint order, so the letter drawn on top is
  the one picked.
- It draws one outline `Line` for that target.

Hit-testing 23,000 quads is a few hundred microseconds per move. Konva node
count stays at two however large the silhouette is.

The same component serves all three block types, so text blocks move to it
too. One code path, not a fast path and a slow one.

## Targets

A target is a letter instance in **group space** (the renderer's own Konva
`Group`, the space the overlay draws in):

```ts
type AlternateHitTarget = {
  key: string;          // unique per instance
  letter: number;       // letter ordinal → options
  polygon: Point[];     // 4 corners of the letter's ink box, transformed
  options: AlternateOption[];
};
```

Each renderer builds its own, from geometry it already computes:

- **Text** (`ShapedText`): the existing per-letter union of hit boxes,
  offset by `bx + localDrawX`, as four corners. No change in what is
  outlined.
- **Shape Fill** (`ShapeFillText`): one target per **tiled instance** of a
  letter that has options. The corners of the glyph's local box go through
  `makeShapeFillInstanceAdapter(...).toCanvas`, the adapter the diacritic
  overlay already trusts, so rotation, the row's fit scale and `shapeScale`
  are all honoured. Instances come from the existing `glyphInstances` memo.
  Its gate widens from `diacriticEditMode` to
  `diacriticEditMode || glyphAlternateMode`, so the tiling walk still runs
  only while a tool is armed. The block's `dragBoundFunc` pin, already used
  for the diacritic tool, applies while either tool is armed.
- **Curve** (`TextOnPathText`): one target per letter. The glyph loop's
  placement math (cursor along the arc, `pointAtArcLengthFromTable`, rotate to
  the tangent, baseline offset, size `fontSize × fitScale`) moves into a pure
  `curveGlyphPlacements(...)` in `lib/textPath.ts`. Both the draw loop and the
  overlay call it, so the outline and the ink cannot drift apart: the same
  "one placement function" discipline the renderers already follow. A target
  is the glyph's box under that placement's transform.

Known approximation, inherited: italic shear is not folded into the polygon,
the same as the diacritic adapter on Shape Fill.

## Interaction

Unchanged from text blocks. Hover outlines, click → next, Shift-click →
previous, the pick happens on release within `CLICK_SLOP`, and the pressed
letter wins. A press on a target never starts a block drag, and a
`click`/`dblclick` on a target is swallowed. The thumbnail strip, "Without
style sets", the panel states and undo (one entry per pick) all carry over
as they are.

## Data and plumbing

- `supportsGlyphAlternates` widens to `text | shapeFill | textPath`. The
  field already sits on `BlockCommon`, so this guard is what actually turns
  the feature on. Widening it without the renderers reading the field would
  type-check and silently discard every pick: the trap
  `blockCapabilities.ts` documents.
- `shapeFillProps` and `textPathProps` carry `glyphAlternates`, so mirrors
  draw them. Both renderers pass it to `useShapedGlyphs`.
- App runs `useGlyphAlternates` for whichever selected block supports it, as
  now; `CanvasStage` hands `alternateLetters` to the selected block's
  renderer, whichever type it is.
- Sidebar: the per-letter checkbox and strip appear for all three types.
- No new stored fields, no remapping. Letter ordinals are shared by every
  tile, which is what makes "every repetition" free.

## Testing

- **Pure:** `hitTestTargets(targets, point)`. It returns the last match,
  ignores points outside, and handles rotated quads.
- **Pure:** `curveGlyphPlacements`. Positions advance along the curve,
  angles follow the tangent, and placements match what the renderer used to
  compute inline (pinned against a straight-line curve with known answers).
- **e2e:**
  - On a Ruqaa **Shape Fill** block, hover a tile's heh and get one outline;
    click it and `glyphAlternates` gets one entry and the ink changes; undo
    restores it. A second tile far away also shows the new shape (ink
    changes there too).
  - On a Ruqaa **Curve** block, the same click and undo.
  - **Text-block regression:** the existing alternates specs keep passing on
    the new overlay. They address targets through a non-listening marker
    node (`name="alternate-targets"`) whose `centers` attribute lists each
    target's centre in group space. A spec reads it and maps it through the
    node's absolute transform. That is read-only scene data, in keeping with
    the "bridge is read-only" rule.
  - **Performance guard:** arm the tool on the largest silhouette the e2e
    suite already builds and assert there are two listening overlay nodes,
    not thousands.

## Out of scope

Per-tile choices (declined). Drag-based per-glyph tools on Curve stay
deferred. This adds click-only picking, which needs no answer to "what does
offsetX mean along a curve". Square kufi draws no font glyphs.

## Docs

`glyph-alternates.md` (overlay architecture, the three target builders),
`text-on-path.md` (first per-glyph tool on curves, click-only, and why that
is safe), `deferred-features.md` (narrow the text-on-path entry to drag
tools), the guide section, PROGRESS.
