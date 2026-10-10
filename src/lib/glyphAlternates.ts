import type { GlyphAlternate } from "../types";
import { ARABIC_DIACRITIC_RE } from "./diacritics";

/**
 * Next Shape: per-letter OpenType alternates. Pure — no `./harfbuzz` import,
 * whose static harfbuzzjs import throws under Vitest; shaping is injected
 * where it is needed (`probeAlternates`).
 *
 * Alternates are keyed by a **letter ordinal**: the index among the text's
 * characters skipping tatweel and combining marks. Kashida and Fit to width
 * only insert tatweel, and shaping only strips marks, so none of the three
 * moves an ordinal — no remap is owed anywhere, unlike stroke cuts. The
 * recorded `char` turns the remaining fragility (a typed edit before the
 * letter) into a drop rather than an alternate on the wrong character.
 */

export type AlternateChoice = { feature: string; value: number };

/** One shape a letter can take. `choice: null` is the default, always first. */
export type AlternateOption = {
  choice: AlternateChoice | null;
  /** The glyph drawn for the letter with this choice, for the thumbnail. */
  glyphId: number;
  label: string;
};

export type LetterAlternates = {
  letter: number;
  /** The letter's UTF-16 offset in the shaped text (its HarfBuzz cluster). */
  offset: number;
  options: AlternateOption[];
};

const TATWEEL = "ـ";

/** Tags whose lookups can hold several alternates, probed at values 1..MAX_ALTERNATE_VALUE. */
export const MULTI_VALUE_FEATURES: ReadonlySet<string> = new Set(["salt", "aalt", "jalt", "swsh"]);
export const MAX_ALTERNATE_VALUE = 4;
/** Probing reshapes the run per tag per letter; past this many letters it stops. */
export const MAX_PROBE_LETTERS = 40;

const OPTIONAL_FEATURE_RE = /^(salt|aalt|jalt|swsh|ss(0[1-9]|1[0-9]|20)|cv(0[1-9]|[1-9][0-9]))$/;

export function isOptionalFeature(tag: string): boolean {
  return OPTIONAL_FEATURE_RE.test(tag);
}

function isSkipped(text: string, i: number): boolean {
  const code = text.charCodeAt(i);
  if (code >= 0xdc00 && code <= 0xdfff) return true; // low surrogate: counted with its high half
  const ch = text[i];
  return ch === TATWEEL || ARABIC_DIACRITIC_RE.test(ch);
}

export function letterOffsets(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) if (!isSkipped(text, i)) out.push(i);
  return out;
}

export function letterAtOffset(text: string, offset: number): number {
  if (offset < 0 || offset >= text.length || isSkipped(text, offset)) return -1;
  let letter = 0;
  for (let i = 0; i < offset; i++) if (!isSkipped(text, i)) letter++;
  return letter;
}

export function charAtLetter(text: string, letter: number): string | null {
  const offset = letterOffsets(text)[letter];
  return offset === undefined ? null : text[offset];
}

const isValidValue = (v: number) => Number.isInteger(v) && v >= 1 && v <= 99;

export function activeAlternates(
  text: string,
  alternates: readonly GlyphAlternate[] | undefined
): GlyphAlternate[] {
  if (!alternates?.length) return [];
  const offsets = letterOffsets(text);
  return alternates.filter((a) => {
    const offset = offsets[a.letter];
    return (
      offset !== undefined &&
      text[offset] === a.char &&
      isOptionalFeature(a.feature) &&
      isValidValue(a.value)
    );
  });
}

export function featureStringFor(
  text: string,
  alternates: readonly GlyphAlternate[] | undefined,
  exceptLetter?: number
): string {
  const offsets = letterOffsets(text);
  return activeAlternates(text, alternates)
    .filter((a) => a.letter !== exceptLetter)
    .map((a) => {
      const o = offsets[a.letter];
      return `${a.feature}[${o}:${o + 1}]=${a.value}`;
    })
    .join(",");
}

/** A stable identity for a block's alternates, for cache keys and effect deps. */
export function alternatesKey(alternates: readonly GlyphAlternate[] | undefined): string {
  if (!alternates?.length) return "";
  return alternates.map((a) => `${a.letter}:${a.char}:${a.feature}=${a.value}`).join(",");
}

export function sameChoice(a: AlternateChoice | null, b: AlternateChoice | null): boolean {
  if (a === null || b === null) return a === b;
  return a.feature === b.feature && a.value === b.value;
}

export function currentChoice(
  alternates: readonly GlyphAlternate[] | undefined,
  letter: number
): AlternateChoice | null {
  const a = alternates?.find((x) => x.letter === letter);
  return a ? { feature: a.feature, value: a.value } : null;
}

export function cycleAlternate(
  options: readonly AlternateOption[],
  current: AlternateChoice | null,
  direction: 1 | -1
): AlternateChoice | null {
  if (options.length === 0) return null;
  const found = options.findIndex((o) => sameChoice(o.choice, current));
  const from = found < 0 ? 0 : found;
  const next = (from + direction + options.length) % options.length;
  return options[next].choice;
}

export function setAlternate(
  list: readonly GlyphAlternate[] | undefined,
  letter: number,
  char: string,
  choice: AlternateChoice | null
): GlyphAlternate[] {
  const rest = (list ?? []).filter((a) => a.letter !== letter);
  const next = choice ? [...rest, { letter, char, feature: choice.feature, value: choice.value }] : rest;
  return next.sort((a, b) => a.letter - b.letter);
}

export function fallbackFeatureLabel(choice: AlternateChoice): string {
  const { feature, value } = choice;
  if (feature.startsWith("ss")) return `Style set ${Number(feature.slice(2))}`;
  if (feature.startsWith("cv")) return `Variant ${Number(feature.slice(2))}`;
  if (feature === "jalt") return value > 1 ? `Justification ${value}` : "Justification";
  if (feature === "swsh") return value > 1 ? `Swash ${value}` : "Swash";
  return `Alternate ${value}`;
}
