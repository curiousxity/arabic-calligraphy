import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "ornaments",
  title: "Shapes and frames",
  order: 25,
  keywords: [
    "ornament",
    "shape",
    "frame",
    "border",
    "arch",
    "mihrab",
    "star",
    "khatam",
    "medallion",
    "roundel",
    "crescent",
    "cartouche",
    "boteh",
    "paisley",
    "silhouette",
    "svg",
    "library",
  ],
  Body: () => (
    <>
      <p>
        The app comes with a small library of ready-made shapes — arches,
        stars, medallions, a cartouche, a crescent, a border — so you can
        start a shaped piece without drawing or finding an SVG of your own.
        Open it from the <strong>Shapes &amp; frames</strong> button in{" "}
        <strong>Block Controls</strong>, or from the top of the{" "}
        <strong>Shape Fill</strong> panel when a shaped block is selected.
      </p>

      <h4>Two ways to use one shape</h4>
      <p>
        Every shape in the picker offers the same two actions, and they make
        very different things:
      </p>
      <ul>
        <li>
          <strong>Fill with text</strong> builds a Shape Fill block — your
          phrase repeats row after row until the silhouette is full. This is
          the shape as a <em>container</em>, and everything on the Shape Fill
          panel applies to it afterwards: scale, spacing, row rotation, the
          mark tools.
        </li>
        <li>
          <strong>Insert as frame</strong> drops the shape in as artwork —
          a solid decoration to sit behind or around your writing. It is not a
          text container, so nothing flows into it.
        </li>
      </ul>
      <p>
        Either way the new block follows your cursor until you click the
        canvas to place it, exactly like adding any other block. Press{" "}
        <strong>Esc</strong> to change your mind before you click.
      </p>

      <h4>Frame colour is chosen before you insert</h4>
      <p>
        The colour swatches at the top of the picker set the colour a frame is
        drawn in, and the thumbnails update so you can see it first. That
        choice is <em>baked in</em> at the moment you insert: a frame arrives
        as a picture, so recolouring it afterwards is not possible — delete it
        and insert it again in the colour you want.
      </p>
      <p>
        A shape used with <strong>Fill with text</strong> has no such limit.
        Its colour is your text's colour, and you can change it whenever you
        like from Typography.
      </p>

      <h4>Your own shapes still work</h4>
      <p>
        The library is a starting point, not a replacement. The{" "}
        <strong>Upload SVG</strong> button beside it takes any SVG you have and
        fills it with text the same way.
      </p>
    </>
  ),
};
