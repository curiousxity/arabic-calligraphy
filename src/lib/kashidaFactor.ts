import type { GlyphStretchHandle } from "../types";
import { snapStretchFactor } from "./strokeSchema/quantize";

export type KashidaSnap = {
  fontFamily: string;
  /** The user's "Snap strokes to nuqta" toggle. */
  enabled: boolean;
};

/**
 * The block-level Kashida dial's distribution formula, in one place.
 *
 * It used to be written out twice — once in `App.tsx`'s
 * `setBlockKashidaAmount` (a state mutator) and once in `lib/justify.ts`'s
 * `applyKashidaAmountToEdits` (pure, so the auto-justify solver can evaluate
 * dozens of candidate dial positions without touching state). Those two
 * copies had to be kept in step by hand: if they ever diverged, the solver
 * would report a width that applying the very amount it returned would not
 * produce, and nothing would fail loudly. Nuqta quantization is exactly the
 * kind of change that would have diverged them, so the formula moved here
 * and both call sites now call this.
 *
 * Returns `null` for a handle the dial must not touch, so a caller can
 * cleanly leave that handle's object identity alone.
 */
export function kashidaFactorForHandle(
  h: GlyphStretchHandle,
  amount: number,
  snap?: KashidaSnap
): number | null {
  if (!h.kashidaEligible || h.maxFactor == null) return null;

  const clampedAmount = Math.max(0, Math.min(100, amount));
  const weight = (h.priority ?? 5) / 10;
  const raw = Math.min(h.maxFactor, 1 + (h.maxFactor - 1) * (clampedAmount / 100) * weight);

  if (!snap) return raw;

  return snapStretchFactor({
    factor: raw,
    lengthDots: h.lengthDots,
    fontFamily: snap.fontFamily,
    minFactor: h.minFactor ?? 0,
    maxFactor: h.maxFactor,
    enabled: snap.enabled,
  });
}
