import type { OrnamentDef } from "../../lib/ornaments";

/**
 * The boteh (paisley) droplet: a full body that narrows into a tip curling
 * over to one side. All four quadrants are hand-placed cubics rather than a
 * deformed ellipse, so the tip can hook without dragging the body with it.
 */
export default {
  id: "boteh",
  name: "Boteh (teardrop)",
  nameAr: "بته",
  tags: ["motif", "droplet"],
  viewBox: { w: 180, h: 260 },
  paths: [
    "M 25 176 " +
      "C 25 122 52 88 84 78 " +
      "C 99 52 120 36 152 26 " +
      "C 132 58 126 84 131 100 " +
      "C 149 120 156 148 156 176 " +
      "C 156 220 127 252 90 252 " +
      "C 53 252 25 220 25 176 Z",
  ],
} satisfies OrnamentDef;
