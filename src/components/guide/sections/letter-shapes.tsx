import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "letter-shapes",
  title: "Choosing a letter's shape",
  order: 37,
  keywords: ["alternate", "shape", "next shape", "swash", "stylistic set", "style set", "letterform", "variant"],
  Body: () => (
    <>
      <p>
        Many fonts draw more than one version of some letters — a looped haa,
        a tailed noon, a longer seen for justifying a line. On a text block,
        open <strong>Typography</strong> and tick{" "}
        <strong>Alternate letter shapes</strong>. Letters that have other
        shapes outline when you hover them: click to step to the next shape,
        Shift-click to go back. The sidebar shows every shape for the letter
        you clicked, so you can also pick one directly.
      </p>
      <p>
        What you get depends on the font. Ruqaa, Amiri, Qahiri, Scheherazade,
        Lateef and others have alternates; Thuluth and Diwani do not, and the
        sidebar will say so. <strong>Reset letter shapes</strong> puts every
        letter back.
      </p>
      <p>
        To change every matching letter at once, tick a <strong>style set</strong>{" "}
        under Letter shapes — for example <em>Looped Haa</em> in Ruqaa. Only the
        sets that change something in your text are listed. Style sets also
        work on Shape Fill and Curve blocks. A letter you have picked by hand
        keeps its own shape, and when a set is on, a letter's options include{" "}
        <strong>Without style sets</strong>, to leave just that one out.
      </p>
      <p>
        While the tool is on, pressing an outlined letter always changes its
        shape, even if the pointer slips a little — so to move the block, drag
        it by a part that isn't outlined, or untick the box first.
      </p>
      <p>
        Kashida and <strong>Fit to width</strong> keep your choices on the same
        letters. Editing the wording before a letter you changed can drop its
        shape back to the default, and changing a letter's shape removes any
        stroke stretch on it — so settle the wording, then the shapes, then the
        stretches.
      </p>
    </>
  ),
};
