export type JoiningForm = "isolated" | "initial" | "medial" | "final";
type JoiningType = "D" | "R" | "T" | "U";

export type ClassifiedChar = {
  index: number;
  char: string;
  codepoint: number;
  /** null for non-letters (spaces, punctuation, digits) and transparent combining marks — they have no cursive-joining form. */
  form: JoiningForm | null;
};

// Dual-joining letters (join to both the previous and next letter). Includes
// tatweel (0640), which is join-causing filler rather than a "real" letter,
// and a handful of common Persian/Urdu extensions since this app ships fonts
// for those scripts too — not exhaustive of every Unicode Arabic-block
// extension letter.
const DUAL_JOINING = new Set<number>([
  0x0626, 0x0628, 0x062a, 0x062b, 0x062c, 0x062d, 0x062e, 0x0633, 0x0634,
  0x0635, 0x0636, 0x0637, 0x0638, 0x0639, 0x063a, 0x0640, 0x0641, 0x0642,
  0x0643, 0x0644, 0x0645, 0x0646, 0x0647, 0x064a,
  0x0679, 0x067e, 0x0686, 0x06a9, 0x06af, 0x06cc,
]);

// Right-joining letters (only ever accept a join from the previous letter;
// never extend a join forward — isolated/final forms only).
const RIGHT_JOINING = new Set<number>([
  0x0622, 0x0623, 0x0624, 0x0625, 0x0627, 0x0629, 0x062f, 0x0630, 0x0631,
  0x0632, 0x0648, 0x0649,
  0x0688, 0x0691, 0x0698,
]);

// Combining marks (harakat, tanween, sukun, shadda, Quranic annotation
// signs) — same ranges as ARABIC_DIACRITIC_RE in lib/harfbuzz.ts. These are
// "transparent": they don't break the cursive join chain and are skipped
// over when looking for a letter's joining neighbor.
function isTransparent(cp: number): boolean {
  return (
    (cp >= 0x0610 && cp <= 0x061a) ||
    (cp >= 0x064b && cp <= 0x065f) ||
    cp === 0x0670 ||
    (cp >= 0x06d6 && cp <= 0x06dc) ||
    (cp >= 0x06df && cp <= 0x06e4) ||
    (cp >= 0x06e7 && cp <= 0x06e8) ||
    (cp >= 0x06ea && cp <= 0x06ed)
  );
}

function joiningType(cp: number): JoiningType {
  if (isTransparent(cp)) return "T";
  if (DUAL_JOINING.has(cp)) return "D";
  if (RIGHT_JOINING.has(cp)) return "R";
  return "U";
}

/**
 * Classifies every character in `text` (indexed by UTF-16 code unit, so
 * indices line up with HarfBuzz cluster offsets — see the `cl`-indexing note
 * in lib/harfbuzz.ts) into its Arabic cursive-joining form. This is the same
 * dual/right/transparent/non-joining letter classification HarfBuzz's own
 * Arabic shaper uses internally to pick GSUB isol/init/medi/fina features,
 * just not exposed by harfbuzzjs — so it's reimplemented here, independent of
 * any font, purely from Unicode script rules.
 */
export function classifyJoiningForms(text: string): ClassifiedChar[] {
  const types: JoiningType[] = [];
  const codepoints: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i) ?? 0;
    codepoints.push(cp);
    types.push(joiningType(cp));
  }

  const prevParticipant = (i: number): JoiningType | null => {
    for (let j = i - 1; j >= 0; j--) {
      if (types[j] === "T") continue;
      if (types[j] === "U") return null;
      return types[j];
    }
    return null;
  };

  const nextParticipant = (i: number): JoiningType | null => {
    for (let j = i + 1; j < types.length; j++) {
      if (types[j] === "T") continue;
      if (types[j] === "U") return null;
      return types[j];
    }
    return null;
  };

  return Array.from(text).map((char, i) => {
    const type = types[i];
    let form: JoiningForm | null = null;

    if (type === "D" || type === "R") {
      const prevJoinsIntoMe = prevParticipant(i) === "D";
      const nextJoinsFromMe = type === "D" && nextParticipant(i) !== null;

      form = prevJoinsIntoMe
        ? nextJoinsFromMe
          ? "medial"
          : "final"
        : nextJoinsFromMe
          ? "initial"
          : "isolated";
    }

    return { index: i, char, codepoint: codepoints[i], form };
  });
}
