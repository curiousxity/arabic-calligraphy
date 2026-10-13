import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import type { Block } from "../types";
import { classifyJoiningForms, isTransparent } from "./arabicJoining";

/**
 * Letter and word spacing for a shaped run (Kelk's تقارب / تباعد).
 *
 * Arabic cannot take Latin tracking — space between every glyph pair would
 * part every join — so letter spacing acts only where a word already
 * breaks: after a letter that does not join forward, when another letter
 * follows. Word spacing acts at whitespace. Both are a fraction of the
 * font size, and both may be negative (tightening, overlap allowed).
 *
 * Only advances change. Glyph count, order, ids and clusters are untouched,
 * so everything keyed by glyph index — diacritic overrides, stroke cuts,
 * Next Shape targets — needs no remapping, and every loop that sums `ax`
 * moves the run correctly by itself.
 *
 * Pure: no React, no Konva, no `./harfbuzz` (Vitest cannot load it).
 */

export type Spacing = { letter?: number; word?: number };

export const LETTER_SPACING_MIN = -0.3;
export const LETTER_SPACING_MAX = 1;
export const WORD_SPACING_MIN = -0.5;
export const WORD_SPACING_MAX = 2;

const ZWNJ = "‌";
const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);
const isMark = (ch: string | undefined) =>
  ch !== undefined && isTransparent(ch.codePointAt(0) ?? 0);

/** The spacing a block's own fields ask for; non-text blocks have none. */
export function spacingForBlock(b: Block): Spacing {
  if (b.type !== "text") return {};
  return { letter: b.letterSpacing, word: b.wordSpacing };
}

export function applySpacing(
  glyphs: readonly HarfBuzzGlyph[],
  text: string,
  spacing: Spacing,
  unitsPerEm: number
): HarfBuzzGlyph[] {
  const letterUnits = (spacing.letter ?? 0) * unitsPerEm;
  const wordUnits = (spacing.word ?? 0) * unitsPerEm;
  if ((letterUnits === 0 && wordUnits === 0) || glyphs.length === 0) {
    return glyphs as HarfBuzzGlyph[];
  }

  const forms = classifyJoiningForms(text);
  const isLetter = (i: number) => forms[i]?.form != null;

  /**
   * Whether a piece break sits at text offset `hi` — the start of the later
   * of two neighbouring clusters `[lo, hi)` and `[hi, …)`. The earlier
   * cluster's last non-mark character must be a letter in final or isolated
   * form, and the next non-mark character from `hi` must be a letter.
   *
   * The backward scan deliberately does not skip a ZWNJ: the break is
   * counted on the boundary *before* the ZWNJ (where the forward scan skips
   * it), so the boundary after it must not count it a second time.
   */
  const pieceBreakAt = (lo: number, hi: number): boolean => {
    let j = hi - 1;
    while (j >= lo && isMark(text[j])) j--;
    if (j < lo) return false;
    const form = forms[j]?.form;
    if (form !== "final" && form !== "isolated") return false;
    let k = hi;
    while (k < text.length && (isMark(text[k]) || text[k] === ZWNJ)) k++;
    return k < text.length && isLetter(k);
  };

  const out = glyphs.map((g) => ({ ...g }));
  const spacedWordClusters = new Set<number>();

  for (let i = 0; i < out.length; i++) {
    const cl = out[i].cl;
    if (cl === undefined) continue;

    // Word gap: the first glyph of a whitespace cluster takes the amount.
    if (wordUnits !== 0 && isSpace(text[cl]) && !spacedWordClusters.has(cl)) {
      spacedWordClusters.add(cl);
      out[i].ax = (out[i].ax ?? 0) + wordUnits;
    }

    // Piece break: between array neighbours i and i+1 the gap is glyph i's
    // advance, whichever direction the array runs, so i takes the amount.
    if (letterUnits !== 0 && i + 1 < out.length) {
      const next = out[i + 1].cl;
      if (next === undefined || next === cl) continue;
      const lo = Math.min(cl, next);
      const hi = Math.max(cl, next);
      if (pieceBreakAt(lo, hi)) out[i].ax = (out[i].ax ?? 0) + letterUnits;
    }
  }

  return out;
}
