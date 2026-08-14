import type { OrnamentDef } from "../../lib/ornaments";
import { starPath } from "./_geometry";

/** The eight-pointed khatam — the silhouette two overlaid squares leave. */
export default {
  id: "khatam-star-8",
  name: "Khatam (8-point star)",
  nameAr: "خاتم",
  tags: ["star", "geometric"],
  viewBox: { w: 200, h: 200 },
  paths: [starPath(100, 100, 95, 52, 8)],
} satisfies OrnamentDef;
