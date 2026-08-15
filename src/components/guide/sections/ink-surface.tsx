import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "ink-surface",
  title: "Gold ink and paper",
  order: 45,
  keywords: [
    "gold",
    "gilding",
    "gilt",
    "leaf",
    "metallic",
    "silver",
    "copper",
    "lapis",
    "gradient",
    "fill",
    "ink",
    "colour",
    "color",
    "paper",
    "parchment",
    "vellum",
    "washi",
    "linen",
    "texture",
    "surface",
    "background",
    "tint",
  ],
  Body: () => (
    <>
      <p>
        Two things decide how a piece <em>feels</em> before anyone reads a
        word of it: what the ink is made of, and what it is written on. The{" "}
        <strong>Fill</strong> controls in <strong>Effects</strong> give a block
        gold, silver or copper instead of a flat colour, and the{" "}
        <strong>Paper surface</strong> row in <strong>Artboard</strong> puts a
        real sheet under the whole page.
      </p>

      <h4>Metallic ink</h4>
      <p>
        Select a block, open <strong>Effects</strong>, and click one of the
        swatches in the <strong>Metallics</strong> row. Gold leaf, aged gold,
        silver and copper are all shading bands rather than single colours —
        that narrow bright stripe running through the middle is what your eye
        reads as metal.
      </p>
      <p>
        The shading spans the <em>whole block</em>, not each letter, so a word
        catches the light once across its width the way a gilded line does.
        Turn the <strong>Gradient angle</strong> to move the light: 90° is the
        usual top-to-bottom gilding, and lower angles read as a raking light
        from the side.
      </p>

      <h4>Mixing your own</h4>
      <p>
        Below the presets, each <strong>stop</strong> is one colour and a
        slider for where it sits along the shading. Two stops give a plain
        fade; three or four let you place a highlight off-centre, which is
        what stops a gradient looking like plastic. Choose{" "}
        <strong>Radial gradient</strong> instead and the shading spreads from
        the middle outwards — good for a medallion or a single centred word.
      </p>
      <p>
        <strong>Flat colour</strong> puts the block back to a single ink; the
        colour itself stays where it always was, under{" "}
        <strong>Typography</strong>.
      </p>

      <h4>Paper</h4>
      <p>
        In the <strong>Artboard</strong> panel, <strong>Paper surface</strong>{" "}
        lays a sheet under everything: parchment, laid paper, fibrous washi or
        a linen weave. <strong>Paper tint</strong> changes what colour that
        sheet is — a deep tint with gold ink is the classic manuscript look, a
        pale one keeps things quiet.
      </p>
      <p>
        The paper is part of the page, so it is exactly as wide as your
        artboard and it moves and zooms with it. It is not a block: nothing
        selects it, and it never gets in the way of what you are writing.
      </p>

      <h4>What happens when you export</h4>
      <ul>
        <li>
          <strong>Transparent background</strong> removes the paper along with
          the page colour — that is the point of the option, so tick it when
          you want the lettering alone.
        </li>
        <li>
          <strong>SVG</strong> keeps metallic ink as a real gradient, so it
          stays sharp at any size and stays editable in a vector app.
        </li>
        <li>
          <strong>PNG, JPEG and PDF</strong> are pictures, so everything —
          ink, paper and all — comes out exactly as you see it.
        </li>
      </ul>

      <h4>Worth knowing</h4>
      <ul>
        <li>
          Metallic ink works on ordinary text, on shaped blocks and on text
          along a curve. On a shaped block the shading spans the whole
          silhouette, so every repeated row shares one sweep of light.
        </li>
        <li>
          An outline colour is separate from the fill and stays a flat colour.
          A thin dark outline under gold is often what makes it read as
          raised.
        </li>
        <li>
          Changing the paper is not part of undo. Setting it back to{" "}
          <strong>None</strong> restores a plain coloured page.
        </li>
      </ul>
    </>
  ),
};
