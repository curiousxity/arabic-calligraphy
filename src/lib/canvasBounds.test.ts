import { describe, it, expect } from "vitest";
import { MAX_SCALE, MAX_STEP, MIN_SCALE, ZOOM_STEP, pinchStep, zoomFactorFromWheel } from "./canvasBounds";

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

describe("pinchStep", () => {
  const pair = (ax: number, ay: number, bx: number, by: number) => [
    { x: ax, y: ay },
    { x: bx, y: by },
  ] as const;

  it("pans by the midpoint's travel when the fingers keep their spacing", () => {
    const r = pinchStep(pair(100, 100, 200, 100), pair(130, 140, 230, 140), 2, { x: 10, y: 20 });
    expect(r.scale).toBeCloseTo(2, 9);
    expect(r.position).toEqual({ x: 40, y: 60 });
  });

  it("zooms by the ratio of finger spacing", () => {
    const r = pinchStep(pair(100, 100, 200, 100), pair(50, 100, 250, 100), 1, { x: 0, y: 0 });
    expect(r.scale).toBeCloseTo(2, 9);
  });

  it("keeps the content point under the fingers' midpoint fixed", () => {
    const scale = 1.5;
    const position = { x: -30, y: 45 };
    const prev = pair(100, 200, 180, 260);
    const next = pair(60, 170, 260, 330);
    const r = pinchStep(prev, next, scale, position);
    // Content point under the previous midpoint...
    const cx = (140 - position.x) / scale;
    const cy = (230 - position.y) / scale;
    // ...lands under the new midpoint.
    expect(cx * r.scale + r.position.x).toBeCloseTo(160, 9);
    expect(cy * r.scale + r.position.y).toBeCloseTo(250, 9);
  });

  it("clamps to the zoom limits and still anchors at the clamped scale", () => {
    const r = pinchStep(pair(100, 100, 101, 100), pair(0, 100, 1000, 100), MAX_SCALE / 2, { x: 0, y: 0 });
    expect(r.scale).toBe(MAX_SCALE);
    const out = pinchStep(pair(0, 100, 1000, 100), pair(500, 100, 501, 100), MIN_SCALE * 2, { x: 0, y: 0 });
    expect(out.scale).toBe(MIN_SCALE);
  });

  it("treats fingers on the same spot as a pure pan rather than dividing by zero", () => {
    const r = pinchStep(pair(100, 100, 100, 100), pair(120, 100, 180, 100), 1, { x: 0, y: 0 });
    expect(r.scale).toBe(1);
    expect(Number.isFinite(r.position.x)).toBe(true);
  });
});
