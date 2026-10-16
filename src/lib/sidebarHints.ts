/**
 * Hover descriptions for the sidebar, keyed by the visible label of a panel
 * header or a form row. `CollapsibleSection`, `RangeRow`, `CheckboxRow`,
 * `SelectRow` and `ColorRow` look their label up here, so a row gets its
 * tooltip without its call site doing anything; a row whose label is not
 * listed simply has none. A call site can still pass its own `hint`, which
 * wins.
 *
 * Written for calligraphers: say what the control does to the artwork, not
 * how it is built. Renaming a label means moving its entry here too.
 */
export const SIDEBAR_HINTS: Record<string, string> = {
  // ---- Panel headers ----
  "Start from a Template": "Begin from a ready-made layout, then type your own words into it.",
  "Artboard & Grid":
    "The page: its size, colour and paper texture, plus gridlines, snapping and rulers to help you line things up.",
  "Save & Export": "Save your project to come back to it, or download the artwork as PNG, JPEG, SVG or PDF.",
  Layers: "Every block on the canvas, top to bottom. Reorder, hide, lock, rename or group them here.",
  "Align & Arrange": "Line up the selected blocks with each other, or space three or more evenly.",
  Font: "Choose the typeface for the selected block. Each card shows your own text in that font.",
  Content: "The words in the selected block, plus buttons for marks, symbols and letters your keyboard may not have.",
  Typography: "Size, colour, alignment and spacing of the selected block's letters, plus tools for reshaping them.",
  Effects: "Outline, shadow and colour fills (gradients and textures) for the selected block.",
  Verse: "This block is one line of a verse. Make all its lines the same width here.",
  Mirror: "Repeat another block as a mirror image or in a circle. It updates when the original changes.",
  "Shape Fill": "Repeats the text in rows to fill an uploaded shape.",
  Curve: "Text that follows a curved line. Change the curve's shape and how the text sits on it.",
  Guide: "A helper shape for laying out text along it. Guides never appear in exports.",
  "Stacked composition": "Letters baked into pieces you can drag and stack on top of each other.",
  Shortcuts: "Keyboard and mouse shortcuts.",

  // ---- Artboard & Grid ----
  "Page size": "Pick a paper or screen size, or choose freeform to work without a page.",
  Units: "Show the page size in pixels, millimetres or inches.",
  Resolution: "Dots per inch. Use 300 dpi for printing and 96 dpi for screens.",
  Margin: "An empty border kept around the inside edge of the page.",
  "Clip exports to the page": "Cut off anything outside the page when exporting.",
  "Page color": "The colour of the page behind your artwork.",
  "Background color": "The colour behind your artwork.",
  "Paper surface": "Give the page a paper texture instead of a flat colour.",
  "Paper tint": "The colour of the paper texture.",
  "Show gridlines": "Show a grid on the canvas to help you place things. It never appears in exports.",
  "Snap to gridlines": "Dragged blocks jump to the nearest gridline.",
  "Snap to block edges": "Dragged blocks line up with the edges and centres of other blocks.",
  "Show rulers (click a ruler to drop a snap guide)":
    "Show rulers along the canvas edges. Click a ruler to drop a guide line that blocks snap to.",

  // ---- Save & Export ----
  "Transparent background (PNG/SVG)": "Leave out the background colour, so the export can sit on top of anything.",

  // ---- Typography ----
  "Font size": "How big the letters are.",
  "Text color": "The colour of the letters.",
  Alignment: "Line up multi-line text to the right, centre or left.",
  "Line height": "The space between lines of text.",
  "Letter spacing": "Extra space between letter groups. Joined letters stay joined.",
  "Word spacing": "Extra space between words.",
  "Kashida join": "Choose which joint between two letters to stretch with a kashida (tatweel).",
  "Alternate letter shapes": "Click a letter on the canvas to try the other shapes this font has for it.",
  "Stretch strokes": "Lengthen a straight stroke of a letter by dragging along it.",
  "Move dots & marks": "Drag a letter's dots, hamza or kaf stroke to a new place.",
  Opacity: "How see-through the block is. Lower values let what is behind show through.",
  Rotation: "Turn the block around its centre.",

  // ---- Effects ----
  "Outline color": "The colour of the line drawn around each letter.",
  "Outline width": "How thick the line around each letter is. 0 means no outline.",
  "Shadow color": "The colour of the shadow.",
  "Shadow X": "Move the shadow left or right.",
  "Shadow Y": "Move the shadow up or down.",
  "Shadow blur": "How soft the shadow's edge is.",
  "Shadow opacity": "How dark the shadow is.",
  Fill: "Fill the letters with a flat colour, a gradient or a texture.",
  "Gradient angle": "The direction the gradient runs across the letters.",

  // ---- Shape Fill ----
  "Diacritic tool": "Hover a tashkeel mark on the canvas to move, resize or hide it.",
  "Shape scale": "How big the shape is.",
  "Scale X": "Stretch or squeeze the text sideways.",
  "Scale Y": "Stretch or squeeze the text up and down.",
  "Text spacing": "The space between the rows of text inside the shape.",
  "Text rotation": "Turn the rows of text inside the shape.",

  // ---- Curve & guides ----
  Preset: "Start the curve from a ready-made shape.",
  "Baseline offset": "Lift the text above the curve, or sink it below.",
  "Attach to guide": "Make this text follow one of your guide shapes.",
  "Position along guide": "Slide the text along the guide.",
  Gap: "The distance between the text and the guide.",
  Flip: "Put the text on the other side of the guide.",

  // ---- Mark (frames) ----
  "Stretch width": "Make the frame wider or narrower without changing its height.",
  "Stretch height": "Make the frame taller or shorter without changing its width.",

  // ---- Mirror ----
  Mode: "Mirror across a line, or repeat copies around a centre.",
  Copies: "How many copies go around the circle.",
  Radius: "How far the copies sit from the centre.",
};

/** The hint for a label, if it has one. Non-string labels never do. */
export function sidebarHint(label: unknown): string | undefined {
  return typeof label === "string" ? SIDEBAR_HINTS[label] : undefined;
}
