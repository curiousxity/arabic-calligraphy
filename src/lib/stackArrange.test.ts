import { describe, it, expect } from "vitest";
import type { StackPiece, StackJoin } from "../types";
import type { SvgCmd } from "./svgPath";
import { pointInPolygon } from "./svgPath";
import { arrangeStackInShape, bandSpan, letterGroups } from "./stackArrange";
import { outlineBounds } from "./strokeCuts";
import { translateCmds } from "./stackGeometry";

// Synthetic pieces are fine here: nothing is shaped, and the solver only
// reads outlines, positions and the rider tree (see CLAUDE.md's rule, which
// is about shaping fixtures).
const UPM = 1000;

const rect = (w: number, h: number): SvgCmd[] => [
  { type: "M", x: 0, y: -h }, { type: "L", x: w, y: -h }, { type: "L", x: w, y: 0 }, { type: "L", x: 0, y: 0 }, { type: "Z" },
];

/** A letter `w` wide and `h` tall, with its baseline at y=0, pen at `x`. */
const letter = (id: string, order: number, x: number, w: number, h: number, extra: Partial<StackPiece> = {}): StackPiece => ({
  id, cmds: rect(w, h), x, y: 0, rotation: 0, pivot: [w / 2, -h / 2], homeX: x, homeY: 0, order, role: "letter", faces: [], ...extra,
});

/** A dot riding above `parent`, offset (dx, dy) from the parent's pen. */
const dot = (id: string, parent: StackPiece, dx: number, dy: number): StackPiece => ({
  id, cmds: rect(80, 80), x: parent.x + dx, y: parent.y + dy, rotation: 0, pivot: [40, -40], homeX: 0, homeY: 0,
  order: parent.order, role: "mark", parentId: parent.id, faces: [],
});

/** Four letters on one baseline, as conversion lays them: order 0 is rightmost. */
function word() {
  const d = letter("p3", 3, 0, 300, 400);
  const c = letter("p2", 2, 400, 300, 400);
  const b = letter("p1", 1, 800, 300, 400);
  const a = letter("p0", 0, 1200, 300, 400);
  const bDot = dot("d1", b, 110, -500);
  const joins: StackJoin[] = [
    { id: "j01", from: { pieceId: "p0", faceIndex: 0 }, to: { pieceId: "p1", faceIndex: 0 }, bow: 0.4, depth: 0.2 },
    { id: "j12", from: { pieceId: "p1", faceIndex: 0 }, to: { pieceId: "p2", faceIndex: 0 }, bow: -0.3 },
  ];
  return { pieces: [d, c, b, a, bDot], joins };
}

/** A tall ellipse in px, centred on the origin, clockwise. */
function ellipse(w: number, h: number, n = 64): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI;
    return [(w / 2) * Math.cos(t), (h / 2) * Math.sin(t)] as [number, number];
  });
}

const groupBox = (pieces: StackPiece[], letterId: string) => {
  const g = letterGroups(pieces).find((x) => x.letter.id === letterId)!;
  return outlineBounds(g.members.flatMap((m) => translateCmds(m.cmds, m.x, m.y)));
};

