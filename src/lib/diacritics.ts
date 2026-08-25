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
 * `glyph.cl`) cannot identify marks one for one. What a cluster's source
 * span *can* say is **how many** marks were typed there, and that count
 * is what this function spends. Verified against real HarfBuzz output for
 * seven fonts (see diacritics.test.ts):
 *
 * 1. Primary signal, unconditional: the glyph's own Unicode codepoint(s)
 *    (from `font.glyphs.get(g.g).unicodes`, opentype.js's cmap-derived
 *    glyph metadata) match `ARABIC_DIACRITIC_RE`. Covers ordinary marks
 *    in fonts that encode them at their real codepoints.
 * 2. Secondary signals, gated by the cluster's remaining allowance: a
 *    glyph sharing its cluster with another and looking like a mark,
 *    meaning either a **zero advance** (a mark takes no width of its own)
 *    or a **nonzero GPOS attachment offset** (`dx`/`dy`, positioning it
 *    relative to its base). Zero-advance candidates are taken first — a
 *    glyph that carries the run's advance is a base letter by definition,
 *    so it is the last thing that should be read as a mark.
 *
 * The allowance is the number of characters matching
 * `ARABIC_DIACRITIC_RE` in the cluster's own source span — from its
 * offset to the next cluster's — minus whatever the primary signal
 * already took there. It exists because both secondary signals also
 * describe things that are not diacritics:
 *
 * - **A letter's own dots.** NotoSans, Ruqaa, Kufi2 and Qahiri draw them
 *   as a separate zero-advance glyph GPOS-attached to the base, which is
 *   indistinguishable in shape from an attached mark. Typing `حرف` in
 *   NotoSans used to flag the ف's dot as a diacritic, so the per-mark
 *   overlay armed on it and its hide button would have erased the dot.
 * - **A base letter carrying a GPOS adjustment.** In NotoSans's `حَرْفٌ`
 *   the reh's final form has `dx = -30` and shares the sukun's cluster.
 *
 * Neither has a combining character behind it, so neither survives the
 * allowance. Conversely a PUA-encoded mark positioned by its own outline
 * rather than by GPOS — Thuluth, ThuluthDeco and Yekan all do this, and
 * defeat both the cmap check and the `dx`/`dy` fallback — is admitted on
 * its zero advance, because the source really does hold a mark there.
 *
 * When a cluster offers more mark-shaped glyphs than its source has
 * marks, the excess is dropped rather than guessed at. That is the safe
 * direction: a mark left without handles is an inconvenience, a base
 * letter or a dot given a hide button is destructive.
 *
 * `shapableText` must be the string that was actually shaped — i.e.
 * `shapeText`'s `shapableText`, after `stripUnsupportedDiacritics`, not
 * the block's own text — since that is what `glyph.cl` indexes into.
 */
export function findDiacriticGlyphIndices(
  glyphs: HarfBuzzGlyph[],
  font: opentype.Font | null | undefined,
  shapableText: string
): Set<number> {
  const result = new Set<number>();
  if (!font) return result;

  // One record per cluster: how many glyphs it holds, and how many marks
  // the source text spends on it. A cluster's span runs from its own
  // offset to the next cluster's; characters before the first cluster
  // belong to no cluster and are ignored.
  const clusters = new Map<number, { glyphs: number; allowance: number }>();
  for (const g of glyphs) {
    const cluster = g.cl ?? 0;
    const entry = clusters.get(cluster) ?? { glyphs: 0, allowance: 0 };
    entry.glyphs++;
    clusters.set(cluster, entry);
  }
  const starts = [...clusters.keys()].sort((a, b) => a - b);
  starts.forEach((from, i) => {
    const span = shapableText.slice(from, starts[i + 1] ?? shapableText.length);
    clusters.get(from)!.allowance = [...span].filter((ch) =>
      ARABIC_DIACRITIC_RE.test(ch)
    ).length;
  });

  /** Flag glyph `i` as a mark and debit its cluster's allowance. */
  const take = (i: number) => {
    result.add(i);
    const entry = clusters.get(glyphs[i].cl ?? 0);
    if (entry) entry.allowance = Math.max(0, entry.allowance - 1);
  };

  // Pass 1 — the primary signal, which never needs the allowance's
  // permission but does consume it, so a cluster's marks cannot be
  // counted twice.
  for (let i = 0; i < glyphs.length; i++) {
    let unicodes: number[] = [];
    try {
      unicodes = font.glyphs.get(glyphs[i].g)?.unicodes ?? [];
    } catch {
      unicodes = [];
    }
    if (unicodes.some((u) => ARABIC_DIACRITIC_RE.test(String.fromCodePoint(u)))) {
      take(i);
    }
  }

  // Pass 2 — the secondary signals, spending what the source allows.
  // Zero-advance candidates first, across the whole run, so a cluster's
  // allowance is never spent on an advance-carrying glyph while a
  // weightless one in the same cluster goes unflagged.
  const secondarySignals: Array<(g: HarfBuzzGlyph) => boolean> = [
    (g) => (g.ax ?? 0) === 0 && (g.ay ?? 0) === 0,
    (g) => (g.dx ?? 0) !== 0 || (g.dy ?? 0) !== 0,
  ];
  for (const isMarkShaped of secondarySignals) {
    for (let i = 0; i < glyphs.length; i++) {
      if (result.has(i)) continue;
      const entry = clusters.get(glyphs[i].cl ?? 0);
      if (!entry || entry.glyphs <= 1 || entry.allowance <= 0) continue;
      if (isMarkShaped(glyphs[i])) take(i);
    }
  }

  return result;
}
