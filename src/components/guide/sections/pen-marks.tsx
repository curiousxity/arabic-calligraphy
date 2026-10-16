import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "pen-marks",
  title: "Pen marks and frames",
  order: 41,
  keywords: [
    "mark",
    "marks",
    "pen",
    "stroke",
    "dot",
    "nuqta",
    "frame",
    "frames",
    "drop",
    "border",
    "ornament",
    "around text",
  ],
  Body: () => (
    <>
      <p>
        The <strong>Marks</strong> panel holds loose pen pieces — strokes,
        tails, heads, dots and small signs — to place anywhere on the canvas.
        Click one, then click where it should go. It takes the size and colour
        of the block you had selected, so a dot added beside a word matches it.
        Its own panel changes the size, colour, angle and shape, and flips it.
      </p>

      <h4>Frames</h4>
      <p>
        The <strong>Frames</strong> group holds shapes made to go around your
        writing. Select a text block first, then click a frame: the frame
        appears around the text, stretched to fit it with a little room on
        every side, drawn behind it, and grouped with it so the two move
        together. The middle of a frame is open, so your text always shows
        through it and you can still click the text to edit it.
      </p>
      <p>
        A frame stretches wider or taller to suit the words inside it. To
        adjust it afterwards, select the frame and use{" "}
        <strong>Stretch width</strong> and <strong>Stretch height</strong>, or
        its Size. If you change the text a lot, delete the frame and pick it
        again to refit it. With nothing selected, a frame is placed like any
        other mark.
      </p>
    </>
  ),
};
