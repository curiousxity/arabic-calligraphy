---
paths:
  - "src/lib/guide*.ts"
  - "src/components/GuideView.tsx"
  - "src/components/GuideDialog.tsx"
  - "src/components/sidebar/Guide*.tsx"
  - "e2e/guides.spec.ts"
---

# Shaped guides

A `guide` block is a dashed construction path.

- Its path, `guideD`, is centred on the block's origin, so `x`, `y` and
  `rotation` place it.
- It carries the name `EXPORT_HIDDEN`, so no export draws it.
- `exportableBlocks` removes it from the freeform crop. Without that, a hidden
  circle would add empty margin to the export.

A `textPath` block with `guide` set is *attached*:
- `CanvasStage` resolves the guide on every render (`resolveGuidePath`) and
  draws the text at the guide's origin and rotation.
- `TextOnPathText` lays the text out with `guideGlyphPlacements`. The text
  keeps its natural size and sits at `offset` along the guide. It shrinks only
  to fit, one full turn on a closed guide.
- A plain Curve block, by contrast, stretches its text along its own
  `textPathD`. That path is unchanged and is gated on `block.guide`.

## How it works

- **Shapes** come from `guidePathD`, which is pure.
  - Closed shapes run clockwise in screen space from the top centre, so
    offset 0 is the top and unflipped text along it walks left to right.
  - `circlePathD` in `textPath.ts` is *not* a full circle (it is a 270° arc).
    Guides build their own closed shapes.
  - The angle of a line guide is the block's rotation.
  - Pen guides reuse `TextPathEditOverlay` unchanged, writing `guideD`.
- **Flip** walks the guide reversed. `offset` is always stored in the
  un-flipped direction, so a flip never moves the text's anchor.
- **Side.** The text hangs when (side is inside) XOR flip. Walking a flipped
  guide turns the glyphs' "up" toward the other side.
- **Baseline-offset sign.** The renderer translates *after* rotating to the
  tangent, so a positive offset moves glyphs down in the glyph frame. Rising
  is `-gap`; hanging is `+(ascent + gap)`.
- **Sliding.** An attached text's drag handlers are replaced.
  - The node stays pinned to the guide origin.
  - The pointer is projected onto the guide (`projectToGuide`), keeping the
    grab offset from the first frame.
  - Snapping and grid snap don't apply. History goes through
    `scheduleMoveHistoryPush`, like any drag.
  - The text's own lock governs, never the guide's.
- **Deleting a guide** detaches its surviving texts in the same undo step
  (`deleteBlocksDetachingGuides`).
  - Each text keeps the guide's path, place and flip, plus a side offset
    approximated with `DETACH_ASCENT`, and becomes a plain Curve block.
  - It then stretches to the curve, as Curve blocks do.
  - An attachment orphaned any other way, such as through a load, is cleared
    by an effect with no history, as mirrors are.

## Traps

- **An attached text's own fields mirror its guide.** That covers
  `x`/`y`/`rotation`, `textPathD`, `textPathReversed` and
  `textPathBaselineOffset`. `syncAttachedToGuides` maintains them in an effect
  with no history. Rendering ignores those fields, but co-moving drags,
  mirrors, snapping and the orphan fallback all read them. When they went
  stale, a guide deleted from Layers left its texts on an old curve, running
  backwards.
- **Every delete path detaches.** The Delete key uses
  `deleteBlocksDetachingGuides`. The Layers panel deletes through reorder, so
  `reorderBlocks` uses `reorderDetachingGuides`.
- **A dragged guide carries its texts as co-movers** (`getCoMovers`). An
  attached text never co-moves with anything other than its guide.
- **A slide pushes history once**, on its first frame. The debounced move push
  would open a second undo step whenever the user paused mid-slide.
- **"Start" is where reading begins.** Glyphs are laid in visual order along
  the walk, so for Arabic, "start" puts the far end of the run at the anchor.
- **The hit box reaches the font's full extent** (`guideInkBox`, ascender to
  descender). A freeform export crops to the client rect, so a box sized to one
  em would clip tall letters and stacked marks.
- **Transform is hidden for attached text.** Its rotation comes from the guide.

- **Hit areas.**
  - The guide's `Path` has `fillEnabled={false}`. Otherwise a closed guide
    hit-tests its whole interior and steals every click inside a medallion.
  - Attached text uses its letters' extent as its hit box, not the guide's
    box, for the same reason.
- **Guides are never mirror sources** (`isMirrorSourceCandidate`). A mirror of
  attached text follows it, because CanvasStage passes `sourceGuideD` and
  `sourceGuideClosed`.
- **A pasted or duplicated attached text stays attached** at the same offset,
  sitting over the original until you slide it.
- **`guideShrink` in App is renderer feedback** for the panel's "Shrunk to N%"
  note. It is never saved and never undone.
- **Guides draw above every other block**, regardless of Layers order, so the
  line can always be grabbed.

## Not supported

- Straight, unbent blocks snapping onto a guide.
- Text continuing from one guide to another.
- Guides made from an uploaded SVG.
- Per-letter drag tools on attached text. Next Shape does work.
