import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "stacked",
  title: "Stacking a word",
  order: 39,
  keywords: ["stack", "tarkib", "diwani", "name", "composition", "join", "tail", "convert", "teardrop"],
  Body: () => (
    <>
      <p>
        A Diwani name design piles its letters up, each one sitting a little above the
        last, with long sweeping strokes between them. To do that here, finish the word
        first — font, letter shapes, kashida — then open <strong>Content</strong> and press{" "}
        <strong>Convert to stacked composition</strong>.
      </p>
      <p>
        That bakes the letters into pieces you can move. Drag a letter and the letters
        after it come along; hold <kbd>Alt</kbd> to move one by itself. Hover a letter for
        its tilt handle. The strokes between letters are redrawn as curves as you go, with
        the pen's own thick-and-thin. Drag the orange handle on a curve to bend it: it
        follows the pointer as far as the curve can go, swinging an S or rounding out a
        U-turn. Double-click it to go back to the natural curve, the one that leaves and
        arrives along the strokes it joins.
      </p>
      <h4>Tails</h4>
      <p>
        Tick <strong>Split strokes</strong> in the Stacked composition panel to see green
        dots on the straight strokes. Click one to cut the stroke there; the end becomes
        its own piece you can sweep out and round, the way the tail of a meem curls under a
        name.
      </p>
      <h4>Shape</h4>
      <p>
        Add a <strong>Teardrop</strong> or <strong>Almond</strong> guide and arrange the
        letters inside it by eye. Guides never print.
      </p>
      <p>
        Converting is one-way: the spelling can't be edited afterwards. Undo brings the
        text block back, or convert a fresh one.
      </p>
    </>
  ),
};
