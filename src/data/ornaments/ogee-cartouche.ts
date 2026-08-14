import type { OrnamentDef } from "../../lib/ornaments";

/**
 * A horizontally stretched cartouche whose long sides swing in an ogee and
 * meet in points at both ends — the panel shape a single line of text sits
 * in most naturally.
 */
export default {
  id: "ogee-cartouche",
  name: "Ogee cartouche",
  nameAr: "خرطوش",
  tags: ["frame", "panel"],
  viewBox: { w: 280, h: 160 },
  paths: [
    // Each side is one cubic with its two control points on *opposite* sides
    // of the chord — that inflection is what makes the edge an ogee rather
    // than a plain convex arc, so the shape reads as a cartouche and not as
    // a pointed oval.
    "M 12 80 " +
      "C 50 76 78 20 140 14 " +
      "C 202 20 230 76 268 80 " +
      "C 230 84 202 140 140 146 " +
      "C 78 140 50 84 12 80 Z",
  ],
} satisfies OrnamentDef;
