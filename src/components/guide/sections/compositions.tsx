import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "compositions",
  title: "Compositions",
  order: 22,
  keywords: [
    "name",
    "names",
    "اسم",
    "gift",
    "wedding",
    "tattoo",
    "compose",
    "composition",
    "compositions",
    "muthanna",
    "mirror",
    "medallion",
    "shamsa",
    "layout",
  ],
  Body: () => (
    <>
      <p>
        A name or a short phrase often wants more than a single line. Type it
        into a text block, choose its font, then open{" "}
        <strong>Compositions</strong> in the <strong>Content</strong> panel to
        set it into one of two classical arrangements, each previewed with
        your own text in the font the block already has:
      </p>
      <ul>
        <li>
          <strong>Muthanna</strong> (مثنى) — the mirrored pair: the text and
          its reflection, set facing each other and spaced to the width it
          actually draws.
        </li>
        <li>
          <strong>Medallion</strong> (شمسة) — copies turned evenly around a
          centre, with the text itself at the middle. Set how many copies you
          want; the ring opens out as you add them, so they never crowd each
          other.
        </li>
      </ul>

      <h4>Afterwards</h4>
      <p>
        Everything a composition creates is an ordinary block. Drag the two
        halves of a muthanna closer, change the medallion's radius in its own
        panel, or delete any part of it. One <strong>Ctrl+Z</strong> undoes the whole composition at once.
      </p>
      <p>
        A reflection and a medallion stay <em>live</em>: edit the original
        text, font or colour and every copy follows.
      </p>
      <p>
        Compositions are offered for plain text blocks. A shape-filled block
        already scales its text to its silhouette and a curved block to its
        curve, so there is no run width for these layouts to measure.
      </p>
    </>
  ),
};
