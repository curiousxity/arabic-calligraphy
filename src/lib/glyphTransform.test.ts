import { describe, it, expect } from "vitest";
import {
  GLYPH_SCALE_MAX,
  GLYPH_SCALE_MIN,
  glyphPivot,
  mergeGlyphTransform,
  normalizeRotation,
  resolveGlyphTransform,
  rotationFromHandleDrag,
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
      rotation: 0,
    });
  });

  it("resolves missing fields to their identity values", () => {
    expect(resolveGlyphTransform({ glyphIndex: 3, offsetY: -12 })).toEqual({
      offsetX: 0,
      offsetY: -12,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    });
  });

  it("passes through fields that are set", () => {
    expect(
      resolveGlyphTransform({ glyphIndex: 0, offsetX: 5, offsetY: 6, scaleX: 2, scaleY: 0.5 })
    ).toEqual({ offsetX: 5, offsetY: 6, scaleX: 2, scaleY: 0.5, rotation: 0 });
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

describe("mergeGlyphTransform", () => {
  it("creates a fresh entry when nothing is stored", () => {
    expect(mergeGlyphTransform(undefined, 3, { glyphId: 10, offsetX: 5 })).toEqual({
      glyphIndex: 3,
      glyphId: 10,
      offsetX: 5,
    });
  });

  it("patches an entry whose glyph still matches", () => {
    const existing = { glyphIndex: 3, glyphId: 10, scaleX: 2, offsetX: 4 };
    expect(mergeGlyphTransform(existing, 3, { glyphId: 10, offsetX: 9 })).toEqual({
      glyphIndex: 3,
      glyphId: 10,
      scaleX: 2,
      offsetX: 9,
    });
  });

  it("replaces a stale entry rather than reviving its scale", () => {
    // The letter at index 3 changed under a text edit. ShapedText has already
    // stopped rendering this transform; a plain spread would bring its
    // scaleX: 3 back under the new glyph's id and jump the letter to 3x on
    // the first drag frame.
    const stale = { glyphIndex: 3, glyphId: 10, scaleX: 3, scaleY: 3 };
    const merged = mergeGlyphTransform(stale, 3, {
      glyphId: 77,
      offsetX: 5,
      offsetY: 0,
    });
    expect(merged).toEqual({ glyphIndex: 3, glyphId: 77, offsetX: 5, offsetY: 0 });
    expect(merged.scaleX).toBeUndefined();
    expect(merged.scaleY).toBeUndefined();
  });

  it("patches an entry that predates glyphId instead of treating it as stale", () => {
    // No recorded id means it cannot be checked, so it is still being applied
    // — dropping its scale here would silently discard a real edit.
    const legacy = { glyphIndex: 3, scaleX: 2 };
    expect(mergeGlyphTransform(legacy, 3, { glyphId: 77, offsetX: 5 })).toEqual({
      glyphIndex: 3,
      glyphId: 77,
      scaleX: 2,
      offsetX: 5,
    });
  });

  it("patches when the incoming patch carries no glyphId", () => {
    const existing = { glyphIndex: 3, glyphId: 10, scaleX: 2 };
    expect(mergeGlyphTransform(existing, 3, { offsetX: 1 })).toEqual({
      glyphIndex: 3,
      glyphId: 10,
      scaleX: 2,
      offsetX: 1,
    });
  });
});

describe("normalizeRotation", () => {
  it("leaves an ordinary angle alone", () => {
    expect(normalizeRotation(30)).toBe(30);
    expect(normalizeRotation(-95)).toBe(-95);
  });

  it("wraps rather than accumulating, so dragging round and round stays small", () => {
    expect(normalizeRotation(370)).toBeCloseTo(10, 9);
    expect(normalizeRotation(-370)).toBeCloseTo(-10, 9);
    expect(normalizeRotation(720 + 45)).toBeCloseTo(45, 9);
  });

  it("keeps the half-turn positive and folds anything past it", () => {
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(181)).toBeCloseTo(-179, 9);
  });

  it("falls back to no rotation for a non-finite stored value", () => {
    // Reachable only from a hand-edited or corrupted project file. NaN would
    // make the glyph vanish and leave no handle to grab and fix it with.
    expect(normalizeRotation(Number.NaN)).toBe(0);
    expect(normalizeRotation(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("glyphPivot", () => {
  const box = { x: 100, y: -50, width: 40, height: 60 };

  it("is the raw box centre, relative to the pen origin", () => {
    expect(glyphPivot(box, 90, 0)).toEqual({ x: 30, y: -20 });
  });

  it("is unaffected by where the pen origin sits along the run", () => {
    const a = glyphPivot(box, 90, 0);
    const b = glyphPivot(box, 200, 0);
    expect(b.x - a.x).toBe(-110);
  });
});

describe("rotationFromHandleDrag", () => {
  const pivot = { x: 0, y: 0 };

  it("returns the starting angle unchanged on a zero-move first frame", () => {
    // The no-jump property `scaleFromHandleDrag` already guarantees for the
    // scale dots: grabbing a handle must never move the glyph.
    const p = { x: 30, y: -30 };
    expect(rotationFromHandleDrag(pivot, p, p, 25)).toBeCloseTo(25, 9);
  });

  it("reads a quarter turn as 90 degrees", () => {
    // Canvas y grows downward, so +x -> +y is clockwise, which is the
    // direction Konva's own `rotation` counts in.
    expect(
      rotationFromHandleDrag(pivot, { x: 50, y: 0 }, { x: 0, y: 50 }, 0)
    ).toBeCloseTo(90, 6);
  });

  it("measures the change in bearing, not the bearing itself", () => {
    // Which is what lets the dot be grabbed anywhere on its rest circle
    // rather than only where the bearing happens to equal the angle.
    const from = { x: -20, y: -40 };
    const to = { x: -40, y: -20 };
    const zeroStart = rotationFromHandleDrag(pivot, from, to, 0);
    expect(rotationFromHandleDrag(pivot, from, to, 15)).toBeCloseTo(
      zeroStart + 15,
      6
    );
  });

  it("wraps rather than accumulating past a full turn", () => {
    const r = rotationFromHandleDrag(pivot, { x: 50, y: 0 }, { x: 0, y: 50 }, 170);
    expect(r).toBeGreaterThan(-180);
    expect(r).toBeLessThanOrEqual(180);
    expect(r).toBeCloseTo(-100, 6);
  });
});

describe("transformedBox with a rotation", () => {
  const box = { x: 100, y: -50, width: 40, height: 60 };

  it("swaps width and height at a quarter turn", () => {
    const r = transformedBox(box, 100, 0, { glyphIndex: 0, rotation: 90 });
    expect(r.width).toBeCloseTo(60, 6);
    expect(r.height).toBeCloseTo(40, 6);
  });

  it("turns about the box's own centre, leaving it where it was", () => {
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    for (const rotation of [17, 90, -140, 180]) {
      const r = transformedBox(box, 100, 0, { glyphIndex: 0, rotation });
      expect(r.x + r.width / 2).toBeCloseTo(centre.x, 6);
      expect(r.y + r.height / 2).toBeCloseTo(centre.y, 6);
    }
  });

  it("grows the box on the diagonal rather than shrinking it", () => {
    const r = transformedBox(box, 100, 0, { glyphIndex: 0, rotation: 45 });
    expect(r.width).toBeGreaterThan(box.width);
    expect(r.height).toBeGreaterThan(box.height);
  });

  it("is a no-op at a half turn, the box being symmetric about its centre", () => {
    const turned = transformedBox(box, 100, 0, { glyphIndex: 0, rotation: 180 });
    const flat = transformedBox(box, 100, 0, { glyphIndex: 0 });
    // Compared field by field rather than with toEqual: sin(180 degrees) is
    // 1.2e-16 rather than 0 in IEEE754, so the half-extents land a hair wide.
    expect(turned.x).toBeCloseTo(flat.x, 9);
    expect(turned.y).toBeCloseTo(flat.y, 9);
    expect(turned.width).toBeCloseTo(flat.width, 9);
    expect(turned.height).toBeCloseTo(flat.height, 9);
  });
});

describe("the scale handles survive a rotation", () => {
  /**
   * The overlay's own drag arithmetic, restated exactly: the dot rests
   * `SCALE_HANDLE_GAP` past the drawn box's right edge, the pivot is the pen
   * origin plus the transform's offset, and `scaleFromHandleDrag` recovers
   * the glyph's unscaled extent from that. This is the pipeline that shipped
   * wrong twice, so a rotation must not disturb it.
   */
  const GAP = 10;
  const raw = { x: 100, y: -50, width: 40, height: 60 };
  const gx = 90;
  const gy = 0;

  const dragToScale = (
    start: { scaleX: number; rotation?: number; offsetX?: number },
    requested: number
  ) => {
    const t = { glyphIndex: 0, ...start };
    const drawn = transformedBox(raw, gx, gy, t);
    const pivotX = gx + (start.offsetX ?? 0);
    const startDistanceX = drawn.x + drawn.width + GAP - pivotX;

    // Where the dot would have to sit for the glyph to be at `requested`.
    const target = transformedBox(raw, gx, gy, { ...t, scaleX: requested });
    const dragDistance = target.x + target.width + GAP - pivotX;

    return scaleFromHandleDrag(startDistanceX, dragDistance, GAP, start.scaleX);
  };

  it("round-trips at rotation 0, as it always did", () => {
    expect(dragToScale({ scaleX: 1 }, 2)).toBeCloseTo(2, 6);
    expect(dragToScale({ scaleX: 1.8 }, 0.7)).toBeCloseTo(0.7, 6);
  });

  it("round-trips with a rotation and a non-unit start scale set together", () => {
    // The test that catches the rejected design. Applying the rotation
    // *outside* the scale makes the drawn box's half-extent
    // |hw·sx·cos| + |hh·sy·sin| — no longer proportional to sx — so the
    // extent `scaleFromHandleDrag` recovers from the drag-start snapshot is
    // wrong and the gesture converges somewhere else entirely.
    expect(dragToScale({ scaleX: 1.8, rotation: 30 }, 2.6)).toBeCloseTo(2.6, 6);
    expect(dragToScale({ scaleX: 1.8, rotation: 30, offsetX: 12 }, 0.9)).toBeCloseTo(
      0.9,
      6
    );
  });

  it("returns the starting scale unchanged on the first frame, at any angle", () => {
    for (const rotation of [0, 30, -75, 144]) {
      expect(dragToScale({ scaleX: 1.8, rotation }, 1.8)).toBeCloseTo(1.8, 6);
    }
  });
});
