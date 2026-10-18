import { describe, it, expect } from "vitest";
import { MARK_GROUPS } from "./markLibrary";
import { FRAME_PADDING, fitFrameToRect, frameWindow } from "./frameWindow";
import { flattenContours } from "./strokeCuts";
import { parseSvgPath, pointInPolygon } from "./svgPath";

// Every frame in the library must have an open window that holds no ink, so
// framed text is never covered by its own frame.
// A tile (a border built to fit, see tileRing.ts) is no frame by itself.
const frames = (MARK_GROUPS.find((g) => g.id === "frames")?.items ?? []).filter((f) => !f.tile);

describe("frameWindow", () => {
  it("finds the library's frames", () => {
    expect(frames.length).toBeGreaterThan(0);
  });

  for (const f of frames) {
    it(`${f.name}: a sizeable window, inside the frame, clear of ink`, () => {
      const w = frameWindow(f.d)!;
      expect(w).not.toBeNull();
      // At least a fifth of the frame each way: room for a word.
      expect(w.w).toBeGreaterThan(f.w / 5);
      expect(w.h).toBeGreaterThan(f.h / 5);
      expect(w.x).toBeGreaterThanOrEqual(-f.w / 2 - 1);
      expect(w.x + w.w).toBeLessThanOrEqual(f.w / 2 + 1);
      const contours = flattenContours(parseSvgPath(f.d)) as [number, number][][];
      for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
        const x = w.x + (w.w * i) / 10, y = w.y + (w.h * j) / 10;
        const n = contours.filter((c) => pointInPolygon(x, y, c)).length;
        expect(n % 2, `ink at ${x.toFixed(0)},${y.toFixed(0)}`).toBe(0);
      }
    });
  }

  it("a solid blob has no window", () => {
    expect(frameWindow("M-50 -50L50 -50L50 50L-50 50Z")).toBeNull();
  });
});

describe("fitFrameToRect", () => {
  it("puts the padded text box exactly on the window, stretching each way", async () => {
    const { MARK_UNITS_PER_EM, markPxCmds } = await import("./markLibrary");
    const f = frames[0];
    const win = frameWindow(f.d)!;
    const rect = { x: 300, y: 120, width: 400, height: 90 };   // a wide word
    const fit = fitFrameToRect(win, rect, MARK_UNITS_PER_EM);
    expect(fit.markScaleX * fit.markScaleY).toBeCloseTo(1, 9);
    expect(fit.markScaleX).toBeGreaterThan(1);                // widened for a wide word
    // The window, drawn the way MarkView draws the frame, lands on the padded text.
    const k = fit.fontSize / MARK_UNITS_PER_EM;
    const left = fit.x + win.x * k * fit.markScaleX, right = fit.x + (win.x + win.w) * k * fit.markScaleX;
    const top = fit.y + win.y * k * fit.markScaleY, bottom = fit.y + (win.y + win.h) * k * fit.markScaleY;
    const pad = FRAME_PADDING;
    expect(left).toBeCloseTo(rect.x - rect.width * pad, 6);
    expect(right).toBeCloseTo(rect.x + rect.width * (1 + pad), 6);
    expect(top).toBeCloseTo(rect.y - rect.height * pad, 6);
    expect(bottom).toBeCloseTo(rect.y + rect.height * (1 + pad), 6);
    expect(markPxCmds(f.d, fit.fontSize, false, fit.markScaleX, fit.markScaleY).length).toBeGreaterThan(0);
  });
});
