import { describe, it, expect } from "vitest";
import type { StackPiece, StackJoin } from "../types";
import type { SvgCmd } from "./svgPath";
import { pointInPolygon } from "./svgPath";
import { arrangeStackInShape, bandSpan, letterGroups, type FillerShape } from "./stackArrange";
import { flattenContours, outlineBounds } from "./strokeCuts";
import { transformCmds, transformPt, translateCmds } from "./stackGeometry";

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

/** A short, tall, short row on one baseline (order 0 rightmost). */
function shortTallShort() {
  const c = letter("q2", 2, 0, 300, 200);
  const b = letter("q1", 1, 400, 300, 400);
  const a = letter("q0", 0, 800, 300, 200);
  return { pieces: [c, b, a], joins: [] as StackJoin[] };
}

/** A parallelogram 1400 wide and 1000 tall whose sides lean right going up (about 27°). */
const PARALLELOGRAM: Array<[number, number]> = [[-700, 500], [700, 500], [1200, -500], [-200, -500]];

const FILLERS: FillerShape[] = [
  { name: "dot", cmds: rect(60, 60) },
  { name: "fatha", cmds: rect(200, 50) },
];

/** Flattened world-space contours of a piece. */
const worldContours = (p: StackPiece) => flattenContours(transformCmds(p.cmds, { x: p.x, y: p.y, rotation: p.rotation, pivot: p.pivot }));

/** A 1400×700 room with a 340-wide, 800-tall chimney over its middle (px):
 *  too narrow for a letter's foot (300 units at the row's 1.1475 scale is
 *  344 px), wide enough for a padded stem cap. */
const CHIMNEY: Array<[number, number]> = [
  [-700, 350], [700, 350], [700, -350], [170, -350], [170, -1150], [-170, -1150], [-170, -350], [-700, -350],
];

/** An L-shaped letter: a 300×103 foot with an 80-wide stem rising to 597
 *  above its middle, meeting the foot through a short diagonal shoulder.
 *  The shoulder matters: a square corner keeps the cut's crossing count at
 *  two while the thickness jumps, and the detector refuses that whole run
 *  as one uneven stroke; a real glyph's junction curves, which is what
 *  breaks the run between stem and bowl. */
function stemLetter(id: string, order: number, x: number): StackPiece {
  const cmds: SvgCmd[] = [
    { type: "M", x: 3, y: 0 }, { type: "L", x: 303, y: 0 }, { type: "L", x: 303, y: -103 }, { type: "L", x: 203, y: -103 },
    { type: "L", x: 193, y: -113 }, { type: "L", x: 193, y: -597 }, { type: "L", x: 113, y: -597 }, { type: "L", x: 113, y: -113 },
    { type: "L", x: 103, y: -103 }, { type: "L", x: 3, y: -103 }, { type: "Z" },
  ];
  return { id, cmds, x, y: 0, rotation: 0, pivot: [153, -300], homeX: x, homeY: 0, order, role: "letter", faces: [] };
}

