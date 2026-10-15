import { describe, expect, it } from "vitest";
import { complementOf, hexToHsl } from "./complementColor";

describe("complementOf", () => {
  it("flips the hue of a saturated colour", () => {
    const h = hexToHsl(complementOf("#ff0000"))!;
    expect(h.h).toBeCloseTo(180, 0);
  });

  it("gives a navy ink a warm, visible complement", () => {
    const h = hexToHsl(complementOf("#1e3a5f"))!;
    expect(h.h).toBeGreaterThan(20);
    expect(h.h).toBeLessThan(60);
    expect(h.s).toBeGreaterThanOrEqual(0.69);
    expect(h.l).toBeGreaterThanOrEqual(0.44);
    expect(h.l).toBeLessThanOrEqual(0.6);
  });

  it("still returns something visible for black, white and grey", () => {
    for (const c of ["#000000", "#ffffff", "#808080", "#000"]) {
      const h = hexToHsl(complementOf(c))!;
      expect(h.s).toBeGreaterThanOrEqual(0.69);
      expect(h.l).toBeGreaterThanOrEqual(0.44);
    }
  });

  it("falls back on an unparsable colour", () => {
    expect(complementOf("tomato")).toBe(complementOf(""));
    expect(complementOf("")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
