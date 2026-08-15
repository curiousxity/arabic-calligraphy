import { tileFbm } from "../_noise";
import type { TextureDef } from "../types";

/**
 * Linen weave: a woven cloth board, for pieces meant to look mounted rather
 * than written on paper. The over/under of the weave is a product of two
 * out-of-phase rulings, both with a whole number of cycles per tile.
 */
const THREADS = 48;

const linen: TextureDef = {
  id: "linen",
  name: "Linen weave",
  nameAr: "نسيج كتّان",
  size: 256,
  defaultTint: "#e8e1d1",
  grain(u, v) {
    const warp = Math.sin(u * Math.PI * 2 * THREADS);
    const weft = Math.sin(v * Math.PI * 2 * THREADS);
    // Which thread is on top alternates cell by cell, so the sheen swaps
    // between the two rulings the way a real weave does.
    // Offset half a cell so the tile edge falls mid-cell rather than exactly
    // on a zero of the sine, where `Math.sign` would flip on floating-point
    // dust and put a hairline seam down every tile boundary.
    const cell = (t: number) => Math.sin((t + 0.5 / THREADS) * Math.PI * THREADS);
    const over = Math.sign(cell(u) * cell(v));
    const slub = tileFbm(u, v, 24, 3, 17) - 0.5;
    return (over > 0 ? warp : weft) * 0.09 + slub * 0.1;
  },
};

export default linen;
