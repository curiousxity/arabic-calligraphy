import { classifyJoiningForms } from "./arabicJoining";
import { ARABIC_DIACRITIC_RE } from "./diacritics";

/** U+0640 ARABIC TATWEEL — the kashida character itself. */
export const TATWEEL = "ـ";

/** What the UI's stepper allows at one slot. Purely a UI bound; the pure
 *  functions below accept any non-negative count, so a future fit-to-width
 *  solver is not boxed in by it. */
export const MAX_KASHIDA_PER_SLOT = 8;

export type KashidaSlot = {
  /** Insertion offset into the block's text (UTF-16 code units). */
  index: number;
  /** The letter pair the slot sits between, for UI labels. */
  before: string;
  after: string;
};

// The alef family a lam fuses with. HarfBuzz substitutes lam+alef into a
// single لا ligature glyph, and a tatweel between them breaks it into two
// unconnected letterforms — never a legal kashida, in any font.
const ALEF_FAMILY = new Set(["آ", "أ", "إ", "ا"]);
const LAM = "ل";

const isTransparent = (ch: string) => ARABIC_DIACRITIC_RE.test(ch);

/**
 * Scans the existing tatweel run that starts at `index`, which is the
 * position of the first cursive participant after the slot's `before`
 * letter. Combining marks are only skipped *inside* a run (a mark sitting
 * on a tatweel), never before one — a mark that precedes the run belongs to
 * the base letter and lives at a lower index than the slot.
 */
function scanRun(text: string, index: number): { positions: number[]; end: number } {
  const positions: number[] = [];
  let pos = index;
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === TATWEEL) {
      positions.push(pos);
      pos += 1;
      continue;
    }
    if (positions.length > 0 && isTransparent(ch)) {
      pos += 1;
      continue;
    }
    break;
  }
  return { positions, end: pos };
}

/**
 * Every legal tatweel insertion point in `text`: after a dual-joining letter
 * whose successor joins back to it.
 *
 * `classifyJoiningForms` does the joining analysis (and the transparency
 * rules for combining marks) — a letter whose form is `initial` or `medial`
 * is by definition one that joins forward, and the next character it has a
 * form at all is by definition the letter it joins to, because an
 * intervening non-joining character would have made this letter `final` or
 * `isolated` instead.
 *
 * An existing run of tatweels between two letters is *one* slot described by
 * the letters on either side of it, not one slot per tatweel — so the
 * stepper's count is the run's length and setting it is absolute.
 */
export function findKashidaSlots(text: string): KashidaSlot[] {
  const classified = classifyJoiningForms(text);
  const participants = classified.filter((c) => c.form !== null);
  const slots: KashidaSlot[] = [];

  for (let p = 0; p < participants.length; p++) {
    const cur = participants[p];
    if (cur.char === TATWEEL) continue;
    if (cur.form !== "initial" && cur.form !== "medial") continue;

    // Skip past any tatweel run already sitting in this gap to reach the
    // letter that actually terminates the join.
    let q = p + 1;
    while (q < participants.length && participants[q].char === TATWEEL) q += 1;
    const successor = participants[q];
    if (!successor) continue;

    if (cur.char === LAM && ALEF_FAMILY.has(successor.char)) continue;

    slots.push({
      index: participants[p + 1].index,
      before: cur.char,
      after: successor.char,
    });
  }

  return slots;
}

/**
 * Returns `text` with exactly `count` tatweels at `slot`, replacing however
 * many are already there — the control is absolute, not additive, so the
 * stepper reads and writes the same number.
 */
export function applyKashida(text: string, slot: KashidaSlot, count: number): string {
  const wanted = Math.max(0, Math.floor(count));
  const { positions, end } = scanRun(text, slot.index);

  // Everything in the run that is not a tatweel (a mark stacked on one) is
  // kept, so removing tatweels never silently drops a diacritic.
  const kept = text
    .slice(slot.index, end)
    .split("")
    .filter((_, i) => !positions.includes(slot.index + i))
    .join("");

  return text.slice(0, slot.index) + TATWEEL.repeat(wanted) + kept + text.slice(end);
}

/** The tatweel count currently sitting at each slot, keyed by `slot.index` —
 *  so a re-opened block shows its own state rather than resetting to zero. */
export function readKashida(text: string, slots: KashidaSlot[]): Map<number, number> {
  return new Map(slots.map((slot) => [slot.index, scanRun(text, slot.index).positions.length]));
}
