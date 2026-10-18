/**
 * Reading a phrase the way the pen writes it, for tarkib: words, the
 * connected runs inside each word (a run ends after a letter that does not
 * join forward), each letter's form by its place in the run, its dotless
 * skeleton, its dots, its hamza or madda, and the vowels typed on it.
 * Pure: no font, no HarfBuzz. See .claude/rules/tarkib.md.
 */

export type LetterForm = "standalone" | "starting" | "middle" | "finishing";

/** A letter as the pen draws it: its dotless skeleton, its dots, its form. */
export type PhraseLetter = {
  /** As typed, normalised: "ي", "أ", "لا", "الله". */
  char: string;
  /** Dotless class key (SKELETONS, adjusted for form). */
  skeleton: string;
  form: LetterForm;
  dots: { count: 0 | 1 | 2 | 3; side: "above" | "below" };
  hamza?: "above" | "below";
  madda?: true;
  /** Typed vowel, shadda, sukun and tanween marks, in typed order. */
  marks: string[];
  /** Index of `char`'s first code unit in the input. */
  at: number;
};
export type PhraseRun = { letters: PhraseLetter[] };
export type PhraseWord = { runs: PhraseRun[] };
export type PhraseAnalysis = { words: PhraseWord[]; hasVowels: boolean; unsupported: string[] };

/**
 * Letter to skeleton key, as the letter stands alone. A ن, ي, ئ or ق takes
 * another skeleton when it starts or sits inside a run (the ba tooth, the fa
 * head): `skeletonFor` applies that. scripts/marks/thuluth/pieceSchema.py
 * keeps a copy of this table; a test holds the two equal.
 */
export const SKELETONS: Record<string, string> = {
  "ا": "alif", "أ": "alif", "إ": "alif", "آ": "alif",
  "ب": "ba", "ت": "ba", "ث": "ba",
  "ج": "jeem", "ح": "jeem", "خ": "jeem",
  "د": "dal", "ذ": "dal", "ر": "ra", "ز": "ra",
  "س": "seen", "ش": "seen", "ص": "sad", "ض": "sad", "ط": "ta", "ظ": "ta",
  "ع": "ain", "غ": "ain", "ف": "fa", "ق": "qaf", "ك": "kaf", "ل": "lam", "م": "meem",
  "ن": "nun", "ه": "ha", "ة": "ha", "و": "waw", "ؤ": "waw",
  "ي": "ya", "ى": "ya", "ئ": "ya", "ء": "hamza",
  "لا": "lamalif", "لأ": "lamalif", "لإ": "lamalif", "لآ": "lamalif",
  "الله": "allah",
};

/** Letters after which the pen lifts: the next letter starts a new run. */
const NO_FORWARD_JOIN = new Set(["ا", "أ", "إ", "آ", "د", "ذ", "ر", "ز", "و", "ؤ", "ة", "ء", "لا", "لأ", "لإ", "لآ", "الله"]);

type Dots = PhraseLetter["dots"];
const DOTS: Record<string, Dots> = {
  "ب": { count: 1, side: "below" }, "ت": { count: 2, side: "above" }, "ث": { count: 3, side: "above" },
  "ج": { count: 1, side: "below" }, "خ": { count: 1, side: "above" }, "ذ": { count: 1, side: "above" },
  "ز": { count: 1, side: "above" }, "ش": { count: 3, side: "above" }, "ض": { count: 1, side: "above" },
  "ظ": { count: 1, side: "above" }, "غ": { count: 1, side: "above" }, "ف": { count: 1, side: "above" },
  "ق": { count: 2, side: "above" }, "ن": { count: 1, side: "above" }, "ي": { count: 2, side: "below" },
  "ة": { count: 2, side: "above" },
};
const NO_DOTS: Dots = { count: 0, side: "above" };

const HAMZA: Record<string, "above" | "below"> = { "أ": "above", "إ": "below", "ؤ": "above", "ئ": "above", "لأ": "above", "لإ": "below" };

/** Vowels, tanween, shadda, sukun, superscript alif. */
const isVowelMark = (c: string) => (c >= "ً" && c <= "ْ") || c === "ٰ";
/** Combining madda and hamza: they change the letter, they are not vowels. */
const COMBINING_SEAT: Record<string, "madda" | "above" | "below"> = { "ٓ": "madda", "ٔ": "above", "ٕ": "below" };
const isArabicLetter = (c: string) => c in SKELETONS;
const TATWEEL = "ـ", ZWNJ = "‌";

