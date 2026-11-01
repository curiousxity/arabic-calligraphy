import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "kufi-star",
  title: "Kufi star panel",
  order: 42,
  keywords: [
    "kufi",
    "square kufi",
    "kufic",
    "star",
    "rosette",
    "radial",
    "wedge",
    "corner",
    "centre",
    "center",
    "geometric",
    "construction lines",
    "find layouts",
    "laser",
    "cut",
    "نجمة",
    "كوفي",
    "كوفي مربع",
  ],
  Body: () => (
    <>
      <p>
        A <strong>Kufi star</strong> is a geometric panel: a star at the
        centre, a ring of wedges around it and corners that close the outer
        shape. Press <strong>Add Kufi star</strong> in Block Controls and click
        on the canvas. Choose 4, 5 or 6 points under <strong>Fold</strong>, the
        classic star or the alternative under <strong>Star</strong>, and the
        panel's <strong>Size</strong> in squares. The construction lines can be
        shown as bands or hidden so only the letters remain.
      </p>

      <h4>Putting your words in</h4>
      <p>
        Type your text in <strong>Content</strong>, then press{" "}
        <strong>Find layouts</strong>. The app tries each fold, star and size
        and offers a few ways to share your words between the parts: the whole
        text in every wedge, two words taking turns in neighbouring wedges, the
        words running once round the wedges, a short word in the corners, or a
        word in the centre. Each offer shows a small picture and says plainly
        what does not fit. Click one to use it; one undo takes it back. If you
        change the text afterwards, press Find layouts again.
      </p>

      <h4>What to expect</h4>
      <p>
        Every copy of a word is the same letters turned with its wedge, never
        mirrored, and the whole panel is one solid shape, ready to cut. For
        now the letters stand only on the outer edge of each wedge, so a short
        word such as «الله» fits well, while longer words and the corners
        often do not fit yet. An offer that does not fit can still be chosen:
        those parts stay as pattern, and the panel says how many did not fit.
      </p>
    </>
  ),
};
