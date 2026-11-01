/**
 * The Kufi panel's status line: what the packer's answer for the block's
 * current inputs means to the person looking at the panel. Pure: no React,
 * no `./harfbuzz`.
 */
import type { KufiPackResult } from "./kufiPack";

type Size = { cols: number; rows: number };

export type KufiPanelStatus = { text: string; suggestions: Size[] };

/**
 * The dashed frame (Konva props, in the block's colour) of something with no
 * ink to show: a panel's box in `KufiUnfitFrame`, a star's unpacked region in
 * `KufiStarView`. Editor chrome only.
 */
export const KUFI_UNFIT_FRAME_STYLE = {
  opacity: 0.4,
  strokeWidth: 2,
  strokeScaleEnabled: false,
  dash: [8, 6],
} as const;

export const kufiSizeLabel = (s: Size) => `${s.cols}×${s.rows}`;

/**
 * `result` is the cached answer for the current inputs (undefined while the
 * worker is still packing them), `failed` whether the packer threw on them.
 * Null when the panel packed cleanly and there is nothing to say.
 */
export function kufiPanelStatus(result: KufiPackResult | undefined, failed: boolean, size: Size): KufiPanelStatus | null {
  const say = (text: string, suggestions: Size[] = []) => ({ text, suggestions });
  if (failed) return say("Couldn't arrange this text");
  if (!result) return say("Arranging…");
  if (result.ok) return result.editsBreakPacking ? say("Painted cells leave a gap") : null;
  if (result.reason === "pinConflict") return say("A pinned edit can't stay where it is at this size");
  const base = result.reason === "tooLong" ? `Too long for ${kufiSizeLabel(size)}` : "Too short to fill a box";
  return result.suggestions.length > 0 ? say(`${base} — try`, result.suggestions) : say(base);
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Where a canvas notice's label goes, beside a letter's box (all in the
 * panel's px): to the right with `gap` between, else to the left, whichever
 * keeps it inside the panel's width; when neither does, the roomier side.
 * Level with the box's top, kept inside the panel's height where it fits.
 */
export function kufiNoticeAt(
  box: Rect,
  panel: { width: number; height: number },
  label: { width: number; height: number },
  gap: number
): { x: number; y: number } {
  const right = box.x + box.width + gap;
  const left = box.x - gap - label.width;
  const x =
    right + label.width <= panel.width
      ? right
      : left >= 0
        ? left
        : panel.width - (box.x + box.width) >= box.x
          ? right
          : left;
  const y = Math.max(0, Math.min(box.y, panel.height - label.height));
  return { x, y };
}
