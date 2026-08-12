import { describe, it, expect } from "vitest";
import {
  GLYPH_SCALE_MAX,
  GLYPH_SCALE_MIN,
  resolveGlyphTransform,
  scaleFromDrag,
  scaleFromHandleDrag,
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

  it("falls back to 1 for a non-finite stored scale rather than propagating NaN", () => {
    // Reachable only from a hand-edited or corrupted project file, but the
    // fallback has to be the identity: NaN would make the glyph vanish and
    // leave no handle to grab and fix it with.
    const r = resolveGlyphTransform({
      glyphIndex: 0,
      scaleX: Number.NaN,
      scaleY: Number.POSITIVE_INFINITY,
    });
    expect(r.scaleX).toBe(1);
    expect(r.scaleY).toBe(1);
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

describe("scaleFromHandleDrag", () => {
  // A glyph whose edge sits 50 units from the pivot, with the dot resting
  // 10 units beyond it — so at scale 1 the dot is at 60.
  const EXTENT = 50;
  const GAP = 10;
  const restAt = (scale: number) => EXTENT * scale + GAP;

  it("returns the starting scale when the pointer has not moved", () => {
    for (const s of [1, 0.5, 1.8, 3]) {
      expect(scaleFromHandleDrag(restAt(s), restAt(s), GAP, s)).toBeCloseTo(s, 6);
    }
  });

  it("keeps the dot exactly `gap` beyond the glyph edge throughout a drag", () => {
    // Dragging the dot to where scale 2 would rest must read back as 2,
    // from any starting scale — this is the property the old
    // startDistance/startScale rest distance violated.
    for (const startScale of [1, 0.5, 1.8, 3]) {
      const target = restAt(2);
      expect(
        scaleFromHandleDrag(restAt(startScale), target, GAP, startScale)
      ).toBeCloseTo(2, 6);
    }
  });

  it("reads a drag toward the pivot as a shrink", () => {
    expect(scaleFromHandleDrag(restAt(1), restAt(0.5), GAP, 1)).toBeCloseTo(0.5, 6);
  });

  it("clamps rather than inverting when dragged past the pivot", () => {
    expect(scaleFromHandleDrag(restAt(1), -80, GAP, 1)).toBe(GLYPH_SCALE_MIN);
  });

  it("stays finite when the glyph has no extent to measure", () => {
    // A bare combining mark can collapse to a zero-width box, putting the
    // dot exactly at the gap.
    const s = scaleFromHandleDrag(GAP, 40, GAP, 1);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBe(GLYPH_SCALE_MAX);
  });

  it("stays finite at a degenerate zero starting scale", () => {
    const s = scaleFromHandleDrag(restAt(1), restAt(1), GAP, 0);
    expect(Number.isFinite(s)).toBe(true);
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
