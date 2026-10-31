/**
 * The state of one stretch pull on the canvas: which count the pointer is
 * asking for, which preview is shown, and what a refusal, a rest and a
 * release mean. Pure, so the policy is testable without Konva; the overlay
 * owns the timers, the previews and the commit. No `./harfbuzz`.
 *
 * - The pointer crossing into a new cell asks for that count (clamped to the
 *   slice's range). The panel keeps showing the last preview that packed
 *   until a newer one does; a count that does not pack changes nothing.
 * - A refused count is asked for once more when the pointer rests: the
 *   packer's repack budget is a clock, so a busy machine can refuse a count
 *   it would otherwise pack. Once only, and a move on forgets it.
 * - Release commits the shown preview; back at the start it is a cancel and
 *   says nothing; otherwise nothing packed and the status line says so.
 */

/** How long the pointer must rest on a refused count before it is asked for again. */
export const PULL_REST_MS = 300;

export type KufiPull = {
  base: number;
  min: number;
  max: number;
  /** The count last asked for. */
  count: number;
  /** The count of the preview on show, or null when the panel shows its own layout. */
  shown: number | null;
  /** The count whose preview was refused, if it is still the one asked for. */
  refused: number | null;
  /** The count already asked for a second time. */
  retried: number | null;
};

export type PullRelease = { kind: "commit"; count: number } | { kind: "cancel" } | { kind: "refused" };

export function pullStart(base: number, min: number, max: number): KufiPull {
  return { base, min, max, count: base, shown: null, refused: null, retried: null };
}

/**
 * The pointer is `delta` cells along the stroke from where it pressed.
 * `request` is the count to preview, if it changed; `clear` says the pointer
 * is back at the start, so the panel's own layout is shown again.
 */
export function pullMove(p: KufiPull, delta: number): { pull: KufiPull; request: number | null; clear: boolean } {
  const count = Math.max(p.min, Math.min(p.max, p.base + delta));
  if (count === p.count) return { pull: p, request: null, clear: false };
  if (count === p.base) return { pull: { ...p, count, shown: null, refused: null, retried: null }, request: null, clear: true };
  return { pull: { ...p, count, refused: null, retried: null }, request: count, clear: false };
}

/** The packer's answer for `count`: `show` when it is the current count and packed. */
export function pullAnswer(p: KufiPull, count: number, ok: boolean): { pull: KufiPull; show: boolean } {
  if (count !== p.count) return { pull: p, show: false };
  if (ok) return { pull: { ...p, shown: count, refused: null }, show: true };
  return { pull: { ...p, refused: count }, show: false };
}

/** The pointer has rested: the current count is asked for again if it was refused and not yet retried. */
export function pullRest(p: KufiPull): { pull: KufiPull; request: number | null } {
  if (p.refused !== p.count || p.retried === p.count || p.count === p.base) return { pull: p, request: null };
  return { pull: { ...p, retried: p.count, refused: null }, request: p.count };
}

export function pullRelease(p: KufiPull): PullRelease {
  if (p.shown !== null && p.shown !== p.base) return { kind: "commit", count: p.shown };
  if (p.count === p.base) return { kind: "cancel" };
  return { kind: "refused" };
}

/**
 * The nearest count in `fitting` to `wanted` (the earlier one on a tie), or
 * `wanted` when `fitting` is null (not explored) or empty. Exploration tries
 * each slice only one and two cells either way from its drawn count
 * (`KUFI_STRETCH_STEPS`), so a pull further than that is not explored and
 * asks the packer as before.
 */
export function snapPull(wanted: number, fitting: number[] | null): number {
  if (!fitting || fitting.length === 0) return wanted;
  let best = fitting[0];
  for (const c of fitting) if (Math.abs(c - wanted) < Math.abs(best - wanted)) best = c;
  return best;
}
