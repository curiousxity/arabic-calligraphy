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
        A <strong>Kufi star</strong> is a geometric panel in two layouts.
        Press <strong>Add Kufi star</strong> in Block Controls and click on
        the canvas. The <strong>Octagon</strong> layout is the traditional
        octagon inside a square: the words run round the four sides, the same
        word turned on each side, and their tall strokes are lengthened inward
        until their ends draw an octagon at the centre, which stays open. The{" "}
        <strong>Wedges</strong> layout is a star construction: a star at the
        centre, a ring of wedges around it and corners that close the outer
        shape; choose 4, 5 or 6 points under <strong>Fold</strong> and the
        classic star or the alternative under <strong>Star</strong>. Both take
        a <strong>Size</strong> in squares. The construction lines (the frame
        the words stand on, or the star's bands) can be shown or hidden so
        only the letters remain.
      </p>

      <h4>Putting your words in</h4>
      <p>
        Type your text in <strong>Content</strong>, then press{" "}
        <strong>Find layouts</strong>. The app first offers octagon squares
        with the text once, twice or more along each side, smallest first;
        then it tries each fold, star and size of the wedges layout and
        offers a few ways to share your words between the parts: the whole
        text in every wedge, two words taking turns in neighbouring wedges,
        the words running once round the wedges, a short word in the corners,
        or a word in the centre. Each offer shows a small picture and says plainly
        what does not fit. Click one to use it; one undo takes it back. If you
        change the text afterwards, press Find layouts again.
      </p>

      <h4>What to expect</h4>
      <p>
        Every copy of a word is the same letters turned with its side or
        wedge, never mirrored, and the whole panel is one solid shape, ready
        to cut. In the octagon layout a short phrase fills a side best when
        it is repeated, as the traditional panels do: one «الله» a side makes
        a small tile, three make a square with a clear octagon, four a
        denser one. Only the tall letters reach into the centre, the alef and
        the lam, and a word's tall letters rise together, all of them or none,
        so no single stroke stands up alone beside the rest of its word; a heh
        keeps its box, as in the old panels, and «الله» always reads alef, lam,
        lam and heh. In the wedges layout the letters stand on the outer edge
        of each wedge and their tall strokes are carried up to the slanted
        sides the same way, so a short word such as «الله» fits well, while
        longer words, several words in one wedge and the corners often do not
        fit yet. An offer that does not fit can still be chosen: those parts
        stay as pattern, and the panel says how many did not fit.
      </p>
    </>
  ),
};
