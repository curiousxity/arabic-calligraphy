import { shapeText } from "./harfbuzz";
import { inkExtentBox, styledRunWidth, type RunStyle } from "./fitToWidth";

/**
 * How wide a run of text draws on canvas, in block space.
 *
 * The async half of `inkExtentWidth` — it does the shaping, which is why it
 * lives here rather than in `fitToWidth.ts`: that module must stay free of
 * `harfbuzz.ts`, whose static harfbuzzjs import throws under Vitest's Node
 * ESM loader before any test code runs. Keeping the geometry pure and the
 * font loading here is what lets the solver be tested against real fonts.
 *
 * Repeated calls are cheap: `shapeText` caches by `text|fontUrl`, and the
 * fit-to-width solver measures several candidates.
 *
 * `style` matters more than it looks. The glyph outlines are not the whole of
 * what gets drawn — an italic block is sheared, a bold one is stroked, and any
 * block may carry an outline — so measuring outlines alone would let a fit
 * promise a width the block then visibly exceeded. `styledRunWidth` adds those
 * back from constants `ShapedText` shares.
 */
export async function measureShapedWidth(
  text: string,
  fontUrl: string,
  fontSize: number,
  style: RunStyle = {}
): Promise<number> {
  return (await measureShapedRun(text, fontUrl, fontSize, style)).width;
}

/**
 * The same measurement, keeping the height as well.
 *
 * The fit-to-width solver only ever needed a width, but a composition has to
 * space blocks apart in *both* axes — how far a muthanna's reflection sits
 * from its source, how much room a medallion's copies need around a circle.
 * The height comes from the ink box untouched by `styledRunWidth`, which
 * folds the italic shear and the outline into the width alone; callers that
 * want the line height a block is actually drawn on run it through
 * `normalizeRunBox` in `lib/nameDesign.ts`.
 *
 * Repeated calls stay cheap for the same reason `measureShapedWidth`'s do:
 * `shapeText` caches by `text|fontUrl`.
 */
export async function measureShapedRun(
  text: string,
  fontUrl: string,
  fontSize: number,
  style: RunStyle = {}
): Promise<{ width: number; height: number }> {
  const { glyphs, font, unitsPerEm } = await shapeText(text, fontUrl);
  const box = inkExtentBox(glyphs, font, fontSize, unitsPerEm);
  return { width: styledRunWidth(box, fontSize, style), height: box.height };
}
