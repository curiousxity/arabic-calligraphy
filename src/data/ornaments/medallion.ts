import type { OrnamentDef } from "../../lib/ornaments";
import { circlePath } from "./_geometry";

/**
 * A plain circular medallion — deliberately undecorated, because it is the
 * shape that fills with text most legibly. `scalloped-roundel` is the
 * decorated counterpart.
 */
export default {
  id: "medallion",
  name: "Circular medallion",
  nameAr: "شمسة",
  tags: ["medallion", "round"],
  viewBox: { w: 240, h: 240 },
  paths: [circlePath(120, 120, 110)],
} satisfies OrnamentDef;
