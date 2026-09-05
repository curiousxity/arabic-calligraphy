/**
 * The square-kufi alphabet: every Arabic letter, in every joining form, drawn
 * as cells on a lattice.
 *
 * Square kufi (كوفي مربع, kufi murabbaʿ) is not a typeface — it is a
 * construction. Every stroke is one cell wide, every gap between two parallel
 * strokes is one cell, and letters are joined by running the baseline stroke
 * from one to the next. So there is nothing here for HarfBuzz to shape and no
 * outline to fetch: a letter *is* its cell set, and this module is the whole
 * of that data.
 *
 * Pure: no React, no Konva, no font loading, and deliberately no dependency
 * on `./harfbuzz` — whose static harfbuzzjs import throws under Vitest's Node
 * ESM loader before any test code runs, the same reason `diacritics.ts` and
 * `fitToWidth.ts` keep their distance.
 *
 * ## The two conventions this alphabet commits to
 *
 * **Every join is on the baseline.** Real cursive Arabic joins jeem to the
 * previous letter at the top of its head, not at the line; square-kufi
 * alphabets in practice go both ways. This one normalises every join to the
 * baseline row, which is what lets a join be a plain run of baseline cells
 * (`bridgeCells` in `squareKufi.ts`) instead of a stepped path whose corner
 * has to be reasoned about per letter pair. `joinsRight`/`joinsLeft` below is
 * therefore a claim about ink at the *baseline row's* end columns, and
 * `squareKufi.test.ts` asserts it of every form rather than trusting it.
 *
 * **Dots are not drawn.** Traditional square kufi omits the iʿjām entirely and
 * leaves ب/ت/ث to context, which is why `beh` below is one skeleton and not
 * three. Adding them is a real design problem — a dot is a cell, and a cell
 * next to a letter in a lattice this tight reads as part of the letter — so it
 * is deferred rather than half-done. See CLAUDE.md, "Square kufi".
 *
 * ## Reading a form
 *
 * `rows` is the letter's own box, top row first, `#` for ink. `base` is how
 * many rows the box hangs *below* the baseline (0 for most letters; 1 for the
 * tails of ر, و, م and ج that drop under the line; negative would float the
 * box above it, which only ء does). Everything else — where the box sits, how
 * long the join to the next letter runs — is the layout's business.
 */

import type { JoiningForm } from "./arabicJoining";

export type KufiForm = {
  /** The letter's cells, top row first. Every row is the same length; `#` is ink. */
  rows: string[];
  /** Rows the box extends below the baseline. Negative floats it above. */
  base: number;
};

export type KufiFormSet = Partial<Record<JoiningForm, KufiForm>>;

const f = (base: number, ...rows: string[]): KufiForm => ({ rows, base });

/** A form used for every one of a letter's shapes — the loop letters mostly. */
const all = (form: KufiForm): KufiFormSet => ({
  isolated: form,
  initial: form,
  medial: form,
  final: form,
});

/** The three shapes a tooth-letter (ب ت ث ن ي) shares. */
const TOOTH_INITIAL = f(0, ".#", ".#", "##");
const TOOTH_MEDIAL = f(0, "#", "#");

/**
 * The skeletons. Letters that differ only by their dots share one entry,
 * because this alphabet draws no dots — see the module comment.
 */
