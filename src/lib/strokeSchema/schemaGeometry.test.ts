import { describe, it, expect } from "vitest";
import { computeNodeBoundingBox, normalizePoint, mapNormToRealBox } from "./schemaGeometry";
import type { GlyphDescription } from "./types";

function glyphWithNodes(nodes: { x: number; y: number }[]): GlyphDescription {
  return {
    schemaVersion: "1.0.0",
    styleProfile: {
      script: "arabic",
      calligraphicModel: "naskh",
      measurementSystem: { dotUnit: { name: "nuqta", shape: "rhombic", width: 1, height: 1 }, angleDegrees: 45 },
      verticalLevels: [],
    },
    glyph: {
      id: "TEST",
      baseLetter: "x",
      joiningForm: "isolated",
      components: [
        {
          id: "C1",
          type: "BODY",
          strokes: [
            {
              id: "S1",
              function: "BODY",
              path: { kind: "bezier", nodes },
              editBehavior: { stretchZones: [], protectedZones: [], priority: 5 },
            },
          ],
        },
      ],
    },
  };
}

describe("computeNodeBoundingBox", () => {
  it("scans every stroke's node coordinates across all components", () => {
    const desc = glyphWithNodes([
      { x: 0, y: -2 },
      { x: 10, y: 5 },
      { x: 4, y: 1 },
    ]);
    expect(computeNodeBoundingBox(desc)).toEqual({ minX: 0, minY: -2, maxX: 10, maxY: 5 });
  });

  it("falls back to a unit box when there are no nodes at all", () => {
    expect(computeNodeBoundingBox(glyphWithNodes([]))).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });
});

describe("normalizePoint", () => {
  it("computes a plain 0-1 proportion within the box", () => {
    const bbox = { minX: 0, minY: 0, maxX: 10, maxY: 4 };
    expect(normalizePoint({ x: 5, y: 2 }, bbox)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalizePoint({ x: 0, y: 0 }, bbox)).toEqual({ x: 0, y: 0 });
    expect(normalizePoint({ x: 10, y: 4 }, bbox)).toEqual({ x: 1, y: 1 });
  });
});

describe("mapNormToRealBox", () => {
  it("maps x directly but flips y (schema Y-up vs real-box Y-down)", () => {
    const box = { x: 100, y: 200, width: 50, height: 20 };
    // norm (0,0) = schema's bottom-left -> real box's bottom-left in x, but TOP in y (flip)
    expect(mapNormToRealBox({ x: 0, y: 0 }, box)).toEqual({ x: 100, y: 220 });
    // norm (1,1) = schema's top-right -> real box's right in x, but TOP in y
    expect(mapNormToRealBox({ x: 1, y: 1 }, box)).toEqual({ x: 150, y: 200 });
    // center maps to center regardless of flip
    expect(mapNormToRealBox({ x: 0.5, y: 0.5 }, box)).toEqual({ x: 125, y: 210 });
  });
});
