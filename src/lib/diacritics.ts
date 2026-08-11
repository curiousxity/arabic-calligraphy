import type { HarfBuzzGlyph } from "./harfbuzz";
import { ARABIC_DIACRITIC_RE } from "./harfbuzz";

/**
 * Returns the set of shaped-glyph array indices whose source character is
 * an Arabic diacritic (harakat/tanween/sukun/shadda/etc.). Each glyph's
 * HarfBuzz cluster (`glyph.cl`) is used as a character offset into
 * `shapableText` — the same cluster-to-source-character technique
 * strokeSchema/glyphLookup.ts uses for a different purpose.
 *
 * `shapableText` must be the text actually shaped (see useShapedGlyphs'
 * `shapableText` field), not the block's raw `text` — `glyph.cl` indexes
 * into that string, not the original input.
 */
export function findDiacriticGlyphIndices(
  glyphs: HarfBuzzGlyph[],
  shapableText: string
): Set<number> {
  const result = new Set<number>();
  for (let i = 0; i < glyphs.length; i++) {
    const cluster = glyphs[i].cl ?? 0;
    const ch = shapableText[cluster];
    if (ch != null && ARABIC_DIACRITIC_RE.test(ch)) {
      result.add(i);
    }
  }
  return result;
}
