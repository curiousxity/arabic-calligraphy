import { extractSvgPaths } from "./svgImport";
import { parseSvgPath, type SvgCmd } from "./svgPath";

/**
 * Codepoint whose font glyph is replaced with a custom SVG symbol at render
 * time (drawn in place of the font outline, scaled down and raised above the
 * baseline like a superscript) instead of a real font glyph. See ShapedText.tsx.
 */
export const OVERRIDE_CODEPOINT = 0xe841;
const OVERRIDE_SVG_URL = "/glyphs/em2.svg";

/** Fraction of the original glyph's em size the override renders at. */
export const OVERRIDE_SCALE = 0.7;
/** Fraction of fontSize the override is raised above the baseline. */
export const OVERRIDE_RAISE = 0.5;

export type OverrideGlyph = {
  commands: SvgCmd[];
  width: number;
  height: number;
};

let overridePromise: Promise<OverrideGlyph | null> | null = null;

/** Fetches and parses the override SVG once; cached for the app's lifetime. */
export function loadOverrideGlyph(): Promise<OverrideGlyph | null> {
  if (!overridePromise) {
    overridePromise = fetch(OVERRIDE_SVG_URL)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load ${OVERRIDE_SVG_URL} (${res.status})`);
        }
        return res.text();
      })
      .then((svgText) => {
        const parsed = extractSvgPaths(svgText, undefined, true);
        if (!parsed) return null;
        return {
          commands: parseSvgPath(parsed.pathData),
          width: parsed.w,
          height: parsed.h,
        };
      })
      .catch((err) => {
        console.error("loadOverrideGlyph failed", err);
        return null;
      });
  }
  return overridePromise;
}

export function isOverrideGlyphChar(unicode: number | undefined): boolean {
  return unicode === OVERRIDE_CODEPOINT;
}
