import { describe, expect, it } from "vitest";
import { assembleRun } from "./penJoin";
import { fitPolygons } from "./penFit";
import { defaultLayout, layoutGeometry, type PenLayout } from "./penLayout";
import { formExit, formPaths, loadPenLibrary, NUQTA, PEN } from "./penLibrary";
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

/** Where each letter of a word's runs hands over to the next: along each join cubic (a quarter, half and three
 *  quarters of the way), or, where the letters continue one stroke with no join between them (a stacked tooth
 *  running down onto the meem, the meem running on into the nun), the node they share. Not a join cubic's ends:
 *  a join may run in under a letter's own body, where the letter's strokes cross with inside corners of their own. */
function joinNodes(phrase: string): { cmds: ReturnType<typeof fitPolygons>; nodes: Pt[] }[] {
  const layout = defaultLayout(lib, phrase) as PenLayout;
  return layout.runs.filter((r) => r.forms.length > 1).map((r) => {
    const run = assembleRun(lib, r.forms, r.joins, [0, 0]);
    const nodes = run.joinSegs.flatMap((k) => {
      const a = k === 0 ? run.body!.start.p : run.body!.segs[k - 1].to.p, s = run.body!.segs[k];
      return [0.25, 0.5, 0.75].map((t): Pt => {
        const u = 1 - t;
        return [u * u * u * a[0] + 3 * u * u * t * s.c1[0] + 3 * u * t * t * s.c2[0] + t * t * t * s.to.p[0], u * u * u * a[1] + 3 * u * u * t * s.c1[1] + 3 * u * t * t * s.c2[1] + t * t * t * s.to.p[1]];
      });
    });
    r.forms.slice(0, -1).forEach((id, i) => {
      if (r.joins[i].gap !== 0 || r.joins[i].rise !== 0) return;
      const e = formExit(lib, id)!.p;
      nodes.push([run.origins[i][0] + e[0], run.origins[i][1] + e[1]]);
    });
    return { cmds: fitPolygons(sweepPath(run.body!, PEN), 0.25), nodes };
  });
}

describe("the stroke library: أم أيمن", () => {
  it("draws the standalone alif 6.5 to 8.5 nuqta tall: the book's seven-dot alif, with its head and foot", () => {
    const f = formPaths(lib, "alif.standalone.1", [0, 0]);
    const ys = [...[f.body!].map((p) => sweepPath(p, PEN)), ...f.drawn.map((d) => [d])].flat(3).map((q) => q[1]);
    const h = (Math.max(...ys) - Math.min(...ys)) / NUQTA;
    expect(h).toBeGreaterThanOrEqual(6.5);
    expect(h).toBeLessThanOrEqual(8.5);
  });

  it("joins every letter of أيمن with no corner along the join", () => {
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

  it("keeps every stroke along the line thick: the nib turns with the stroke rather than running along its edge", () => {
    // Thuluth's horizontals are its heaviest strokes. Where the pen travels within 30° of the line, the nib's breadth
    // across the travel, width·W·|sin(φ−θ)|, stays at least half a pen; only a lifted nib (a taper, width < 0.5) may thin it,
    // the stroke passing back over its own ink (a meem's head written down and up again), where the thin pass never shows,
    // or a stroke's tapering end (the studio meem's tail thins all the way to a hair)
    const thinAt = (path: PenPath) => {
      const out: string[] = [];
      const centre: { k: number; q: Pt }[] = [];
      let prev = path.start;
      path.segs.forEach((s, k) => {
        for (let i = 0; i <= 16; i++) {
          const t = i / 16, u = 1 - t;
          centre.push({ k, q: [u * u * u * prev.p[0] + 3 * u * u * t * s.c1[0] + 3 * u * t * t * s.c2[0] + t * t * t * s.to.p[0], u * u * u * prev.p[1] + 3 * u * u * t * s.c1[1] + 3 * u * t * t * s.c2[1] + t * t * t * s.to.p[1]] });
        }
        prev = s.to;
      });
      const overOwnInk = (k: number, q: Pt) => centre.some((c) => Math.abs(c.k - k) >= 2 && Math.hypot(c.q[0] - q[0], c.q[1] - q[1]) < PEN / 2);
      const samples: { k: number; t: number; thick: number; flat: boolean; lifted: boolean; q: Pt }[] = [];
      let from = path.start;
      path.segs.forEach((s, k) => {
        for (let i = 1; i < 32; i++) {
          const t = i / 32, u = 1 - t;
          const w = (from.width ?? 1) + ((s.to.width ?? 1) - (from.width ?? 1)) * t;
          const d = [3 * u * u * (s.c1[0] - from.p[0]) + 6 * u * t * (s.c2[0] - s.c1[0]) + 3 * t * t * (s.to.p[0] - s.c2[0]), 3 * u * u * (s.c1[1] - from.p[1]) + 6 * u * t * (s.c2[1] - s.c1[1]) + 3 * t * t * (s.to.p[1] - s.c2[1])];
          const phi = Math.atan2(-d[1], d[0]), theta = ((from.angle + (s.to.angle - from.angle) * t) * Math.PI) / 180;
          const q: Pt = [u * u * u * from.p[0] + 3 * u * u * t * s.c1[0] + 3 * u * t * t * s.c2[0] + t * t * t * s.to.p[0], u * u * u * from.p[1] + 3 * u * u * t * s.c1[1] + 3 * u * t * t * s.c2[1] + t * t * t * s.to.p[1]];
          samples.push({ k, t, thick: w * Math.abs(Math.sin(phi - theta)), flat: Math.abs(Math.sin(phi)) <= Math.sin(Math.PI / 6), lifted: Math.min(from.width ?? 1, s.to.width ?? 1) < 0.5, q });
        }
        from = s.to;
      });
      // the final taper: from where the stroke last stops thinning, all the way to its end
      let taper = samples.length;
      while (taper > 0 && samples[taper - 1].thick <= (samples[taper - 2]?.thick ?? Infinity) + 0.02) taper--;
      samples.forEach((m, i) => {
        if (i >= taper || m.lifted || !m.flat) return;
        if (m.thick < 0.5 && !overOwnInk(m.k, m.q)) out.push(`seg ${m.k} t=${m.t.toFixed(2)}`);
      });
      return out;
    };
    for (const id of ["alif.standalone.1", "meem.standalone.1", "ya.starting.1", "meem.middle.1", "nun.finishing.1"]) {
      const { body, strokes } = formPaths(lib, id, [0, 0]);
      for (const p of [body!, ...strokes]) expect(thinAt(p), id).toEqual([]);
    }
    for (const r of (defaultLayout(lib, "أيمن") as PenLayout).runs.filter((r) => r.forms.length > 1)) {
      expect(thinAt(assembleRun(lib, r.forms, r.joins, [0, 0]).body!), "أيمن").toEqual([]);
    }
  });

  it("draws أم أيمن", () => {
    const layout = defaultLayout(lib, "أم أيمن");
    expect(layout).not.toHaveProperty("missing");
    expect(layoutGeometry(lib, layout as PenLayout).strokes.length).toBeGreaterThan(0);
  });
});
