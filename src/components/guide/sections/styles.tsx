import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "styles",
  title: "Styles and palettes",
  order: 32,
  keywords: [
    "style",
    "styles",
    "preset",
    "palette",
    "palettes",
    "swatch",
    "colour",
    "color",
    "consistent",
    "reuse",
    "match",
    "save look",
    "theme",
  ],
  Body: () => (
    <>
      <p>
        A piece with several blocks reads as one piece only when the blocks
        agree — same face, same ink, same weight of outline. A{" "}
        <strong>style</strong> is that agreement made reusable: build the look
        once on one block, save it under a name, and drop it onto anything
        else. Both live at the top of the <strong>Typography</strong> panel.
      </p>

      <h4>Saving a style</h4>
      <p>
        Select the block whose look you want to keep, type a name in the{" "}
        <strong>Style name</strong> field, and press <strong>Save style</strong>
        . Saving under a name you have already used replaces that style, so
        refining a look is a matter of adjusting the block and saving again.
      </p>
      <p>
        A style carries the <em>look</em> only — font, size, colour and
        opacity, the outline colour and width, and the shadow. It never carries
        the words, the block's place on the page, or anything you have adjusted
        on individual letters. Applying one therefore restyles a block without
        disturbing what it says or where it sits.
      </p>

      <h4>Applying it</h4>
      <p>
        Select the block or blocks you want changed, choose the style from the
        dropdown, and press <strong>Apply</strong>. Applying to a whole
        selection is a single change: one <strong>Undo</strong> puts every
        block back.
      </p>

      <h4>Palettes</h4>
      <p>
        Under the style row is a <strong>palette</strong> — a short strip of
        colours you can click to recolour the selected blocks. Four palettes
        come with the app (Manuscript, Rubrication, Aged page and a plain
        neutral ramp) and are always available.
      </p>
      <p>
        <strong>From canvas</strong> makes a palette out of the colours already
        in use in your piece — every block's ink and outline colour, in the
        order it meets them — which is the quickest way to keep a new block in
        key with what is already there. It saves under the name{" "}
        <em>From canvas</em> and refreshes in place each time you press it.
      </p>

      <h4>Where they live</h4>
      <p>
        Styles and palettes are kept in this browser, not inside a project.
        They follow you from piece to piece on this machine, but they are not
        part of a saved or shared project file, and clearing your browser's
        site data clears them. The colours themselves are of course saved with
        each block as usual.
      </p>
    </>
  ),
};
