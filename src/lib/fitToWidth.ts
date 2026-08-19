import type * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import {
  applyKashida,
  findKashidaSlots,
  MAX_KASHIDA_PER_SLOT,
  type KashidaSlot,
} from "./tatweel";

/**
 * Fit-to-width: choose tatweel counts across a run's legal joins so the run
 * spans a target width.
 *
 * This is the solver `tatweel.ts` was deliberately kept pure for — no React,
 * no Konva, and in particular **no font loading**. Measurement arrives as an
 * injected `measure` callback, which is what lets this module be unit-tested
 * against real harfbuzzjs (see `fitToWidth.test.ts`) while the app hands it a
 * measurement backed by the shape cache.
 *
 * It replaces the `lib/justify.ts` removed with the Morph subsystem on
 * 2026-08-14. That one could never work: the kashida dial it drove displaced
 * outline points without touching `penX += advance`, so the run's width never
 * changed and there was nothing for a solver to converge on. Tatweels are real
 * characters the font shapes, so the width genuinely moves.
 */

/**
 * Splits `total` tatweels as evenly as possible across `slotCount` joins,
 * giving the remainder to the earliest slots one at a time.
 *
 * Even distribution is what "justify" means here: piling the whole total onto
 * one join reads as a mistake rather than as elongation, and hits the per-slot
 * cap long before a wide target is met.
 */
