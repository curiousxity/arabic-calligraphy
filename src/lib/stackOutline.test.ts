import { describe, it, expect } from "vitest";
import { assembleStackOutline, assembleStackOutlineReport, chainOf, rebasePiece, pieceTransform } from "./stackOutline";
import { splitAtCut, transformPt, cmdsCentre } from "./stackGeometry";
import { flattenContours } from "./strokeCuts";
import type { StackPiece, StackJoin } from "../types";
import type { SvgCmd } from "./svgPath";

const BAR: SvgCmd[] = [
  { type: "M", x: 0, y: -10 }, { type: "L", x: 100, y: -10 },
  { type: "L", x: 100, y: 10 }, { type: "L", x: 0, y: 10 }, { type: "Z" },
];
const NIB = { width: 20, minFraction: 0.15 };
const piece = (id: string, cmds: SvgCmd[], order: number, extra: Partial<StackPiece> = {}): StackPiece => ({
  id, cmds, x: 0, y: 0, rotation: 0, pivot: cmdsCentre(cmds), homeX: 0, homeY: 0,
  order, role: "letter", faces: [], ...extra,
});
const area = (cmds: SvgCmd[]) =>
  flattenContours(cmds).reduce((sum, c) => {
    let a = 0;
    for (let i = 0; i + 1 < c.length; i++) a += c[i][0] * c[i + 1][1] - c[i + 1][0] * c[i][1];
    return sum + Math.abs(a) / 2;
  }, 0);

function splitBar() {
  const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
  const left = piece("L", r.near, 1, { faces: [r.nearFace] });
  const right = piece("R", r.far, 0, { faces: [r.farFace] });
  const join: StackJoin = { id: "j", from: { pieceId: "R", faceIndex: 0 }, to: { pieceId: "L", faceIndex: 0 }, bow: 0 };
  return { left, right, join };
}

describe("assembleStackOutline", () => {
  it("is the identity straight after a split", () => {
    const { left, right, join } = splitBar();
    const out = assembleStackOutline([right, left], [join], NIB);
    expect(flattenContours(out)).toHaveLength(1);
    expect(area(out)).toBeCloseTo(2000, 6);
  });
  it("grows when a piece is lifted and keeps one contour", () => {
    const { left, right, join } = splitBar();
    const out = assembleStackOutline([right, { ...left, y: -60 }], [join], NIB);
    expect(flattenContours(out)).toHaveLength(1);
    expect(area(out)).toBeGreaterThan(2000);
  });
  it("draws pieces with no join as separate contours", () => {
    const { left, right } = splitBar();
    const out = assembleStackOutline([right, left], [], NIB);
    expect(flattenContours(out)).toHaveLength(2);
  });
  it("skips a join whose piece is missing rather than throwing, and reports it", () => {
    const { left, join } = splitBar();
    expect(() => assembleStackOutline([left], [join], NIB)).not.toThrow();
    expect(assembleStackOutlineReport([left], [join], NIB).skipped).toBe(1);
  });
  it("draws nothing rather than crashing when a hand-edited save drops its lists", () => {
    expect(assembleStackOutlineReport(undefined, undefined, NIB)).toEqual({ cmds: [], skipped: 0 });
  });
});

describe("chainOf", () => {
  const ps = [
    piece("a", BAR, 0), piece("b", BAR, 1), piece("c", BAR, 2),
    piece("mb", BAR, 1, { role: "mark", parentId: "b" }),
  ];
  it("carries the piece, its marks, and every later piece", () => {
    expect(chainOf(ps, "b", false).sort()).toEqual(["b", "c", "mb"]);
  });
  it("alone carries only the piece and its marks", () => {
    expect(chainOf(ps, "b", true).sort()).toEqual(["b", "mb"]);
  });
  it("a mark moves by itself", () => {
    expect(chainOf(ps, "mb", false)).toEqual(["mb"]);
  });
  it("moving a whole chain translates its assembled outline and nothing else", () => {
    const { left, right, join } = splitBar();
    const lifted = { ...left, y: -60, rotation: 0.3 };
    const ps = [right, lifted];
    const ids = chainOf(ps, "R", false);   // R is first in reading order: carries L
    expect([...ids].sort()).toEqual(["L", "R"]);
    const moved = ps.map((p) => (ids.includes(p.id) ? { ...p, x: p.x + 10, y: p.y - 20 } : p));
    const before = flattenContours(assembleStackOutline(ps, [join], NIB));
    const after = flattenContours(assembleStackOutline(moved, [join], NIB));
    expect(after.length).toBe(before.length);
    after.forEach((c, ci) => c.forEach(([x, y], k) => {
      expect(x - before[ci][k][0]).toBeCloseTo(10, 9);
      expect(y - before[ci][k][1]).toBeCloseTo(-20, 9);
    }));
  });
});

describe("rebasePiece", () => {
  it("keeps every world point where it was when the local outline changes", () => {
    const p = { ...piece("p", BAR, 0), x: 12, y: -7, rotation: 0.4 };
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const q = rebasePiece(p, r.far);
    const before = transformPt([70, 5], pieceTransform(p));
    const after = transformPt([70, 5], pieceTransform(q));
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
    expect(q.pivot).toEqual(cmdsCentre(r.far));
  });
});

import { stackScale } from "./stackOutline";
describe("stackScale", () => {
  it("falls back to 1000 units per em when the block has none", () => {
    expect(stackScale(50, undefined)).toBeCloseTo(0.05, 12);
    expect(stackScale(50, 0)).toBeCloseTo(0.05, 12);
    expect(stackScale(50, 2048)).toBeCloseTo(50 / 2048, 12);
  });
});
