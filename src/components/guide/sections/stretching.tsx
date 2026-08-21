import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "stretching-strokes",
  title: "Stretching a letter itself",
  order: 36,
  keywords: [
    "stretch",
    "stretching",
    "extend",
    "lengthen",
    "elongate",
    "stroke",
    "stem",
    "letterform",
    "nuqta",
    "dot",
    "proportion",
    "مط",
    "تطويل",
    "نقطة",
  ],
  Body: () => (
    <>
      <p>
        A <strong>kashida</strong> stretches the join <em>between</em> two
        letters. This stretches a straight stroke <em>inside</em> a letter — the
        stem of a ط, the flat bar of a ك — so the letterform itself grows
        longer while keeping its own weight.
      </p>

      <h4>How to use it</h4>
      <p>
        Select a text block, open <strong>Typography</strong>, and tick{" "}
        <strong>Stretch strokes</strong>. Now move the pointer across your
        letters. Where a letter has a straight stroke long enough to work with,
        an orange dot appears on it, with a soft bar showing which way the
        stroke runs. Drag the dot along that bar and the stroke lengthens.
      </p>
      <p>
        Stretches land on <strong>half-nuqta steps</strong> — the nuqta being
        the dot of the pen the font was drawn with, the unit Arabic
        calligraphic proportion has always been written in. Hold{" "}
        <strong>Alt</strong> while dragging for a free amount.
      </p>
      <p>
        Drag a dot back to where it started to remove that stretch. To clear
        every one at once, use <strong>Reset stroke stretches</strong> under the
        same checkbox.
      </p>

      <h4>Not every letter offers one</h4>
      <p>
        This depends entirely on how your chosen font draws its letters, and
        there is nothing wrong when a letter offers no dot. A stroke has to be
        genuinely straight along its length for the stretch to keep the
        letter's weight even — where a font draws that same stroke with a
        slight curve, stretching it would thin or thicken it visibly, so it is
        not offered. Fonts differ a great deal here. If a letter you want will
        not stretch, try the same word in another face.
      </p>

      <h4>Stretching versus kashida</h4>
      <p>
        They do different jobs and work together. A kashida lengthens the
        connector between two letters and works in every font, because it is a
        real character the font itself draws. Stretching works inside a single
        letter, which a kashida can never do, but only where the font's own
        geometry allows it.
      </p>
      <p>
        For filling a line to a set width, reach for kashida and{" "}
        <strong>Fit to width</strong> first. Use stretching when a particular
        letter wants to be longer — the long final stroke that carries the eye
        to the end of a phrase, or a stem lengthened to balance the piece.
      </p>

      <h4>Worth knowing</h4>
      <ul>
        <li>
          Stretching a stroke never moves the letters around it out of line —
          they simply shift along to make room.
        </li>
        <li>
          A stretched stroke that runs at a slight angle grows along its own
          direction, the way a pen travels, so the rest of the letter follows
          it up or down a little. That is intended.
        </li>
        <li>
          Apply stretches after you have settled the text. Editing the words
          moves the letters your stretches were attached to, and a stretch
          whose letter has changed is dropped rather than moved onto the wrong
          one.
        </li>
        <li>Available on plain text blocks — not on shape fill or curved text.</li>
      </ul>
    </>
  ),
};

export default section;