/** Three stem letters on one baseline (order 0 rightmost). */
function threeStems() {
  return { pieces: [stemLetter("a2", 2, 0), stemLetter("a1", 1, 400), stemLetter("a0", 0, 800)], joins: [] as StackJoin[] };
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
    // A rectangle: no edge leans, so every letter comes out upright.
    const inp = { ...input(), shapePx: [[-150, -450], [150, -450], [150, 450], [-150, 450]] as Array<[number, number]> };
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
    // An outer letter may lean, so measure its rotated bounds.
    const rotatedBox = (id: string) => {
      const p = r.pieces.find((x) => x.id === id)!;
      const g = letterGroups(r.pieces).find((x) => x.letter.id === id)!;
      const t = { x: p.x, y: p.y, rotation: p.rotation, pivot: p.pivot };
      const cs = ([[g.box.x1, g.box.y1], [g.box.x2, g.box.y1], [g.box.x1, g.box.y2], [g.box.x2, g.box.y2]] as const).map((c) => transformPt([c[0], c[1]], t));
      return { x1: Math.min(...cs.map((c) => c[0])), x2: Math.max(...cs.map((c) => c[0])), y1: Math.min(...cs.map((c) => c[1])), y2: Math.max(...cs.map((c) => c[1])) };
    };
    const right = rotatedBox("p0"), left = rotatedBox("p3");
    const rs = bandSpan(poly, right.y1, right.y2)!, ls = bandSpan(poly, left.y1, left.y2)!;
    // Each outer letter's bounds sit one letter gap (0.08 em) inside the chord over their own band.
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

  it("nudges a short outer letter into the curve, and never in a rectangle", () => {
    // A wide, short ellipse forces one row of three (a circle would take two rows).
    const r = arrangeStackInShape({ ...shortTallShort(), shapePx: ellipse(1800, 600), fontSize: 100, unitsPerEm: UPM })!;
    expect(r.rows).toBe(1);
    const a = r.pieces.find((p) => p.id === "q0")!, b = r.pieces.find((p) => p.id === "q1")!, c = r.pieces.find((p) => p.id === "q2")!;
    // All three share a baseline before; the row is centred, so the short
    // letters sit in the ellipse's lower half, where the band widens upward.
    expect(a.y).toBeLessThan(b.y - 1);
    expect(c.y).toBeLessThan(b.y - 1);
    const rect: Array<[number, number]> = [[-700, -700], [700, -700], [700, 700], [-700, 700]];
    const r2 = arrangeStackInShape({ ...shortTallShort(), shapePx: rect, fontSize: 100, unitsPerEm: UPM })!;
    const a2 = r2.pieces.find((p) => p.id === "q0")!, b2 = r2.pieces.find((p) => p.id === "q1")!;
    expect(Math.abs(a2.y - b2.y)).toBeLessThan(1e-6);
  });

  it("tilts outer letters toward a leaning edge, never past 30°, and keeps them inside", () => {
    const r = arrangeStackInShape({ ...input(), shapePx: PARALLELOGRAM })!;
    const scale = r.fontSize / UPM;
    const letters = r.pieces.filter((p) => p.role === "letter" && p.parentId === undefined);
    const tilted = letters.filter((p) => Math.abs(p.rotation) > 0.1);
    expect(tilted.length).toBeGreaterThan(0);
    for (const p of letters) {
      expect(Math.abs(p.rotation)).toBeLessThanOrEqual(Math.PI / 6 + 1e-9);
      // Leaning right going up is a positive rotation (y-down frame).
      if (Math.abs(p.rotation) > 0.1) expect(p.rotation).toBeGreaterThan(0);
      const g = letterGroups(r.pieces).find((x) => x.letter.id === p.id)!;
      const t = { x: p.x, y: p.y, rotation: p.rotation, pivot: p.pivot };
      for (const c of [[g.box.x1, g.box.y1], [g.box.x2, g.box.y1], [g.box.x1, g.box.y2], [g.box.x2, g.box.y2]] as const) {
        const [wx, wy] = transformPt([c[0], c[1]], t);
        expect(pointInPolygon(wx * scale, wy * scale, PARALLELOGRAM), `${p.id} corner inside`).toBe(true);
      }
    }
  });

  it("does not tilt in a rectangle, and a rider turns with its letter", () => {
    const rect: Array<[number, number]> = [[-300, -900], [300, -900], [300, 900], [-300, 900]];
    const r = arrangeStackInShape({ ...input(), shapePx: rect })!;
    for (const p of r.pieces) expect(p.rotation).toBe(0);

    const r2 = arrangeStackInShape({ ...input(), shapePx: PARALLELOGRAM })!;
    const b = r2.pieces.find((p) => p.id === "p1")!, d = r2.pieces.find((p) => p.id === "d1")!;
    expect(d.rotation).toBe(b.rotation);
    // The dot's pivot stays the same distance from the letter's pivot as at conversion.
    const bp = [b.pivot[0] + b.x, b.pivot[1] + b.y], dp = [d.pivot[0] + d.x, d.pivot[1] + d.y];
    const before = Math.hypot(110 + 40 - 150, -500 - 40 + 200); // dot pivot (40,-40)+(110,-500) vs letter pivot (150,-200)
    expect(Math.hypot(dp[0] - bp[0], dp[1] - bp[1])).toBeCloseTo(before, 3);
  });

  it("returns null with no letters or a degenerate shape", () => {
    expect(arrangeStackInShape({ ...input(), pieces: [] })).toBeNull();
    expect(arrangeStackInShape({ ...input(), shapePx: [[0, 0], [1, 1]] })).toBeNull();
  });
});

describe("fillers", () => {
  const shape = ellipse(300, 900);
  const base = () => ({ ...word(), shapePx: shape, fontSize: 100, unitsPerEm: UPM, fillers: FILLERS });

  it("busies a loose shape with marks that stay inside and off the ink", () => {
    const r = arrangeStackInShape(base())!;
    expect(r.fillers).toBeGreaterThan(0);
    const scale = r.fontSize / UPM;
    const fillers = r.pieces.filter((p) => p.filler);
    expect(fillers.length).toBe(r.fillers);
    const ink = r.pieces.filter((p) => !p.filler).flatMap(worldContours);
    const boxes = fillers.map((f) => outlineBounds(translateCmds(f.cmds, f.x, f.y)));
    fillers.forEach((f, i) => {
      expect(f.role).toBe("mark");
      expect(f.parentId).toBeUndefined();
      expect(f.homeX).toBe(f.x); expect(f.homeY).toBe(f.y);
      const b = boxes[i];
      const probes: Array<[number, number]> = [[b.x1, b.y1], [b.x2, b.y1], [b.x1, b.y2], [b.x2, b.y2], [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2]];
      for (const [x, y] of probes) {
        expect(pointInPolygon(x * scale, y * scale, shape), `${f.id} inside`).toBe(true);
        expect(ink.some((c) => pointInPolygon(x, y, c)), `${f.id} off the ink`).toBe(false);
      }
      for (let j = 0; j < i; j++) {
        const o = boxes[j];
        const apart = b.x2 <= o.x1 || b.x1 >= o.x2 || b.y2 <= o.y1 || b.y1 >= o.y2;
        expect(apart, `${f.id} vs ${fillers[j].id}`).toBe(true);
      }
    });
  });

  it("adds none to a shape the letters already fill, and is deterministic", () => {
    const one = letter("solo", 0, 0, 300, 400);
    const tight: Array<[number, number]> = [[-160, -210], [160, -210], [160, 210], [-160, 210]];
    const r = arrangeStackInShape({ pieces: [one], joins: [], shapePx: tight, fontSize: 1000, unitsPerEm: UPM, fillers: FILLERS })!;
    expect(r.fillers).toBe(0);
    const a = arrangeStackInShape(base())!, b = arrangeStackInShape(base())!;
    expect(a).toEqual(b);
  });

  it("adds no fillers when none are offered", () => {
    const r = arrangeStackInShape({ ...base(), fillers: undefined })!;
    expect(r.fillers).toBe(0);
    expect(r.pieces.some((p) => p.filler)).toBe(false);
  });
});

