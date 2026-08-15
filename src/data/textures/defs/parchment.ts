import { tileFbm, tileSpeckle } from "../_noise";
import type { TextureDef } from "../types";

/**
 * Vellum-ish parchment: broad cloudy mottling with a scatter of darker
 * flecks, the way a skin-based sheet pools unevenly.
 */
const parchment: TextureDef = {
  id: "parchment",
  name: "Parchment",
  nameAr: "رَقّ",
  size: 256,
  defaultTint: "#efe3c8",
  grain(u, v) {
    const cloud = tileFbm(u, v, 6, 4, 11) - 0.5;
    const tooth = tileFbm(u, v, 64, 2, 29) - 0.5;
    const flecks = tileSpeckle(u, v, 64, 0.28, 0.09, 41);
    return cloud * 0.14 + tooth * 0.12 - flecks * 0.16;
  },
};

export default parchment;
