import type { OrnamentDef } from "../../lib/ornaments";
import { ringPath, type Pt } from "./_geometry";

const W = 300;
const H = 220;
const BAND = 34;

// Clockwise outer, counter-clockwise inner: opposite windings are what make
// the inner loop read as a hole. See `ringPath` for why the bridge between
// them has to be a doubled-back segment rather than a second subpath.
const outer: Pt[] = [
  [0, 0],
  [W, 0],
  [W, H],
  [0, H],
];
const inner: Pt[] = [
  [BAND, BAND],
  [BAND, H - BAND],
  [W - BAND, H - BAND],
  [W - BAND, BAND],
];

export default {
  id: "border-frame",
  name: "Border frame",
  nameAr: "إطار",
  tags: ["frame", "border"],
  viewBox: { w: W, h: H },
  paths: [ringPath(outer, inner)],
} satisfies OrnamentDef;
