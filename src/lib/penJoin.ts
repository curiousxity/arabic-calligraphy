/**
 * A connected word as one pen path. Each letter's body runs into the next
 * through a join: one cubic from the first letter's exit to the next one's
 * entry, leaving and arriving in the pen's direction of travel and matching
 * the curvature at both ends (G2) where the cubic can, so no join can show
 * where one letter ends. Its gap and rise are parameters of the join, and
 * place the next letter. The connecting stroke belongs to both letters: it
 * is not a patch. Pure. See .claude/rules/tarkib.md.
 */
import { formEntry, formExit, formPaths, NUQTA, type JoinDefault, type PenLibrary } from "./penLibrary";
import type { PenPath, Polygon, Pt } from "./penSweep";

const NEWTON_STEPS = 30;
const NEWTON_TOL = 1e-9;

const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
const unit = (v: Pt): Pt => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

/** The connecting cubic from exit point P0 (direction t0, curvature k0) to entry point P3
 *  (direction t1, curvature k1), matching both curvatures where a positive solution exists (G2),
 *  else chord/3 handles (G1). Curvature is signed as cross(B', B'') / |B'|^3. */
export function joinCubic(p0: Pt, t0: Pt, k0: number, p3: Pt, t1: Pt, k1: number): { c1: Pt; c2: Pt; g2: boolean } {
  const u0 = unit(t0), u1 = unit(t1);
  const d: Pt = [p3[0] - p0[0], p3[1] - p0[1]], chord = Math.hypot(d[0], d[1]);
  const handles = (a: number, b: number): { c1: Pt; c2: Pt } => ({ c1: [p0[0] + u0[0] * a, p0[1] + u0[1] * a], c2: [p3[0] - u1[0] * b, p3[1] - u1[1] * b] });
  // cross(t0, d) − b·cross(t0, t1) = 1.5·k0·a²;  cross(d, t1) − a·cross(t0, t1) = 1.5·k1·b²
  const X = cross(u0, u1), A = cross(u0, d), B = cross(d, u1);
  let a = chord / 3, b = chord / 3;
  for (let i = 0; i < NEWTON_STEPS; i++) {
    const f1 = A - b * X - 1.5 * k0 * a * a, f2 = B - a * X - 1.5 * k1 * b * b;
    if (Math.abs(f1) + Math.abs(f2) < NEWTON_TOL * Math.max(1, chord)) break;
    const j11 = -3 * k0 * a, j12 = -X, j21 = -X, j22 = -3 * k1 * b, det = j11 * j22 - j12 * j21;
    if (Math.abs(det) < 1e-15) { a = NaN; break; }
    a -= (f1 * j22 - f2 * j12) / det;
    b -= (j11 * f2 - j21 * f1) / det;
  }
  const solved = Number.isFinite(a) && Number.isFinite(b)
    && Math.abs(A - b * X - 1.5 * k0 * a * a) + Math.abs(B - a * X - 1.5 * k1 * b * b) < 1e-6 * Math.max(1, chord)
    && a >= 0.05 * chord && a <= chord && b >= 0.05 * chord && b <= chord;
  return solved ? { ...handles(a, b), g2: true } : { ...handles(chord / 3, chord / 3), g2: false };
}

/** Signed curvature where a path starts, from its first segment. */
function startCurvature(path: PenPath): number {
  const s = path.segs[0], p0 = path.start.p;
  const h: Pt = [s.c1[0] - p0[0], s.c1[1] - p0[1]], l = Math.hypot(h[0], h[1]);
  return l < 1e-9 ? 0 : (2 * cross(h, [s.c2[0] - s.c1[0], s.c2[1] - s.c1[1]])) / (3 * l ** 3);
}
/** Signed curvature where a path ends, from its last segment. */
function endCurvature(path: PenPath): number {
  const s = path.segs[path.segs.length - 1];
  const h: Pt = [s.to.p[0] - s.c2[0], s.to.p[1] - s.c2[1]], l = Math.hypot(h[0], h[1]);
  return l < 1e-9 ? 0 : (2 * cross([s.c2[0] - s.c1[0], s.c2[1] - s.c1[1]], h)) / (3 * l ** 3);
}

export type RunStrokes = {
  /** The run's pen path through every letter; null for a lone letter with no body. */
  body: PenPath | null;
  /** Index in `body.segs` of each join's cubic, in reading order. */
  joinSegs: number[];
  strokes: PenPath[];
  drawn: Polygon[];
  dots: PenPath[];
  /** Each form's placement, units. */
  origins: Pt[];
};

/** A connected run: forms in reading order, joins between them (length forms-1). The first form sits at `at`. */
export function assembleRun(lib: PenLibrary, formIds: string[], joins: JoinDefault[], at: Pt): RunStrokes {
  if (joins.length !== Math.max(0, formIds.length - 1)) throw new Error(`a run of ${formIds.length} letters needs ${formIds.length - 1} joins`);
  const out: RunStrokes = { body: null, joinSegs: [], strokes: [], drawn: [], dots: [], origins: [] };
  let origin: Pt = at;
  // the path the next letter's body joins: the run's body, or the stroke a lifted pen began
  let cur: PenPath | null = null;
  formIds.forEach((id, k) => {
    if (k > 0) {
      const exit = formExit(lib, formIds[k - 1]), entry = formEntry(lib, id);
      if (!exit) throw new Error(`${formIds[k - 1]} has no exit to join from`);
      if (!entry) throw new Error(`${id} has no entry to join`);
      const prev = out.origins[k - 1];
      const e: Pt = [prev[0] + exit.p[0], prev[1] + exit.p[1]];
      const n: Pt = [e[0] - joins[k - 1].gap * NUQTA, e[1] - joins[k - 1].rise * NUQTA];
      origin = [n[0] - entry.p[0], n[1] - entry.p[1]];
    }
    out.origins.push(origin);
    const f = formPaths(lib, id, origin);
    out.strokes.push(...f.strokes);
    out.drawn.push(...f.drawn);
    out.dots.push(...f.dots);
    if (!f.body) return;
    // a letter that leaves by a piece of its own hands the next join to that piece
    const leave = () => { if (f.exit) { out.strokes.push(f.exit); cur = f.exit; } };
    if (!out.body) { out.body = cur = f.body; leave(); return; }
    if (joins[k - 1].lift || !cur) { out.strokes.push(f.body); cur = f.body; leave(); return; }
    const body = cur, from = body.segs[body.segs.length - 1]?.to ?? body.start, to = f.body.start;
    if (Math.hypot(to.p[0] - from.p[0], to.p[1] - from.p[1]) > 1e-9) {
      const exit = formExit(lib, formIds[k - 1])!, entry = formEntry(lib, id)!;
      const { c1, c2 } = joinCubic(from.p, exit.dir, endCurvature(body), to.p, entry.dir, startCurvature(f.body));
      // joinSegs index the run's body; a join inside a stroke begun after a lifted pen is not listed
      if (body === out.body) out.joinSegs.push(body.segs.length);
      body.segs.push({ c1, c2, to });
    }
    body.segs.push(...f.body.segs);
    leave();
  });
  return out;
}
