import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "artboard",
  title: "The page",
  order: 15,
  keywords: [
    "artboard",
    "page",
    "canvas size",
    "paper",
    "a4",
    "a5",
    "a3",
    "letter",
    "instagram",
    "story",
    "square",
    "print",
    "dpi",
    "resolution",
    "margin",
    "orientation",
    "portrait",
    "landscape",
    "millimetres",
    "inches",
    "background colour",
    "page colour",
    "export size",
    "crop",
  ],
  Body: () => (
    <>
      <p>
        By default there is no page. The white area simply grows to hold
        whatever you have drawn, and an export comes out cropped tightly to
        your blocks — so moving a letter changes the size of the picture you
        get out.
      </p>
      <p>
        Open <strong>Artboard</strong> and pick a page size and that stops
        being true. The page becomes a fixed rectangle of paper on the desk,
        and every export is that rectangle, whatever else you do.
      </p>

      <h4>Choosing a size</h4>
      <p>
        The list offers printing sizes (A5, A4, A3, US Letter, all at 300 dpi)
        and screen sizes (a square post, a portrait post, a story, a wide
        header). <strong>Custom size…</strong> keeps the current page but lets
        you type your own width and height. <strong>No artboard
        (freeform)</strong>, the first entry, puts you back to the growing
        canvas.
      </p>
      <p>
        Choosing a page also zooms the view to fit it, so you can see the sheet
        you just picked.
      </p>

      <h4>Units and resolution</h4>
      <p>
        Width and height can be typed in pixels, millimetres, or inches — this
        only changes how the numbers are shown, never the page itself.
        Resolution is what ties the two together: at 300 dpi a 210 mm page is
        2480 pixels across, which is what a printer wants; at 96 dpi the same
        210 mm is only 794 pixels, which is what a screen wants.
      </p>
      <p>
        Changing the resolution keeps the physical size and rescales the
        pixels, so a page set up in millimetres stays the same piece of paper
        when you move it from screen to print quality.
      </p>

      <h4>Margins</h4>
      <p>
        A margin draws a faint dashed rectangle inside the page. Nothing is
        forced to stay within it — it is a guide for the eye, and a line your
        blocks will snap to while you drag them, exactly like the page edges
        and centres do.
      </p>

      <h4>Colour</h4>
      <p>
        The page's colour is set here too, because it belongs to the paper
        rather than to the view. It is the same control that used to sit under
        Background &amp; Grid.
      </p>

      <h4>What you get out</h4>
      <p>
        With a page set, every format — PNG, JPEG, SVG, PDF — comes out at the
        page's own pixel size. The panel tells you what that will be. The
        export scale setting has no effect while a page is set, because the
        page already says how many pixels it is; a PDF also gets its real paper
        size, so an A4 document prints as A4.
      </p>
      <p>
        Blocks may hang over the page edge freely while you work, and nothing
        is ever cut off on the canvas. <strong>Clip exports to the page</strong>
        {" "}decides what happens to that overhang when you export: on, it is
        trimmed at the edge; off, the export grows to include it.
      </p>
    </>
  ),
};
