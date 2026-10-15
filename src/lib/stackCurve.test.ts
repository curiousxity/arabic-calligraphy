import { describe, it, expect } from "vitest";
import type { SvgCmd } from "./svgPath";
import type { CutFace } from "../types";
import { arcBand, traceCurve } from "./stackCurve";
import { splitAtCut } from "./stackGeometry";

/** A 20-thick bowl of radius 110 from 0.15π to 0.85π: its apex is at (0, 110). */
const BOWL = arcBand(100, 120, Math.PI * 0.15, Math.PI * 0.85);
const BAR: SvgCmd[] = [{ type: "M", x: 0, y: -10 }, { type: "L", x: 300, y: -10 }, { type: "L", x: 300, y: 10 }, { type: "L", x: 0, y: 10 }, { type: "Z" }];

/** Two quarter-turn bands glued into an S: the upper lobe turns one way, the lower the other. */
function sBand(): SvgCmd[] {
  type P = { x: number; y: number };
  const pts = (a0: number, a1: number, r: number, cx: number, steps = 30): P[] =>
    Array.from({ length: steps + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / steps; return { x: cx + Math.cos(a) * r, y: Math.sin(a) * r }; });
  // Upper lobe about (0,0): from (0,110) at 0.5π to (-110,0) at π. Lower lobe about (-220,0): from (-110,0) at 2π down to (-220,-110) at 1.5π.
  const outerU = pts(Math.PI * 0.5, Math.PI, 120, 0), innerU = pts(Math.PI * 0.5, Math.PI, 100, 0);
  const outerL = pts(Math.PI * 2, Math.PI * 1.5, 100, -220), innerL = pts(Math.PI * 2, Math.PI * 1.5, 120, -220);
  // One continuous outline: outer upper → (its end meets the lower lobe's inner-radius edge) → lower → back along the other edges.
  const seq: P[] = [...outerU, ...outerL, ...[...innerL].reverse(), ...[...innerU].reverse()];
  const cmds: SvgCmd[] = seq.map((p, i) => ({ type: i === 0 ? "M" : "L", x: p.x, y: p.y }) as SvgCmd);
  cmds.push({ type: "Z" });
  return cmds;
}

describe("traceCurve", () => {
  it("traces a bowl from its apex: constant thickness, the whole turn, cuts half a thickness in from the ends", () => {
    const t = traceCurve(BOWL, [0, 110])!;
    expect(t).not.toBeNull();
    for (const th of t.thickness) expect(Math.abs(th - 20)).toBeLessThan(0.4);
    expect(t.turn).toBeGreaterThan(Math.PI * 0.6);
    expect(t.turn).toBeLessThan(Math.PI * 0.72);
    expect(t.pressT).toBeGreaterThan(0.4); expect(t.pressT).toBeLessThan(0.6);
    // Both cuts split the band cleanly, each 10 ± 6 units in from an end
    // (the band's ends are at angles 0.15π and 0.85π on radius 110).
    for (const cut of t.cuts) {
      const split = splitAtCut(BOWL, cut);
      expect(split).not.toBeNull();
      const mid = [(split!.nearFace.a[0] + split!.nearFace.b[0]) / 2, (split!.nearFace.a[1] + split!.nearFace.b[1]) / 2];
      const ang = Math.atan2(mid[1], mid[0]);
      const fromEnd = Math.min(Math.abs(ang - Math.PI * 0.15), Math.abs(ang - Math.PI * 0.85)) * 110;
      expect(fromEnd).toBeGreaterThan(4); expect(fromEnd).toBeLessThan(16);
    }
  });

  it("returns null on a straight bar (no turn) and off the ink", () => {
    expect(traceCurve(BAR, [150, 0])).toBeNull();
    expect(traceCurve(BOWL, [0, 0])).toBeNull();
  });

  it("stops at an inflection: an S traced from one lobe covers only that lobe", () => {
    const t = traceCurve(sBand(), [0, 110])!;
    expect(t).not.toBeNull();
    // Only the upper lobe: about a quarter turn, not a half.
    expect(t.turn).toBeLessThan(Math.PI * 0.6);
    expect(t.turn).toBeGreaterThan(Math.PI * 0.3);
    // No sample crosses into the lower lobe (x < -115).
    for (const c of t.centre) expect(c[0]).toBeGreaterThan(-118);
  });

  it("stops at a thickness jump: a bowl with a thick foot keeps the foot out", () => {
    // The bowl plus a 60-thick block welded onto its right end.
    const foot: SvgCmd[] = [{ type: "M", x: 60, y: 30 }, { type: "L", x: 160, y: 30 }, { type: "L", x: 160, y: 90 }, { type: "L", x: 60, y: 90 }, { type: "Z" }];
    const t = traceCurve([...BOWL, ...foot], [0, 110])!;
    expect(t).not.toBeNull();
    for (const th of t.thickness) expect(th).toBeLessThan(32);
  });

  it("stops at an existing face", () => {
    const face: CutFace = { a: [60, 85], b: [78, 95], tangent: 0 };   // across the band near angle 0.3π
    const t = traceCurve(BOWL, [0, 110], { faces: [face] })!;
    expect(t).not.toBeNull();
    for (const c of t.centre) expect(c[0]).toBeLessThan(62);
  });
});
