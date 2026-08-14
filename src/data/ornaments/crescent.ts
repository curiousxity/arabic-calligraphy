import type { OrnamentDef } from "../../lib/ornaments";
import { arcCommands, moveTo, polar } from "./_geometry";

// The crescent is the disc (C1, R1) with the disc (C2, R2) bitten out of it.
// Rather than draw two subpaths and lean on a fill rule, its boundary is
// traced as one closed outline: the part of circle 1 that lies *outside*
// circle 2, then the part of circle 2 that lies *inside* circle 1, back to
// the start. That keeps it a simple polygon for Shape Fill's ray-casting.
const C1X = 110;
const C1Y = 110;
const R1 = 100;
const C2X = 150;
const R2 = 82;

const d = C2X - C1X;
// Radical line: both intersection points share this x.
const px = C1X + (d * d + R1 * R1 - R2 * R2) / (2 * d);
const dy = Math.sqrt(R1 * R1 - (px - C1X) ** 2);

// Negative y is up in SVG, so "top" is the intersection above the centres.
const aTop1 = Math.atan2(-dy, px - C1X);
const aBottom1 = -aTop1;
const aTop2 = Math.atan2(-dy, px - C2X);
const aBottom2 = -aTop2;

export default {
  id: "crescent",
  name: "Crescent",
  nameAr: "هلال",
  tags: ["motif", "crescent"],
  viewBox: { w: 220, h: 220 },
  paths: [
    [
      moveTo(polar(C1X, C1Y, R1, aTop1)),
      // Outer edge: the long way round, through the left of circle 1 — the
      // short way would run through the region circle 2 removes.
      arcCommands(C1X, C1Y, R1, aTop1, aBottom1 - Math.PI * 2),
      // Inner edge: back across the left of circle 2, which is the part of
      // it that falls inside circle 1.
      arcCommands(C2X, C1Y, R2, aBottom2, aTop2 + Math.PI * 2),
      "Z",
    ].join(" "),
  ],
} satisfies OrnamentDef;
