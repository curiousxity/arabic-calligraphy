import { tileFbm } from "../_noise";
import type { TextureDef } from "../types";

/**
 * Laid paper: the close horizontal wire lines plus the widely spaced chain
 * lines a laid mould leaves. Both are periodic in the tile by construction
 * (an integer number of cycles across it), so the ruling never drifts out of
 * phase at the tile edge.
 */
const LINES = 32;
const CHAINS = 4;

const laidPaper: TextureDef = {
  id: "laid-paper",
  name: "Laid paper",
  nameAr: "ورق مضلّع",
  size: 256,
  defaultTint: "#f2ecdd",
  grain(u, v) {
    const wire = Math.sin(v * Math.PI * 2 * LINES) * 0.5 + 0.5;
    const chain = Math.sin(u * Math.PI * 2 * CHAINS) * 0.5 + 0.5;
    const tooth = tileFbm(u, v, 48, 3, 5) - 0.5;
    return -wire * 0.07 - chain ** 6 * 0.1 + tooth * 0.1;
  },
};

export default laidPaper;
