import type { GlyphAlternate } from "../types";
import { ARABIC_DIACRITIC_RE } from "./diacritics";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";

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

/**
 * A per-letter entry whose feature is this exempts its letter from the
 * block's style sets and applies nothing else ("Without style sets").
 */
export const NO_STYLE_SETS = "none";

const STYLE_SET_RE = /^ss(0[1-9]|1[0-9]|20)$/;

/**
 * The block-level style sets that may reach HarfBuzz: `ss01`–`ss20` only,
 * once each. Other alternates (`salt`, `jalt`, …) stay per-letter — applied
 * to every letter at once they would read as noise, not as a style.
 */
export function activeStyleSets(sets: readonly string[] | undefined): string[] {
  if (!Array.isArray(sets)) return [];
  return [...new Set(sets.filter((t): t is string => typeof t === "string" && STYLE_SET_RE.test(t)))];
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

/**
 * The entries of a stored list that have the right shape. A save is user
 * data — a hand-edited project can hold `null`, a string, or an object with
 * the wrong field types, and every reader goes through this so none of them
 * throws (a throw here happens during render and takes the whole App down).
 */
function wellFormed(list: readonly GlyphAlternate[] | undefined): GlyphAlternate[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (a): a is GlyphAlternate =>
      typeof a === "object" &&
      a !== null &&
      typeof a.letter === "number" &&
      typeof a.char === "string" &&
      typeof a.feature === "string" &&
      typeof a.value === "number"
  );
}

export function activeAlternates(
  text: string,
  alternates: readonly GlyphAlternate[] | undefined
): GlyphAlternate[] {
  const list = wellFormed(alternates);
  if (list.length === 0) return [];
  const offsets = letterOffsets(text);
  return list.filter((a) => {
    const offset = offsets[a.letter];
    return (
      offset !== undefined &&
      text[offset] === a.char &&
      (isOptionalFeature(a.feature) || a.feature === NO_STYLE_SETS) &&
      isValidValue(a.value)
    );
  });
}

/**
 * The HarfBuzz feature string for a run: the block's style sets over the
 * whole run first, then each letter's own choice. HarfBuzz applies features
 * in order, so a letter with a choice first has the block's sets switched
 * back off on its range (`ss01[5:6]=0`) — a letter picked by hand always
 * shows exactly what was picked.
 */
export function featureStringFor(
  text: string,
  alternates: readonly GlyphAlternate[] | undefined,
  exceptLetter?: number,
  styleSets?: readonly string[]
): string {
  const sets = activeStyleSets(styleSets);
  const offsets = letterOffsets(text);
  const parts: string[] = [...sets];
  for (const a of activeAlternates(text, alternates)) {
    if (a.letter === exceptLetter) continue;
    const o = offsets[a.letter];
    parts.push(...setsOffAt(sets, o));
    if (a.feature !== NO_STYLE_SETS) parts.push(`${a.feature}[${o}:${o + 1}]=${a.value}`);
  }
  return parts.join(",");
}

function setsOffAt(sets: readonly string[], offset: number): string[] {
  return sets.map((t) => `${t}[${offset}:${offset + 1}]=0`);
}

/** A stable identity for a block's alternates, for cache keys and effect deps. */
export function alternatesKey(alternates: readonly GlyphAlternate[] | undefined): string {
  return wellFormed(alternates).map((a) => `${a.letter}:${a.char}:${a.feature}=${a.value}`).join(",");
}

export function sameChoice(a: AlternateChoice | null, b: AlternateChoice | null): boolean {
  if (a === null || b === null) return a === b;
  return a.feature === b.feature && a.value === b.value;
}

export function currentChoice(
  alternates: readonly GlyphAlternate[] | undefined,
  letter: number
): AlternateChoice | null {
  const a = wellFormed(alternates).find((x) => x.letter === letter);
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
  const rest = wellFormed(list).filter((a) => a.letter !== letter);
  const next = choice ? [...rest, { letter, char, feature: choice.feature, value: choice.value }] : rest;
  return next.sort((a, b) => a.letter - b.letter);
}

export function fallbackFeatureLabel(choice: AlternateChoice): string {
  const { feature, value } = choice;
  if (feature === NO_STYLE_SETS) return "Without style sets";
  if (feature.startsWith("ss")) return `Style set ${Number(feature.slice(2))}`;
  if (feature.startsWith("cv")) return `Variant ${Number(feature.slice(2))}`;
  if (feature === "jalt") return value > 1 ? `Justification ${value}` : "Justification";
  if (feature === "swsh") return value > 1 ? `Swash ${value}` : "Swash";
  return `Alternate ${value}`;
}

export type ShapeFn = (features: string) => HarfBuzzGlyph[];

/** The glyphs HarfBuzz emitted for one cluster, as a comparable signature. */
function clusterSignature(glyphs: HarfBuzzGlyph[], offset: number): string {
  return glyphs
    .filter((g) => (g.cl ?? -1) === offset)
    .map((g) => g.g)
    .join(",");
}

/** The cluster's widest glyph — the letter itself rather than a mark on it. */
function mainGlyph(glyphs: HarfBuzzGlyph[], offset: number): number {
  let best: HarfBuzzGlyph | null = null;
  for (const g of glyphs) {
    if ((g.cl ?? -1) !== offset) continue;
    if (!best || (g.ax ?? 0) > (best.ax ?? 0)) best = g;
  }
  return best?.g ?? 0;
}

/**
 * For each letter, reshape the run with every optional feature switched on
 * for that letter alone, and keep the results that change its glyph. Each
 * letter is probed with the *other* letters' alternates applied, so a
 * contextual alternate sees its real neighbours. Features that never touch
 * the letter fall out on their own.
 */
