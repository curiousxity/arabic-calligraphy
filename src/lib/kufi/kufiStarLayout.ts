/**
 * A Kufi star panel's text: each region's string packed into its region's
 * mask (`packKufiRegion`). Every region of one kind is a rotation of the
 * kind's first, with the same mask, so each distinct (kind, text) is packed
 * once and every other region of that kind takes the same result; the view
 * places it through that region's own frame, so no cells are rotated here.
 * Pure: no React, no Konva, no `./harfbuzz`.
 */
import { packKufiRegion, type KufiPackResult } from "./kufiPack";
import { starConstruction, type StarFold } from "./kufiStarGeometry";

export type KufiStarInputs = { fold: StarFold; k: number; size: number; regions: string[] };

export type KufiStarLayout = {
  regions: Array<{ text: string; result: KufiPackResult | null }>; // null for "" (pattern only)
  unpacked: number[]; // indices whose text did not pack
};

/** The layout inputs of a star block: nothing else of the block is read. */
export function kufiStarInputs(b: { starFold: StarFold; starK: number; starSize: number; starRegions: string[] }): KufiStarInputs {
  return { fold: b.starFold, k: b.starK, size: b.starSize, regions: b.starRegions };
}

/** The cache key: the layout's inputs and nothing else. */
export function kufiStarKey(i: KufiStarInputs): string {
  return JSON.stringify([i.fold, i.k, i.size, i.regions]);
}

/** Regions with text to pack: an upper bound on the packs one layout runs. */
export function kufiStarTextCount(i: KufiStarInputs): number {
  return i.regions.filter((t) => t.trim() !== "").length;
}

export function layoutKufiStar(i: KufiStarInputs): KufiStarLayout {
  const c = starConstruction(i.fold, i.k, i.size);
  const packed = new Map<string, KufiPackResult>();
  const regions = c.regions.map((r) => {
    const text = i.regions[r.index] ?? "";
    if (text.trim() === "") return { text, result: null };
    const key = JSON.stringify([r.kind, text]);
    let result = packed.get(key);
    if (!result) {
      // Regions of a kind are rotations of each other and share one mask.
      const first = c.regions.find((q) => q.kind === r.kind)!;
      result = packKufiRegion({ text, mask: first.mask });
      packed.set(key, result);
    }
    return { text, result };
  });
  const unpacked = regions.flatMap((r, index) => (r.result && !r.result.ok ? [index] : []));
  return { regions, unpacked };
}

/**
 * The star's status line (the pattern of `kufiPanelStatus`): `layout` is the
 * answer for the current inputs (null while the worker is still packing),
 * `failed` whether the packer threw on them. Null when there is nothing to say.
 */
export function kufiStarStatus(layout: KufiStarLayout | null, failed: boolean): string | null {
  if (failed) return "Couldn't arrange this text";
  if (!layout) return "Arranging…";
  const n = layout.unpacked.length;
  if (n === 0) return null;
  return n === 1 ? "1 region doesn't fit" : `${n} regions don't fit`;
}
