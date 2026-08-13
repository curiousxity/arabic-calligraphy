import { describe, it, expect } from "vitest";
import { MAX_STEP, ZOOM_STEP, zoomFactorFromWheel } from "./canvasBounds";

describe("zoomFactorFromWheel", () => {
  it("does nothing at zero travel", () => {
    expect(zoomFactorFromWheel(0)).toBe(1);
  });

  it("zooms in on negative delta and out on positive", () => {
    expect(zoomFactorFromWheel(-100)).toBeGreaterThan(1);
    expect(zoomFactorFromWheel(100)).toBeLessThan(1);
  });

  it("gives one mouse-wheel detent exactly the zoom buttons' step", () => {
    // Both input paths derive from ZOOM_STEP, so a 100px detent and a
    // button click must stay identical however that constant is tuned.
    expect(zoomFactorFromWheel(-100)).toBeCloseTo(ZOOM_STEP, 6);
    expect(zoomFactorFromWheel(100)).toBeCloseTo(1 / ZOOM_STEP, 6);
  });

  it("scales with travel instead of stepping once per event", () => {
    // This is the whole fix: a trackpad pinch's small per-event deltas must
    // produce correspondingly small steps, not a full detent each.
    const small = zoomFactorFromWheel(-4);
    expect(small).toBeGreaterThan(1);
    // 4px of travel is 4% of a detent, so the factor is ZOOM_STEP to that
    // power — asserted against the constant rather than a literal bound, so
    // retuning ZOOM_STEP can't quietly invalidate this test's premise.
    expect(small).toBeCloseTo(ZOOM_STEP ** 0.04, 6);
    // A pinch event is a small fraction of a detent, not a whole one.
    expect(small).toBeLessThan(zoomFactorFromWheel(-100));
  });

  it("composes: two half-travel events equal one full-travel event", () => {
    const half = zoomFactorFromWheel(-50);
    expect(half * half).toBeCloseTo(zoomFactorFromWheel(-100), 6);
  });

  it("is symmetric, so zooming in then out returns to the start", () => {
    expect(zoomFactorFromWheel(-100) * zoomFactorFromWheel(100)).toBeCloseTo(1, 6);
  });

  it("normalizes line-mode deltas, which Firefox reports instead of pixels", () => {
    // 3 lines ~= 48px, so it must land well short of a 100px detent.
    const lines = zoomFactorFromWheel(-3, 1);
    expect(lines).toBeGreaterThan(1);
    expect(lines).toBeLessThan(zoomFactorFromWheel(-100));
    expect(lines).toBeCloseTo(zoomFactorFromWheel(-48), 6);
  });

  it("normalizes page-mode deltas", () => {
    expect(zoomFactorFromWheel(-1, 2)).toBeCloseTo(zoomFactorFromWheel(-800), 6);
  });

  it("clamps a single enormous flick rather than jumping zoom levels", () => {
    expect(zoomFactorFromWheel(-100000)).toBeLessThanOrEqual(MAX_STEP);
    expect(zoomFactorFromWheel(100000)).toBeGreaterThanOrEqual(1 / MAX_STEP);
    // The clamp must stay above one detent, or a single wheel click would
    // zoom less than one button press.
    expect(MAX_STEP).toBeGreaterThan(ZOOM_STEP);
  });

  it("returns the identity for a non-finite delta", () => {
    expect(zoomFactorFromWheel(Number.NaN)).toBe(1);
  });
});
