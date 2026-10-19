import { describe, expect, it } from "vitest";
import { assembleRun } from "./penJoin";
import { fitPolygons } from "./penFit";
import { defaultLayout, layoutGeometry, type PenLayout } from "./penLayout";
import { formPaths, loadPenLibrary, NUQTA, PEN } from "./penLibrary";
import { polygonArea, sweepPath, type PenPath, type Pt } from "./penSweep";
import { flattenContours } from "./strokeCuts";

const lib = loadPenLibrary();

const pathLength = (p: PenPath) => {
  let L = 0, from = p.start.p;
  for (const s of p.segs) {
    let prev = from;
    for (let i = 1; i <= 64; i++) {
      const t = i / 64, u = 1 - t;
      const q: Pt = [u * u * u * from[0] + 3 * u * u * t * s.c1[0] + 3 * u * t * t * s.c2[0] + t * t * t * s.to.p[0], u * u * u * from[1] + 3 * u * u * t * s.c1[1] + 3 * u * t * t * s.c2[1] + t * t * t * s.to.p[1]];
      L += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
      prev = q;
    }
    from = s.to.p;
  }
  return L;
};

/** The turns of the ink's outline, read two units a step, at every outline point within one pen of `at`:
 *  each turn minus the larger of its neighbours'. A corner turns at one point; a bend turns evenly. */
function cornersNear(cmds: ReturnType<typeof fitPolygons>, at: Pt[]): number[] {
  const out: number[] = [];
  for (const raw of flattenContours(cmds, 256)) {
    // resample at 2-unit spacing
    const ring: Pt[] = [];
    let prev = raw[0], need = 0;
    for (let i = 1; i <= raw.length; i++) {
      const q = raw[i % raw.length];
      let d = Math.hypot(q[0] - prev[0], q[1] - prev[1]);
      while (d >= need) {
        const t = need / (d || 1);
        prev = [prev[0] + (q[0] - prev[0]) * t, prev[1] + (q[1] - prev[1]) * t];
        ring.push(prev); d -= need; need = 2;
      }
      need -= d; prev = q;
    }
    const n = ring.length;
    const turn = (k: number) => {
      const a = ring[(k - 1 + n) % n], b = ring[k], c = ring[(k + 1) % n];
      const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
      return (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]) || 1)))) * 180) / Math.PI;
    };
    for (let k = 0; k < n; k++) {
      // half a pen: a letter's own loop crossing near a join is an inside corner of the letter, not a seam
      if (!at.some((p) => Math.hypot(ring[k][0] - p[0], ring[k][1] - p[1]) < PEN / 2)) continue;
      out.push(turn(k) - Math.max(turn((k - 1 + n) % n), turn((k + 1) % n)));
    }
  }
  return out;
}

/** The join nodes of a word's runs: each join cubic's two ends. */
function joinNodes(phrase: string): { cmds: ReturnType<typeof fitPolygons>; nodes: Pt[] }[] {
  const layout = defaultLayout(lib, phrase) as PenLayout;
  return layout.runs.filter((r) => r.forms.length > 1).map((r) => {
    const run = assembleRun(lib, r.forms, r.joins, [0, 0]);
    const nodes = run.joinSegs.flatMap((k) => [k === 0 ? run.body!.start.p : run.body!.segs[k - 1].to.p, run.body!.segs[k].to.p]);
    return { cmds: fitPolygons(sweepPath(run.body!, PEN), 0.25), nodes };
  });
}

describe("the stroke library: أم أيمن", () => {
  it("draws the standalone alif 5 to 8 nuqta tall", () => {
    const f = formPaths(lib, "alif.standalone.1", [0, 0]);
    const ys = [...[f.body!].map((p) => sweepPath(p, PEN)), ...f.drawn.map((d) => [d])].flat(3).map((q) => q[1]);
    const h = (Math.max(...ys) - Math.min(...ys)) / NUQTA;
    expect(h).toBeGreaterThanOrEqual(5);
    expect(h).toBeLessThanOrEqual(8);
  });

  it("joins every join point of أيمن with no corner on the ink", () => {
    const words = joinNodes("أيمن");
    expect(words.length).toBeGreaterThan(0);
    for (const w of words) {
      const turns = cornersNear(w.cmds, w.nodes);
      expect(turns.length).toBeGreaterThan(0);
      expect(Math.max(...turns)).toBeLessThan(4);
    }
  });

  it("bends no join tighter than the nib's half-width across it, where the ink's edge would pinch to a point", () => {
    for (const r of (defaultLayout(lib, "أيمن") as PenLayout).runs.filter((r) => r.forms.length > 1)) {
      const run = assembleRun(lib, r.forms, r.joins, [0, 0]);
      for (const k of run.joinSegs) {
        const from = k === 0 ? run.body!.start.p : run.body!.segs[k - 1].to.p, s = run.body!.segs[k];
        for (let i = 0; i <= 64; i++) {
          const t = i / 64, u = 1 - t;
          const d1 = [3 * u * u * (s.c1[0] - from[0]) + 6 * u * t * (s.c2[0] - s.c1[0]) + 3 * t * t * (s.to.p[0] - s.c2[0]), 3 * u * u * (s.c1[1] - from[1]) + 6 * u * t * (s.c2[1] - s.c1[1]) + 3 * t * t * (s.to.p[1] - s.c2[1])];
          const d2 = [6 * u * (s.c2[0] - 2 * s.c1[0] + from[0]) + 6 * t * (s.to.p[0] - 2 * s.c2[0] + s.c1[0]), 6 * u * (s.c2[1] - 2 * s.c1[1] + from[1]) + 6 * t * (s.to.p[1] - 2 * s.c2[1] + s.c1[1])];
          const k2 = Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) / Math.hypot(d1[0], d1[1]) ** 3;
          // the ink's edge sits the nib's half-width across the direction of travel from the centre line
          const phi = Math.atan2(-d1[1], d1[0]), theta = ((from === run.body!.start.p ? run.body!.start.angle : run.body!.segs[k - 1].to.angle) * (1 - t) + s.to.angle * t) * Math.PI / 180;
          expect(1 / k2, `join ${k} at t=${t}`).toBeGreaterThan((PEN / 2) * Math.abs(Math.sin(phi - theta)));
        }
      }
    }
  });

  it("keeps the nib's own width: no body stroke wider than one pen across its direction", () => {
    for (const id of ["alif.standalone.1", "meem.standalone.1", "ya.starting.1", "meem.middle.1", "nun.finishing.1"]) {
      const { body } = formPaths(lib, id, [0, 0]);
      const nodes = [body!.start, ...body!.segs.map((s) => s.to)];
      expect(nodes.every((n) => (n.width ?? 1) <= 1), id).toBe(true);
      expect(polygonArea(sweepPath(body!, PEN)), id).toBeLessThanOrEqual(pathLength(body!) * PEN * 1.02 + PEN * PEN);
    }
  });

  it("draws أم أيمن", () => {
    const layout = defaultLayout(lib, "أم أيمن");
    expect(layout).not.toHaveProperty("missing");
    expect(layoutGeometry(lib, layout as PenLayout).strokes.length).toBeGreaterThan(0);
  });
});
