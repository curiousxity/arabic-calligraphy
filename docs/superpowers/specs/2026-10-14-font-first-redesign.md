# Font-first redesign — design

**Date:** 2026-10-14
**Status:** approved in conversation; awaiting written review
**Scope:** four subsystem removals, a start screen, a font strip in the
editor, and the sidebar restructure those imply. No change to shaping,
rendering maths, or export.

## Goal

The app has grown bulky and some features are redundant. The thing it
excels at is the fonts: real HarfBuzz shaping of 22 calligraphic faces, and
letter-level tools that work on a font's own glyphs. The redesign puts the
fonts at the centre, removes what does not involve them, and leaves an
editor a calligrapher can read at a glance.

Success looks like: open the app, type a word, see it in every face, pick
one, and be editing in under ten seconds. Inside the editor, changing font
is one click, never a dialog.

## Decisions already made

- **Delete, not hide.** An "advanced" toggle keeps the code and the bloat.
  Each removal follows the repo's removal protocol (below).
- **Cut:** Square Kufi, horizontal and vertical warp, image blocks, the
  ornament and frame library. The last follows from the third: a frame is an
  image block, and an image type nobody can add themselves is plumbing.
- **Keep:** everything else, explicitly including templates and Randomize,
  fill textures and gradients, paper surface and tint, saved projects, export
  presets, cloud sync, styles and palettes, mirrors, compositions (muthanna
  and medallion), guides, verse, spacing, free marks, stacked compositions,
  and all four preset keyboards.
- **All 22 active fonts stay.** Noto Sans, Yekan and Janna were proposed for
  removal and the user declined.
- **Option A** for the front door: a start screen built on the existing
  gallery, plus a persistent font strip in the editor. Rejected: a permanent
  left-hand font column (squeezes the canvas, two sidebars) and a start
  screen alone (fonts prominent for ten seconds, then buried again).
- No usage telemetry exists. "Won't get used" is the user's judgment, given
  in conversation.

## 1. Start screen

A new `src/components/StartScreen.tsx`, shown instead of the editor when the
app loads with nothing to restore.

- One RTL `<input>` at the top, pre-filled with the starter word (`حرف`,
  `DEFAULT_BLOCK.text`). Below it, every font card, grouped by genre with the
  same headings the picker uses. Cards update live as the field changes.
- Cards render with CSS `@font-face`, exactly as `FontPickerDialog` does.
  Uploaded fonts (IndexedDB) appear under "Uploaded" once loaded. Retired
  fonts (`FontChoice.retired`) are hidden.
- Clicking a card creates the single starter block with that text and font
  and opens the editor. Empty field falls back to the starter word.
- A "Skip" link opens the editor with the default block unchanged.
- The start screen is **bypassed** when any of these apply: a quick-save
  exists in `localStorage`, a project file is being opened, or a cloud
  project is being loaded. The restore path already runs in `App.tsx`; the
  start screen is gated on its outcome, not on a separate check.
- State: one `useState<"start" | "editor">` in `App.tsx`. Nothing from the
  start screen is persisted.
- The gallery grid is extracted from `FontPickerDialog.tsx` into a shared
  `FontGallery` component (text, fonts, active value, onPick) that both the
  dialog and the start screen render. One gallery, two frames.

## 2. Font strip in the editor

In the `selected` tier, a new **Font** panel sits first, above Content.

- A horizontal, scrollable row of cards, one per font, each showing the
  selected block's text in that face. Active card highlighted and scrolled
  into view on selection change. One click applies the font (one undo step;
  re-picking the current font is a no-op, as the dialog already guarantees).
- A trailing button opens the existing `FontPickerDialog` for the
  genre-grouped view. `FontPickerField` (label-then-font accessible name)
  stays as that button so `e2e/harf.ts`'s `chooseFont` keeps working.
- The strip is hidden for block types with no font (mirror, guide, stack);
  Typography already hides for those.
- Typography loses its Font family row (it moved up) and gains the Rotation
  row from Transform. The Transform panel is deleted.
- The font catalogue (`FONT_OPTIONS`, `FontChoice`, genre data) moves out of
  `Sidebar.tsx` into `src/lib/fontCatalog.ts`. `FONT_URLS` stays in
  `useShapedGlyphs.ts`; `bundledFonts.test.ts` continues to check every
  `FONT_URLS` key appears in the catalogue.

## 3. Removals

Four removals, one commit each, after a git tag `pre-font-first-redesign`
on the last commit before the first deletion.

**Removal protocol** (from removed-subsystems.md), applied to each:

1. Delete code, unit tests, e2e specs, guide sections, demo GIFs.
2. Old saves: block *types* are filtered in `applyParsedLayoutPayload`
   beside the existing `shapeWarp` filter; block *fields* are added to
   `REMOVED_BLOCK_FIELDS` so `stripRemovedFields` drops them. No second
   stripper.
3. One entry in `.claude/rules/removed-subsystems.md`: what went, why in the
   user's words, how to recover (the tag).
4. Delete the subsystem's `.claude/rules/` note and its CLAUDE.md index
   line; update the Block union description in CLAUDE.md.
5. README feature list and `docs/media` references updated.
6. `PROGRESS.md` gets one dated line per removal.

