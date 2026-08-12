import { describe, it, expect } from "vitest";
import {
  GLYPH_SCALE_MAX,
  GLYPH_SCALE_MIN,
  resolveGlyphTransform,
  scaleFromDrag,
  transformedBox,
} from "./glyphTransform";

describe("resolveGlyphTransform", () => {
  it("resolves undefined to the identity", () => {
    expect(resolveGlyphTransform(undefined)).toEqual({
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
    });
  });

  it("resolves missing fields to their identity values", () => {
    expect(resolveGlyphTransform({ glyphIndex: 3, offsetY: -12 })).toEqual({
      offsetX: 0,
      offsetY: -12,
      scaleX: 1,
      scaleY: 1,
    });
  });

  it("passes through fields that are set", () => {
    expect(
      resolveGlyphTransform({ glyphIndex: 0, offsetX: 5, offsetY: 6, scaleX: 2, scaleY: 0.5 })
    ).toEqual({ offsetX: 5, offsetY: 6, scaleX: 2, scaleY: 0.5 });
  });

  it("clamps out-of-range stored scales, so a hand-edited project file cannot explode a glyph", () => {
    const r = resolveGlyphTransform({ glyphIndex: 0, scaleX: 99, scaleY: -3 });
    expect(r.scaleX).toBe(GLYPH_SCALE_MAX);
    expect(r.scaleY).toBe(GLYPH_SCALE_MIN);
  });
});

describe("scaleFromDrag", () => {
  it("returns the ratio of dragged distance to rest distance", () => {
    expect(scaleFromDrag(40, 60)).toBeCloseTo(1.5, 6);
    expect(scaleFromDrag(40, 20)).toBeCloseTo(0.5, 6);
  });

  it("returns exactly 1 when the pointer is at the rest position", () => {
    expect(scaleFromDrag(40, 40)).toBe(1);
  });

  it("clamps at both ends", () => {
    expect(scaleFromDrag(10, 1000)).toBe(GLYPH_SCALE_MAX);
    expect(scaleFromDrag(10, 0)).toBe(GLYPH_SCALE_MIN);
  });

  it("stays finite at a degenerate zero rest distance", () => {
    const s = scaleFromDrag(0, 25);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeLessThanOrEqual(GLYPH_SCALE_MAX);
  });

  it("treats a drag past the pivot as a shrink, not a negative scale", () => {
    expect(scaleFromDrag(40, -30)).toBe(GLYPH_SCALE_MIN);
  });
});

describe("transformedBox", () => {
  const box = { x: 100, y: -50, width: 40, height: 60 };

  it("returns the box unchanged for an undefined transform", () => {
    expect(transformedBox(box, 100, 0, undefined)).toEqual(box);
  });

  it("translates by the offset", () => {
    expect(transformedBox(box, 100, 0, { glyphIndex: 0, offsetX: 7, offsetY: -3 })).toEqual({
      x: 107,
      y: -53,
      width: 40,
      height: 60,
    });
  });

  it("scales about the pen origin, not the box origin", () => {
    // Pen origin at (100, 0); the box starts exactly at that x, so its
    // left edge is fixed and only its width grows.
    expect(transformedBox(box, 100, 0, { glyphIndex: 0, scaleX: 2 })).toEqual({
      x: 100,
      y: -50,
      width: 80,
      height: 60,
    });
  });

  it("moves a box that is offset from the pen origin away from it when scaling", () => {
    // Box left edge is 20 units right of the pen origin at x=80.
    expect(transformedBox(box, 80, 0, { glyphIndex: 0, scaleX: 2 })).toEqual({
      x: 120,
      y: -50,
      width: 80,
      height: 60,
    });
  });

  it("scales vertically about the baseline so the glyph keeps sitting on it", () => {
    // Pen origin y = 0 is the baseline; the box sits 50 above it.
    expect(transformedBox(box, 100, 0, { glyphIndex: 0, scaleY: 2 })).toEqual({
      x: 100,
      y: -100,
      width: 40,
      height: 120,
    });
  });

  it("applies offset after scale, matching the ctx.translate-then-scale draw order", () => {
    const r = transformedBox(box, 100, 0, {
      glyphIndex: 0,
      offsetX: 10,
      scaleX: 2,
    });
    expect(r).toEqual({ x: 110, y: -50, width: 80, height: 60 });
  });
});
