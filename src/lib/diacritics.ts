import type * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";

// Arabic combining marks: harakat, tanween, sukun, shadda, Quranic
// annotation signs, etc. (U+0610-061A, U+064B-065F, U+0670, U+06D6-06DC,
// U+06DF-06E4, U+06E7-06E8, U+06EA-06ED). Lives here (not in
// `harfbuzz.ts`, which owns Arabic-diacritic *shaping* concerns like
// dropping glyphs a font can't render) specifically so this module has
// no runtime dependency on harfbuzzjs — `harfbuzz.ts` itself does
// `import * as hbjsModule from "harfbuzzjs"` at module scope, which
// throws under Vitest's Node ESM loader the instant that module is
// evaluated unless harfbuzzjs is mocked; keeping this regex (and this
// whole diacritic-detection module) free of that import lets
// diacritics.test.ts shape real text with real harfbuzzjs directly,
// without needing to mock anything. `harfbuzz.ts` re-exports this for
// backward compatibility — it's still the conceptual owner of "what
// counts as an Arabic diacritic" for shaping purposes.
//
// Written with explicit `\uXXXX` escapes rather than literal characters:
// the previous literal-character version of this pattern
// (`/[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ]/`) silently encoded the *wrong* ranges — e.g.
// its first `ؐ-ً` pair actually spanned U+0610 through U+064B, which
// swallows the entire plain-letter block in between (confirmed: it
// matched U+0628 beh, an ordinary letter, not a diacritic) instead of
// the two separate U+0610-061A / U+064B-065F ranges the surrounding
// comment always documented. That went unnoticed because the only
// caller (`stripUnsupportedDiacritics`, below) also requires
// `!font.charToGlyphIndex(ch)`, and every font in this project has a
// glyph for its own letters, so the false-positive match on a letter
// was always masked by the second condition. `findDiacriticGlyphIndices`
// has no such second condition, so the bug is load-bearing here —
// verified against real shaping output that this corrected version
// rejects U+0628 (beh) while still matching U+064E (fatha) and U+0651
// (shadda).
export const ARABIC_DIACRITIC_RE =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED]/;

/**
 * Returns the set of shaped-glyph array indices whose glyph is an Arabic
 * diacritic (harakat/tanween/sukun/shadda/etc.).
 *
 * HarfBuzz's default cluster level (`MONOTONE_GRAPHEMES`) merges a base
 * letter with every combining mark that follows it into one cluster whose
 * value is the *base letter's* character offset — a mark glyph's own
 * `glyph.cl` therefore never points at the mark's own character, so
 * cluster-to-source-character lookup (indexing into `shapableText` with
 * `glyph.cl`) cannot identify marks. Instead this identifies marks by
 * glyph identity plus GPOS attachment shape, verified against real
 * HarfBuzz output for Amiri/FatemiMaqala (see diacritics.test.ts):
 *
 * 1. Primary signal: the glyph's own Unicode codepoint(s) (from
 *    `font.glyphs.get(g.g).unicodes`, opentype.js's cmap-derived glyph
 *    metadata) match `ARABIC_DIACRITIC_RE`. Covers ordinary marks.
 * 2. Fallback signal: some contextual mark variants (e.g. a font's own
 *    fused/ligated mark glyph) have no cmap entry at all
 *    (`unicodes: []`), so they can't be identified directly. Within a
 *    merged cluster (more than one glyph sharing the same `cl`), a base
 *    letter is drawn at its own designed origin (`dx`/`dy` both 0),
 *    while every mark stacked onto it carries a nonzero GPOS
 *    mark-attachment offset (`dx`/`dy`) positioning it relative to the
 *    base — that's true of every base/mark pair observed in real
 *    shaping output, including ones the direct cmap check misses.
 *    A cluster-sharing glyph with a nonzero `dx`/`dy` is therefore
 *    treated as a mark too. A cluster-sharing glyph with `dx === 0 &&
 *    dy === 0` is left alone even without a direct cmap hit, since that
 *    shape (rendered in place, no repositioning) matches every base
 *    letter observed, not marks — this is what keeps the base letter of
 *    a single-diacritic cluster (e.g. "بَ", where beh and fatha share one
 *    cluster) from being misidentified as a diacritic itself.
 *
 * This is a heuristic grounded in real shaping output, not a spec
 * guarantee — an unusual font could in principle break the "marks always
 * carry a nonzero attachment offset" assumption. If that ever surfaces,
 * revisit the fallback signal rather than trusting cluster-sharing alone.
 */
export function findDiacriticGlyphIndices(
  glyphs: HarfBuzzGlyph[],
  font: opentype.Font | null | undefined
): Set<number> {
  const result = new Set<number>();
  if (!font) return result;

  const clusterCounts = new Map<number, number>();
  for (const g of glyphs) {
    const cluster = g.cl ?? 0;
    clusterCounts.set(cluster, (clusterCounts.get(cluster) ?? 0) + 1);
  }

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];

    let glyphObj: ReturnType<opentype.Font["glyphs"]["get"]> | undefined;
    try {
      glyphObj = font.glyphs.get(g.g);
    } catch {
      glyphObj = undefined;
    }

    const unicodes = glyphObj?.unicodes ?? [];
    const isDirectMark = unicodes.some((u) =>
      ARABIC_DIACRITIC_RE.test(String.fromCodePoint(u))
    );
    if (isDirectMark) {
      result.add(i);
      continue;
    }

    const cluster = g.cl ?? 0;
    const sharesCluster = (clusterCounts.get(cluster) ?? 0) > 1;
    const hasAttachmentOffset = (g.dx ?? 0) !== 0 || (g.dy ?? 0) !== 0;
    if (sharesCluster && hasAttachmentOffset) {
      result.add(i);
    }
  }

  return result;
}
