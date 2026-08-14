import type { OrnamentDef } from "../../lib/ornaments";
import { starPath } from "./_geometry";

/** Twelve points, blunter than the khatam so the fill rows stay readable. */
export default {
  id: "star-12",
  name: "Twelve-point star",
  nameAr: "نجمة اثنتا عشرية",
  tags: ["star", "geometric"],
  viewBox: { w: 200, h: 200 },
  paths: [starPath(100, 100, 95, 64, 12)],
} satisfies OrnamentDef;
