import { classifyJoiningForms, isTransparent, type ClassifiedChar, type JoiningForm } from "../arabicJoining";
import { KUFI_FORMS, skeletonOf, type LigatureName, type SkeletonName } from "./kufiAlphabet";

export type KufiUnit = {
  index: number;
  /** UTF-16 index of the unit's first character in the input. */
  textOffset: number;
  /** `${skeleton}:${form}`, used to anchor edits. */
  key: string;
  skeleton: SkeletonName | LigatureName;
  form: JoiningForm;
  /** True when a following unit in the same word joins this one. */
  joinsNext: boolean;
  wordIndex: number;
};

const LAM = 0x0644;
const HEH = 0x0647;
const ALEF = 0x0627;
const TATWEEL = 0x0640;
const ALEF_FORMS = new Set([0x0627, 0x0623, 0x0625, 0x0622]);

const isSpace = (ch: string) => /\s/.test(ch);

/**
 * True for the two presentation-form ligatures the panel draws as ligatures:
 * ﷲ (U+FDF2) and the lam-alef forms ﻻ ﻼ ﻷ ﻸ ﻹ ﻺ ﻵ ﻶ (U+FEF5–U+FEFC). They are
 * normalised (NFKC) to their letters before resolving, each expanded letter
 * keeping the form's own text offset. Other presentation forms stay
 * unsupported: a shaped single letter would lose its dots (the packer reads
 * them from the original character), and an isolated haraka form normalises
 * to a space that splits the word.
 */
const isPresentationForm = (ch: string) => {
  const cp = ch.codePointAt(0) ?? 0;
  return cp === 0xfdf2 || (cp >= 0xfef5 && cp <= 0xfefc);
};

/**
 * Turns text into square Kufi letter units. Harakat and tatweel are dropped,
 * spaces split words, and anything without a skeleton (Latin, digits,
 * punctuation) is reported in `unsupported` and also ends the current word.
 * A lone leading و/ف/ب before الله is not treated as part of allah.
 * Presentation forms (ﷲ, ﻻ and the rest) are read as the letters they stand
 * for; a unit made from one has the form's offset as its `textOffset`.
 */
export function resolveKufiText(text: string): { units: KufiUnit[]; unsupported: string[] } {
  // classifyJoiningForms misaligns after non-BMP characters, so classify a copy
  // where each is a single BMP placeholder and map back to the original here.
  // A presentation form becomes the letters it stands for, every one of them
  // carrying the form's offset, so an edit keyed on the unit finds its place.
  const original: string[] = [];
  const offsets: number[] = [];
  let at = 0;
  for (const ch of Array.from(text)) {
    const expanded = isPresentationForm(ch) ? Array.from(ch.normalize("NFKC")) : [ch];
    for (const e of expanded) {
      original.push(e);
      offsets.push(at);
    }
    at += ch.length;
  }
  const chars = classifyJoiningForms(original.map((ch) => (ch.length > 1 ? "�" : ch)).join(""));
  const units: KufiUnit[] = [];
  const unsupported: string[] = [];
  let word = 0;
  let wordHasUnits = false;
  const endWord = () => {
    if (wordHasUnits) word++;
    wordHasUnits = false;
  };

  const skipMarks = (from: number): number => {
    let j = from;
    while (j < chars.length && isTransparent(chars[j].codepoint)) j++;
    return j;
  };
  const isLetterLike = (c: ClassifiedChar | undefined) =>
    !!c && (c.codepoint === TATWEEL || skeletonOf(c.codepoint) !== null);

  const push = (c: ClassifiedChar, skeleton: SkeletonName | LigatureName, form: JoiningForm) => {
    units.push({
      index: units.length,
      textOffset: offsets[c.index],
      key: `${skeleton}:${form}`,
      skeleton,
      form,
      joinsNext: false,
      wordIndex: word,
    });
    wordHasUnits = true;
  };

  // Matches ا ل ل ه (marks between ignored) as a whole word; returns the index after it.
  const matchAllah = (i: number): number | null => {
    const seq = [ALEF, LAM, LAM, HEH];
    let j = i;
    for (let k = 0; k < seq.length; k++) {
      j = skipMarks(j);
      if (j >= chars.length || chars[j].codepoint !== seq[k]) return null;
      j++;
    }
    const end = skipMarks(j);
    if (isLetterLike(chars[end])) return null;
    return j;
  };

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const cp = c.codepoint;
    if (isTransparent(cp) || cp === TATWEEL || cp === 0x200d) continue;
    const ch = original[c.index];
    if (isSpace(ch)) {
      endWord();
      continue;
    }
    const sk = skeletonOf(cp);
    if (sk === null) {
      unsupported.push(ch);
      endWord();
      continue;
    }

    if (cp === ALEF) {
      const prev = i > 0 ? chars[i - 1] : undefined;
      let p = i - 1;
      while (p >= 0 && isTransparent(chars[p].codepoint)) p--;
      if (!isLetterLike(p >= 0 ? chars[p] : undefined) || !prev) {
        const end = matchAllah(i);
        if (end !== null) {
          const form = KUFI_FORMS.allah.isolated ? "isolated" : (Object.keys(KUFI_FORMS.allah)[0] as JoiningForm);
          push(c, "allah", form);
          i = end - 1;
          continue;
        }
      }
    }

    if (cp === LAM) {
      const n = skipMarks(i + 1);
      if (n < chars.length && ALEF_FORMS.has(chars[n].codepoint)) {
        let form: JoiningForm = c.form === "medial" || c.form === "final" ? "final" : "isolated";
        if (!KUFI_FORMS.lamAlef[form]) form = "isolated";
        push(c, "lamAlef", form);
        i = n;
        continue;
      }
    }

    push(c, sk, c.form ?? "isolated");
  }

  for (let k = 0; k + 1 < units.length; k++) {
    const u = units[k];
    u.joinsNext = u.wordIndex === units[k + 1].wordIndex && (u.form === "initial" || u.form === "medial");
  }

  return { units, unsupported };
}
