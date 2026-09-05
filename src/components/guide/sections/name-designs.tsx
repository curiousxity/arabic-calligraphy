import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "name-designs",
  title: "Designing a name",
  order: 22,
  keywords: [
    "name",
    "names",
    "اسم",
    "gift",
    "wedding",
    "tattoo",
    "style",
    "styles",
    "gallery",
    "browse",
    "compare",
    "compose",
    "composition",
    "muthanna",
    "mirror",
    "medallion",
    "shamsa",
    "frame",
    "framed",
    "cartouche",
    "layout",
  ],
  Body: () => (
    <>
      <p>
        A name is the piece most people want first, and it is worth seeing in
        more than one hand before you commit. Type it into a text block, then
        open <strong>Name designs</strong> in the <strong>Content</strong>{" "}
        panel.
      </p>

      <h4>Step one: the style gallery</h4>
      <p>
        Your own text appears written in every style at once — Thuluth, Diwani,
        Kufi, Naskh, Ruq'ah and the rest, including any font you have uploaded.
        Nothing is committed while you look. Click the one you want, or
        double-click it to go straight on to the layouts.
      </p>
      <p>
        The gallery is a quick preview drawn by the browser, so a style may sit
        very slightly differently once it is on the canvas, where the text is
        shaped properly. Judge the fine detail there.
      </p>

      <h4>Step two: the layout</h4>
      <p>
        Four compositions, each previewed with your own name in the style you
        just chose:
      </p>
      <ul>
        <li>
          <strong>Single</strong> — the name on its own. Choose this when you
          only came for the style.
        </li>
        <li>
          <strong>Muthanna</strong> (مثنى) — the classical mirrored pair: the
          name and its reflection, set facing each other and spaced to the
          width the name actually draws.
        </li>
        <li>
          <strong>Medallion</strong> (شمسة) — copies turned evenly around a
          centre, with the name itself at the middle. Set how many copies you
          want; the ring opens out as you add them, so they never crowd each
          other.
        </li>
        <li>
          <strong>Framed</strong> — the name inside a frame from the shape
          library, sized around it with room to breathe.
        </li>
      </ul>

      <h4>Afterwards</h4>
      <p>
        Everything a design creates is an ordinary block. Drag the two halves
        of a muthanna closer, change the medallion's radius in its own panel,
        resize the frame from its corner handle, or delete any part of it. One{" "}
        <strong>Ctrl+Z</strong> undoes the whole design at once, style included.
      </p>
      <p>
        A reflection and a medallion stay <em>live</em>: edit the original
        name's text or colour and every copy follows. A frame is a picture, so
        its colour is fixed when it is inserted — pick it in the wizard before
        you create the design.
      </p>
      <p>
        Name designs are offered for plain text blocks. A shape-filled block
        already scales its text to its silhouette and a curved block to its
        curve, so there is no run width for these layouts to measure.
      </p>
    </>
  ),
};
