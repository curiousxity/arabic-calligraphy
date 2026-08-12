import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "blocks",
  title: "Block types",
  order: 20,
  keywords: [
    "block",
    "text",
    "shape fill",
    "shape warp",
    "curve",
    "path",
    "image",
    "svg",
    "silhouette",
    "trace",
    "logo",
    "photo",
    "duplicate",
    "delete",
  ],
  Body: () => (
    <>
      <p>
        There are five kinds of block, all added from{" "}
        <strong>Block Controls</strong>. Every one of them can be dragged,
        rotated, coloured, and given an outline or shadow; what differs is how
        the text is laid out.
      </p>

      <h4>Text</h4>
      <p>
        A plain line or paragraph of shaped Arabic. This is the block that
        supports the most fine-tuning — the per-letter tools and the on-canvas
        mark handles are all built around it.
      </p>

      <h4>Shape Fill and Shape Warp</h4>
      <p>
        These two both take a silhouette — an uploaded SVG, or for Shape Warp a
        traced image — and put your text inside it. They are constantly
        confused for each other, and the difference is simple:
      </p>
      <ul>
        <li>
          <strong>Shape Fill</strong> <em>repeats</em> your text in row after
          row until the silhouette is full, scaling each row to span the shape
          at that height. Use it when you want a shape woven out of many
          repetitions of a phrase.
        </li>
        <li>
          <strong>Shape Warp</strong> draws your text <em>once</em> and bends
          it so it fills the silhouette. Use it when you want one phrase to
          take the shape.
        </li>
      </ul>
      <p>
        A Shape Fill block has controls for the shape's scale, the spacing
        between rows, a button to space the rows evenly through the shape's
        height, and a rotation for the text inside. A Shape Warp block instead
        has a warp mode, inner padding, and warp strength — try the modes, they
        bend the text in genuinely different ways.
      </p>
      <p>
        <strong>Trace image</strong> is a Shape Warp option only. It takes a
        photo or a logo, reduces it to black and white at a threshold you
        choose in a preview dialog, and uses the resulting silhouette as the
        shape. If the trace comes out as one solid block, move the threshold
        slider until the outline separates from the background.
      </p>

      <h4>Curve (text on a path)</h4>
      <p>
        Text flowing along a line you draw. Pick <strong>Arc</strong>,{" "}
        <strong>Wave</strong>, or <strong>Circle</strong> to start, upload an
        SVG path, or press <strong>Edit Curve</strong> and shape it by hand on
        the canvas — click empty canvas to add a point, drag a point or its
        handle to bend the line, right-click a point to remove it. Press{" "}
        <strong>Done Editing Curve</strong> when you are finished.
      </p>
      <p>
        Two things surprise people here. The text always stretches to span the
        whole curve, so there is no font-size slider for these blocks — the
        length of the curve <em>is</em> the size control, and a longer curve
        means larger letters. And if the text runs the wrong way round your
        curve, tick <strong>Flip direction</strong>.{" "}
        <strong>Baseline offset</strong> lifts the letters off the line or
        drops them below it.
      </p>

      <h4>Image</h4>
      <p>
        A picture placed on the canvas — a background texture, a seal, a
        reference to trace over. It has scale, opacity, and rotation, and a
        small handle on its corner when selected for resizing by hand.
      </p>

      <h4>Working with blocks</h4>
      <p>
        Duplicate and delete live in <strong>Block Controls</strong>, alongside
        undo and redo. Double-clicking a block on the canvas jumps straight to
        its text field. Selected blocks deliberately have no outline drawn
        around them, so what you see on the canvas is what you will export.
      </p>
    </>
  ),
};
