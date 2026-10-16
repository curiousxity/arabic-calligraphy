import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "muthanna",
  title: "Mirrored and radial compositions",
  order: 35,
  keywords: [
    "muthanna",
    "مثنى",
    "mirror",
    "mirrored",
    "reflection",
    "reflect",
    "doubled",
    "symmetry",
    "symmetrical",
    "radial",
    "medallion",
    "shamsa",
    "rosette",
    "circle",
    "repeat",
    "copies",
    "composition",
    "compositions",
    "name",
    "names",
    "اسم",
    "gift",
    "wedding",
  ],
  Body: () => (
    <>
      <p>
        <em>Muthanna</em> — "doubled" — is the classical form where a phrase is
        set beside its own reflection, the two halves reading toward each
        other. A radial composition is its cousin: one motif turned around a
        centre, the way a medallion or <em>shamsa</em> is built.
      </p>
      <p>
        For a mirror, select a block, then press <strong>Add mirror</strong>{" "}
        under <strong>Block Controls &rarr; Add</strong>. For a medallion,
        select a text block and press <strong>Add medallion</strong> beside
        it: copies of the text are turned around it, spaced so they don't
        crowd each other. Either way a new block appears that draws the
        selected block's writing again, reflected or repeated around a circle.
        Change how many copies a medallion has, or its radius, in its own
        Mirror panel. One <strong>Ctrl+Z</strong> undoes either.
      </p>

      <h4>The copy stays alive</h4>
      <p>
        The new block has no words of its own — it borrows them. Change the
        original's text, font, colour or spacing and every copy changes with
        it, immediately. That is the point: you compose once and the symmetry
        follows.
      </p>
      <p>
        Because of this, a mirror block has no Content or Typography panel.
        Its own panel has a <strong>Select source</strong> button that jumps
        you back to the block it is reflecting, so you can edit there.
      </p>

      <h4>Placing it</h4>
      <p>
        A mirror is a block like any other: drag it, rotate it, fade it,
        arrange it in the layer list. Only the <em>writing</em> is borrowed —
        where it sits is yours. Sliding it toward the original until the two
        halves meet is how a muthanna is composed.
      </p>

      <h4>Mode, copies and radius</h4>
      <p>
        <strong>Mode</strong> chooses between reflecting across a vertical
        axis (the usual muthanna), reflecting across a horizontal one, and
        turning copies around a centre.
      </p>
      <p>
        In radial mode, <strong>Copies</strong> sets how many go around the
        circle — from two up to sixteen — and <strong>Radius</strong> how far
        each sits from the centre. A radius of zero stacks them all on the
        centre point, each still turned to its own angle, which makes a tight
        rosette rather than a ring.
      </p>

      <h4>Worth knowing</h4>
      <p>
        A mirror cannot reflect another mirror — pick an ordinary block as the
        source. And deleting the original removes its mirrors with it, since
        they have nothing left to draw; one undo brings back the whole group.
      </p>
    </>
  ),
};
