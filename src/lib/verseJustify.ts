import type { TextBlock } from "../types";
import {
  applyDistributionWithEdits,
  solveFitToWidth,
  type DistributionEdit,
} from "./fitToWidth";
import { countSpacingBoundaries } from "./spacing";
import { findKashidaSlots, MAX_KASHIDA_PER_SLOT } from "./tatweel";

/**
 * Justifies one line of a verse to a target width: shrink if too wide,
 * kashida first, then spacing for what kashida cannot reach.
 *
 * Pure, with measurement injected — the same shape as `solveFitToWidth`,
 * which it reuses — so it stays Vitest-importable and never imports
 * `./harfbuzz`. Never overshoots: every width it returns was measured at or
 * under the target.
 */

export const JUSTIFY_TOLERANCE = 1;
const SHRINK_STEP = 0.99;
const MAX_SHRINK_STEPS = 40;

export type LineSpacing = { letter: number; word: number };
export type LineMeasure = (text: string, fontSize: number, spacing: LineSpacing) => Promise<number>;

export type JustifyLineInput = {
  text: string;
  baseFontSize: number;
  /** The user's own spacing, with any earlier Justify's additions already removed. */
  userSpacing: LineSpacing;
  target: number;
  measure: LineMeasure;
  maxPerSlot?: number;
};

export type JustifyLineResult = {
  text: string;
  /** Replay over offset-keyed data via `kashidaTextPatch`, in this order. */
  edits: DistributionEdit[];
  fontSize: number;
  addedLetter: number;
  addedWord: number;
  width: number;
  shrunk: boolean;
  reason: "justified" | "short";
};

/** `text` with every slot's kashida removed. */
export function stripKashida(text: string): string {
  const slots = findKashidaSlots(text);
  return applyDistributionWithEdits(text, slots, slots.map(() => 0)).text;
}

/** A line's width with no kashida — what "the widest line" is judged by. */
export function naturalWidth(
  text: string,
  fontSize: number,
  spacing: LineSpacing,
  measure: LineMeasure
): Promise<number> {
  return measure(stripKashida(text), fontSize, spacing);
}

export async function justifyLine({
  text,
  baseFontSize,
  userSpacing,
  target,
  measure,
  maxPerSlot = MAX_KASHIDA_PER_SLOT,
}: JustifyLineInput): Promise<JustifyLineResult> {
  // 1. Shrink. Always judged from the base size, so a line shrunk for a
  //    narrow target grows back when the target widens.
  const stripped = stripKashida(text);
  let fontSize = baseFontSize;
  let shrunk = false;
  const natural = await measure(stripped, fontSize, userSpacing);
  if (natural > target && natural > 0) {
    shrunk = true;
    fontSize = (baseFontSize * target) / natural;
    for (let i = 0; i < MAX_SHRINK_STEPS; i++) {
      if ((await measure(stripped, fontSize, userSpacing)) <= target) break;
      fontSize *= SHRINK_STEP;
    }
  }

  // 2. Kashida. Absolute counts from the caller's text, so an earlier run's
  //    tatweel is replaced, not added to.
  const fit = await solveFitToWidth({
    text,
    target,
    measure: (candidate) => measure(candidate, fontSize, userSpacing),
    maxPerSlot,
  });
  let width = fit.width;
  let added = 0;

  // 3. Spacing fill for what kashida could not reach. Width is linear in the
  //    added amount, so a first guess plus one secant correction lands on
  //    it; both candidates are measured, and only one at or under the target
  //    is ever kept.
  if (target - width > JUSTIFY_TOLERANCE) {
    const { pieceBreaks, wordGaps } = countSpacingBoundaries(fit.text);
    const n = pieceBreaks + wordGaps;
    if (n > 0 && fontSize > 0) {
      const at = (e: number) =>
        measure(fit.text, fontSize, { letter: userSpacing.letter + e, word: userSpacing.word + e });
      const e1 = (target - width) / n / fontSize;
      const w1 = await at(e1);
      let best = 0;
      let bestWidth = width;
      if (w1 <= target && w1 > bestWidth) {
        best = e1;
        bestWidth = w1;
      }
      if (w1 !== width) {
        const e2 = (e1 * (target - width)) / (w1 - width);
        if (Number.isFinite(e2) && e2 > 0 && e2 !== e1) {
          const w2 = await at(e2);
          if (w2 <= target && w2 > bestWidth) {
            best = e2;
            bestWidth = w2;
          }
        }
      }
      added = best;
      width = bestWidth;
    }
  }

  return {
    text: fit.text,
    edits: fit.edits,
    fontSize,
    addedLetter: added,
    addedWord: added,
    width,
    shrunk,
    reason: target - width <= JUSTIFY_TOLERANCE ? "justified" : "short",
  };
}

/** The size Justify should start from: the user's own if they changed it since. */
export function baseFontSizeForLine(b: TextBlock): number {
  const v = b.verse;
  if (!v) return b.fontSize;
  return b.fontSize === v.fittedFontSize ? v.baseFontSize : b.fontSize;
}

/** The user's own spacing, with the last Justify's additions taken back off. */
export function baseSpacingForLine(b: TextBlock): LineSpacing {
  return {
    letter: (b.letterSpacing ?? 0) - (b.verse?.addedLetter ?? 0),
    word: (b.wordSpacing ?? 0) - (b.verse?.addedWord ?? 0),
  };
}

export function describeVerseResult(results: readonly JustifyLineResult[], target: number): string {
  const n = results.length;
  const shrunk = results.filter((r) => r.shrunk).length;
  const short = results.filter((r) => r.reason === "short").length;
  let msg = `${n} ${n === 1 ? "line" : "lines"} justified to ${Math.round(target)} px`;
  if (shrunk > 0) msg += ` · ${shrunk} shrunk`;
  if (short > 0) msg += ` · ${short} couldn't reach full width`;
  return msg;
}
