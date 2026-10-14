---
paths:
  - "src/lib/fontCatalog*.ts"
  - "src/lib/startScreen*.ts"
  - "src/components/StartScreen.tsx"
  - "src/components/FontGallery.tsx"
  - "src/components/sidebar/FontPanel.tsx"
  - "e2e/start-screen.spec.ts"
---

# Font-first: the start screen, the Font panel and the catalogue

Shipped 2026-10-14 with the redesign argued in
`docs/superpowers/specs/2026-10-14-font-first-redesign.md`: the fonts are what
the app is best at, so they are the front door (the start screen) and one
click away inside the editor (the Font panel's strip). The removals that went
with it are in [removed-subsystems.md](removed-subsystems.md); the Font
panel's place in the sidebar is in [sidebar.md](sidebar.md).

## The catalogue is the single list (`src/lib/fontCatalog.ts`)

`FONT_OPTIONS` (moved out of `Sidebar.tsx`), the `FontChoice` type,
`groupByGenre`, `fontChoicesWith` (built-ins then uploads, under the genre
"Uploaded") and `visibleFonts` all live here. Every surface that lists fonts
reads this module — the picker dialog, the start screen and the strip — so a
font added or retired here reaches all three.

- **`FONT_URLS` stays in `src/hooks/useShapedGlyphs.ts`.** It is the shaping
  registry and drags in HarfBuzz; the catalogue must stay importable from
  Vitest without it. Two tests cross-check the pair by *reading the source
  text* of `useShapedGlyphs.ts` rather than importing it:
  `fontCatalog.test.ts` (every `FONT_URLS` key is in `FONT_OPTIONS`, genres
  contiguous, retired fonts hidden, uploads appended) and
  `bundledFonts.test.ts` (every key also has an `@font-face`). Adding a font
  is still the four-place edit in [bundled-fonts.md](bundled-fonts.md).
- **Genres must be contiguous** in `FONT_OPTIONS`: the gallery starts a new
  heading wherever `genre` changes, so a stray entry heads its genre twice.
- **`value` is persisted in every saved block** — never rename one. Labels
  are free (the `Kufi` key is Janna, a modern sans).
- **Retired fonts stay in the list.** `visibleFonts(fonts, current)` drops
  `retired` entries unless one is the current font, so an old project still
  shows and keeps Layla Diwani while nobody new can pick it. The strip and the
  dialog pass the selected block's font as `current`; the start screen passes
  none, so it never shows a retired face.

## Previews are CSS, not canvas

Every card — gallery, strip, start screen — is a DOM `<span>` with
`font-family` set to the face's `cssFamily` and `dir="rtl"`. The browser
shapes Arabic natively, so twenty-odd previews cost no HarfBuzz shaping and
no Konva stage. The consequence: a card shows the font as the *browser*
shapes it, without the block's letter spacing, kashida, Next Shape alternates
or per-letter edits. That is acceptable for choosing a face; do not "fix" it
by rendering cards through the canvas pipeline.

One grid, two frames: `FontGallery.tsx` is the genre-grouped grid, rendered
by both `FontPickerDialog` and `StartScreen`. The strip is not a
`FontGallery` — it is a single scrolling row with no headings, built in
`FontPanel.tsx` from the same catalogue.

## The start screen (`StartScreen.tsx`, `lib/startScreen.ts`)

A word field (pre-filled with `STARTER_TEXT`, `حرف`) above every font card,
updating live. Picking a card calls `App.tsx`'s `beginFromStart(text, font)`;
Skip just closes it. An empty field falls back to the starter word
(`startingText`).

- **It is an overlay above the mounted editor, not a replacement for it.**
  `App.tsx` renders `{showStart && <StartScreen … />}` as the last child, a
  `position: fixed` layer at `z-index: 3000`. The editor underneath mounts as
  normal, so the one-time hydration effect (reads the quick-save, or calls
  `fitInitialView` on the default block, keyed on the viewport size measured
  from `window.innerWidth`) runs exactly as before. Swapping the editor out
  would run that effect with no stage to measure, and `fitInitialView` would
  frame nothing. `beginFromStart` then calls `fitInitialView` itself on the
  new block.
- **`beginFromStart` does not `pushHistory`.** The start screen precedes the
  first edit; an undo step there would let Ctrl+Z reopen the default `حرف`
  block the user just replaced. It sets blocks, selection and `showStart`
  directly. `start-screen.spec.ts` pins this ("undo after picking a font does
  not bring back the default block").
- **Editor shortcuts are blocked twice.** App's window `keydown` handler
  returns early while `showStart` is true (otherwise Delete or an arrow would
  act on the hidden block, and leave a history entry behind), and the overlay
  root calls `stopPropagation()` on `keydown`, because `CanvasStage`'s own
  window listener for Space-to-pan calls `preventDefault` and would swallow
  Space before it could activate a focused card or Skip. Keep both: they
  guard different listeners.
- **`shouldShowStartScreen` reads only the quick-save key**
  (`STORAGE_KEY`, `calligraphy-layout-v2`): shown when it is absent. Quick
  save is manual, not an autosave, so the screen keeps appearing on every
  fresh load until the user quick-saves once. Opening a project file or a
  cloud project happens from inside the editor, after the screen is gone, so
  no other bypass is needed. Do not add a separate "seen it" flag; it would
  disagree with whether there is work to restore.
- **Nothing from the start screen is persisted.** `showStart` is plain
  `useState`.

## The strip (`FontPanel.tsx`)

The Font panel is first in the `selected` tier and starts open. The strip is
a horizontal row of `.fontStripCard` buttons (`data-testid="font-strip"`),
one per visible font, each showing the selected block's text (or
`SAMPLE_FALLBACK` when empty). A click calls `onChange` unless the card is
already active, so re-picking the current font costs no undo step; a real
pick is one `updateSelectedBlock`, so one undo step.

**The active card is centred by setting the strip's own `scrollLeft`**, from
the two elements' bounding rects, in an effect on the font value. Not
`scrollIntoView`: that also scrolls every scrollable ancestor, so a font
change made while the sidebar is scrolled down (a style applied from
Typography, an undo, selecting another block) would jump the whole sidebar.
`FontGallery` in the dialog does use `scrollIntoView`, which is fine inside a
modal.

The panel also holds `FontPickerField` (the "Font family" button that opens
the full dialog) and font upload — see [custom-fonts.md](custom-fonts.md).

## e2e

- **`gotoApp` in `e2e/harf.ts` clicks Skip.** A fresh Playwright context has
  no quick-save, so every spec would otherwise land on the start screen and
  every click would hit the overlay. It waits for the stage canvas *first*
  (both mount in one React tree, so once the canvas exists the overlay is
  either up or never will be), then clicks Skip if the screen is present and
  waits for it to detach. A spec that wants the start screen loads its own
  way (`gotoFresh` in `start-screen.spec.ts`).
- **`chooseFont` opens the Font panel**, then clicks the button whose
  accessible name starts with "Font family". The strip's own cards are
  addressed by `data-font-key` inside `[data-testid="font-strip"]`.
