import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "layers",
  title: "Layers and arranging",
  order: 50,
  keywords: [
    "layer",
    "order",
    "stacking",
    "front",
    "back",
    "group",
    "ungroup",
    "lock",
    "rename",
    "select",
    "multi-select",
    "align",
    "distribute",
    "arrange",
    "nudge",
  ],
  Body: () => (
    <>
      <h4>The layer list</h4>
      <p>
        <strong>Layers</strong> lists every block on the canvas, topmost last.
        Clicking a row selects that block; the arrows on the right move it up
        and down the stack, which is what decides who covers whom.
      </p>
      <ul>
        <li>
          <strong>Double-click a layer name</strong> to rename it. Useful once
          a piece has a dozen blocks that all read as similar snippets of
          Arabic.
        </li>
        <li>
          <strong>Double-click a layer row</strong> to zoom the canvas to that
          block.
        </li>
        <li>
          The <strong>lock</strong> icon freezes a block in place so you cannot
          drag it by accident while working on something on top of it.
        </li>
      </ul>

      <h4>Selecting several blocks</h4>
      <p>
        Shift-click or Ctrl-click on the canvas or in the layer list to add
        blocks to the selection. With more than one selected you can move them
        together, align them to each other, and group them.
      </p>

      <h4>Grouping</h4>
      <p>
        <strong>Group selected</strong> links the chosen blocks so that dragging
        any one of them moves them all. The layer list also has a per-row group
        button for linking two blocks a pair at a time, and an ungroup button
        to release one again. Grouping only affects dragging — each block keeps
        its own text, font, and every other setting, and you still edit them
        one at a time.
      </p>

      <h4>Align &amp; Arrange</h4>
      <p>
        Six alignment buttons — left, horizontal centre, right, top, middle,
        bottom — and two distribute buttons that space blocks evenly across or
        down.
      </p>
      <p>
        What these align <em>to</em> depends on your selection, and the panel
        says so at the top: with a single block selected they align it to the
        canvas, and with several selected they align those blocks to each
        other. Distributing needs at least three blocks, since spacing evenly
        between two of them means nothing.
      </p>

      <h4>Nudging</h4>
      <p>
        Arrow keys move the selected block a small step; hold Shift for a
        larger one. Precise placement is usually faster this way than by
        dragging.
      </p>
    </>
  ),
};