export function distributeKashida(
  slotCount: number,
  total: number,
  maxPerSlot: number = MAX_KASHIDA_PER_SLOT
): number[] {
  const n = Math.max(0, Math.floor(slotCount));
  if (n === 0) return [];

  const cap = Math.max(0, Math.floor(maxPerSlot));
  const capped = Math.min(Math.max(0, Math.floor(total)), n * cap);
  const base = Math.floor(capped / n);
  const remainder = capped - base * n;

  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Applies one count per slot to `text`.
 *
 * Slots are applied **from the highest text offset down**. `applyKashida`
 * only rewrites the text at and after `slot.index`, so working right-to-left
 * leaves every lower offset valid; going left-to-right would shift each later
 * slot by however many characters the earlier insertion added, and every slot
 * after the first would land in the wrong place.
 */
export function applyDistribution(
  text: string,
  slots: KashidaSlot[],
  counts: number[]
): string {
  const ordered = slots
    .map((slot, i) => ({ slot, count: counts[i] ?? 0 }))
    .sort((a, b) => b.slot.index - a.slot.index);

  let out = text;
  for (const { slot, count } of ordered) {
    out = applyKashida(out, slot, count);
  }
  return out;
}

/**
 * The horizontal extent of a shaped run's actual ink, in block space.
 *
 * Mirrors `ShapedText`'s own metrics loop exactly — same pen walk, same
 * `getPath(gx, gy, fontSize)` bounding boxes, same `fontSize / unitsPerEm`
 * scale — so the number the solver optimises is the number the canvas draws.
 * Summing advances instead would be cheaper but would measure a different
 * thing: advances include the run's trailing side bearing and miss ink that
 * overhangs its own advance, both of which move as a join is stretched.
 */
export function inkExtentWidth(
  glyphs: HarfBuzzGlyph[],
  font: opentype.Font | null | undefined,
  fontSize: number,
  unitsPerEm: number
): number {
  if (!font || glyphs.length === 0) return 0;

  const upm = Math.max(unitsPerEm || 1000, 1);
  const scale = fontSize / upm;

  let penX = 0;
  let minX = Infinity;
  let maxX = -Infinity;

  for (const g of glyphs) {
    const glyphObj = font.glyphs.get(g.g);
    if (glyphObj) {
      const gx = (penX + (g.dx ?? 0)) * scale;
      const gy = -(g.dy ?? 0) * scale;
      const box = glyphObj.getPath(gx, gy, fontSize).getBoundingBox();
      if (Number.isFinite(box.x1) && Number.isFinite(box.x2)) {
        minX = Math.min(minX, box.x1);
        maxX = Math.max(maxX, box.x2);
      }
    }
    penX += g.ax ?? 0;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return 0;
  return Math.max(maxX - minX, 0);
}

export type FitToWidthOptions = {
  text: string;
  /** Desired run width, in the same space `measure` reports. */
  target: number;
  measure: (text: string) => Promise<number>;
  maxPerSlot?: number;
};

export type FitToWidthReason =
  /** The text has no join a tatweel may legally sit in. */
  | "no-slots"
  /** Even with every tatweel removed the run is at or past the target. */
  | "already-wider"
  /** Every slot is at the per-slot cap and the target is still not reached. */
  | "capped"
  /** Landed on the widest count that still fits. */
  | "fitted";

export type FitToWidthResult = {
  /** The text to write back to the block. */
  text: string;
  /** What `measure` reported for that text. */
  width: number;
  /** Total tatweels placed. */
  total: number;
  /** Per-slot counts, parallel to `findKashidaSlots(text)`. */
  counts: number[];
  slotCount: number;
  reason: FitToWidthReason;
};

/** How many measurement steps the refinement may take before giving up. */
const MAX_REFINE_STEPS = 64;

/**
 * Chooses the largest tatweel count whose run still fits within `target`.
 *
 * **Never overshoots.** Text that spills past the width it was fitted to is
 * a worse answer than text a few pixels short of it, so the search always
 * settles on the last count that fits.
 *
 * The search starts from an estimate rather than counting up from zero: one
 * measurement at 0 tatweels and one at 1 gives the per-tatweel delta, and
 * `(target - width0) / delta` lands within a step or two. Refinement then
 * walks against real measurements, because that delta is only *near*
 * constant — a font may substitute different glyphs across a stretched join,
 * so the width is not perfectly linear in the count.
 *
 * Every candidate is built from the caller's original text with **absolute**
 * counts, so an existing kashida is replaced rather than added to. That is
 * what makes the operation idempotent: fitting an already-fitted run returns
 * it unchanged instead of compounding.
 */
export async function solveFitToWidth({
  text,
  target,
  measure,
  maxPerSlot = MAX_KASHIDA_PER_SLOT,
}: FitToWidthOptions): Promise<FitToWidthResult> {
  const slots = findKashidaSlots(text);

  if (slots.length === 0) {
    return {
      text,
      width: await measure(text),
      total: 0,
      counts: [],
      slotCount: 0,
      reason: "no-slots",
    };
  }

  const cap = slots.length * Math.max(0, Math.floor(maxPerSlot));
  const textFor = (total: number) =>
    applyDistribution(
      text,
      slots,
      distributeKashida(slots.length, total, maxPerSlot)
    );
  const widthFor = (total: number) => measure(textFor(total));

  const base = textFor(0);
  const width0 = await measure(base);

  // A non-finite or non-positive target can't be fitted to; treat it the
  // same as a run that is already too wide, which returns the narrowest
  // achievable text rather than throwing.
  if (!Number.isFinite(target) || width0 >= target) {
    return {
      text: base,
      width: width0,
      total: 0,
      counts: distributeKashida(slots.length, 0, maxPerSlot),
      slotCount: slots.length,
      reason: "already-wider",
    };
  }

  const width1 = await widthFor(1);
  const delta = width1 - width0;

  // delta <= 0 means this font does not widen on a tatweel at all, which
  // the real-font tests say does not happen — but dividing by it would give
  // Infinity or a negative count, so fall back to probing from the cap.
  const estimate =
    delta > 0 ? Math.floor((target - width0) / delta) : cap;

  let total = Math.max(0, Math.min(cap, estimate));
  let width = await widthFor(total);
  let steps = 0;

  while (width > target && total > 0 && steps++ < MAX_REFINE_STEPS) {
    total -= 1;
    width = await widthFor(total);
  }

  while (total < cap && steps++ < MAX_REFINE_STEPS) {
    const nextWidth = await widthFor(total + 1);
    if (nextWidth > target) break;
    total += 1;
    width = nextWidth;
  }

  return {
    text: textFor(total),
    width,
    total,
    counts: distributeKashida(slots.length, total, maxPerSlot),
    slotCount: slots.length,
    reason: total >= cap ? "capped" : "fitted",
  };
}
