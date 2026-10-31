# Square Kufi panel: making most texts pack

Follows `2026-10-31-kufi-panel-usability-design.md`. The user asked for the
next step on the Kufi panel and skipped the questions; every call below is
mine unless marked as theirs.

## Why

Today only three texts pack: الله (9×9), الحمد لله (13×13) and Al-Baqarah
2:286 (21×21), each at exactly one size. A probe of six more common texts
(every box from 7 to 29 cells a side, with width and height up to 3 apart,
work-bounded with no clock) found:

| text | packs at | closest miss |
|---|---|---|
| الله أكبر | 11×13, 11×14, 15×12, 15×13 | — |
| سبحان الله | none | 13×12: 2 holes, 2 frame breaks |
| بسم الله الرحمن الرحيم | none | 17×19: 2 holes, 2 frame breaks |
| قل هو الله أحد | none | 15×16: 4 holes, 9 frame breaks |
| لا إله إلا الله محمد رسول الله | none | 23×26: 40 holes, 19 frame breaks |
| محمد | none | 15×12: 53 holes, 28 frame breaks |

Three different problems, then:

1. **Rectangles.** Some texts pack, but only in a box that is not square,
   and Fit and the size suggestions try squares only, so the panel says the
   text does not fit.
2. **Near misses.** Every letter is placed and two to four windows stay
   open, always at the end of the reading order: the last line's tail,
   where the text ran out. The only filler, a lone square, may not go there
   (it must stand two cells from any other square and beside a letter), so
   a run of paper at the end of a line cannot be closed.
3. **Far misses.** The text ends part-way round an inner ring and leaves a
   large empty patch (the Shahada at every size; محمد, which is too short
   to go round even one frame, since a word never bends round a corner).

## Goals, in build order

1. **Fit and suggestions try rectangles of any proportion** *(the user: "the
   rectangle can be any length")*. Fit walks the box heights and, for each,
   the widths that give about the text's area, squares first, then the
   least elongated, within the current `FIT_BUDGET_MS`; suggestions after
   a failure may be rectangles too. Test: الله أكبر packs via Fit.
2. **Two lines** *(the user: "you can have two lines as well"; how, my
   call)*. A second layout beside the ring: the text on two horizontal
   lines, one band above the other with a one-cell gap, both upright and
   read right to left, the top line first. The text breaks between words
   (a word stays whole on its line). Every other rule holds: bands
   interlock, strokes stretch to fill a line, dots, fillers, no holes, a
   closed frame. The panel block stores its layout (`panelLayout`, absent
   = ring, so old saves are unchanged); Fit tries both layouts and keeps
   the first that packs in its size order, rings first at equal size; the
   sidebar shows Ring / Two lines so the user can switch. Test: a long
   text packs as two lines in a wide box.
3. **A closer for near misses** *(my call: filler bars)*. A **filler bar**
   is a straight run of ink one cell wide, at least two cells long, lying
   along a line (parallel to its baseline), touching letters only at its
   ends. It reads as an extended baseline, the way a tatweel does, never as
   a letter: a bar across the line could read as alef or lam and is not
   allowed. Bars go where the reading order has ended (a line's tail, and
   the gap a word leaves before the next corner). They rank after
   lengthened strokes and before lone squares: lengthening a real stroke is
   still preferred, and one bar is preferred over several scattered
   squares. Test: سبحان الله, Bismillah and قل هو الله أحد each pack at
   some size, through Fit.
4. **The Shahada** *(spike first; two lines is now a third candidate)*. A throwaway spike tries the two likely
   shapes for the leftover patch and keeps whichever packs the Shahada with
   fewer filler bars and squares:
   - **a core word**: the last word (or words) moves into the core, inside
     the last full ring, as a block of its own lines, the way many panels
     set الله or محمد in the middle;
   - **deeper inner bands**: an inner ring's band may be deeper than 5
     cells (tall strokes stretch to fill it), so the rings absorb the
     spare area instead of leaving it as a patch.
   - **two lines** in a wide box, once goal 2 is built.
   The spike's finding comes back to the user with pictures before it is
   built; this spec is amended then.

## Non-goals

- Repeating a short text round the frame (محمد four times, turned): it
  changes the text, so it waits for the user's say-so.
- Words bending round a corner.
- Layouts other than the ring and two lines (one line, three or more
  lines, other ring directions), flowing Kufi, touch tools.
- Re-route rearranging the rest of the panel (still the user's decision).

## Anti-goals (it fails even if it works)

- A filler bar that reads as a letter, or as a stroke of the letter it
  touches (an alef too long, a lam with a tail).
- A text that packs today packing differently: الله 9×9, الحمد لله 13×13 and
  Baqarah 21×21 keep their panels exactly (filler bars are tried only when
  the panel does not pack without them).
- Fit getting slower: it keeps its current budget; rectangles are tried
  within it.
- Breaking the dot rules or filler order (bars are a new rung, after
  lengthening, before squares).

## Constraints

- Everything in `.claude/rules/kufi-panel.md`: pure deterministic packer,
  work budget plus clock safety net, edits keyed by unit index, export as
  one outline.
- Additive result fields only: `quality` gains `bars`. The ranking becomes
  packed, then fewest filler squares, then fewest bars, then least
  shortening, then least lengthening. So a panel closed by one bar beats one
  needing a square, and any lengthening beats a bar (lengthening needs no
  bar at all).
- Unit tests that assert a layout use the clock override.
- Repo rules: no names of teachers, calligraphers, studios or products;
  reference images stay local; never merge to main.

## Left to the builder

- The exact bar placement search (after the beam, as a closing pass, like
  the lone squares; or as moves inside the beam), from measurement.
- Fit's size order and how many rectangles it reaches within the budget.
- How bars are drawn and hit-tested on the canvas (they are not letters:
  no selection, no handles; Paint can erase their cells as it does a
  square's).