export function probeAlternates(args: {
  text: string;
  alternates: readonly GlyphAlternate[] | undefined;
  /** The block's style sets: every letter is probed starting from them. */
  styleSets?: readonly string[];
  tags: readonly string[];
  shape: ShapeFn;
  labelFor: (choice: AlternateChoice) => string;
  maxLetters?: number;
}): LetterAlternates[] {
  const { text, alternates, shape, labelFor } = args;
  const sets = activeStyleSets(args.styleSets);
  const tags = [...new Set(args.tags)].filter(isOptionalFeature);
  if (tags.length === 0) return [];

  const memo = new Map<string, HarfBuzzGlyph[]>();
  const shapeOnce = (features: string) => {
    let hit = memo.get(features);
    if (!hit) {
      hit = shape(features);
      memo.set(features, hit);
    }
    return hit;
  };

  const offsets = letterOffsets(text).slice(0, args.maxLetters ?? MAX_PROBE_LETTERS);
  const out: LetterAlternates[] = [];

  offsets.forEach((offset, letter) => {
    const base = featureStringFor(text, alternates, letter, sets);
    const baseGlyphs = shapeOnce(base);
    const baseSig = clusterSignature(baseGlyphs, offset);
    if (baseSig === "") return; // consumed into another letter's ligature

    const options: AlternateOption[] = [
      { choice: null, glyphId: mainGlyph(baseGlyphs, offset), label: "Default" },
    ];
    const seen = new Set([baseSig]);
    // Every candidate turns the block's sets off on this letter first, as
    // `featureStringFor` will when the choice is stored.
    const off = setsOffAt(sets, offset).join(",");
    const join = (...parts: string[]) => parts.filter(Boolean).join(",");

    if (sets.length > 0) {
      const glyphs = shapeOnce(join(base, off));
      const sig = clusterSignature(glyphs, offset);
      if (sig !== "" && !seen.has(sig)) {
        seen.add(sig);
        const choice = { feature: NO_STYLE_SETS, value: 1 };
        options.push({ choice, glyphId: mainGlyph(glyphs, offset), label: labelFor(choice) });
      }
    }

    for (const feature of tags) {
      const maxValue = MULTI_VALUE_FEATURES.has(feature) ? MAX_ALTERNATE_VALUE : 1;
      for (let value = 1; value <= maxValue; value++) {
        const probe = `${feature}[${offset}:${offset + 1}]=${value}`;
        const glyphs = shapeOnce(join(base, off, probe));
        const sig = clusterSignature(glyphs, offset);
        if (sig === "" || seen.has(sig)) continue;
        seen.add(sig);
        const choice = { feature, value };
        options.push({ choice, glyphId: mainGlyph(glyphs, offset), label: labelFor(choice) });
      }
    }

    if (options.length > 1) out.push({ letter, offset, options });
  });

  return out;
}

export type AlternatePanelView =
  | { kind: "loading" }
  | { kind: "noFontAlternates" }
  | { kind: "noTextAlternates" }
  | { kind: "prompt" }
  | { kind: "noLetterAlternates" }
  | { kind: "strip"; target: LetterAlternates };

/**
 * What the sidebar's Letter shapes section shows. A strip it can already
 * draw wins over "loading": every pick changes the alternates and re-probes,
 * and swapping the strip for a message on each click made it blink out
 * under the pointer, so a second quick pick landed on the note.
 */
export function alternatePanelView(
  state:
    | { letters: LetterAlternates[]; fontHasAlternates: boolean; loading: boolean; hasFont: boolean }
    | undefined,
  letter: number | null
): AlternatePanelView {
  if (!state) return { kind: "loading" };
  const target = letter === null ? undefined : state.letters.find((l) => l.letter === letter);
  if (target && state.hasFont) return { kind: "strip", target };
  if (state.loading) return { kind: "loading" };
  if (!state.fontHasAlternates) return { kind: "noFontAlternates" };
  // The font has alternates, but none of them touches a letter of this text,
  // so there is no outline to click.
  if (state.letters.length === 0) return { kind: "noTextAlternates" };
  if (letter === null) return { kind: "prompt" };
  return { kind: "noLetterAlternates" };
}

/** The letter the sidebar strip is showing, and the character it was. */
export type AlternateTarget = { blockId: number; letter: number; char: string };

/**
 * The strip's letter for `blockId`, or null. A target is held by ordinal, so
 * typing before it would silently re-point it at a different letter; the
 * recorded character drops it instead, the same checksum `GlyphAlternate`
 * itself carries.
 */
export function resolveAlternateTarget(
  target: AlternateTarget | null | undefined,
  blockId: number,
  text: string
): number | null {
  if (!target || target.blockId !== blockId) return null;
  return charAtLetter(text, target.letter) === target.char ? target.letter : null;
}

export type StyleSetOption = { feature: string; label: string };

/**
 * The font's style sets that change at least one glyph of this text, for the
 * block-level toggles. One shaping pass per set; a set that touches nothing
 * here (Amiri's "Localised @ and &" on Arabic words) is left out rather than
 * offered as a checkbox that does nothing.
 */
export function probeStyleSets(args: {
  text: string;
  tags: readonly string[];
  shape: ShapeFn;
  labelFor: (choice: AlternateChoice) => string;
}): StyleSetOption[] {
  const sig = (glyphs: HarfBuzzGlyph[]) => glyphs.map((g) => g.g).join(",");
  const tags = activeStyleSets([...args.tags]).sort();
  if (tags.length === 0 || args.text.length === 0) return [];
  const plain = sig(args.shape(""));
  return tags
    .filter((feature) => sig(args.shape(feature)) !== plain)
    .map((feature) => ({ feature, label: args.labelFor({ feature, value: 1 }) }));
}
