import type { OrnamentDef } from "../../lib/ornaments";
import { scallopedCirclePath } from "./_geometry";

/** A disc with sixteen scallops meeting in cusps on the base circle. */
export default {
  id: "scalloped-roundel",
  name: "Scalloped roundel",
  nameAr: "شمسة مفصصة",
  tags: ["medallion", "round"],
  viewBox: { w: 240, h: 240 },
  paths: [scallopedCirclePath(120, 120, 96, 16, 14)],
} satisfies OrnamentDef;
