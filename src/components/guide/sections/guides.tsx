import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "guides",
  title: "Guides: setting text around shapes",
  order: 38,
  keywords: [
    "guide",
    "guides",
    "circle",
    "ellipse",
    "arc",
    "wave",
    "line",
    "pen",
    "roundel",
    "medallion",
    "seal",
    "around",
    "دائرة",
    "ختم",
    "attach",
    "construction",
  ],
  Body: () => (
    <>
      <p>
        A guide is a construction line, the pencilled circle you would rule
        before writing around a medallion. You set words along it, and it never
        appears when you export or print.
      </p>
      <p>
        Choose <strong>Add guide</strong> in <strong>Block Controls</strong>{" "}
        and pick a circle, ellipse, arc, wave, straight line, or a pen curve you
        draw yourself, then click where it should go. Its size is set in the{" "}
        <strong>Guide</strong> panel. To angle a straight line, use{" "}
        <strong>Transform</strong>.
      </p>

      <h4>Putting words on it</h4>
      <ul>
        <li>
          <strong>Add text to guide</strong> in the Guide panel starts a new
          piece of text on it.
        </li>
        <li>
          <strong>Attach to guide</strong> in a text block's{" "}
          <strong>Content</strong> panel moves text you already have onto a
          guide.
        </li>
      </ul>
      <p>
        Several pieces can share one guide, each at its own size. Words keep
        their size until they would run off the guide, and only then become
        smaller to fit.
      </p>

      <h4>Placing the words</h4>
      <p>
        Drag the words to slide them along the guide, or use{" "}
        <strong>Position along guide</strong> for a precise value. Start,
        Centre and End choose which part of the words sits at that point.{" "}
        <strong>Outside</strong> and <strong>Inside</strong> choose the side of
        the line, and <strong>Gap</strong> sets how far from it they sit.
      </p>
      <p>
        <strong>Flip</strong> turns the words around. Words along the bottom of
        a circle still read upright, the way a seal carries one phrase across
        the top and another across the bottom.
      </p>

      <h4>Moving and removing a guide</h4>
      <p>
        Drag the guide, or change its size, and everything on it moves with
        it. Deleting a guide keeps its words where they are, each as an
        ordinary curved text on the same shape.
      </p>
    </>
  ),
};
