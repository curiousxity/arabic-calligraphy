import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "dots-and-marks",
  title: "Moving dots and marks",
  order: 38,
  keywords: [
    "dots",
    "nuqta",
    "nuqat",
    "i'jam",
    "hamza",
    "tashkeel",
    "harakat",
    "fatha",
    "damma",
    "kasra",
    "shadda",
    "move a dot",
    "vowel marks",
    "compose",
  ],
  Body: () => (
    <>
      <p>
        A calligrapher places the dots and vowel marks where the composition
        wants them, not where a typeface puts them. Both can be moved here.
      </p>
      <p>
        <strong>Vowel marks.</strong> Select a text block and hover any
        mark: drag the blue handle anywhere. Hold Shift to move it straight
        up or down only. The gold handle resizes it, the red one hides that
        one mark.
      </p>
      <p>
        <strong>Dots, hamza and the kaf stroke.</strong> Tick "Move dots &amp;
        marks" in the block's panel, then hover a dot and drag its purple
        handle anywhere. Double-click the handle to put it back. Dots keep
        their size on purpose: a dot is one touch of the pen. If a font draws
        a dot touching its letter there is nothing separate to move, and a
        few decorative faces that build letters from loose pieces offer no
        dot handles at all.
      </p>
      <p>
        Everything you place survives converting the block to a stacked
        composition, where each dot becomes its own piece riding on its
        letter.
      </p>
    </>
  ),
};