describe("letterGroups", () => {
  it("lists letters in reading order with their riders, excluding end caps from the letter list", () => {
    const { pieces } = word();
    const cap: StackPiece = { ...letter("p0t1", 0, 1500, 100, 100), parentId: "p0" };
    const groups = letterGroups([...pieces, cap]);
    expect(groups.map((g) => g.letter.id)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(groups[0].members.map((m) => m.id)).toEqual(["p0", "p0t1"]);
    expect(groups[1].members.map((m) => m.id)).toEqual(["p1", "d1"]);
    // The dot above ب makes its group taller than the letter alone.
    expect(groups[1].box.y1).toBeLessThan(groups[0].box.y1);
  });
});

describe("bandSpan", () => {
  it("is the narrowest chord across the band, and null outside the shape", () => {
    const poly = ellipse(200, 400);
    const atCentre = bandSpan(poly, -10, 10)!;
    expect(atCentre[0]).toBeCloseTo(-100, 0);
    expect(atCentre[1]).toBeCloseTo(100, 0);
    const nearTop = bandSpan(poly, -190, -100)!;
    // Narrower at the top end of the band than at the bottom; the span is the narrower.
    expect(nearTop[1] - nearTop[0]).toBeLessThan(80);
    expect(bandSpan(poly, -300, -210)).toBeNull();
  });
});

describe("arrangeStackInShape", () => {
  const shape = ellipse(300, 900);
  const input = () => ({ ...word(), shapePx: shape, fontSize: 100, unitsPerEm: UPM });

  it("puts every letter inside the shape, reading order climbing from the bottom", () => {
    const r = arrangeStackInShape(input())!;
    expect(r).not.toBeNull();
    const scale = r.fontSize / UPM;
    const centres = ["p0", "p1", "p2", "p3"].map((id) => {
      const b = groupBox(r.pieces, id);
      return { id, x: ((b.x1 + b.x2) / 2) * scale, y: ((b.y1 + b.y2) / 2) * scale, b };
    });
    for (const c of centres) {
      expect(pointInPolygon(c.x, c.y, shape), `${c.id} inside`).toBe(true);
      // Its four corners too, give or take the sampling of the chord.
      for (const [x, y] of [[c.b.x1, c.b.y1], [c.b.x2, c.b.y1], [c.b.x1, c.b.y2], [c.b.x2, c.b.y2]] as const) {
        expect(pointInPolygon(x * scale * 0.98, y * scale * 0.98, shape), `${c.id} corner`).toBe(true);
      }
    }
    // The first letter is lowest; each later letter is at or above the one before.
    for (let i = 1; i < centres.length; i++) expect(centres[i].y).toBeLessThanOrEqual(centres[i - 1].y + 1e-6);
    expect(centres[0].y).toBeGreaterThan(centres[3].y);
  });

  it("scales the block up to fill the shape and spreads the rows over its height", () => {
    const r = arrangeStackInShape(input())!;
    // Four 400-unit letters stacked in a 900 px shape: well over the 100 px start.
    expect(r.fontSize).toBeGreaterThan(100);
    const scale = r.fontSize / UPM;
    const top = groupBox(r.pieces, "p3").y1 * scale, bottom = groupBox(r.pieces, "p0").y2 * scale;
    // The stack reaches most of the shape's height.
    expect(bottom - top).toBeGreaterThan(900 * 0.7);
  });

  it("moves a letter's riders with it and resets tilt and bends", () => {
    const inp = input();
    inp.pieces = inp.pieces.map((p) => (p.id === "p1" ? { ...p, rotation: 0.3 } : p));
    const r = arrangeStackInShape(inp)!;
    const b = r.pieces.find((p) => p.id === "p1")!, d = r.pieces.find((p) => p.id === "d1")!;
    expect(d.x - b.x).toBeCloseTo(110, 6);
    expect(d.y - b.y).toBeCloseTo(-500, 6);
    expect(b.rotation).toBe(0);
    for (const j of r.joins) { expect(j.bow).toBe(0); expect(j.depth).toBe(0); }
    // Home positions are untouched: Reset layout still returns to the conversion.
    expect(b.homeX).toBe(800);
  });

  it("lays a wide shape as one row, right to left in reading order", () => {
    const r = arrangeStackInShape({ ...input(), shapePx: ellipse(2000, 300) })!;
    expect(r.rows).toBe(1);
    const xs = ["p0", "p1", "p2", "p3"].map((id) => r.pieces.find((p) => p.id === id)!.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThan(xs[i - 1]);
  });

  it("hugs the shape with the outer letters of a row of three or more", () => {
    // One wide row: four 300-wide letters in a 1600×500 px ellipse.
    const r = arrangeStackInShape({ ...input(), shapePx: ellipse(1600, 500) })!;
    expect(r.rows).toBe(1);
    const scale = r.fontSize / UPM;
    const poly = ellipse(1600, 500).map(([x, y]) => [x / scale, y / scale] as [number, number]);
    const right = groupBox(r.pieces, "p0"), left = groupBox(r.pieces, "p3");
    const rs = bandSpan(poly, right.y1, right.y2)!, ls = bandSpan(poly, left.y1, left.y2)!;
    // Each outer letter's box sits one letter gap (0.08 em) inside the chord at its own band.
    expect(Math.abs(rs[1] - right.x2 - 80)).toBeLessThan(2);
    expect(Math.abs(left.x1 - ls[0] - 80)).toBeLessThan(2);
    // Inner letters sit between them with equal gaps.
    const b1 = groupBox(r.pieces, "p1"), b2 = groupBox(r.pieces, "p2");
    const g0 = right.x1 - b1.x2, g1 = b1.x1 - b2.x2, g2 = b2.x1 - left.x2;
    expect(Math.abs(g0 - g1)).toBeLessThan(1);
    expect(Math.abs(g1 - g2)).toBeLessThan(1);
  });

  it("keeps the spread cap for a row of two", () => {
    const { pieces, joins } = word();
    const two = pieces.filter((p) => p.id === "p0" || p.id === "p1" || p.id === "d1");
    const r = arrangeStackInShape({ pieces: two, joins, shapePx: ellipse(3000, 300), fontSize: 100, unitsPerEm: UPM })!;
    const a = groupBox(r.pieces, "p0"), b = groupBox(r.pieces, "p1");
    expect(a.x1 - b.x2).toBeLessThanOrEqual(1.0 * UPM + 1);
  });

  it("returns null with no letters or a degenerate shape", () => {
    expect(arrangeStackInShape({ ...input(), pieces: [] })).toBeNull();
    expect(arrangeStackInShape({ ...input(), shapePx: [[0, 0], [1, 1]] })).toBeNull();
  });
});