const SKELETONS = {
  /** ا — the plumb line the whole band is measured against. */
  alef: {
    isolated: f(0, "#", "#", "#", "#", "#", "#", "#"),
    final: f(0, "#", "#", "#", "#", "#", "#", "#"),
  } as KufiFormSet,

  /** ب ت ث — shallow bowl, one tooth. */
  beh: {
    isolated: f(0, "#.#", "#.#", "###"),
    initial: TOOTH_INITIAL,
    medial: TOOTH_MEDIAL,
    final: f(0, "#..", "#..", "###"),
  } as KufiFormSet,

  /** ن — the same tooth, over a bowl deep enough to tell it from beh. */
  noon: {
    isolated: f(0, "#.#", "#.#", "#.#", "###"),
    initial: TOOTH_INITIAL,
    medial: TOOTH_MEDIAL,
    final: f(0, "#..", "#..", "#..", "###"),
  } as KufiFormSet,

  /** ي ى ئ — wider than noon, which is what separates the two bowls. */
  yeh: {
    isolated: f(0, "#..#", "#..#", "#..#", "####"),
    initial: TOOTH_INITIAL,
    medial: TOOTH_MEDIAL,
    final: f(0, "#...", "#...", "#...", "####"),
  } as KufiFormSet,

  /** ج ح خ — the head enclosed, its tail dropping below the line. */
  jeem: {
    isolated: f(1, "####", "...#", "...#", "####", "#..."),
    initial: f(0, "###", "..#", "###"),
    medial: f(0, "###", "..#", "###"),
    final: f(1, "####", "...#", "...#", "####", "#..."),
  } as KufiFormSet,

  /** د ذ — a shoulder and a foot. */
  dal: {
    isolated: f(0, "..#", "..#", "###"),
    final: f(0, "..#", "..#", "###"),
  } as KufiFormSet,

  /** ر ز — the one letter that is mostly below the line. */
  reh: {
    isolated: f(1, "###", "#.."),
    final: f(1, "###", "#.."),
  } as KufiFormSet,

  /** و — a closed loop with the tail dropped at its left. */
  waw: {
    isolated: f(1, ".###", ".#.#", "####", "#..."),
    final: f(1, ".###", ".#.#", "####", "#..."),
  } as KufiFormSet,

  /** س ش — three teeth; the isolated and final forms close with a bowl. */
  seen: {
    isolated: f(0, "#......", "#.#.#.#", "#.#.#.#", "#######"),
    initial: f(0, "#.#.#", "#.#.#", "#####"),
    medial: f(0, "#.#.#", "#.#.#", "#####"),
    final: f(0, "#......", "#.#.#.#", "#.#.#.#", "#######"),
  } as KufiFormSet,

  /** ص ض — a four-wide loop on a long tail, which is what tells it from feh. */
  sad: {
    isolated: f(1, "..####", "..#..#", "######", "#....."),
    initial: f(0, "..####", "..#..#", "######"),
    medial: f(0, "..####", "..#..#", "######"),
    final: f(1, "..####", "..#..#", "######", "#....."),
  } as KufiFormSet,

  /** ط ظ — sad's loop with the shaft standing out of it. */
  tah: all(f(0, "..#...", "..#...", "..#...", "..#...", "..####", "..#..#", "######")),

  /** ع غ — the open head over a foot. */
  ain: {
    isolated: f(0, ".###", ".#.#", ".###", "...#", "####"),
    initial: f(0, ".##", ".#.", "###"),
    medial: f(0, ".##", ".#.", "###"),
    final: f(0, ".###", ".#.#", ".###", "...#", "####"),
  } as KufiFormSet,

  /** ف — a three-wide loop, one narrower than sad's. */
  feh: all(f(0, "..###", "..#.#", "#####")),

  /** ق — feh's loop when it joins, over a deep bowl when it does not. */
  qaf: {
    isolated: f(0, "..###", "..#.#", "..###", "#...#", "#####"),
    initial: f(0, "..###", "..#.#", "#####"),
    medial: f(0, "..###", "..#.#", "#####"),
    final: f(0, "..###", "..#.#", "..###", "#...#", "#####"),
  } as KufiFormSet,

  /** ك — the shaft with its top stroke laid back over it. */
  kaf: {
    isolated: f(0, "###.", "..#.", "..#.", "..#.", "..#.", "####"),
    initial: f(0, "###", "..#", "..#", "..#", "###"),
    medial: f(0, "###", "..#", "..#", "..#", "###"),
    final: f(0, "###.", "..#.", "..#.", "..#.", "..#.", "####"),
  } as KufiFormSet,

  /** ل — alef's height, with a foot when it stands alone. */
  lam: {
    isolated: f(0, "..#", "..#", "..#", "..#", "..#", "#.#", "###"),
    initial: f(0, "#", "#", "#", "#", "#", "#", "#"),
    medial: f(0, "#", "#", "#", "#", "#", "#", "#"),
    final: f(0, "..#", "..#", "..#", "..#", "..#", "#.#", "###"),
  } as KufiFormSet,

  /** م — a small loop with the tail dropped below the line. */
  meem: {
    isolated: f(1, "###", "#.#", "###", "#.."),
    initial: f(0, "###", "#.#", "###"),
    medial: f(0, "###", "#.#", "###"),
    final: f(1, "###", "#.#", "###", "#.."),
  } as KufiFormSet,

  /** ه ة — meem's loop drawn tall, and never with a tail. */
  heh: all(f(0, "###", "#.#", "#.#", "###")),

  /** لا — the ligature, two shafts sharing a foot. Never joins to its left. */
  lamAlef: {
    isolated: f(0, "#.#", "#.#", "#.#", "#.#", "#.#", "#.#", "###"),
    final: f(0, "#.#", "#.#", "#.#", "#.#", "#.#", "#.#", "###"),
  } as KufiFormSet,

  /** ء — the one mark that floats clear of the line. */
  hamza: {
    isolated: f(-3, "##", "#."),
  } as KufiFormSet,

  /** ـ tatweel: one cell of baseline, which is exactly what it is. */
  tatweel: all(f(0, "#")),
} satisfies Record<string, KufiFormSet>;