export function skeletonFor(char: string, form: LetterForm): string {
  const base = SKELETONS[char];
  const joined = form === "starting" || form === "middle";
  if (joined && (base === "nun" || base === "ya")) return "ba";
  if (joined && base === "qaf") return "fa";
  return base;
}

type Raw = { char: string; at: number; marks: string[]; hamza?: "above" | "below"; madda?: true };

export function analyzePhrase(text: string): PhraseAnalysis {
  const s = text.normalize("NFC");
  const unsupported: string[] = [];
  const words: Raw[][] = [];
  let word: Raw[] = [];
  let breakBefore = new Set<number>();          // ZWNJ: a run break inside a word
  const breaks: Set<number>[] = [];
  const endWord = () => { if (word.length) { words.push(word); breaks.push(breakBefore); } word = []; breakBefore = new Set(); };
  let hasVowels = false;

  for (let i = 0; i < s.length; ) {
    const c = s[i];
    // Lam-alif: one letter whatever its hamza or madda.
    if (c === "ل" && i + 1 < s.length) {
      let j = i + 1; const between: string[] = [];
      while (j < s.length && isVowelMark(s[j])) between.push(s[j++]);
      if ("اأإآ".includes(s[j] ?? "")) {
        word.push({ char: "ل" + s[j], at: i, marks: between, ...(HAMZA["ل" + s[j]] ? { hamza: HAMZA["ل" + s[j]] } : {}), ...(s[j] === "آ" ? { madda: true as const } : {}) });
        if (between.length) hasVowels = true;
        i = j + 1; continue;
      }
    }
    if (isArabicLetter(c)) {
      word.push({ char: c, at: i, marks: [], ...(HAMZA[c] ? { hamza: HAMZA[c] } : {}), ...(c === "آ" ? { madda: true as const } : {}) });
      i++; continue;
    }
    if (isVowelMark(c)) { hasVowels = true; word[word.length - 1]?.marks.push(c); i++; continue; }
    if (c in COMBINING_SEAT) {
      const last = word[word.length - 1];
      if (last) { if (COMBINING_SEAT[c] === "madda") last.madda = true; else last.hamza = COMBINING_SEAT[c] as "above" | "below"; }
      i++; continue;
    }
    if (c === TATWEEL) { i++; continue; }
    if (c === ZWNJ) { breakBefore.add(word.length); i++; continue; }
    if (/\s/.test(c)) { endWord(); i++; continue; }
    // Anything else ends the word and cannot be drawn.
    if (!unsupported.includes(c)) unsupported.push(c);
    endWord(); i++;
  }
  endWord();

  const out: PhraseWord[] = words.map((raw, wi) => {
    // The word Allah is its own piece.
    if (raw.map((r) => r.char).join("") === "الله") {
      return { runs: [{ letters: [{ char: "الله", skeleton: "allah", form: "standalone", dots: NO_DOTS, marks: raw.flatMap((r) => r.marks), at: raw[0].at }] }] };
    }
    const runs: Raw[][] = [];
    let run: Raw[] = [];
    raw.forEach((r, k) => {
      if (breaks[wi].has(k) && run.length) { runs.push(run); run = []; }
      run.push(r);
      if (NO_FORWARD_JOIN.has(r.char)) { runs.push(run); run = []; }
    });
    if (run.length) runs.push(run);
    return {
      runs: runs.map((rs) => ({
        letters: rs.map((r, k): PhraseLetter => {
          const form: LetterForm = rs.length === 1 ? "standalone" : k === 0 ? "starting" : k === rs.length - 1 ? "finishing" : "middle";
          const joined = form === "starting" || form === "middle";
          let dots = DOTS[r.char] ?? NO_DOTS;
          if (r.char === "ي" && !joined) dots = { count: 2, side: "below" };
          if (r.char === "ئ" || r.char === "ى") dots = NO_DOTS;
          return { char: r.char, skeleton: skeletonFor(r.char, form), form, dots, marks: r.marks, at: r.at,
            ...(r.hamza ? { hamza: r.hamza } : {}), ...(r.madda ? { madda: true as const } : {}) };
        }),
      })),
    };
  });
  return { words: out, hasVowels, unsupported };
}
