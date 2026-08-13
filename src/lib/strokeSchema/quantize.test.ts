import { describe, it, expect } from "vitest";
import {
  addedNuqta,
  formatNuqtaDelta,
  halfNuqtaFactorStep,
  quantizeFactor,
  snapStretchFactor,
} from "./quantize";

describe("halfNuqtaFactorStep", () => {
  it("is half a nuqta expressed in factor space", () => {
    // beh's body: 4.2 nuqta long, so half a nuqta is 0.5/4.2 of its length.
    expect(halfNuqtaFactorStep(4.2)).toBeCloseTo(0.11905, 5);
  });

  it("is null when the stroke authored no length", () => {
    expect(halfNuqtaFactorStep(undefined)).toBeNull();
    expect(halfNuqtaFactorStep(0)).toBeNull();
    expect(halfNuqtaFactorStep(-1)).toBeNull();
  });
});

describe("quantizeFactor", () => {
  it("leaves factor 1 exactly alone — the regression bar", () => {
    const step = halfNuqtaFactorStep(4.2)!;
    expect(quantizeFactor(1, step, 0.85, 1.8)).toBe(1);
  });

  it("snaps the ADDED length, not the absolute length", () => {
    const step = halfNuqtaFactorStep(4.2)!;
    // 1.1 is 0.84 of a step above 1 -> rounds to one whole step.
    expect(quantizeFactor(1.1, step, 0.85, 1.8)).toBeCloseTo(1 + step, 6);
    // 1.05 is 0.42 of a step -> rounds back down to no added length at all.
    expect(quantizeFactor(1.05, step, 0.85, 1.8)).toBeCloseTo(1, 6);
  });

  it("snaps shortening as well as lengthening", () => {
    const step = halfNuqtaFactorStep(4.2)!;
    expect(quantizeFactor(0.9, step, 0.85, 1.8)).toBeCloseTo(1 - step, 6);
  });

  it("stays inside the zone's own bounds", () => {
    const step = halfNuqtaFactorStep(1)!; // 0.5 — a coarse step
    expect(quantizeFactor(1.79, step, 0.85, 1.8)).toBeLessThanOrEqual(1.8);
    expect(quantizeFactor(0.86, step, 0.85, 1.8)).toBeGreaterThanOrEqual(0.85);
  });

  it("passes the factor straight through when there is no step", () => {
    expect(quantizeFactor(1.234, null, 0.85, 1.8)).toBe(1.234);
  });
});

describe("addedNuqta / formatNuqtaDelta", () => {
  it("reports the stretch in the units a calligrapher measures in", () => {
    expect(addedNuqta(1.5, 4)).toBeCloseTo(2, 6);
    expect(addedNuqta(1, 4)).toBeCloseTo(0, 6);
    expect(addedNuqta(1.5, undefined)).toBeNull();
  });

  it("formats whole and half nuqta, signed", () => {
    expect(formatNuqtaDelta(0)).toBe("natural");
    expect(formatNuqtaDelta(1.5)).toBe("+1½ nuqta");
    expect(formatNuqtaDelta(0.5)).toBe("+½ nuqta");
    expect(formatNuqtaDelta(2)).toBe("+2 nuqta");
    expect(formatNuqtaDelta(-0.5)).toBe("−½ nuqta");
    expect(formatNuqtaDelta(null)).toBe("");
  });
});

describe("snapStretchFactor", () => {
  const base = { lengthDots: 4.2, minFactor: 0.85, maxFactor: 1.8, enabled: true };

  it("snaps for an in-scope font", () => {
    const step = halfNuqtaFactorStep(4.2)!;
    expect(snapStretchFactor({ ...base, factor: 1.1, fontFamily: "Amiri" })).toBeCloseTo(
      1 + step,
      6
    );
  });

  it("does not snap for a font that is out of scope", () => {
    expect(snapStretchFactor({ ...base, factor: 1.1, fontFamily: "Ruqaa" })).toBe(1.1);
    expect(snapStretchFactor({ ...base, factor: 1.1, fontFamily: "HarfCanvasDiwani" })).toBe(1.1);
  });

  it("does not snap when the user has turned snapping off", () => {
    expect(
      snapStretchFactor({ ...base, enabled: false, factor: 1.1, fontFamily: "Amiri" })
    ).toBe(1.1);
  });

  it("does not snap a handle whose stroke authored no length", () => {
    expect(
      snapStretchFactor({ ...base, lengthDots: undefined, factor: 1.1, fontFamily: "Amiri" })
    ).toBe(1.1);
  });
});
