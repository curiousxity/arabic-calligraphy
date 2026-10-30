/**
 * The Kufi panel's status line: what the packer's answer for the block's
 * current inputs means to the person looking at the panel. Pure: no React,
 * no `./harfbuzz`.
 */
import type { KufiPackResult } from "./kufiPack";

type Size = { cols: number; rows: number };

export type KufiPanelStatus = { text: string; suggestions: Size[] };

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
