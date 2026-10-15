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
  - **Uploaded SVG guides** (`guideShape: "svg"`) have no formula.
    `uploadedGuideSource` centres the outline on the origin at its natural
    size and stores it as `guideSvgD`; `guideD` is it scaled uniformly to
    `guideParams.width` by `svgGuidePathD`, so the panel offers one size and
    the height follows. `guidePathD("svg")` returns "" on purpose. The file
    is read by `extractSvgPaths` with the aspect kept (a guide is the user's
    shape, not a tile to stretch); arcs become straight lines, as everywhere
    the importer is used.
  - **A closed guide is a container** for a stacked composition
    (`containerPolygon`: the largest closed subpath, so a ring or an outline
    with stray marks still gives one shape). See
    [stacked-compositions.md](stacked-compositions.md), "Fill a guide shape".
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

## Writing on a guide

Text can be typed straight onto a guide on the canvas, with a caret, instead
of through the sidebar. The session is `WritingSession` in `guides.ts`,
owned by `App` (`writing`) and drawn by `CanvasStage`.

- **Two ways in.** A printable key with a guide selected (App's window
  keydown, before the Delete branch) seeds the text with that key, at the
  guide's default place. Space is not one: it pans the canvas. A
  double-click (or double-tap) on the guide's line starts an empty session
  *at the clicked point*, projected with `pointerOffsetOnGuide`. Both anchor
  `align: "start"` so letters already typed stay put as more arrive; the
  centred default is for Add text to guide only. A double-click on attached
  text re-opens it (`beginWritingText`); a plain Curve or text block still
  goes to the sidebar.
- **The block is created by the first letter**, not by opening the session
  (`createWrittenText`). Until then `textId` is null and the caret is drawn
  by `CanvasStage` at the guide, with a stand-in ascent, because no font is
  loaded for a guide. Escape before typing therefore leaves no block and no
  undo entry. A text emptied by the user is removed when the session ends.
- **Input is a real `<textarea>`** (`WritingField`, invisible, no pointer
  events) so Arabic layouts, IMEs and on-screen keyboards deliver text the
  way they do in the sidebar, and `isTypingTarget` keeps Delete, arrows and
  the guide-key shortcut off the block. Blur, Escape and Enter end it, once.
  It is mounted once per session and never keyed on `textId`: a remount when
  the first letter creates the block would drop an IME composition. Each
  change goes through `updateBlock`, so keystrokes coalesce in history like
  sidebar typing.
- **The caret sits at the reading end** (`guideCaret`): the base glyph of
  the highest cluster, which for Arabic is the leftmost glyph, since HarfBuzz
  returns the run in visual order. It is found by cluster, never by placement
  index, because a centred run re-centres on every keystroke. The pure
  helper is tested against real shaping in `guidePlacement.test.ts`.
- **An attached text with nothing drawn has no hit box** (`TextOnPathText`).
  The old fallback to the curve's box would let an empty text on a circle
  claim the whole medallion.
- **Playwright cannot press an Arabic key** — `keyboard.type` turns it into
  `insertText` with no keydown — so the e2e specs open the session on a
  Latin key and replace it with select-all.

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
- **Rotation is hidden for attached text.** Its rotation comes from the guide.

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
- Editing the points of an uploaded SVG guide (upload a new file instead).
- Per-letter drag tools on attached text, except diacritic handles. Next
  Shape does work.
