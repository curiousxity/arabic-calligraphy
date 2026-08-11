import { describe, it, expect } from "vitest";
import { dotPositionForFactor, factorForPosition, projectOntoAxis } from "./dragAxis";

describe("dotPositionForFactor", () => {
  it("lands exactly on dragOrigin at factor 1", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 100, y: 0 };
    const p = dotPositionForFactor(anchor, dragOrigin, 1);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  it("lands exactly on the extrapolated point at factor = maxFactor", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 100, y: 0 };
    const maxFactor = 1.8;
    const p = dotPositionForFactor(anchor, dragOrigin, maxFactor);
    expect(p.x).toBeCloseTo(180);
    expect(p.y).toBeCloseTo(0);
  });

  it("lands on the anchor at factor 0", () => {
    const anchor = { x: 10, y: 20 };
    const dragOrigin = { x: 10, y: 120 };
    const p = dotPositionForFactor(anchor, dragOrigin, 0);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(20);
  });
});

describe("factorForPosition", () => {
  it("round-trips with dotPositionForFactor for a representative range", () => {
    const anchor = { x: 5, y: 5 };
    const dragOrigin = { x: 5, y: 105 };
    for (const factor of [0.85, 1, 1.2, 1.5, 1.8]) {
      const dot = dotPositionForFactor(anchor, dragOrigin, factor);
      const recovered = factorForPosition(anchor, dragOrigin, dot, 0.85, 1.8);
      expect(recovered).toBeCloseTo(factor, 5);
    }
  });

  it("round-trips on a diagonal axis", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 60, y: 80 }; // length 100
    for (const factor of [0.5, 1, 1.5, 2]) {
      const dot = dotPositionForFactor(anchor, dragOrigin, factor);
      const recovered = factorForPosition(anchor, dragOrigin, dot, 0, 3);
      expect(recovered).toBeCloseTo(factor, 5);
    }
  });

  it("clamps to minFactor/maxFactor", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 100, y: 0 };
    expect(factorForPosition(anchor, dragOrigin, { x: -50, y: 0 }, 0.85, 1.8)).toBeCloseTo(0.85);
    expect(factorForPosition(anchor, dragOrigin, { x: 500, y: 0 }, 0.85, 1.8)).toBeCloseTo(1.8);
  });

  it("ignores perpendicular offset (projects onto the axis)", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 100, y: 0 };
    // Directly above the dragOrigin point — perpendicular distance shouldn't change the factor.
    const factor = factorForPosition(anchor, dragOrigin, { x: 100, y: 40 }, 0, 3);
    expect(factor).toBeCloseTo(1);
  });
});

describe("projectOntoAxis", () => {
  it("leaves an on-axis point unchanged", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 100, y: 0 };
    const p = projectOntoAxis(anchor, dragOrigin, { x: 40, y: 0 });
    expect(p.x).toBeCloseTo(40);
    expect(p.y).toBeCloseTo(0);
  });

  it("projects an off-axis point onto the line", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 100, y: 0 };
    const p = projectOntoAxis(anchor, dragOrigin, { x: 40, y: 25 });
    expect(p.x).toBeCloseTo(40);
    expect(p.y).toBeCloseTo(0);
  });

  it("projects correctly on a diagonal axis", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 3, y: 4 }; // unit direction (0.6, 0.8), length 5
    // Point at distance 10 along the axis direction, offset perpendicular by 1 unit.
    const alongX = 0.6 * 10;
    const alongY = 0.8 * 10;
    const perpX = -0.8 * 1;
    const perpY = 0.6 * 1;
    const p = projectOntoAxis(anchor, dragOrigin, { x: alongX + perpX, y: alongY + perpY });
    expect(p.x).toBeCloseTo(alongX);
    expect(p.y).toBeCloseTo(alongY);
  });
});
