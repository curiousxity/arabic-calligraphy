import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "glyph-editing",
  title: "Adjusting marks",
  order: 70,
  keywords: [
    "glyph",
    "letter",
    "diacritic",
    "tashkeel",
    "harakat",
    "marks",
    "hide mark",
  ],
  Body: () => (
    <>
      <p>
        The marks above and below a letter can be adjusted one at a time,
        right on the canvas: you hover the mark and small handles appear. To
        lengthen a letter's own stroke instead, see{" "}
        <strong>Stretch strokes</strong>, which extends the stroke without
        distorting the rest of the letter.
      </p>

      <h4>Adjusting marks</h4>
      <p>
        Hover a diacritic on a selected block and three small handles appear:
        drag one to move the mark up or down, drag another to resize it, and
        click the third to hide that one mark. These only change how the mark
        is <em>drawn</em> — the character stays in your text, which is why{" "}
        <strong>Reset diacritic overrides</strong> can always put things back.
        Hiding a mark does not reflow the letters around it.
      </p>
      <p>
        On a Shape Fill block the marks are behind a <strong>Diacritic tool</strong>{" "}
        tick-box, because a tiled shape can contain hundreds of copies of the
        same mark and showing handles on all of them would bury the artwork.
        For the same reason, adjusting a mark there adjusts{" "}
        <strong>every tiled repetition of it</strong> at once — the adjustment
        belongs to the letter, not to the copy.
      </p>
      <p>
        Marks on a curve cannot be adjusted this way: once a letter is
        rotated to follow a curve, the handles do not appear.
      </p>

      <h4>One thing to know before you start</h4>
      <p>
        These adjustments are attached to a mark's position in the text. If
        you go back and edit wording <em>before</em> a mark you have
        hand-adjusted, the adjustment can land on a neighbouring mark
        instead. Settle the wording first, then fine-tune. Everything here is
        undoable if it does go astray.
      </p>
    </>
  ),
};
