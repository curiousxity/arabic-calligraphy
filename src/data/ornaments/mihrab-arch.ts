import type { OrnamentDef } from "../../lib/ornaments";

/**
 * A mihrab niche: straight jambs rising to a springline, closed by a pointed
 * arch whose two halves meet in a cusp at the apex. Drawn as two cubics
 * rather than one, precisely so the apex stays a point instead of rounding.
 */
export default {
  id: "mihrab-arch",
  name: "Mihrab arch",
  nameAr: "محراب",
  tags: ["frame", "arch"],
  viewBox: { w: 200, h: 300 },
  paths: [
    // Each half's second control point sits almost directly below the apex,
    // which is what makes the two tangents meet steeply there. Pulling them
    // outward instead rounds the point off into a plain dome.
    "M 10 300 L 10 150 " +
      "C 10 80 82 62 100 15 " +
      "C 118 62 190 80 190 150 " +
      "L 190 300 Z",
  ],
} satisfies OrnamentDef;
