import { describe, it, expect } from "vitest";
import {
  makeGlyphTransformAdapter,
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

describe("makeGlyphTransformAdapter", () => {
  const base = {
    offsetX: 30,
    offsetY: -12,
    pivotX: 100,
    pivotY: 0,
    transformOffsetX: 0,
    transformOffsetY: 0,
    scaleX: 1,
    scaleY: 1,
  };

  it("matches makeOffsetAdapter exactly when the transform is the identity", () => {
    const plain = makeOffsetAdapter(30, -12);
    const withTransform = makeGlyphTransformAdapter(base);
    for (const p of [
      { x: 0, y: 0 },
      { x: 120, y: -40 },
      { x: -75, y: 55 },
    ]) {
      expect(withTransform.toCanvas(p.x, p.y)).toEqual(plain.toCanvas(p.x, p.y));
      expect(withTransform.toLocal(p.x, p.y)).toEqual(plain.toLocal(p.x, p.y));
    }
  });

  const cases = [
    { ...base, transformOffsetX: 40 },
    { ...base, transformOffsetY: -25 },
    { ...base, scaleX: 1.8 },
    { ...base, scaleY: 0.4 },
    { ...base, transformOffsetX: 40, transformOffsetY: -25, scaleX: 1.8, scaleY: 0.4 },
    { ...base, pivotX: -60, pivotY: 35, scaleX: 3, scaleY: 3 },
    // A turn on its own, and a turn combined with everything else — the
    // rotation is the innermost of the three, so composing it correctly and
    // inverting it in the same order is what the round trip is checking.
    { ...base, rotationDeg: 35, rotationPivotX: 118, rotationPivotY: -20 },
    {
      ...base,
      transformOffsetX: 40,
      transformOffsetY: -25,
      scaleX: 1.8,
      scaleY: 0.4,
      rotationDeg: -62,
      rotationPivotX: 118,
      rotationPivotY: -20,
    },
  ];

  for (const c of cases) {
    it(`round-trips with ${JSON.stringify(c)}`, () => {
      const a = makeGlyphTransformAdapter(c);
      for (const p of [
        { x: 100, y: 0 },
        { x: 137, y: -48 },
        { x: -20, y: 62 },
      ]) {
        const back = a.toLocal(...(Object.values(a.toCanvas(p.x, p.y)) as [number, number]));
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    });
  }

  it("leaves the pivot itself fixed under scaling alone", () => {
    const a = makeGlyphTransformAdapter({ ...base, scaleX: 2.5, scaleY: 2.5 });
    expect(a.toCanvas(base.pivotX, base.pivotY)).toEqual({
      x: base.pivotX + base.offsetX,
      y: base.pivotY + base.offsetY,
    });
  });

  it("reads a canvas-space drag back as an unscaled text-space offset", () => {
    // The whole point of routing the diacritic overlay through this
    // adapter: on a glyph scaled 2x vertically, dragging a mark 30px up on
    // screen must store a 15-unit offset, not 30.
    const a = makeGlyphTransformAdapter({ ...base, scaleY: 2 });
    const at = a.toCanvas(120, -40);
    const moved = a.toLocal(at.x, at.y - 30);
    expect(moved.y).toBeCloseTo(-40 - 15, 6);
  });

  it("still reads a drag back as unscaled and unturned with a rotation set", () => {
    // The contract the whole adapter exists for, now with the fourth
    // handle in play: a mark's stored offsetY must stay in the glyph's own
    // pre-transform units no matter how the glyph itself has been turned or
    // stretched, or DiacriticHoverHandles cannot invert a drag at all.
    const a = makeGlyphTransformAdapter({
      ...base,
      scaleY: 2,
      rotationDeg: 40,
      rotationPivotX: 118,
      rotationPivotY: -20,
    });
    const local = { x: 120, y: -40 };
    const at = a.toCanvas(local.x, local.y);
    const back = a.toLocal(at.x, at.y);
    expect(back.x).toBeCloseTo(local.x, 6);
    expect(back.y).toBeCloseTo(local.y, 6);
  });

  it("matches makeOffsetAdapter exactly at a zero rotation, whatever pivot is passed", () => {
    // Rotation is optional and absent on almost every glyph; a stray pivot
    // must not perturb the common path.
    const plain = makeOffsetAdapter(30, -12);
    const a = makeGlyphTransformAdapter({
      ...base,
      rotationDeg: 0,
      rotationPivotX: 999,
      rotationPivotY: -999,
    });
    expect(a.toCanvas(137, -48)).toEqual(plain.toCanvas(137, -48));
    expect(a.toLocal(137, -48)).toEqual(plain.toLocal(137, -48));
  });

  it("treats a non-finite rotation as no rotation rather than propagating NaN", () => {
    const a = makeGlyphTransformAdapter({
      ...base,
      rotationDeg: Number.NaN,
      rotationPivotX: 118,
      rotationPivotY: -20,
    });
    expect(a.toCanvas(137, -48)).toEqual(makeOffsetAdapter(30, -12).toCanvas(137, -48));
  });

  it("turns the mark about the pivot the renderer turns the glyph about", () => {
    // A quarter turn about the mark's own position leaves it exactly there;
    // a quarter turn about a point beside it swings it round by the radius.
    const pivot = { x: 118, y: -20 };
    const a = makeGlyphTransformAdapter({
      ...base,
      offsetX: 0,
      offsetY: 0,
      rotationDeg: 90,
      rotationPivotX: pivot.x,
      rotationPivotY: pivot.y,
    });
    expect(a.toCanvas(pivot.x, pivot.y).x).toBeCloseTo(pivot.x, 6);
    expect(a.toCanvas(pivot.x, pivot.y).y).toBeCloseTo(pivot.y, 6);
    // 40 to the right of the pivot, turned a quarter clockwise, lands 40 below.
    const p = a.toCanvas(pivot.x + 40, pivot.y);
    expect(p.x).toBeCloseTo(pivot.x, 6);
    expect(p.y).toBeCloseTo(pivot.y + 40, 6);
  });

  it("stays finite at a degenerate zero scale", () => {
    const a = makeGlyphTransformAdapter({ ...base, scaleX: 0, scaleY: 0 });
    const at = a.toCanvas(120, -40);
    const back = a.toLocal(at.x, at.y);
    expect(Number.isFinite(at.x)).toBe(true);
    expect(Number.isFinite(back.y)).toBe(true);
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
