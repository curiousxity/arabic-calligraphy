import { shapeText } from "./harfbuzz";
import { inkExtentWidth } from "./fitToWidth";

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
 * fit-to-width solver measures the same candidates more than once.
 */
export async function measureShapedWidth(
  text: string,
  fontUrl: string,
  fontSize: number
): Promise<number> {
  const { glyphs, font, unitsPerEm } = await shapeText(text, fontUrl);
  return inkExtentWidth(glyphs, font, fontSize, unitsPerEm);
}
