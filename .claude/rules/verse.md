---
paths:
  - "src/lib/verseLayout*"
  - "src/lib/verseJustify*"
  - "src/components/VerseDialog.tsx"
  - "src/components/sidebar/VersePanel.tsx"
  - "e2e/verse.spec.ts"
---

# Multi-line verse

A verse is a set of **ordinary text blocks** that share a `verse` tag
(`VerseTag` in `types.ts`) and a `groupId`. Every per-letter tool works on a
line unchanged because a line *is* a text block. That is the reason a verse is
not its own block type: a block holding many lines would have needed a line
dimension in every per-letter tool.

- **Layout** is in `verseLayout.ts` and is pure.
  - Stacked lines sit on one column.
  - Bayt puts the first misra' in the right column, and an odd last line is
    centred on its own row.
  - Gaps are multiples of line 0's base font size.
  - The anchor is *derived* from the blocks (`verseAnchor`: line 0's `x`, or
    the midpoint of lines 0 and 1 in bayt) and never stored, so a verse the
    user dragged re-justifies where it now is.
- **Justify** is in `verseJustify.ts`. It is pure, with the measure passed
  in, and runs four steps:
  1. Shrink from `baseFontSize` if the line is too wide.
  2. Run `solveFitToWidth`.
  3. Spread whatever gap is left over `countSpacingBoundaries`, using a
     measured guess plus one secant correction.
  4. Keep only a result measured at or under the target, so a line never
     overshoots.
  Kashida writes go through `kashidaTextPatch`.
- **Undo and async.** `solveVerse` in `App.tsx` measures every line first, each
  with its own font, style and alternates. `justifyVerse` and `createVerse`
  then call `pushHistory()` once and write every patch in one `setBlocks`, by
  id. A line deleted during the solve is skipped.

## Traps

- **The tag stores the user's base spacing and the total Justify wrote**
  (`baseLetterSpacing`/`fittedLetterSpacing`, and the same for word).
  `baseSpacingForLine` returns the stored base while the block still holds the
  fitted total. Otherwise it adopts the block's current value as the user's.
  It never subtracts the fill back off: the slider's reset, a drag to a value,
  and an applied style all write *absolute* values, and subtracting from one
  of those gave a negative base.
- **A copy is not a member.** Paste and Duplicate set `verse: undefined`, as
  they already did for `groupId`. Otherwise the copy would slot into the
  verse on the next Justify.
- **The bayt anchor pairs lines by stored `index`.** After a misra' is
  deleted, pairing by sorted position matched two right-column lines and
  shifted the verse sideways by half a column.
- **History is pushed before the solve's `await`.** Pushing after it
  snapshots the click-time blocks and folds any edit made during the solve
  into the Justify's undo. A line whose text changed during the solve is
  left as the user typed it.
- **New verse… copies the selected line's base, not its fitted values**
  (`baseFontSizeForLine`/`baseSpacingForLine`). A second verse should not
  inherit the first one's shrink and fill.
- **`fittedFontSize` is how a manual size change is detected.** Justify
  writes it together with `fontSize`. If anything else changes a verse line's
  `fontSize`, that size is treated as the user's new base.
- **The fill can push `letterSpacing` past the slider's range.** This is
  allowed: the value renders, and only the slider display clamps.
- **`countSpacingBoundaries` counts on the logical text.** The Allah ligature
  swallows a break, so the count can come out too high. The fill measures the
  result instead of trusting the arithmetic, so this costs a correction pass
  and never an overshoot.
- **Editing a line's text does not re-justify it.** Live justification would
  put tatweel into the text while the user is still typing. The user presses
  Justify. A change to the panel's layout, width or gaps does re-run it, and
  each change is one undo step. The number fields commit when they lose focus
  or on Enter.

## Not supported

- Rows of more than two half-lines.
- Bayt columns of unequal width.
- Shape Fill, Curve or square kufi lines.
- The practice sheet.
- Turning existing blocks into a verse. Only **New verse…** in Block Controls
  makes one.
