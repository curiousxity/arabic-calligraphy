import { tileFbm, tileSpeckle } from "../_noise";
import type { TextureDef } from "../types";

/**
 * Washi: long pale fibres suspended in a soft sheet. The fibres come from
 * noise sampled on a strongly anisotropic lattice — cheap, and it reads as
 * direction rather than as blobs.
 */
const washi: TextureDef = {
  id: "washi",
  name: "Fibrous washi",
  nameAr: "ورق ليفي",
  size: 256,
  defaultTint: "#f6f1e4",
  grain(u, v) {
    // A lattice 32× finer down the page than across it stretches every
    // feature along u, which is what makes a fibre rather than a speck.
    const fibres = tileFbm(u, v, 6, 2, 71, 128) - 0.5;
    const sheet = tileFbm(u, v, 12, 3, 83) - 0.5;
    const motes = tileSpeckle(u, v, 56, 0.3, 0.07, 97);
    return fibres * 0.13 + sheet * 0.07 + motes * 0.14;
  },
};

export default washi;
