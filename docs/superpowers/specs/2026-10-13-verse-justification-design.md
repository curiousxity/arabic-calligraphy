# Multi-line verse with per-line justification

Date: 2026-10-13. Status: design, awaiting review.

The second of three Kelk-gap projects, in build order: spacing (shipped),
multi-line verse, shaped guides. Each gets its own spec.

## Goal

Let a calligrapher set poetry: several lines, each justified to one common
width with kashida and spacing, laid out either as stacked lines or as bayt
couplets (two misra' side by side, couplets stacked).

**Success:** a three-line verse in Amiri, after Justify, has every line's ink
width equal to the target within 1 px and none wider than it; switching to
bayt pairs the lines with the first misra' on the right; widening the target
grows a line that had been shrunk back towards its original size; pressing
Justify twice gives the same result as pressing it once; one undo restores
the state from before Justify.

**What the user said:**
- Support both layouts, stacked and bayt.
- Keep one ordinary text block per line, so every per-letter tool still works on it.
- The width defaults to the widest line and can be overridden. A line that is still too wide shrinks to fit.
- A short line gets kashida first, then spacing for what is left.

**Assumed, open to correction:**
- Justify is a button and does not run automatically while you type.
- In bayt, the two columns are the same width.
- Gaps are in units of font size.
- The verse is anchored at its first line.

## Approach

A verse is a group of ordinary text blocks. Each block carries a small
`verse` tag, and the blocks share a `groupId` so they drag together. Two
other approaches were rejected:

- **A new block type that holds every line.** Every per-letter tool would
  need a line dimension, which the user ruled out.
- **Verse settings in document-level state.** This is a new kind of state for
  save, load and undo to handle, and it gains little.

## Data

`TextBlock` gains one optional field, `verse`:

```ts
verse?: {
  id: number;            // shared by every line of one verse
  index: number;         // reading order, 0-based
  layout: "stacked" | "bayt";
  width?: number;        // px; absent = widest line
  lineGap: number;       // row pitch, × font size (default 1.6)
  columnGap: number;     // bayt gutter, × font size (default 1.0)
  baseFontSize: number;  // size before any shrink
  addedLetter: number;   // spacing Justify added, removed before the next run
  addedWord: number;
}
```

- The verse-wide settings are copied onto every line. The panel reads them
  from line 0 and writes all the lines together.
- There is no save-format bump. Old saves have no `verse` field and load
  unchanged.
- `verse` is not added to `blockRenderProps`, because a mirror does not need it.
- `stripRemovedFields` is not involved.

**Deleting a line.** Deleting a line leaves the others valid, because they
are re-indexed by sort order on the next Justify. A verse that drops to one
line keeps its tag, which is harmless. `dissolveSingletonGroups` handles the
group as usual.

## Creating a verse

The Verse entry in the document tier has a textarea that takes one line of
poem per line of text, a layout choice, and a Create button.

- `createVerse` makes one text block per non-empty line.
- Each new block copies the selected text block's style fields
  (`STYLE_FIELDS`), or uses the defaults if nothing is selected.
- The new blocks share a new `groupId` and a new `verse.id`.
- Creating the verse runs Justify straight away. Creation and Justify are a
  single undo step.

## Layout (`src/lib/verseLayout.ts`, pure)

```ts
layoutVerse(lines: { index; fontSize; width }[], settings, anchor: { x; y })
  → { index; x; y }[]
```

- **Stacked:** row `i` is centred on `anchor.x`, at
  `y = anchor.y + i × lineGap × fontSize₀`, where `fontSize₀` is line 0's
  `baseFontSize`.
- **Bayt:** couplet `k` holds line `2k` and line `2k+1`.
  - Line `2k` is the first misra'. It sits in the right column, centred at
    `anchor.x + (W + gutter)/2`.
  - Line `2k+1` sits in the left column, centred at `anchor.x − (W + gutter)/2`.
  - `W` is the target width and the gutter is `columnGap × fontSize₀`.
  - An odd last line is centred on its own row.
- **The anchor** is the column centre and the first row's position. The
  first time, it comes from line 0's current position. Laying the verse out
  again never moves it, so the verse doesn't jump.
- The lines' `align` is set to `"center"` so their positions mean what the
  layout says.
- No `./harfbuzz` import.

## Justification (`src/lib/verseJustify.ts`, pure, measurement injected)

```ts
justifyLine({ text, baseFontSize, userSpacing, target,
              measure: (text, fontSize, spacing) => Promise<number> })
  → { text, edits, fontSize, addedLetter, addedWord, reason }
```

**The target** is `verse.width` if it is set. Otherwise it is the widest
line's ink width, measured at `baseFontSize` with tatweel removed and user
spacing only. In bayt, every half-line counts as a line.

**For each line**, the spacing the last Justify added (`addedLetter` and
`addedWord`) is taken off first, so the user's own spacing is the base.
Then:

1. **Shrink.** If the line is wider than the target at `baseFontSize` with
   tatweel removed, set
   `fontSize = baseFontSize × target / width`. Check it by measuring and
   step down until it fits. Otherwise `fontSize = baseFontSize`. This lets a
   shrunk line grow back when the target widens.
2. **Kashida.** Run `solveFitToWidth` at that font size. Its counts are
   absolute, so tatweel from an earlier run is removed or replaced. It never
   overshoots.
3. **Spacing fill.** If the line is still more than 1 px short after
   kashida (kashida capped, or no slots):
   - `n = countSpacingBoundaries(text)` (piece breaks plus word gaps).
   - `extra = (target − width) / n / fontSize`.
   - Both added amounts are set to `extra`.
   - Measure again. If the line overshoots, scale `extra` by
     `(target − width₀) / (width₁ − width₀)` and check once more. If it
     still overshoots, fall back to no fill, so the line never overshoots.
   - If `n = 0`, the line is left short and reported.
4. A line that ends up within 1 px of the target counts as justified.

## `spacing.ts`

`countSpacingBoundaries(text) → { pieceBreaks, wordGaps }` uses the same
boundary rules as `applySpacing`, so the count matches where the spacing
actually lands.

## App wiring

`justifyVerse(verseId, overrides?)`:

- Collect the verse's lines, sorted by `verse.index`, and capture each one's
  id and inputs.
- For every line, resolve the font with `resolveFontUrl`. Measure through
  `measureShapedWidth` with `runStyleForBlock(block, cutWidthForBlock(block))`
  and that line's alternates and style sets.
- Solve all the lines with `await`. Then call `pushHistory()` once and make
  one `setBlocks` call that writes each line's:
  - text, through `kashidaTextPatch`;
  - `fontSize`, `letterSpacing`, `wordSpacing` and `x`/`y`;
  - `align: "center"`;
  - the updated `verse` tag.
- A line deleted during the solve is skipped. A guard flag
  (`isJustifyingVerse`) blocks re-entry, as `isFittingWidth` does.
- The status line reads:
  `"N lines justified to W px · k shrunk · m couldn't reach full width"`.

Panel setting changes (layout, width, line gap, column gap) call
`justifyVerse` with the new settings. Each is one undo step. A slider
commits on release, not on every frame.

## UI

`VersePanel` sits in the selected tier and shows only when the selected
block has a `verse` tag. It contains:

- a layout toggle (Stacked / Bayt);
- a Width number field, empty meaning "widest line", with a reset;
- Line gap and Column gap RangeRows (column gap only in bayt);
- a **Justify** button.

The document tier gets the Verse creation entry.

## Out of scope (v1)

- Rows with more than two half-lines.
- Unequal bayt columns.
- Justifying Shape Fill, Curve or square kufi blocks.
- Automatic re-justification while you type.
- Practice sheet.
- Converting existing loose blocks into a verse. Only Create makes one.

## Testing

- **`verseLayout.test.ts`:**
  - stacked rows and pitch;
  - bayt pairing, with the first misra' on the right;
  - an odd last line centred;
  - the anchor is stable when the verse is laid out again.
- **`verseJustify.test.ts`**, with a fake linear measure plus one real
  harfbuzz and Amiri case (the `shapeReal` pattern):
  - a short line gets kashida only;
  - a line where kashida is capped gets the spacing fill;
  - the line never overshoots;
  - a line that is too wide shrinks, and grows back when the target widens;
  - spacing added by one run is removed by the next, so it never accumulates;
  - running twice gives the same result as running once;
  - a line with no boundaries is reported short.
- **`spacing.test.ts`:** `countSpacingBoundaries` counts agree with where
  `applySpacing` adds advance.
- **e2e:**
  - Create a three-line verse. The line rects should be equal in width to
    within a tolerance.
  - Switch to bayt and check the line positions from the `__HARF__` bridge.
  - One undo restores the state from before Justify.

## Docs

- `.claude/rules/verse.md`, with `paths:` covering `verseLayout*`,
  `verseJustify*` and `VersePanel*`.
- One index line in `CLAUDE.md`.
- `guide/sections/verse.tsx`.
- A `PROGRESS.md` entry.
- A note in `fit-to-width.md` that Justify reuses its solver.
