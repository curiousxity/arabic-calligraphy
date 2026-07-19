import { describe, it, expect } from "vitest";
import { applyGlyphEdit, applyGlyphRig } from "./glyphEdits";
import type { GlyphEdit, GlyphRig } from "../types";

describe("applyGlyphEdit", () => {
  it("is a no-op with no edit", () => {
    const p = applyGlyphEdit(10, 20, undefined);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(20);
  });

  it("stretches a point on the axis, within the band, toward the drag position", () => {
    const edit: GlyphEdit = {
      glyphIndex: 0,
      stretches: [
        {
          id: "h1",
          anchorX: 0,
          anchorY: 0,
          dragOriginX: 100,
          dragOriginY: 0,
          dragX: 150,
          dragY: 0,
          bandWidth: 20,
        },
      ],
    };
    // Sits exactly at the (unstretched) drag origin, on the axis (perpDist 0).
    const p = applyGlyphEdit(100, 0, edit);
    // tAlong = 1, falloff = 1, deltaAlong = 50 -> full 50px displacement.
    expect(p.x).toBeCloseTo(150);
    expect(p.y).toBeCloseTo(0);
  });

  it("leaves points outside the band width untouched", () => {
    const edit: GlyphEdit = {
      glyphIndex: 0,
      stretches: [
        {
          id: "h1",
          anchorX: 0,
          anchorY: 0,
          dragOriginX: 100,
          dragOriginY: 0,
          dragX: 150,
          dragY: 0,
          bandWidth: 20,
        },
      ],
    };
    const p = applyGlyphEdit(100, 50, edit);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(50);
  });

  it("applies move after stretches, as a rigid shift", () => {
    const edit: GlyphEdit = {
      glyphIndex: 0,
      move: { offsetX: 5, offsetY: -5 },
      stretches: [],
    };
    const p = applyGlyphEdit(10, 10, edit);
    expect(p.x).toBeCloseTo(15);
    expect(p.y).toBeCloseTo(5);
  });
});

describe("applyGlyphRig", () => {
  const rig: GlyphRig = {
    fontFamily: "Thuluth",
    glyphId: 42,
    axes: [
      {
        id: "axis1",
        name: "Tip Length",
        // Em-relative: authored at fontSize 100, so these are raw/100.
        anchorX: 0,
        anchorY: 0,
        dragOriginX: 1,
        dragOriginY: 0,
        dragX: 1.5,
        dragY: 0,
        bandWidth: 0.2,
      },
    ],
  };

  it("is a no-op with no values", () => {
    const p = applyGlyphRig(100, 0, "Thuluth", 42, 100, [rig], undefined);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  it("is a no-op when the rig for this font+glyph isn't found", () => {
    const p = applyGlyphRig(100, 0, "Kufi", 42, 100, [rig], [{ axisId: "axis1", value: 1 }]);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  it("skips a value of exactly 0", () => {
    const p = applyGlyphRig(100, 0, "Thuluth", 42, 100, [rig], [{ axisId: "axis1", value: 0 }]);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  it("silently skips a dangling axis id", () => {
    const p = applyGlyphRig(100, 0, "Thuluth", 42, 100, [rig], [{ axisId: "missing", value: 1 }]);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  it("rescales axis geometry by the consuming block's fontSize, at value 1", () => {
    // Rig authored at fontSize 100 -> anchor at (0,0), dragOrigin at (100,0),
    // drag at (150,0) in raw pixels. Consuming at the SAME fontSize (100):
    // a point sitting at the (rescaled) dragOrigin should move the full 50px.
    const p = applyGlyphRig(100, 0, "Thuluth", 42, 100, [rig], [{ axisId: "axis1", value: 1 }]);
    expect(p.x).toBeCloseTo(150);
    expect(p.y).toBeCloseTo(0);
  });

  it("scales displacement proportionally to a different consuming fontSize", () => {
    // Consuming at fontSize 50 (half): dragOrigin rescales to (50,0), drag to
    // (75,0) -> a point at the rescaled dragOrigin moves by 25px, not 50px.
    const p = applyGlyphRig(50, 0, "Thuluth", 42, 50, [rig], [{ axisId: "axis1", value: 1 }]);
    expect(p.x).toBeCloseTo(75);
    expect(p.y).toBeCloseTo(0);
  });

  it("scales displacement by the value multiplier, including negative values", () => {
    const half = applyGlyphRig(100, 0, "Thuluth", 42, 100, [rig], [{ axisId: "axis1", value: 0.5 }]);
    expect(half.x).toBeCloseTo(125);

    const negative = applyGlyphRig(100, 0, "Thuluth", 42, 100, [rig], [{ axisId: "axis1", value: -1 }]);
    expect(negative.x).toBeCloseTo(50);
  });
});
