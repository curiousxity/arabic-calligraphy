import { describe, it, expect } from "vitest";
import {
  makeOffsetAdapter,
  makeShapeFillInstanceAdapter,
} from "./diacriticPlacement";

describe("makeOffsetAdapter", () => {
  it("translates to canvas space and back", () => {
    const a = makeOffsetAdapter(30, -12);
    expect(a.toCanvas(5, 5)).toEqual({ x: 35, y: -7 });
    expect(a.toLocal(35, -7)).toEqual({ x: 5, y: 5 });
  });

  it("is the identity at zero offset", () => {
    const a = makeOffsetAdapter(0, 0);
    expect(a.toCanvas(7, 9)).toEqual({ x: 7, y: 9 });
  });
});

describe("makeShapeFillInstanceAdapter", () => {
  const cases = [
    { gx: 0, gy: 0, rotationDeg: 0, scX: 1, scY: 1, shapeScale: 1 },
    { gx: 40, gy: 120, rotationDeg: 0, scX: 1, scY: 1, shapeScale: 1 },
    { gx: 40, gy: 120, rotationDeg: 0, scX: 1.4, scY: 0.7, shapeScale: 1 },
    { gx: -25, gy: 60, rotationDeg: 18, scX: 1, scY: 1, shapeScale: 1 },
    { gx: 40, gy: 120, rotationDeg: -35, scX: 0.6, scY: 1.9, shapeScale: 2.5 },
    { gx: 5, gy: 5, rotationDeg: 90, scX: 2, scY: 2, shapeScale: 0.3 },
  ];

  for (const c of cases) {
    it(`round-trips with ${JSON.stringify(c)}`, () => {
      const a = makeShapeFillInstanceAdapter(c);
      for (const p of [
        { x: 0, y: 0 },
        { x: 12, y: -30 },
        { x: -8, y: 45 },
      ]) {
        const canvas = a.toCanvas(p.x, p.y);
        const back = a.toLocal(canvas.x, canvas.y);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    });
  }

  it("places a glyph-local origin at the instance origin, scaled by shapeScale", () => {
    const a = makeShapeFillInstanceAdapter({
      gx: 10, gy: 20, rotationDeg: 0, scX: 1, scY: 1, shapeScale: 2,
    });
    expect(a.toCanvas(0, 0)).toEqual({ x: 20, y: 40 });
  });

  it("applies row scale before rotation", () => {
    const a = makeShapeFillInstanceAdapter({
      gx: 0, gy: 0, rotationDeg: 90, scX: 3, scY: 1, shapeScale: 1,
    });
    const p = a.toCanvas(1, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(3, 6);
  });

  it("stays finite and invertible at degenerate zero scales", () => {
    const a = makeShapeFillInstanceAdapter({
      gx: 0, gy: 0, rotationDeg: 0, scX: 0, scY: 0, shapeScale: 0,
    });
    const canvas = a.toCanvas(4, 4);
    const back = a.toLocal(canvas.x, canvas.y);
    expect(Number.isFinite(canvas.x)).toBe(true);
    expect(Number.isFinite(canvas.y)).toBe(true);
    expect(Number.isFinite(back.x)).toBe(true);
    expect(Number.isFinite(back.y)).toBe(true);
  });
});
