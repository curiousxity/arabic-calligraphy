import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "blocks",
  title: "Block types",
  order: 20,
  keywords: [
    "block",
    "text",
    "shape fill",
    "curve",
    "path",
    "image",
    "svg",
    "silhouette",
    "duplicate",
    "delete",
  ],
  Body: () => (
    <>
      <p>
        There are four kinds of block, all added from{" "}
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

      <h4>Shape Fill</h4>
      <p>
        Takes a silhouette — an SVG you upload — and fills it with your text,{" "}
        <em>repeating</em> the phrase in row after row until the shape is full
        and scaling each row to span the shape at that height. Use it when you
        want a shape woven out of many repetitions of a phrase.
      </p>
      <p>
        Its controls are the shape's scale, the spacing between rows, a button
        to space the rows evenly through the shape's height, and a rotation for
        the text inside.
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
