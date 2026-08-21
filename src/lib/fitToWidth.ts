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
export function inkExtentBox(
  glyphs: HarfBuzzGlyph[],
  font: opentype.Font | null | undefined,
  fontSize: number,
  unitsPerEm: number
): { width: number; height: number } {
  if (!font || glyphs.length === 0) return { width: 0, height: 0 };

  const upm = Math.max(unitsPerEm || 1000, 1);
  const scale = fontSize / upm;

  let penX = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

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
      // The height is not decoration: the italic shear widens a run by a
      // fraction of it, so `styledRunWidth` cannot do its job without it.
      if (Number.isFinite(box.y1) && Number.isFinite(box.y2)) {
        minY = Math.min(minY, box.y1);
        maxY = Math.max(maxY, box.y2);
      }
    }
    penX += g.ax ?? 0;
  }

  return {
    width: Number.isFinite(minX) && Number.isFinite(maxX) ? Math.max(maxX - minX, 0) : 0,
    height: Number.isFinite(minY) && Number.isFinite(maxY) ? Math.max(maxY - minY, 0) : 0,
  };
}

/** The horizontal half of `inkExtentBox`, for callers with no style to apply. */
export function inkExtentWidth(
  glyphs: HarfBuzzGlyph[],
  font: opentype.Font | null | undefined,
  fontSize: number,
  unitsPerEm: number
): number {
  return inkExtentBox(glyphs, font, fontSize, unitsPerEm).width;
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

/**
 * Extra width the renderer adds on top of the glyph outlines.
 *
 * These mirror `ShapedText` exactly and it imports them from here, so the two
 * cannot drift — a fit that measured only the outlines would promise a width
 * it then overshot for every italic, bold or outlined block.
 */
export const ITALIC_SHEAR = 0.25;
export const fauxBoldStrokeWidth = (fontSize: number) =>
  Math.max(fontSize * 0.035, 0.6);

/**
 * How far a full-strength `warpX` can spread a run, as a fraction of its own
 * width. `lib/warp.ts` displaces each point by `(warpX / 100) * ny * width *
 * 0.25` with `ny` clamped to [-1, 1], so the extent grows by twice that
 * quarter-width at most — hence 0.5, not 0.25.
 */
export const WARP_X_SPREAD = 0.5;

/** Style that widens a drawn run beyond its raw outline extent. */
export type RunStyle = {
  italic?: boolean;
  bold?: boolean;
  /** The block's outline width, which straddles the path. */
  strokeWidth?: number;
  /** The block's horizontal warp, in the slider's own -100..100 units. */
  warpX?: number;
  /**
   * Width added by straight-stroke cuts, from
   * `cutAdvanceTotal(block.strokeCuts, nuqtaUnits(...))`. Passed in already
   * summed rather than as the cuts themselves, so this module stays free of
   * nuqta and glyph geometry; the shared helper is what keeps the number the
   * same one the renderer lays out with.
   */
  cutWidth?: number;
};

/**
 * The drawn width of a run whose raw outline extent is `box`.
 *
 * A canvas stroke straddles the path it follows, so half of it falls outside
 * the outline on each side and the full width is added once. The italic shear
 * maps `x' = x - ITALIC_SHEAR·y`, widening the extent by that fraction of the
 * run's *height*. `warpX` slides points sideways by a fraction of the run's
 * own width. All four are summed independently rather than composed, which
 * slightly over-estimates — the safe direction for a promise never to
 * overshoot.
 *
 * The warp term is the only deliberately loose one: it is the widest the
 * distortion *can* push the extent, whereas the actual spread depends on
 * where the ink sits vertically. A block with no warp — every block, until
 * the slider is touched — pays nothing for it.
 */
export function styledRunWidth(
  box: { width: number; height: number },
  fontSize: number,
  style: RunStyle = {}
): number {
  const shear = style.italic ? ITALIC_SHEAR * box.height : 0;
  const bold = style.bold ? fauxBoldStrokeWidth(fontSize) : 0;
  const outline = Math.max(style.strokeWidth ?? 0, 0);
  const warp =
    (Math.abs(style.warpX ?? 0) / 100) * Math.max(box.width, 1) * WARP_X_SPREAD;
  // Cuts add width the shaping measurement cannot see — they are geometry,
  // not characters. Without this term a fit promises a width a stretched
  // block then visibly exceeds, which is the exact bug this term list exists
  // to prevent.
  const cuts = Math.max(style.cutWidth ?? 0, 0);
  return box.width + shear + bold + outline + warp + cuts;
}

/**
 * Chooses the largest tatweel count whose run still fits within `target`.
 *
 * **Never overshoots.** Text that spills past the width it was fitted to is
 * a worse answer than text a few pixels short of it, so the search always
 * settles on the last count that fits.
 *
 * The search is a binary search over the count, so it costs about
 * log2(slots x maxPerSlot) measurements — a handful — and is bounded by
 * construction rather than by a step budget. It assumes width rises with the
 * count, which is what `tatweel.test.ts` measures in real fonts, but it does
 * not *depend* on that: the answer it returns was always measured to fit.
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

  // Binary search for the largest count that still fits.
  //
  // This replaces an estimate-then-walk scheme (measure at 0 and 1, divide
  // the gap by the per-tatweel delta, then step to the answer). That was
  // fine in the common case but had two holes a bounded search does not: a
  // font whose 1-tatweel candidate is not wider — real, since a tatweel can
  // decompose a ligature — gave a delta of zero or less and no usable
  // estimate, and the step budget that guarded the resulting long walk could
  // run out *while still over the target*, returning overshooting text
  // reported as a successful fit.
  //
  // `best` only ever advances to a count whose width was actually measured
  // at or under the target, so the returned width cannot exceed it no matter
  // how non-monotonic the font makes the sequence. Count 0 is known to fit
  // (checked above), which is what makes that guarantee total.
  let lo = 1;
  let hi = cap;
  let best = 0;
  let width = width0;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midWidth = await widthFor(mid);
    if (midWidth <= target) {
      best = mid;
      width = midWidth;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const total = best;

  return {
    text: textFor(total),
    width,
    total,
    counts: distributeKashida(slots.length, total, maxPerSlot),
    slotCount: slots.length,
    reason: total >= cap ? "capped" : "fitted",
  };
}
