import { describe, it, expect } from "vitest";
import { kashidaFactorForHandle } from "./kashidaFactor";
import type { GlyphStretchHandle } from "../types";

const handle = (patch: Partial<GlyphStretchHandle> = {}): GlyphStretchHandle => ({
  id: "h1",
  anchorX: 0,
  anchorY: 0,
  dragOriginX: 100,
  dragOriginY: 0,
  dragX: 200,
  dragY: 0,
  bandWidth: 20,
  minFactor: 0.85,
  maxFactor: 1.8,
  kashidaEligible: true,
  priority: 10,
  lengthDots: 4.2,
  ...patch,
});

describe("kashidaFactorForHandle", () => {
  it("returns null for a handle the dial must not touch", () => {
    expect(kashidaFactorForHandle(handle({ kashidaEligible: false }), 50)).toBeNull();
    expect(kashidaFactorForHandle(handle({ maxFactor: undefined }), 50)).toBeNull();
  });

  it("reproduces the established distribution formula", () => {
    // 1 + (1.8 - 1) * (50/100) * (10/10) = 1.4
    expect(kashidaFactorForHandle(handle(), 50)).toBeCloseTo(1.4, 6);
    // priority 5 halves it: 1 + 0.8 * 0.5 * 0.5 = 1.2
    expect(kashidaFactorForHandle(handle({ priority: 5 }), 50)).toBeCloseTo(1.2, 6);
  });

  it("defaults a missing priority to 5, as before", () => {
    expect(kashidaFactorForHandle(handle({ priority: undefined }), 50)).toBeCloseTo(1.2, 6);
  });

  it("never exceeds the handle's own maxFactor", () => {
    expect(kashidaFactorForHandle(handle(), 100)).toBeCloseTo(1.8, 6);
  });

  it("leaves the dial at 0 exactly at the natural factor", () => {
    expect(kashidaFactorForHandle(handle(), 0)).toBe(1);
  });

  it("quantizes to half-nuqta when asked, for an in-scope font", () => {
    const step = 0.5 / 4.2;
    const raw = kashidaFactorForHandle(handle(), 50)!;
    const snapped = kashidaFactorForHandle(handle(), 50, {
      fontFamily: "Amiri",
      enabled: true,
    })!;
    expect(snapped).toBeCloseTo(1 + Math.round((raw - 1) / step) * step, 6);
  });

  it("does not quantize for an out-of-scope font or when disabled", () => {
    const raw = kashidaFactorForHandle(handle(), 50)!;
    expect(
      kashidaFactorForHandle(handle(), 50, { fontFamily: "Ruqaa", enabled: true })
    ).toBeCloseTo(raw, 6);
    expect(
      kashidaFactorForHandle(handle(), 50, { fontFamily: "Amiri", enabled: false })
    ).toBeCloseTo(raw, 6);
  });
});
