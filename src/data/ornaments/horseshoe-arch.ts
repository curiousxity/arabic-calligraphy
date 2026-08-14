import type { OrnamentDef } from "../../lib/ornaments";
import { arcCommands, lineTo, moveTo, polar } from "./_geometry";

const CX = 100;
const CY = 130;
const R = 85;
const FOOT = 300;

// A horseshoe arch's defining feature is that the curve continues *past* the
// half circle before the jambs drop, so its widest point is above the
// springing. Sweeping from 145° round to 395° (i.e. 35° on the next turn)
// gives that overshoot on both sides symmetrically. Much more than this and
// the jambs narrow until the arch reads as a circle on a stem rather than as
// an opening.
const START = (145 * Math.PI) / 180;
const END = (395 * Math.PI) / 180;

const [sx, sy] = polar(CX, CY, R, START);
const [ex] = polar(CX, CY, R, END);

export default {
  id: "horseshoe-arch",
  name: "Horseshoe arch",
  nameAr: "قوس حدوة",
  tags: ["frame", "arch"],
  viewBox: { w: 200, h: FOOT },
  paths: [
    [
      moveTo([sx, FOOT]),
      lineTo([sx, sy]),
      arcCommands(CX, CY, R, START, END),
      lineTo([ex, FOOT]),
      "Z",
    ].join(" "),
  ],
} satisfies OrnamentDef;