export type SkeletonName = keyof typeof SKELETONS;

/**
 * Letter → skeleton. Letters that differ only in their dots share one, and the
 * Persian/Urdu extensions map onto the Arabic letter they are drawn from —
 * the same non-exhaustive set `arabicJoining.ts` already classifies, so the
 * two files agree on which characters are letters at all.
 */
const LETTER_SKELETON: Record<string, SkeletonName> = {
  "ء": "hamza", // ء
  "آ": "alef", // آ
  "أ": "alef", // أ
  "ؤ": "waw", // ؤ
  "إ": "alef", // إ
  "ئ": "yeh", // ئ
  "ا": "alef", // ا
  "ب": "beh", // ب
  "ة": "heh", // ة
  "ت": "beh", // ت
  "ث": "beh", // ث
  "ج": "jeem", // ج
  "ح": "jeem", // ح
  "خ": "jeem", // خ
  "د": "dal", // د
  "ذ": "dal", // ذ
  "ر": "reh", // ر
  "ز": "reh", // ز
  "س": "seen", // س
  "ش": "seen", // ش
  "ص": "sad", // ص
  "ض": "sad", // ض
  "ط": "tah", // ط
  "ظ": "tah", // ظ
  "ع": "ain", // ع
  "غ": "ain", // غ
  "ـ": "tatweel", // ـ
  "ف": "feh", // ف
  "ق": "qaf", // ق
  "ك": "kaf", // ك
  "ل": "lam", // ل
  "م": "meem", // م
  "ن": "noon", // ن
  "ه": "heh", // ه
  "و": "waw", // و
  "ى": "yeh", // ى
  "ي": "yeh", // ي
  // Persian / Urdu extensions, drawn as the Arabic letter they extend.
  "ٹ": "beh", // ٹ
  "پ": "beh", // پ
  "چ": "jeem", // چ
  "ڈ": "dal", // ڈ
  "ڑ": "reh", // ڑ
  "ژ": "reh", // ژ
  "ک": "kaf", // ک
  "گ": "kaf", // گ
  "ی": "yeh", // ی
  // ں (noon ghunna) and ے (bari yeh) are deliberately absent: arabicJoining.ts
  // classifies neither, so both come back with no joining form. Drawing them
  // would mean picking a form here, and always-isolated is simply wrong for ں,
  // which joins. They are reported as undrawable rather than drawn wrongly —
  // adding them properly starts by classifying them in that file.
};

/** The alef-family characters ل fuses with into the لا ligature. */
export const ALEF_FAMILY = new Set(["آ", "أ", "إ", "ا"]);
export const LAM = "ل";
export const LAM_ALEF_SKELETON: SkeletonName = "lamAlef";

/** Every character this alphabet can draw, for the tests that sweep them all. */
export const SUPPORTED_LETTERS = Object.keys(LETTER_SKELETON).join("");

/**
 * The cells for one letter in one joining form.
 *
 * Falls back down the joining chain (medial → initial → isolated, final →
 * isolated) rather than returning nothing: a right-joining letter classified
 * as `medial` by a hand-edited string should still draw, and a missing form is
 * a gap in this table, not a reason to drop a letter out of the word.
 */
export function squareKufiForm(
  skeleton: SkeletonName,
  form: JoiningForm
): KufiForm | null {
  const set = SKELETONS[skeleton];
  const chain: JoiningForm[] =
    form === "medial"
      ? ["medial", "initial", "final", "isolated"]
      : form === "initial"
        ? ["initial", "isolated"]
        : form === "final"
          ? ["final", "isolated"]
          : ["isolated"];
  for (const candidate of chain) {
    const found = set[candidate];
    if (found) return found;
  }
  return null;
}

export function skeletonFor(char: string): SkeletonName | null {
  return LETTER_SKELETON[char] ?? null;
}

/** Every skeleton, for the tests that assert structural rules over all of them. */
export const ALL_SKELETONS = SKELETONS as Record<SkeletonName, KufiFormSet>;
