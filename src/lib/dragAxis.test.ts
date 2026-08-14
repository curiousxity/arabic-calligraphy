import { describe, it, expect } from "vitest";
import { projectOntoAxis } from "./dragAxis";

describe("projectOntoAxis", () => {
  it("leaves an on-axis point unchanged", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const p = projectOntoAxis(a, b, { x: 40, y: 0 });
    expect(p.x).toBeCloseTo(40);
    expect(p.y).toBeCloseTo(0);
  });

  it("projects an off-axis point onto the line", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const p = projectOntoAxis(a, b, { x: 40, y: 25 });
    expect(p.x).toBeCloseTo(40);
    expect(p.y).toBeCloseTo(0);
  });

  it("projects correctly on a diagonal axis", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 3, y: 4 }; // unit direction (0.6, 0.8), length 5
    // Point at distance 10 along the axis direction, offset perpendicular by 1 unit.
    const alongX = 0.6 * 10;
    const alongY = 0.8 * 10;
    const perpX = -0.8 * 1;
    const perpY = 0.6 * 1;
    const p = projectOntoAxis(a, b, { x: alongX + perpX, y: alongY + perpY });
    expect(p.x).toBeCloseTo(alongX);
    expect(p.y).toBeCloseTo(alongY);
  });
});
