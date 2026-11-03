# Kufi spiral panels: a word in the centre

Status: draft, 2026-11-03. The user asked for a design for the spiral layout before any building starts.

## Intent

Historical square Kufi panels that carry a full phrase, such as the Shahada, Muhammad with the four caliphs, or the Names of God, are spirals.

- The text starts at a corner and runs clockwise round the edges.
- Every baseline sits on the outside, so the letters' heads point inward.
- Each lap steps one band inward.
- The text ends with its **last word alone in the centre**.

Cairo and Isfahan follow the same rule. The references are local only and never committed: Majeed 2006, Ch. 3 Figs 20–24 and Ch. 4 Figs 27, 28, 30 and 32; Imam 1991, pp. 28–29, plates 9 and 38.

The Cairo Shahada (Maridani) is the model:
- five lines: east, south, west, north;
- then الله alone in the centre, its base towards the south.

The Kufi panel today (`.claude/rules/kufi-panel.md`) already does most of this. Words run clockwise from the bottom right, baselines on the outer edge, ring inside ring. What it lacks is the ending, so the Shahada and short words like محمد never pack: "a band holds one word's pieces, and there are few corner/turn options". This design adds the two missing pieces. It is **an extension of the existing panel, not a new panel kind**. That is my call, made because the existing packer is 90% of a spiral already.

## Goals

1. **A centre word.**
   - The text's last word (or last two) may be placed in the panel's core instead of on a band. It has its own orientation, upright or turned 90°, and is free of the band's 5-cell depth.
   - The core is what is left inside the innermost band.
   - The centre word is centred in the core, with its stretch points used to fill the core's width.
   - Fillers follow the panel's existing rules.
2. **Laps of different depth.**
   - Today every band is `BAND` = 5 cells deep.
   - In the sources the laps are 2–4 cells deep and get shorter inward.
   - A lap's depth may be chosen per ring: 5 by default, with shallower rings allowed when the ring's words have no tall letters.
   - **This is my call and the riskiest part.** If it costs too much, it moves to "later" (see Non-goals).
3. **A start corner.** Bottom right, as today (Isfahan), or top right, running down (Cairo). It is a panel setting, top right being the Cairo default for the Shahada. Both run clockwise.
4. **The Shahada packs**, in some square or rectangle Fit finds, with الله in the centre. This is the acceptance test. Also wanted:
   - محمد رسول الله;
   - Muhammad and the four caliphs, with علي in the centre.

## Non-goals

- **Words turning round a corner mid-word.** The sources do it (fāṭima sits on a corner, and pinwheel words turn their last letter), but the grammar has no bend. Kept as a known gap, as the octagon note already records.
- **The four-way pinwheel** (محمد ×4, علي ×4). It is the next layout after this, a separate design.
- **Diagonal (45°, bannā'ī brick) panels, mirrored seal panels, gaps of half a cell, and strokes wider than gaps.** All are recorded in the reference notes and none is in this design.
- **Any change to the star or octagon panels.**

## Anti-goals

These would make it a failure even if it "works":
- a centre word squashed until it no longer reads;
- a centre word mirrored;
- the centre filled with filler shapes instead of a word;
- the existing panels' layouts changing.

Saved panels must redraw exactly as before. A panel with no centre word packs the same cells as today.

## Constraints

- The grammar is unchanged:
  - stroke = gap = one cell;
  - no 2×2 of ink, and no empty 2×2 inside the panel;
  - letters change only by whole-cell stretch or by authored alternates;
  - the "rise together" shaft rule.
- When space is left, fill it in this order, matching the references:
  1. lengthen an alef or lam shaft;
  2. lengthen a horizontal stroke (a heh widens sideways, never taller);
  3. add a filler bar on a letter's end or baseline;
  4. add a filler square last.
- Do not reuse the removed field names (see kufi-panel.md). New block fields: `panelCentre` (on/off, or the number of words in the centre) and `panelStart` (`"bottomRight" | "topRight"`).
- Branch `claude/kufi-star` or a new branch off it. Never merge or push without asking. Do not name any teacher, calligrapher, studio or product in committed files.

## How it works for the user

- The Kufi panel's sidebar gains two settings:
  - **Centre word: Off / Last word**, defaulting to Off, so existing panels are unchanged;
  - **Start: Bottom right / Top right**.
- Fit gains an attempt: if a text does not pack with Centre off, it tries Last word. This is what lets the Shahada fit without the user knowing about the setting.
- The panel's guide section gets a paragraph and one picture.

## Settled after the builder check

All of these are my calls. Each can be revisited.

1. **The core is reserved first.**
   - Steps:
     1. The centre word's natural size (upright and turned) is reserved at the panel's middle.
     2. Bands are packed round it, ring by ring, until the next ring would cut into the reserved block.
     3. The space between the last ring and the word is closed by stretching the word, then by the fill order above.
   - A size where the gap left cannot be closed within the grammar is rejected, never padded with filler.
2. **Only "Last word" in this design.** "Last two words" is deferred, so the setting is On or Off: `panelCentre: boolean`.
3. **Variable lap depth is searched automatically, and only when Centre is on.** It uses no new letter forms: a lap shallower than 5 may only hold pieces whose authored forms fit that depth. Panels with Centre off keep `BAND` = 5. The test for dropping the feature: if the Shahada packs with Centre on and every lap at 5, variable depth moves to "later".
4. **The Shahada is the target, not a gate.**
   - The fixture is `لا إله إلا الله محمد رسول الله`, with its last الله in the centre.
   - Rectangles are allowed up to the existing Fit range.
   - If it does not pack within the work cap, ship what works, record the measurement in the rules note and report it. Do not tune endlessly.
   - Secondary targets: محمد رسول الله, and the four caliphs ending on علي. The second needs its own text: محمد أبو بكر عمر عثمان علي.
5. **Fit's schedule:**
   - It first runs today's pass unchanged (Centre off, today's size order), so every text that fits today gets the same result.
   - Only if that finds nothing does a second pass run with Centre on, under its own share of the clock (the `BAR_WORK` pattern).
   - A success writes `panelCentre: true` into the block. The layout key and the worker protocol carry the field.
6. **Centre letters are fixed in v1.** The packer may stretch or swap them, but they take no pins, no Move word and no paint edits.
   - The sanitizer drops edits aimed at them.
   - Toggling Centre clears the pins, as a size change does today.
7. **`panelStart`:**
   - Applies to squares and rectangles.
   - `"topRight"` is the same clockwise order started one side later.
   - A missing field means `"bottomRight"`, so old saves redraw unchanged.
   - The Cairo default (top right) applies only to Fit's centre pass.

## Left to the builder

- How the core is measured and how the centre word is oriented. Pick whichever of upright and turned fills the core better, and record the choice in the result.
- How the search budget is shared between band depths and the centre.
- Test fixtures. A useful one is the 9×5 الله from the Cairo Shahada:
  ```
  ###.#.#.#
  #.#.#.#.#
  ###.#.#.#
  ..#.#.#.#
  #.#######
  ```
  The final row's first cell is a dot added to stop an empty 2×2. It is a good check that a centre الله at that size is reachable.
