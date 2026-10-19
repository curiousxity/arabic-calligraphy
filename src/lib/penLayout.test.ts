import { describe, expect, it } from "vitest";
import { clampStrokeOpacity, defaultLayout, layoutGeometry, RUN_GAP, SPACING_CLEARANCE, WORD_GAP, type PenLayout } from "./penLayout";
import { flattenContours } from "./strokeCuts";
import { loadPenLibrary, NUQTA, type Form, type Part, type PenLibrary } from "./penLibrary";
import type { Pt } from "./penSweep";

const seg = (a: Pt, b: Pt) => ({ c1: [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3] as Pt, c2: [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3] as Pt, to: { p: b } });
const path = (...pts: Pt[]) => ({ start: { p: pts[0] }, segs: pts.slice(1).map((p, i) => seg(pts[i], p)) });
const parts: Part[] = [
  { id: "stem", name: "stem", paths: [path([0, -6], [0, 0])] },
  { id: "loop", name: "loop", paths: [path([0, 0], [-0.5, -1], [-1.2, 0], [-2, 0.2])] },
  { id: "tooth", name: "tooth", paths: [path([0, -1.5], [0, 0], [-1, 0])] },
  { id: "bowl", name: "bowl", paths: [path([0, 0], [-1, 1.5], [-3, 1.5], [-3.5, 0])] },
  { id: "hamza", name: "hamza", drawn: ["M0 0 L0.4 -0.3 L0.3 0.2 Z"] },
];
const anchors = { above: [-0.5, -7] as Pt, below: [-0.5, 1] as Pt };
const forms: Form[] = [
  { id: "alif.standalone.f", letter: "ا", form: "standalone", parts: [{ part: "stem", at: [0, 0], body: true }], anchors },
  { id: "meem.standalone.f", letter: "م", form: "standalone", parts: [{ part: "loop", at: [0, 0], body: true }], anchors },
  { id: "ya.starting.f", letter: "ي", form: "starting", parts: [{ part: "tooth", at: [0, 0], body: true }], dots: [[-0.5, 1]], anchors },
  { id: "meem.middle.f", letter: "م", form: "middle", parts: [{ part: "loop", at: [0, 0], body: true }], anchors },
  { id: "nun.finishing.f", letter: "ن", form: "finishing", parts: [{ part: "bowl", at: [0, 0], body: true }], dots: [[-1.7, -0.5]], anchors },
];
const lib = (fs: Form[], ps: Part[]): PenLibrary => ({ parts: new Map(ps.map((p) => [p.id, p])), forms: new Map(fs.map((f) => [f.id, f])), joins: { "*": { gap: 0.5, rise: 0 } } });
const fixtureFull = lib(forms, parts);
const emptyLib = lib([], []);
const shipped = (phrase: string) => !("missing" in defaultLayout(loadPenLibrary(), phrase));

/** Each run's ink points, from the layout's strokes in drawing order (each run's paths, then hamzas, then dots). */
function runInks(g: ReturnType<typeof layoutGeometry>, l: PenLayout): Pt[][] {
  const pts = g.strokes.map((s) => flattenContours(s, 8).flat());
  // strokes are pushed run by run; split them by which run's bounds hold them
  return g.runs.map((b) => pts.filter((ps) => ps.every(([x]) => x >= b.x1 - 1 && x <= b.x2 + 1)).flat()).slice(0, l.runs.length);
}
/** The least horizontal distance from a later run's ink to an earlier run's (on its left side), over points
 *  within SPACING_CLEARANCE of each other in height. */
function closestAcross(earlier: Pt[], later: Pt[]): number {
  let best = Infinity;
  for (const p of earlier) for (const q of later) if (Math.abs(p[1] - q[1]) <= SPACING_CLEARANCE * NUQTA) best = Math.min(best, p[0] - q[0]);
  return best;
}

describe("the phrase laid out on a line", () => {
  it("reports the letters with no pen forms", () => {
    expect(defaultLayout(emptyLib, "أم")).toEqual({ missing: ["ا", "ء", "م"] });
  });

  it("splits a phrase into runs at letters that do not join forward, words marked", () => {
    const l = defaultLayout(fixtureFull, "أم أيمن") as PenLayout;
    expect(l.runs.map((r) => r.forms.length)).toEqual([1, 1, 1, 3]);
    expect(l.wordStarts).toEqual([0, 2]);
    expect(l.runs[0].hamza).toEqual([{ index: 0, side: "above" }]);
    expect(l.runs[3].forms).toEqual(["ya.starting.f", "meem.middle.f", "nun.finishing.f"]);
  });

  it("draws the letters of a vowelled phrase", () => {
    expect(defaultLayout(fixtureFull, "أُمّ أَيْمَن")).toEqual(defaultLayout(fixtureFull, "أم أيمن"));
  });

  it("keeps runs and words apart by RUN_GAP and WORD_GAP, ink to ink at the same height, right to left", () => {
    const l = defaultLayout(fixtureFull, "أم أيمن") as PenLayout;
    const g = layoutGeometry(fixtureFull, l);
    expect(g.runs[0].x2).toBeCloseTo(0, 6);
    const inks = runInks(g, l);
    for (let k = 0; k + 1 < inks.length; k++) {
      const gap = (l.wordStarts.includes(k + 1) ? WORD_GAP : RUN_GAP) * NUQTA;
      expect(closestAcross(inks[k], inks[k + 1]), `runs ${k} and ${k + 1}`).toBeCloseTo(gap, 0);
    }
    // one entry per stroke: 4 run bodies, 2 hamzas, 2 dots
    expect(g.strokes).toHaveLength(8);
    expect(g.union.some((c) => c.type === "M")).toBe(true);
  });

  it("tucks a word in over the one before where their ink does not meet, as the masters space a line", () => {
    // the standalone meem's tail sweeps down and left under the line; أيمن's alif stands over it
    const lib = loadPenLibrary();
    const l = defaultLayout(lib, "أم أيمن") as PenLayout;
    const g = layoutGeometry(lib, l);
    expect(g.runs[2].x2).toBeGreaterThan(g.runs[1].x1);
    const inks = runInks(g, l);
    expect(closestAcross(inks[1], inks[2])).toBeGreaterThanOrEqual(WORD_GAP * NUQTA - 1);
  });

  it("clamps stroke opacity", () => {
    expect(clampStrokeOpacity(undefined)).toBe(1);
    expect(clampStrokeOpacity(0)).toBe(0.1);
    expect(clampStrokeOpacity(1.4)).toBe(1);
    expect(clampStrokeOpacity(0.55)).toBe(0.55);
  });

  it.skipIf(!shipped("أم أيمن الحب حياتي"))("lays the first target out in under 250 ms", () => {
    const t = performance.now();
    layoutGeometry(loadPenLibrary(), defaultLayout(loadPenLibrary(), "أم أيمن الحب حياتي") as PenLayout);
    expect(performance.now() - t).toBeLessThan(250);
  });
});
