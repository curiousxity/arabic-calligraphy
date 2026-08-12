import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "getting-started",
  title: "Getting started",
  order: 10,
  keywords: [
    "canvas",
    "artboard",
    "pan",
    "zoom",
    "scroll",
    "pinch",
    "first",
    "new",
    "add text",
    "template",
    "background",
    "grid",
    "rulers",
  ],
  Body: () => (
    <>
      <p>
        HarfCanvas is a workspace for composing Arabic calligraphy. Everything
        you place on the canvas is a <strong>block</strong> — a piece of text, a
        shape filled with text, an image — and the sidebar on the left always
        shows the controls for whatever block is currently selected.
      </p>

      <h4>Your first piece</h4>
      <ol>
        <li>
          Press the <strong>+</strong> button in <strong>Block Controls</strong>{" "}
          to add a text block, or pick something from{" "}
          <strong>Start from a Template</strong> at the top of the sidebar.
        </li>
        <li>
          Type into the right-to-left field in the <strong>Content</strong>{" "}
          panel. If you do not have an Arabic keyboard layout, turn on{" "}
          <strong>Arabic Keyboard</strong> just below it and click the letters.
        </li>
        <li>
          Drag the block around the canvas to place it. Click empty canvas to
          deselect.
        </li>
      </ol>
      <p>
        A template asks you to fill in its wording first, then replaces
        everything currently on the canvas — so save your work before reaching
        for one.
      </p>

      <h4>Moving around the canvas</h4>
      <p>
        The canvas is endless; the coloured area is simply the background
        following your work.
      </p>
      <ul>
        <li>
          <strong>Scroll</strong> — a plain wheel or a two-finger swipe pans.
        </li>
        <li>
          <strong>Zoom</strong> — hold Ctrl (⌘ on a Mac) while scrolling, or
          pinch on a trackpad. Zooming follows the wheel's actual travel, so a
          gentle pinch nudges and a fast flick moves further.
        </li>
        <li>
          <strong>Drag to pan</strong> — hold Space and drag, drag with the
          middle mouse button, or switch on the hand button in the toolbar at
          the bottom right of the canvas.
        </li>
        <li>
          That toolbar also has zoom in and out, a percentage you can click to
          return to 100%, and a frame button that fits everything back into
          view when you get lost.
        </li>
      </ul>

      <h4>Setting the scene</h4>
      <p>
        <strong>Background &amp; Grid</strong> sets the background colour and
        turns on gridlines, snapping to those gridlines, and rulers. Clicking a
        ruler drops a guide line that blocks snap to; a button appears there to
        clear the guides again once you have some.
      </p>

      <h4>Finding controls</h4>
      <p>
        The sidebar is grouped in three bands. The top band affects the whole
        document, the middle band the canvas and its layers, and the bottom
        band only the block you have selected — which is why most of the
        sidebar disappears when nothing is selected. Panels collapse and expand
        by clicking their titles.
      </p>
    </>
  ),
};