describe("stem pull", () => {
  const base = () => ({ ...threeStems(), shapePx: CHIMNEY, fontSize: 1000, unitsPerEm: UPM, pullStems: true });

  it("draws the middle letter's stem up into the chimney and stops a gap short of its top", () => {
    const r = arrangeStackInShape(base())!;
    expect(r.stems).toBe(1);
    const cap = r.pieces.find((p) => p.parentId === "a1" && p.role === "letter")!;
    expect(cap).toBeDefined();
    expect(r.joins.some((j) => (j.from.pieceId === "a1" && j.to.pieceId === cap.id) || (j.to.pieceId === "a1" && j.from.pieceId === cap.id))).toBe(true);
    const scale = r.fontSize / UPM;
    const b = outlineBounds(transformCmds(cap.cmds, { x: cap.x, y: cap.y, rotation: cap.rotation, pivot: cap.pivot }));
    // Well into the chimney (its mouth is at y = -350 px), and inside it with its gap.
    expect(b.y1 * scale).toBeLessThan(-350 - 400);
    expect(b.y1 * scale).toBeGreaterThan(-1150);
    expect(pointInPolygon(b.x1 * scale, b.y1 * scale, CHIMNEY)).toBe(true);
    expect(pointInPolygon(b.x2 * scale, b.y1 * scale, CHIMNEY)).toBe(true);
    // The outer letters, under the roof, are untouched.
    expect(r.pieces.filter((p) => p.parentId === "a0" || p.parentId === "a2")).toHaveLength(0);
  });

  it("is idempotent: a second run slides a cap rather than cutting the letter again", () => {
    const first = arrangeStackInShape(base())!;
    const second = arrangeStackInShape({ ...base(), pieces: first.pieces, joins: first.joins, fontSize: first.fontSize })!;
    // The lengthened letter makes its row taller, so the block re-sizes and
    // other letters may now find room; but no letter is ever cut twice.
    expect(second.pieces.filter((p) => p.parentId === "a1" && p.role === "letter")).toHaveLength(1);
    for (const id of ["a0", "a1", "a2"]) {
      expect(second.pieces.filter((p) => p.parentId === id && p.role === "letter").length).toBeLessThanOrEqual(1);
    }
    const third = arrangeStackInShape({ ...base(), pieces: second.pieces, joins: second.joins, fontSize: second.fontSize })!;
    expect(third.pieces.length).toBe(second.pieces.length);
    expect(third.joins.length).toBe(second.joins.length);
  });

  it("never pulls through ink or when stems are off", () => {
    // A rider slab above the middle letter blocks the chimney's mouth.
    const { pieces, joins } = threeStems();
    const mid = pieces.find((p) => p.id === "a1")!;
    const slab: StackPiece = { ...letter("slab", 1, mid.x, 300, 100), y: -700, role: "mark", parentId: "a1", pivot: [150, -50] };
    const r = arrangeStackInShape({ pieces: [...pieces, slab], joins, shapePx: CHIMNEY, fontSize: 1000, unitsPerEm: UPM, pullStems: true })!;
    // The blocked letter is not cut at all; any other cap stays clear of every other piece's ink.
    expect(r.pieces.filter((p) => p.parentId === "a1" && p.role === "letter")).toHaveLength(0);
    for (const cap of r.pieces.filter((p) => p.role === "letter" && p.parentId !== undefined)) {
      const b = outlineBounds(transformCmds(cap.cmds, { x: cap.x, y: cap.y, rotation: cap.rotation, pivot: cap.pivot }));
      const others = r.pieces.filter((p) => p.id !== cap.id && p.id !== cap.parentId).flatMap(worldContours);
      for (const [x, y] of [[b.x1, b.y1], [b.x2, b.y1], [b.x1, b.y2], [b.x2, b.y2]] as const) {
        expect(others.some((c) => pointInPolygon(x, y, c)), `${cap.id} clear of ink`).toBe(false);
      }
    }
    const off = arrangeStackInShape({ ...base(), pullStems: false })!;
    expect(off.stems).toBe(0);
    expect(off.pieces.some((p) => p.parentId !== undefined)).toBe(false);
  });
});
