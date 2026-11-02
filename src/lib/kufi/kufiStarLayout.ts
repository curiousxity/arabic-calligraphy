/**
 * A Kufi star panel's text, laid out for one of its two layouts:
 *
 * - **`octagon`** (the 4-fold default): one text runs round the four sides
 *   of a square, turned by rotation, and its tall strokes lengthen inward to
 *   an open octagon at the centre (`kufiOctagon.ts`). `regions[0]` is the
 *   side's text (with its repeats); `size` the square's side in cells.
 * - **`wedges`**: the compass-and-ruler construction (`kufiStarGeometry.ts`),
 *   each region's string packed into its region's mask (`packKufiRegion`).
 *   Every region of one kind is a rotation of the kind's first, with the
 *   same mask, so each distinct (kind, text) is packed once and every other
 *   region of that kind takes the same result; the view places it through
 *   that region's own frame, so no cells are rotated here.
 *
 * Pure: no React, no Konva, no `./harfbuzz`.
 */
import { kufiFormsOf, packKufiRegion, type KufiPackResult } from "./kufiPack";
import { layoutKufiOctagon, OCTAGON_DEPTH, OCTAGON_MAX_SIZE, OCTAGON_MIN_SIZE, type KufiOctagonLayout } from "./kufiOctagon";
import { starConstruction, type StarFold } from "./kufiStarGeometry";
import { resolveKufiText } from "./kufiWords";

export type KufiStarLayoutKind = "wedges" | "octagon";

export type KufiStarInputs = { layout: KufiStarLayoutKind; fold: StarFold; k: number; size: number; regions: string[] };

export type KufiStarLayout = {
  regions: Array<{ text: string; result: KufiPackResult | null }>; // null for "" (pattern only)
  unpacked: number[]; // indices whose text did not pack
  /** The octagon layout's square (present, null when its side's text did not pack); absent for the wedges layout. */
  octagon?: KufiOctagonLayout | null;
};

/** The layout inputs of a star block: nothing else of the block is read. A save without `starLayout` is the wedges layout. */
export function kufiStarInputs(b: {
  starLayout?: KufiStarLayoutKind;
  starFold: StarFold;
  starK: number;
  starSize: number;
  starRegions: string[];
}): KufiStarInputs {
  return { layout: b.starLayout ?? "wedges", fold: b.starFold, k: b.starK, size: b.starSize, regions: b.starRegions };
}

/** The cache key: the layout's inputs and nothing else. */
export function kufiStarKey(i: KufiStarInputs): string {
  return JSON.stringify([i.layout, i.fold, i.k, i.size, i.regions]);
}

/** Regions with text to pack: an upper bound on the packs one layout runs. */
export function kufiStarTextCount(i: KufiStarInputs): number {
  return i.regions.filter((t) => t.trim() !== "").length;
}

/** The side text of an octagon layout: its first region. */
export function octagonSideText(i: Pick<KufiStarInputs, "regions">): string {
  return i.regions[0] ?? "";
}

/**
 * The square an octagon layout starts on for `text` along each side once:
 * the line the text's region forms take at their authored widths, a gap
 * between letters, plus the band's depth. An estimate for a fresh switch to
 * the layout, within the size bounds; Find layouts measures.
 */
export function octagonSizeFor(text: string): number {
  const { units } = resolveKufiText(text);
  const line = units.reduce((n, u) => n + (kufiFormsOf(u, "octagon")[0]?.rows[0]?.length ?? 1) + 1, 0) - 1;
  return Math.min(OCTAGON_MAX_SIZE, Math.max(OCTAGON_MIN_SIZE, line + OCTAGON_DEPTH));
}

export function layoutKufiStar(i: KufiStarInputs): KufiStarLayout {
  if (i.layout === "octagon") {
    const text = octagonSideText(i);
    if (text.trim() === "") return { regions: [{ text, result: null }], unpacked: [], octagon: null };
    const { layout, band } = layoutKufiOctagon(i.size, text);
    return { regions: [{ text, result: band }], unpacked: layout ? [] : [0], octagon: layout };
  }
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
 * `failed` whether the packer threw on them. An outline wider than 0 adds
 * the panel's warning that it exports as a second path (the SVG is then no
 * longer one path a laser cutter can follow). Null when there is nothing to say.
 */
export function kufiStarStatus(layout: KufiStarLayout | null, failed: boolean, strokeWidth = 0): string | null {
  const text = kufiStarTextStatus(layout, failed);
  const outline = strokeWidth > 0 ? "The outline exports as a separate path." : null;
  return text && outline ? `${text}
${outline}` : text ?? outline;
}

function kufiStarTextStatus(layout: KufiStarLayout | null, failed: boolean): string | null {
  if (failed) return "Couldn't arrange this text";
  if (!layout) return "Arranging…";
  const n = layout.unpacked.length;
  if (n === 0) return null;
  if ("octagon" in layout) {
    const r = layout.regions[0]?.result;
    return r && !r.ok && r.reason === "tooShort" ? "The text leaves a side open: a bigger text or a smaller size" : "The text doesn't fit a side at this size";
  }
  return n === 1 ? "1 region doesn't fit" : `${n} regions don't fit`;
}

/** A layout with nothing to report: what a star with no region text is, as far as its status goes. */
export const KUFI_STAR_NO_TEXT: KufiStarLayout = { regions: [], unpacked: [] };