| Removal | Code | Save-file handling | Knock-on |
|---|---|---|---|
| **Square Kufi** | `SquareKufiBlock` type, `SquareKufiText.tsx`, `KufiCellEditOverlay.tsx`, `lib/squareKufi*`, Sidebar panel, `kufiOptionsFor`, Add button, `e2e/square-kufi.spec.ts`, guide section `square-kufi.tsx`, deferred-features lines | filter `type === "squareKufi"` | `blockCapabilities.ts` loses its kufi guards; `font-picker.spec.ts` and `styles.spec.ts` drop their kufi cases |
| **Warp** | `lib/warp.ts` + test, `warpX`/`warpY` on `BlockCommon`, two Typography sliders, `ShapedText` warp pass, `blockRenderProps` mapping, `DiacriticHoverHandles` warp term | add `warpX`, `warpY` to `REMOVED_BLOCK_FIELDS` | `fitToWidth.ts` drops its warp term and the `warpX` input (test updated); `composition.ts` stops copying warp; detached-marks "marks, then cuts, then warp" becomes "marks, then cuts" |
| **Image blocks** | `ImageBlock` type, `ImageBlockView.tsx`, `addImageBlock`, Add image button + file input, Image panel, `imageDataUrl`/`imageScale` fields, mirror-of-image path in `MirrorBlockView` | filter `type === "image"`; fields to `REMOVED_BLOCK_FIELDS` | `blockRenderProps` loses the image mapping; `randomizeLayout`'s image exemption goes |
| **Ornaments & frames** | `OrnamentPicker.tsx`, `lib/ornaments.ts` + test, `src/data/ornaments/`, Add ornament button, `insertOrnamentShapeFill`/`insertOrnamentFrame`, `ornamental` flag on `BlockCommon`, `e2e/ornaments.spec.ts`, guide section `ornaments.tsx`, `.claude/rules/ornaments.md` | `ornamental` to `REMOVED_BLOCK_FIELDS` | Compositions drops the `framed` layout (keeps muthanna, medallion); `CompositionDialog` loses its frame swatches; `FontUploadDialog` loses its ornament reference; `e2e/harf.ts` `addOrnamentShapeFill` replaced by `addShapeFillFromSvg` that uploads a small fixture SVG (curves, no `A` commands); `detached-marks`, `glyph-alternates`, `ink-surface` specs switch to it |

**Mirror blocks stay**, including "Add mirror" and the medallion. The
"Add medallion" button leaves the Add grid and lives only in Compositions,
where the same action already exists.

## 4. Sidebar after the cuts

| Tier | Panels |
|---|---|
| `document` | Start from a Template · Artboard · Background & Grid · Project & Export |
| `canvas` | Block Controls (Add: text, shape fill, curve, guide, mirror — one 5-column row; Selected; History) · Layers · Align & Arrange |
| `selected` | **Font** · Content · type panel (Shape Fill / Curve / Mirror / Guide / Verse / Stacked) · Typography (+ Rotation) · Effects |

Shortcuts stay outside any tier.

Alongside the removals, the remaining type panels and the Typography and
Effects panels are split into `src/components/sidebar/*Panel.tsx` files the
way `VersePanel` and `StackPanel` already are. This is file boundaries only:
no prop renamed, no behaviour changed, so the e2e suite is the regression
check. `Sidebar.tsx` becomes the tier layout plus wiring.

`sidebar.md` is rewritten to match; its Add-grid paragraph (nine buttons,
orphan row) is replaced.

## 5. Testing

Unit (Vitest):
- `fontCatalog.test.ts`: every `FONT_URLS` key present, genres contiguous,
  retired fonts flagged (absorbs the relevant `bundledFonts.test.ts` checks).
- `applyParsedLayoutPayload`'s filter and `stripRemovedFields`: a fixture
  save containing a `squareKufi` block, an `image` block, and a text block
  with `warpX`/`ornamental` loads as one clean text block.
- `fitToWidth.test.ts` updated for the solver without a warp term.
- `composition.test.ts` updated for two layouts.

E2e (Playwright, Chromium):
- New `start-screen.spec.ts`: fresh load shows the gallery; typing updates a
  card; picking lands in the editor with that font and text; Skip lands with
  the default; a quick-save bypasses the screen.
- `font-picker.spec.ts` extended: the strip applies a font in one click; the
  trailing button still opens the dialog; `chooseFont` helper unchanged.
- `square-kufi.spec.ts`, `ornaments.spec.ts` deleted; the three fixture
  swaps pass.
- Full suite green.

Then typecheck, lint, test, build, in that order, and a browser pass by eye
on the start screen and the strip at the sidebar's minimum width (`min-width:
0` on the strip's cards, per the grid footgun in sidebar.md).

## Order of work

1. Tag `pre-font-first-redesign`. Extract `fontCatalog.ts` and `FontGallery`
   (pure moves, suite green).
2. Four removals, one commit each, in the table's order. Each commit leaves
   typecheck, lint, tests, build green.
3. Font strip panel; Transform folded into Typography.
4. Start screen.
5. Sidebar panel split.
6. Docs: CLAUDE.md, sidebar.md, removed-subsystems.md, README, PROGRESS.md,
   user guide sections.

## Out of scope

- Any change to shaping, render maths, export, or the fonts themselves.
- Mobile layout.
- Re-evaluating the kept-but-questioned features (templates, textures, three
  save paths, three localStorage lists). They may come up again once the
  trimmed app is in use.
