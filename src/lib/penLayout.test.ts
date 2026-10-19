import { describe, expect, it } from "vitest";
import { clampStrokeOpacity, defaultLayout, layoutGeometry, RUN_GAP, WORD_GAP, type PenLayout } from "./penLayout";
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

/** Each run's ink points. */
function runInks(g: ReturnType<typeof layoutGeometry>, l: PenLayout): Pt[][] {
  const pts = g.strokes.map((s) => flattenContours(s, 8).flat());
  return l.runs.map((_, k) => pts.filter((_, i) => g.strokeRuns[i] === k).flat());
}
/** The least distance between two runs' ink, in any direction. */
function closest(a: Pt[], b: Pt[]): number {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
  return best;
}

describe("the phrase laid out on a line", () => {
  it("reports the letters with no pen forms", () => {
    expect(defaultLayout(emptyLib, "أم")).toEqual({ missing: ["ا", "م"] });
  });

  it("splits a phrase into runs at letters that do not join forward, words marked", () => {
    const l = defaultLayout(fixtureFull, "أم أيمن") as PenLayout;
    expect(l.runs.map((r) => r.forms.length)).toEqual([1, 1, 1, 3]);
    expect(l.wordStarts).toEqual([0, 2]);
    // Thuluth writes the alif bare: the hamza of أ and إ is left out
    expect(l.runs[0].hamza).toBeUndefined();
    expect(l.runs[3].forms).toEqual(["ya.starting.f", "meem.middle.f", "nun.finishing.f"]);
  });

  it("draws the letters of a vowelled phrase", () => {
    expect(defaultLayout(fixtureFull, "أُمّ أَيْمَن")).toEqual(defaultLayout(fixtureFull, "أم أيمن"));
  });

  it("keeps each run RUN_GAP or WORD_GAP clear of all the ink before it, in any direction, right to left", () => {
    // the studio reference (أم أيمن, 2026-10-19) keeps 0.85 nuqta inside a word and 0.9 between words, measured
    // as the closest approach of the new run's ink to everything written before it
    const l = defaultLayout(fixtureFull, "أم أيمن") as PenLayout;
    const g = layoutGeometry(fixtureFull, l);
    expect(g.runs[0].x2).toBeCloseTo(0, 6);
    const inks = runInks(g, l);
    for (let k = 1; k < inks.length; k++) {
      const gap = (l.wordStarts.includes(k) ? WORD_GAP : RUN_GAP) * NUQTA;
      const d = closest(inks.slice(0, k).flat(), inks[k]);
      expect(d, `run ${k}`).toBeGreaterThanOrEqual(gap - 1);
      expect(d, `run ${k}`).toBeLessThanOrEqual(gap + 0.1 * NUQTA);
    }
    // one entry per stroke: 4 run bodies and 2 dots, no hamzas
    expect(g.strokes).toHaveLength(6);
    expect(g.union.some((c) => c.type === "M")).toBe(true);
  });

  it("tucks a word in over the one before where their ink does not meet, as the masters space a line", () => {
    // a meem whose tail sweeps down and left under the line: the next word's alif stands over it
    const tailParts: Part[] = [...parts, { id: "tail", name: "tail", paths: [path([0, 0], [-0.8, -0.8], [-1.4, 0], [-4, 1.5], [-7, 2.2])] }];
    const tailForms: Form[] = forms.map((f) => (f.id === "meem.standalone.f" ? { ...f, parts: [{ part: "tail", at: [0, 0] as Pt, body: true as const }] } : f));
    const tailLib = lib(tailForms, tailParts);
    const l = defaultLayout(tailLib, "ام ا") as PenLayout;
    const g = layoutGeometry(tailLib, l);
    expect(g.runs[2].x2).toBeGreaterThan(g.runs[1].x1);
    const inks = runInks(g, l);
    expect(closest([...inks[0], ...inks[1]], inks[2])).toBeGreaterThanOrEqual(WORD_GAP * NUQTA - 1);
  });

  it("keeps a word clear of a stroke that overhangs it, not only of ink beside it", () => {
    // a letter whose stroke runs left high above the line, just over the next word's alif: the alif may not slip under it
    const shelfParts: Part[] = [...parts, { id: "shelf", name: "shelf", paths: [path([0, 0], [0, -7.1], [-6, -7.1])] }];
    const shelfForms: Form[] = forms.map((f) => (f.id === "meem.standalone.f" ? { ...f, parts: [{ part: "shelf", at: [0, 0] as Pt, body: true as const }] } : f));
    const shelfLib = lib(shelfForms, shelfParts);
    const l = defaultLayout(shelfLib, "ام ا") as PenLayout;
    const inks = runInks(layoutGeometry(shelfLib, l), l);
    expect(closest([...inks[0], ...inks[1]], inks[2])).toBeGreaterThanOrEqual(WORD_GAP * NUQTA - 1);
  });

  it("places each letter group of أم أيمن where the studio reference does, to 0.1 nuqta", () => {
    // the right edge of each group's ink, nuqta left of the first alif's, read off the studio's own outlines
    // (2026-10-19): the meem of أم, the alif of أيمن, and يمن tucked in under the meem's tail
    const lib = loadPenLibrary(), g = layoutGeometry(lib, defaultLayout(lib, "أم أيمن") as PenLayout);
    const at = g.runs.map((b) => (b.x2 - g.runs[0].x2) / NUQTA);
    [0, -1.184, -6.144, -6.528].forEach((want, k) => expect(Math.abs(at[k] - want), `group ${k}`).toBeLessThan(0.1));
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
