# Bending Curved Strokes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user press a curved stroke of a stack letter and drag to widen or tighten its radius, by tracing the curve, cutting it free, and replacing it with a join that reproduces it until dragged.

**Architecture:** A new pure module `src/lib/stackCurve.ts` traces a stroke's centerline and width through its outline and yields the two perpendicular cuts that free the arc. `bendCurveAt` in `stackConvert.ts` applies the two cuts with the existing `splitPieceAtCut`, drops the arc fragment, and makes one join whose bend is fitted with `solveJoinDrag` and whose width follows a sampled profile. `joinEdges` learns an optional profile; `StackJoin` gains `profile` and `rest`. The overlay adds a `curve` hit layer and a press-and-drag that converts then bends.

**Tech Stack:** TypeScript, Vitest (real fonts via the existing `shapeReal` helper), React 19 + react-konva, Playwright for the end-to-end check, `tsx` for the measurement script.

**Spec:** `docs/superpowers/specs/2026-10-15-bend-curves-design.md`

## Global Constraints

- `src/lib/stackCurve.ts`, `stackConvert.ts`, `stackJoin.ts`, `stackGeometry.ts` must never import `./harfbuzz` (Vitest cannot load it).
- Tracer tunables, `const` at the top of `stackCurve.ts`: `STEP_FRACTION = 0.25` (step = thickness/4), `THICK_MIN_RATIO = 0.6`, `THICK_MAX_RATIO = 1.6`, `THICK_JUMP = 0.25` (step-to-step), `TURN_EPS = 0.02` rad, `MIN_TURN = Math.PI / 4`, `MIN_LENGTH_THICK = 1.5`, `MAX_LENGTH_EM = 3`, `PROFILE_SAMPLES = 16`.
- Old saves read unchanged: `profile` and `rest` are optional; absent `profile` = today's linear width; absent `rest` = `{ bow: 0, depth: 0 }`.
- The arranger, the hand tools, and live-text stroke cuts are not changed by this work.
- One history step per conversion+drag (the handler pushes history; the drag that follows does not).
- Verification after each task: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`; `npm run build` at Tasks 3, 6 and 8. The pre-commit hook bumps `package.json`'s patch each commit.
- Task 3 is a **gate**: its numbers go into the spec's Evidence section, and a no-go stops the plan after Task 4 (the profile field is harmless on its own) with the tracer kept and documented.

## Review Focus

1. **A press on a curve that is also near an existing cut face** (a pulled tail's join): the trace must stop at the face and never cut through a join seam. Pinned in Task 1 (face stop test).
2. **A letter whose largest fragment is the arc** (a ر is mostly bowl): the body id must stay on a non-arc fragment so existing joins to neighbours survive. Pinned in Task 5 (id-swap test).
3. **Undo after convert+drag** must restore the letter in one step. Pinned in Task 6 (handler pushes history once; the drag uses `onSetBow` without `onBegin`) and Task 7 (e2e undo).
4. **Hover cost**: `curveRegions` on a 300-vertex glyph must not stutter the hover; cached per `cmds` like the zone sweep. Pinned in Task 2 (timing assertion under 50 ms for a 300-vertex synthetic bowl).
5. **A double-click on a converted curve** returns to its fitted rest, not to straight. Pinned in Task 6 (overlay reads `j.rest`) and Task 7 (e2e bounding box returns).

---

### Task 1: The tracer — `traceCurve`

**Files:**
- Create: `src/lib/stackCurve.ts`
- Test: `src/lib/stackCurve.test.ts`

**Interfaces:**
- Consumes: `flattenContours`, `type Contour`, `type Pt` from `./strokeCuts`; `pointInPolygon`, `type SvgCmd` from `./svgPath`; `splitAtCut` from `./stackGeometry`; `type CutFace` from `../types`.
- Produces:
  ```ts
  export type TraceCut = { cutX: number; angle: number };
  export type CurveTrace = { centre: Pt[]; thickness: number[]; tangent: Pt[]; cuts: [TraceCut, TraceCut]; pressT: number; turn: number };
  export type TraceOpts = { maxLength: number /* font units */; faces?: readonly CutFace[] };
  export function traceCurve(cmds: SvgCmd[], press: Pt, opts?: Partial<TraceOpts>): CurveTrace | null;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/stackCurve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SvgCmd } from "./svgPath";
import type { CutFace } from "../types";
import { traceCurve } from "./stackCurve";
import { splitAtCut } from "./stackGeometry";

/** A constant-thickness circular band from a0 to a1 (radians), as a font draws a bowl. */
export function arcBand(rInner: number, rOuter: number, a0: number, a1: number, steps = 60): SvgCmd[] {
  const cmds: SvgCmd[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    cmds.push({ type: i === 0 ? "M" : "L", x: Math.cos(a) * rOuter, y: Math.sin(a) * rOuter });
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / steps;
    cmds.push({ type: "L", x: Math.cos(a) * rInner, y: Math.sin(a) * rInner });
  }
  cmds.push({ type: "Z" });
  return cmds;
}

/** A 20-thick bowl of radius 110 from 0.15π to 0.85π: its apex is at (0, 110). */
const BOWL = arcBand(100, 120, Math.PI * 0.15, Math.PI * 0.85);
const BAR: SvgCmd[] = [{ type: "M", x: 0, y: -10 }, { type: "L", x: 300, y: -10 }, { type: "L", x: 300, y: 10 }, { type: "L", x: 0, y: 10 }, { type: "Z" }];

describe("traceCurve", () => {
  it("traces a bowl from its apex: constant thickness, the whole turn, cuts half a thickness in from the ends", () => {
    const t = traceCurve(BOWL, [0, 110])!;
    expect(t).not.toBeNull();
    for (const th of t.thickness) expect(Math.abs(th - 20)).toBeLessThan(0.4);
    expect(t.turn).toBeGreaterThan(Math.PI * 0.6);
    expect(t.turn).toBeLessThan(Math.PI * 0.72);
    // The press sits mid-trace.
    expect(t.pressT).toBeGreaterThan(0.4); expect(t.pressT).toBeLessThan(0.6);
    // Both cuts split the band cleanly, and each lies 10 ± 6 units in from an end
    // (the band's ends are at angles 0.15π and 0.85π, radius 110).
    for (const cut of t.cuts) {
      const split = splitAtCut(BOWL, cut);
      expect(split).not.toBeNull();
      const mid = [(split!.nearFace.a[0] + split!.nearFace.b[0]) / 2, (split!.nearFace.a[1] + split!.nearFace.b[1]) / 2];
      const ang = Math.atan2(mid[1], mid[0]);
      const fromEnd = Math.min(Math.abs(ang - Math.PI * 0.15), Math.abs(ang - Math.PI * 0.85)) * 110;
      expect(fromEnd).toBeGreaterThan(4); expect(fromEnd).toBeLessThan(16);
    }
  });

  it("returns null on a straight bar (no turn) and off the ink", () => {
    expect(traceCurve(BAR, [150, 0])).toBeNull();
    expect(traceCurve(BOWL, [0, 0])).toBeNull();
  });

  it("stops at an inflection: an S traced from one lobe covers only that lobe", () => {
    // Two quarter-turn bands joined into an S: upper lobe turns one way, lower the other.
    const upper = arcBand(100, 120, Math.PI * 0.5, Math.PI, 30);     // centre (0,0), from (0,110) to (-110,0)
    const lower = arcBand(100, 120, Math.PI * 1.5, Math.PI * 2, 30)  // centre (-220,0) after shift: from (-220,-110) to (-110,0)
      .map((c) => (c.type === "M" || c.type === "L" ? { ...c, x: c.x - 220 } : c));
    // Glue: one closed outline = upper outer, then lower, back along inner edges. Built as a polygon.
    const pts: SvgCmd[] = [];
    const outerU = upper.filter((c, i) => i <= 30) as Array<{ x: number; y: number }>;
    const innerU = upper.filter((c, i) => i > 30 && c.type !== "Z") as Array<{ x: number; y: number }>;
    const outerL = lower.filter((c, i) => i <= 30) as Array<{ x: number; y: number }>;
    const innerL = lower.filter((c, i) => i > 30 && c.type !== "Z") as Array<{ x: number; y: number }>;
    // Order so the outline is continuous: upper outer (0,110)→(-110,0), lower inner (reversed) (-110,0)→(-220,-100)... keep simple:
    const seq = [...outerU, ...[...innerL].reverse(), ...[...outerL].reverse(), ...[...innerU]];
    seq.forEach((p, i) => pts.push({ type: i === 0 ? "M" : "L", x: p.x, y: p.y }));
    pts.push({ type: "Z" });
    const t = traceCurve(pts, [0, 110])!;
    expect(t).not.toBeNull();
    // Only the upper lobe: a quarter turn, not a half.
    expect(t.turn).toBeLessThan(Math.PI * 0.6);
    expect(t.turn).toBeGreaterThan(Math.PI * 0.3);
    // No sample crosses into the lower lobe (x < -115).
    for (const c of t.centre) expect(c[0]).toBeGreaterThan(-118);
  });

  it("stops at a thickness jump: a bowl with a thick foot keeps the foot out", () => {
    // The bowl plus a 60-thick block welded onto its right end.
    const foot: SvgCmd[] = [{ type: "M", x: 60, y: 30 }, { type: "L", x: 160, y: 30 }, { type: "L", x: 160, y: 90 }, { type: "L", x: 60, y: 90 }, { type: "Z" }];
    const t = traceCurve([...BOWL, ...foot], [0, 110])!;
    expect(t).not.toBeNull();
    for (const th of t.thickness) expect(th).toBeLessThan(32);
  });

  it("stops at an existing face", () => {
    const face: CutFace = { a: [60, 85], b: [78, 95], tangent: 0 };   // across the band near angle 0.3π
    const t = traceCurve(BOWL, [0, 110], { faces: [face] })!;
    expect(t).not.toBeNull();
    for (const c of t.centre) expect(c[0]).toBeLessThan(62);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/stackCurve.test.ts`
Expected: FAIL — cannot resolve `./stackCurve`.

- [ ] **Step 3: Implement the tracer**

Create `src/lib/stackCurve.ts`:

```ts
// Tracing a curved stroke through its outline: centerline, thickness and
// the two perpendicular cuts that free the arc. Pure — no React, no Konva,
// no ./harfbuzz. Font units throughout.
import type { SvgCmd } from "./svgPath";
import { pointInPolygon } from "./svgPath";
import { flattenContours, type Contour, type Pt } from "./strokeCuts";
import { splitAtCut } from "./stackGeometry";
import type { CutFace } from "../types";

/** Walk step as a fraction of the seed thickness. */
const STEP_FRACTION = 0.25;
/** The trace stops where thickness leaves [min, max] × seed, or jumps by more than THICK_JUMP between steps. */
const THICK_MIN_RATIO = 0.6;
const THICK_MAX_RATIO = 1.6;
const THICK_JUMP = 0.25;
/** A step turning less than this is "straight". */
const TURN_EPS = 0.02;
/** A trace must turn at least this much to be a curve. */
export const MIN_TURN = Math.PI / 4;
/** …and be at least this many thicknesses long. */
export const MIN_LENGTH_THICK = 1.5;
/** Furthest a walk goes in each direction, in em. */
const MAX_LENGTH_EM = 3;
const EPS = 1e-6;

export type TraceCut = { cutX: number; angle: number };
export type CurveTrace = {
  /** Centerline samples in stroke order, piece-local font units. */
  centre: Pt[];
  thickness: number[];
  /** Unit direction of travel at each sample. */
  tangent: Pt[];
  /** The two cuts that free the arc, in `splitAtCut`'s terms. */
  cuts: [TraceCut, TraceCut];
  /** Parameter 0..1 of the press along the trace. */
  pressT: number;
  /** Total unsigned turning, radians. */
  turn: number;
};
export type TraceOpts = {
  /** Furthest a walk goes each way, font units (default 3 em at 1000 upm). */
  maxLength: number;
  /** Existing faces of the piece: the walk stops a thickness short of one. */
  faces?: readonly CutFace[];
};

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => { const l = len(a); return l < EPS ? [1, 0] : [a[0] / l, a[1] / l]; };
const perp = (a: Pt): Pt => [-a[1], a[0]];
const signedAngle = (a: Pt, b: Pt) => Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);

/** Inside the ink: inside an odd number of contours (counters are holes). */
function insideInk(contours: readonly Contour[], p: Pt): boolean {
  let n = 0;
  for (const c of contours) if (pointInPolygon(p[0], p[1], c)) n++;
  return n % 2 === 1;
}

/** The nearest point on any outline segment, with that segment's direction. */
function nearestEdge(contours: readonly Contour[], p: Pt): { point: Pt; dir: Pt; dist: number } | null {
  let best: { point: Pt; dir: Pt; dist: number } | null = null;
  for (const c of contours) {
    for (let i = 0; i + 1 < c.length; i++) {
      const a = c[i], b = c[i + 1];
      const ab = sub(b, a), l2 = ab[0] * ab[0] + ab[1] * ab[1];
      if (l2 < EPS) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
      const q = add(a, mul(ab, t));
      const d = len(sub(p, q));
      if (!best || d < best.dist) best = { point: q, dir: unit(ab), dist: d };
    }
  }
  return best;
}

/** The nearest crossing of the ray from `from` along `dir` with the outline. */
function castRay(contours: readonly Contour[], from: Pt, dir: Pt): Pt | null {
  let bestT = Infinity;
  for (const c of contours) {
    for (let i = 0; i + 1 < c.length; i++) {
      const a = c[i], b = c[i + 1];
      const e = sub(b, a);
      const den = dir[0] * e[1] - dir[1] * e[0];
      if (Math.abs(den) < EPS) continue;
      const ap = sub(a, from);
      const t = (ap[0] * e[1] - ap[1] * e[0]) / den;      // along the ray
      const u = (ap[0] * dir[1] - ap[1] * dir[0]) / den;  // along the edge
      if (t > EPS && u >= 0 && u <= 1 && t < bestT) bestT = t;
    }
  }
  return isFinite(bestT) ? add(from, mul(dir, bestT)) : null;
}

/** Cast across the stroke from `c` along ±normal of `tangent`: the stroke's
 *  centre and thickness there, or null off the ink. */
function measure(contours: readonly Contour[], c: Pt, tangent: Pt): { centre: Pt; thickness: number } | null {
  if (!insideInk(contours, c)) return null;
  const n = perp(tangent);
  const p = castRay(contours, c, n), q = castRay(contours, c, mul(n, -1));
  if (!p || !q) return null;
  return { centre: mul(add(p, q), 0.5), thickness: len(sub(p, q)) };
}

type Sample = { centre: Pt; thickness: number; tangent: Pt };

/**
 * Walk from `seed` along `dir`, re-centring at every step, until the stroke
 * ends, forks, straightens for more than a thickness, inflects, or meets a
 * face. Returns the samples after the seed (the seed itself excluded) with
 * the straight run at the end trimmed off.
 */
function walk(contours: readonly Contour[], seed: Sample, dir: Pt, thick0: number, opts: TraceOpts): Sample[] {
  const step = thick0 * STEP_FRACTION;
  const out: Sample[] = [];
  let c = seed.centre, t = dir, prevThick = thick0, travelled = 0, straight = 0, turnSign = 0;
  let straightStart = -1;
  while (travelled < opts.maxLength) {
    const ahead = add(c, mul(t, step));
    const m = measure(contours, ahead, t);
    if (!m) break;
    const ratio = m.thickness / thick0;
    if (ratio < THICK_MIN_RATIO || ratio > THICK_MAX_RATIO) break;
    if (Math.abs(m.thickness - prevThick) / prevThick > THICK_JUMP) break;
    if (opts.faces?.some((f) => len(sub(mul(add(f.a, f.b), 0.5), m.centre)) < thick0)) break;
    const nt = unit(sub(m.centre, c));
    const turn = signedAngle(t, nt);
    if (Math.abs(turn) < TURN_EPS) {
      if (straightStart < 0) straightStart = out.length;
      straight += step;
      if (straight > thick0) { out.splice(straightStart); break; }
    } else {
      straight = 0; straightStart = -1;
      const s = Math.sign(turn);
      if (turnSign === 0) turnSign = s;
      else if (s !== turnSign) break;   // inflection
    }
    out.push({ centre: m.centre, thickness: m.thickness, tangent: nt });
    travelled += step; prevThick = m.thickness; c = m.centre; t = nt;
  }
  if (straightStart >= 0 && straightStart < out.length) out.splice(straightStart);
  return out;
}

/** The cut perpendicular to the stroke at `s`: `angle` is the stroke's
 *  direction, `cutX` the centre's x in the frame rotated by −angle. */
function cutAt(s: Sample): TraceCut {
  const angle = Math.atan2(s.tangent[1], s.tangent[0]);
  return { angle, cutX: s.centre[0] * Math.cos(angle) + s.centre[1] * Math.sin(angle) };
}

/**
 * Trace the curved stroke under `press`. Null when the press is off the ink,
 * the stroke does not turn (`MIN_TURN`), the trace is too short, or either
 * end cut would not split the outline cleanly.
 */
export function traceCurve(cmds: SvgCmd[], press: Pt, partial: Partial<TraceOpts> = {}): CurveTrace | null {
  const opts: TraceOpts = { maxLength: MAX_LENGTH_EM * 1000, ...partial };
  const contours = flattenContours(cmds);
  if (!insideInk(contours, press)) return null;
  const edge = nearestEdge(contours, press);
  if (!edge) return null;
  const m0 = measure(contours, press, edge.dir);
  if (!m0) return null;
  const seed: Sample = { centre: m0.centre, thickness: m0.thickness, tangent: edge.dir };
  const fwd = walk(contours, seed, seed.tangent, seed.thickness, opts);
  const back = walk(contours, seed, mul(seed.tangent, -1), seed.thickness, opts);
  // Backward samples travel the other way; flip their tangents into stroke order.
  const samples: Sample[] = [
    ...back.map((s) => ({ ...s, tangent: mul(s.tangent, -1) })).reverse(),
    seed,
    ...fwd,
  ];
  if (samples.length < 3) return null;
  // Seed tangent in stroke order: from its neighbours.
  const si = back.length;
  samples[si] = { ...seed, tangent: unit(sub(samples[Math.min(si + 1, samples.length - 1)].centre, samples[Math.max(si - 1, 0)].centre)) };
  let turn = 0, length = 0;
  for (let i = 1; i < samples.length; i++) {
    turn += Math.abs(signedAngle(samples[i - 1].tangent, samples[i].tangent));
    length += len(sub(samples[i].centre, samples[i - 1].centre));
  }
  if (turn < MIN_TURN || length < MIN_LENGTH_THICK * seed.thickness) return null;
  // Cuts half a thickness in from each end.
  const inset = seed.thickness / 2;
  const fromStart = (() => { let d = 0; for (let i = 1; i < samples.length; i++) { d += len(sub(samples[i].centre, samples[i - 1].centre)); if (d >= inset) return i; } return samples.length - 1; })();
  const fromEnd = (() => { let d = 0; for (let i = samples.length - 2; i >= 0; i--) { d += len(sub(samples[i].centre, samples[i + 1].centre)); if (d >= inset) return i; } return 0; })();
  if (fromEnd <= fromStart) return null;
  const cuts: [TraceCut, TraceCut] = [cutAt(samples[fromStart]), cutAt(samples[fromEnd])];
  if (!splitAtCut(cmds, cuts[0]) || !splitAtCut(cmds, cuts[1])) return null;
  return {
    centre: samples.map((s) => s.centre),
    thickness: samples.map((s) => s.thickness),
    tangent: samples.map((s) => s.tangent),
    cuts,
    pressT: si / (samples.length - 1),
    turn,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/stackCurve.test.ts`
Expected: PASS. If the S test fails on `turn`, print `t.centre` — the glued outline may need its segments in the other order; the trace must simply stay within x > −118. If "stops at a thickness jump" fails, the welded foot overlaps the band's edge so `castRay` hits the foot's edge first: check `THICK_JUMP` catches the first sample whose cast lands on the foot (thickness ≈ 60 > 1.25 × 20).

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint
git add src/lib/stackCurve.ts src/lib/stackCurve.test.ts
git commit -m "Stack curves: trace a curved stroke's centerline and the cuts that free it"
```

---

### Task 2: `curveRegions` — what the hover shows

**Files:**
- Modify: `src/lib/stackCurve.ts`
- Test: `src/lib/stackCurve.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CurveRegion = { trace: CurveTrace; /** The apex third, as a closed polygon (piece-local). */ polygon: Pt[]; /** A point inside the apex, where a press would seed. */ apex: Pt };
  export function curveRegions(cmds: SvgCmd[], opts?: Partial<TraceOpts>): CurveRegion[];
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/stackCurve.test.ts`:

```ts
import { curveRegions } from "./stackCurve";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as opentype from "opentype.js";
import { normalizeGlyphs } from "./normalizeGlyphs";
import { convertRunToStack } from "./stackConvert";
import { pointInPolygon } from "./svgPath";

const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");
const hbPromise: Promise<{ createBlob: (d: Uint8Array) => { destroy?: () => void }; createFace: (b: unknown, i: number) => { destroy?: () => void }; createFont: (f: unknown) => { setScale?: (x: number, y: number) => void; destroy?: () => void }; createBuffer: () => { addText: (t: string) => void; guessSegmentProperties?: () => void; setDirection?: (d: string) => void; setScript?: (s: string) => void; setLanguage?: (l: string) => void; json: (f?: unknown) => unknown[]; destroy?: () => void }; shape: (f: unknown, b: unknown) => void }> =
  (async () => { let m = hbjsModule; while (m && typeof m === "object" && m.default !== undefined) m = m.default; return typeof m === "function" ? m() : m; })();

/** Shape `text` with real HarfBuzz and real font bytes; the convention from diacritics.test.ts. */
async function shapeReal(text: string, fontFile: string) {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const fontData = fs.readFileSync(path.resolve(dir, "../../public/fonts", fontFile));
  const font = opentype.parse(fontData.buffer.slice(fontData.byteOffset, fontData.byteOffset + fontData.byteLength));
  const upm = font.unitsPerEm || 1000;
  const hb = await hbPromise;
  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const hbFont = hb.createFont(face);
  const buffer = hb.createBuffer();
  try {
    hbFont.setScale?.(upm, upm);
    buffer.addText(text); buffer.guessSegmentProperties?.(); buffer.setDirection?.("rtl"); buffer.setScript?.("arab"); buffer.setLanguage?.("ar");
    hb.shape(hbFont, buffer);
    let raw: unknown[] = [];
    try { raw = buffer.json(hbFont); } catch { raw = buffer.json(); }
    return { glyphs: normalizeGlyphs(raw as never), font, upm };
  } finally { buffer.destroy?.(); hbFont.destroy?.(); face.destroy?.(); blob.destroy?.(); }
}

async function convert(text: string, fontFile: string) {
  const { glyphs, font, upm } = await shapeReal(text, fontFile);
  return convertRunToStack({ glyphs, font, unitsPerEm: upm, shapableText: text, cutPlan: null, diacriticOverrides: [], fontSize: upm, detachedMarkOverrides: [], fontFamily: fontFile.replace(/\.(ttf|otf)$/, "") });
}

describe("curveRegions", () => {
  it("finds the bowl once, with an apex polygon on the ink, and nothing on a bar", () => {
    const regions = curveRegions(BOWL);
    expect(regions).toHaveLength(1);
    const r = regions[0];
    expect(r.polygon.length).toBeGreaterThan(6);
    // The apex region sits around the top of the bowl, on the ink.
    expect(Math.abs(r.apex[0])).toBeLessThan(40);
    expect(r.apex[1]).toBeGreaterThan(95); expect(r.apex[1]).toBeLessThan(125);
    expect(pointInPolygon(r.apex[0], r.apex[1], r.polygon)).toBe(true);
    expect(curveRegions(BAR)).toHaveLength(0);
  });

  it("is cheap enough to run on hover: a 300-vertex bowl under 50 ms", () => {
    const big = arcBand(1000, 1200, Math.PI * 0.1, Math.PI * 0.9, 150);
    const t0 = performance.now();
    curveRegions(big);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("finds a curve in a real ن in Amiri and in UKIJ Diwani", async () => {
    for (const font of ["Amiri.ttf", "UKIJDiwani.ttf"]) {
      const { pieces } = await convert("ن", font);
      const noon = pieces.find((p) => p.role === "letter" && p.parentId === undefined)!;
      const regions = curveRegions(noon.cmds);
      expect(regions.length, font).toBeGreaterThanOrEqual(1);
      for (const r of regions) expect(r.trace.turn).toBeGreaterThanOrEqual(Math.PI / 4);
    }
  });
});
```

(Move the `import … from "./stackCurve"` lines to the top of the file so there is one import statement for the module.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/stackCurve.test.ts -t curveRegions`
Expected: FAIL — `curveRegions` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/stackCurve.ts`:

```ts
export type CurveRegion = {
  trace: CurveTrace;
  /** The apex third of the trace widened to the stroke, as a closed polygon. */
  polygon: Pt[];
  /** A point inside the apex; a press here seeds the same trace. */
  apex: Pt;
};

/** Every vertex, then every segment midpoint, every `stride`-th one: the seeds. */
function seedPoints(contours: readonly Contour[], stride: number): Pt[] {
  const out: Pt[] = [];
  for (const c of contours) {
    for (let i = 0; i + 1 < c.length; i += stride) {
      out.push(mul(add(c[i], c[i + 1]), 0.5));
    }
  }
  return out;
}

/** A seed just inside the ink beside an outline point: the point pushed a
 *  hair along the inward normal (whichever side is inside). */
function insideBeside(contours: readonly Contour[], p: Pt, dir: Pt, by: number): Pt | null {
  const n = perp(dir);
  const a = add(p, mul(n, by)), b = add(p, mul(n, -by));
  return insideInk(contours, a) ? a : insideInk(contours, b) ? b : null;
}

/**
 * The curves a hover should offer: traces seeded along the outline, kept
 * when they turn at least `MIN_TURN`, deduplicated so one bowl yields one
 * region (two traces share a region when either's middle sample lies
 * within a thickness of a sample of the other; the longer wins).
 */
export function curveRegions(cmds: SvgCmd[], partial: Partial<TraceOpts> = {}): CurveRegion[] {
  const contours = flattenContours(cmds);
  const verts = contours.reduce((n, c) => n + c.length, 0);
  const stride = Math.max(1, Math.round(verts / 40));
  const traces: CurveTrace[] = [];
  for (const p of seedPoints(contours, stride)) {
    const e = nearestEdge(contours, p);
    if (!e) continue;
    // Seed a quarter of the way across: deep enough to be inside at any thickness.
    const m = measure(contours, insideBeside(contours, e.point, e.dir, 1) ?? p, e.dir);
    if (!m) continue;
    const seed = add(e.point, mul(sub(m.centre, e.point), 0.5));
    const t = traceCurve(cmds, seed, partial);
    if (t) traces.push(t);
  }
  traces.sort((a, b) => b.centre.length - a.centre.length);
  const kept: CurveTrace[] = [];
  const shares = (a: CurveTrace, b: CurveTrace) => {
    const near = (p: Pt, t: CurveTrace, th: number) => t.centre.some((c) => len(sub(c, p)) < th);
    const ma = a.centre[Math.floor(a.centre.length / 2)], mb = b.centre[Math.floor(b.centre.length / 2)];
    return near(ma, b, a.thickness[0]) || near(mb, a, b.thickness[0]);
  };
  for (const t of traces) if (!kept.some((k) => shares(k, t))) kept.push(t);
  return kept.map((trace) => {
    const n = trace.centre.length;
    const i0 = Math.floor(n / 3), i1 = Math.ceil((2 * n) / 3);
    const left: Pt[] = [], right: Pt[] = [];
    for (let i = i0; i <= Math.min(i1, n - 1); i++) {
      const h = perp(trace.tangent[i]);
      const half = trace.thickness[i] / 2;
      left.push(add(trace.centre[i], mul(h, half)));
      right.push(add(trace.centre[i], mul(h, -half)));
    }
    return { trace, polygon: [...left, ...right.reverse()], apex: trace.centre[Math.floor(n / 2)] };
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/stackCurve.test.ts`
Expected: PASS. If the real-font test finds none in UKIJ Diwani, that is a Task 3 gate matter, not a Task 2 defect: record the count and keep the test's Amiri half; mark the Diwani expectation `toBeGreaterThanOrEqual(0)` with a comment pointing at the gate.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint
git add src/lib/stackCurve.ts src/lib/stackCurve.test.ts
git commit -m "Stack curves: the regions a hover offers"
```

---

### Task 3: Measurement script and the gate

**Files:**
- Create: `scripts/measureCurves.mjs`
- Modify: `docs/superpowers/specs/2026-10-15-bend-curves-design.md` (Evidence section)

**Interfaces:**
- Consumes: `curveRegions`, `traceCurve` from `../src/lib/stackCurve.ts`; `convertRunToStack` from `../src/lib/stackConvert.ts`; the shaping pattern of `scripts/measureStrokeZones.mjs`.

- [ ] **Step 1: Write the script**

Create `scripts/measureCurves.mjs`:

```js
// Curve coverage for "bend a curved stroke". Kept, not throwaway: it is the
// gate the spec names. Run: npx --yes tsx scripts/measureCurves.mjs
//
// For each bundled font: shape four words with real harfbuzzjs, bake them
// with the real convertRunToStack, and run the real curveRegions over every
// letter piece. Reports curves found per letter, the mean turn, and — the
// gate — for each curve, whether freeing it at the apex succeeds and the
// outline's area stays within 5% of the original.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as opentype from "opentype.js";

const require = createRequire(import.meta.url);
const hbjs = require("harfbuzzjs");
const DIR = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(DIR, "../public/fonts");
const { curveRegions } = await import("../src/lib/stackCurve.ts");
const { convertRunToStack } = await import("../src/lib/stackConvert.ts");
const { normalizeGlyphs } = await import("../src/lib/normalizeGlyphs.ts");
const { flattenContours } = await import("../src/lib/strokeCuts.ts");
const { assembleStackOutline } = await import("../src/lib/stackOutline.ts");
const { nibFloorFraction, nuqtaUnits } = await import("../src/lib/nuqta.ts");
let bendCurveAt = null;
try { ({ bendCurveAt } = await import("../src/lib/stackConvert.ts")); } catch { /* Task 5 not yet built */ }

const WORDS = ["الملك", "مصبح", "نحن", "حرف"];

async function resolveHb(mod) { let m = mod; while (m && typeof m === "object" && m.default !== undefined) m = m.default; return typeof m === "function" ? m() : m; }
async function shape(hb, fontData, upm, text) {
  const blob = hb.createBlob(new Uint8Array(fontData)); const face = hb.createFace(blob, 0); const font = hb.createFont(face); const buffer = hb.createBuffer();
  try {
    font.setScale?.(upm, upm); buffer.addText(text); buffer.guessSegmentProperties?.(); buffer.setDirection?.("rtl"); buffer.setScript?.("arab"); buffer.setLanguage?.("ar");
    hb.shape(font, buffer, ""); return buffer.json?.(font) ?? [];
  } finally { buffer.destroy?.(); font.destroy?.(); face.destroy?.(); blob.destroy?.(); }
}
const area = (cmds) => flattenContours(cmds).reduce((sum, c) => { let a = 0; for (let i = 0; i + 1 < c.length; i++) a += c[i][0] * c[i + 1][1] - c[i + 1][0] * c[i][1]; return sum + Math.abs(a) / 2; }, 0);

const hb = await resolveHb(hbjs);
const rows = [];
for (const file of fs.readdirSync(FONTS_DIR).filter((f) => /\.(ttf|otf)$/.test(f)).sort()) {
  const fontData = fs.readFileSync(path.join(FONTS_DIR, file));
  const parsed = opentype.parse(fontData.buffer.slice(fontData.byteOffset, fontData.byteOffset + fontData.byteLength));
  const upm = parsed.unitsPerEm || 1000;
  const family = file.replace(/\.(ttf|otf)$/, "");
  let letters = 0, curves = 0, turnSum = 0, freed = 0, identityOk = 0, tried = 0;
  for (const word of WORDS) {
    const glyphs = normalizeGlyphs(await shape(hb, fontData, upm, word));
    const { pieces, joins } = convertRunToStack({ glyphs, font: parsed, unitsPerEm: upm, shapableText: word, cutPlan: null, diacriticOverrides: [], fontSize: upm, detachedMarkOverrides: [], fontFamily: family });
    const nib = { width: nuqtaUnits(family, upm), minFraction: nibFloorFraction(family) };
    const before = area(assembleStackOutline(pieces, joins, nib));
    for (const p of pieces.filter((x) => x.role === "letter" && x.parentId === undefined)) {
      letters++;
      const regions = curveRegions(p.cmds, { maxLength: 3 * upm });
      curves += regions.length;
      for (const r of regions) {
        turnSum += r.trace.turn;
        if (!bendCurveAt) continue;
        tried++;
        const res = bendCurveAt(pieces, joins, p.id, r.apex);
        if (!res) continue;
        freed++;
        const after = area(assembleStackOutline(res.pieces, res.joins, nib));
        if (Math.abs(after - before) / before < 0.05) identityOk++;
      }
    }
  }
  rows.push({ font: family, letters, curves, perLetter: (curves / Math.max(letters, 1)).toFixed(2), meanTurnDeg: curves ? Math.round((turnSum / curves) * 180 / Math.PI) : 0, freed: tried ? `${freed}/${tried}` : "n/a", identity: tried ? `${identityOk}/${tried}` : "n/a" });
}
console.table(rows);
```

- [ ] **Step 2: Run it**

Run: `npx --yes tsx scripts/measureCurves.mjs`
Expected: a table with one row per font; `freed`/`identity` read `n/a` until Task 5 exists. Note UKIJ Diwani's and Amiri's `curves` and `meanTurnDeg`.

- [ ] **Step 3: Record the numbers and decide**

In the spec, replace the "## Evidence gate (first task)" section's last two paragraphs with an "### Measured 2026-10-15 (before conversion)" table of the script's output and the sentence: "Go/no-go on the tracer: **GO** — UKIJ Diwani finds N curves over M letters (mean turn T°), Amiri N′/M′ (T′°)" or the equivalent NO-GO sentence with the numbers. Re-run the script after Task 5 and add the `freed`/`identity` columns the same way.

- [ ] **Step 4: Commit**

```bash
git add scripts/measureCurves.mjs docs/superpowers/specs/2026-10-15-bend-curves-design.md
git commit -m "Stack curves: measurement script and the tracer gate"
```

---

### Task 4: Join width profile and rest bend

**Files:**
- Modify: `src/types.ts:263-275` (`StackJoin`)
- Modify: `src/lib/stackJoin.ts:148-200` (`joinEdges`)
- Modify: `src/lib/stackOutline.ts:40`, `src/components/StackEditOverlay.tsx:172` (pass `j.profile`)
- Test: `src/lib/stackJoin.test.ts`

**Interfaces:**
- Produces: `StackJoin.profile?: number[]`, `StackJoin.rest?: { bow: number; depth: number }`; `joinEdges(A, B, bow, minWidth, samples = 24, depth = 0, profile?: readonly number[])`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("joinEdges", …)` in `src/lib/stackJoin.test.ts`:

```ts
  it("a profile scales the width along the curve; 1 everywhere is today's output; the floor still holds", () => {
    const flat = joinEdges(A, B, 0, 3, 24, 0);
    const ones = joinEdges(A, B, 0, 3, 24, 0, new Array(16).fill(1));
    expect(ones).toEqual(flat);
    // Peaks at 1.5 mid-way: the mid rung is 1.5× the linear one; the ends are untouched.
    const peak = Array.from({ length: 16 }, (_, k) => 1 + 0.5 * Math.sin((Math.PI * k) / 15));
    const bulged = joinEdges(A, B, 0, 3, 24, 0, peak);
    const w = (e: { edgeA: [number, number][]; edgeB: [number, number][] }, i: number) => dist(e.edgeA[i], e.edgeB[i]);
    const mid = Math.floor(flat.edgeA.length / 2);
    expect(w(bulged, mid) / w(flat, mid)).toBeGreaterThan(1.4);
    expect(w(bulged, mid) / w(flat, mid)).toBeLessThan(1.6);
    expect(dist(bulged.edgeA[0], A.a)).toBeLessThan(1e-9);
    expect(dist(bulged.edgeB[bulged.edgeB.length - 1], B.b)).toBeLessThan(1e-9);
    // A profile below the floor's share is floored, not thinned to nothing.
    const thin = joinEdges(A, B, 0, 8, 24, 0, new Array(16).fill(0.2));
    for (let i = 1; i < thin.edgeA.length - 1; i++) expect(w(thin, i)).toBeGreaterThanOrEqual(8 - 1e-6);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/stackJoin.test.ts -t profile`
Expected: FAIL (the extra argument is ignored; `bulged` equals `flat`).

- [ ] **Step 3: Implement**

`src/types.ts`, in `StackJoin` after `depth?: number;`:

```ts
  /** Width multipliers at even parameters along the curve, 1 = the linear
   *  interpolation of the two faces. Absent = linear (every join today). A
   *  curve converted from a letter carries its own sampled width here. */
  profile?: number[];
  /** The bend double-click returns to. Absent = { bow: 0, depth: 0 }. A
   *  curve converted from a letter rests at the bend that reproduces it. */
  rest?: { bow: number; depth: number };
```

`src/lib/stackJoin.ts`: change the signature and the rung vector:

```ts
export function joinEdges(
  A: CutFace, B: CutFace, bow: number, minWidth: number, samples = 24, depth = 0, profile?: readonly number[]
): { edgeA: Pt[]; edgeB: Pt[] } {
```

and, right after `let v: Pt = [vA[0] + (vB[0] - vA[0]) * t, vA[1] + (vB[1] - vA[1]) * t];`:

```ts
    // The stroke's own width along the curve, when it has one: scale the
    // nib's cross-section by the profile, never at the two faces (the seam
    // must land on them exactly); the floor below still applies.
    if (profile && profile.length > 1 && i > 0 && i < last) {
      const u = t * (profile.length - 1), k = Math.min(profile.length - 2, Math.floor(u)), f = u - k;
      const m = profile[k] * (1 - f) + profile[k + 1] * f;
      v = [v[0] * m, v[1] * m];
    }
```

`src/lib/stackOutline.ts:40`: `const edges = joinEdges(A, B, j.bow, joinFloor(A, B, nib.minFraction), 24, j.depth ?? 0, j.profile);`
`src/components/StackEditOverlay.tsx:172`: `const { edgeA, edgeB } = joinEdges(A, B, j.bow, joinFloor(A, B, nib.minFraction), 24, depth, j.profile);`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/stackJoin.test.ts src/lib/stackOutline.test.ts`
Expected: PASS, including the pre-existing identity and floor tests.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint
git add src/types.ts src/lib/stackJoin.ts src/lib/stackJoin.test.ts src/lib/stackOutline.ts src/components/StackEditOverlay.tsx
git commit -m "Stack joins: a sampled width profile and a rest bend"
```

---

### Task 5: `bendCurveAt` — the conversion

**Files:**
- Modify: `src/lib/stackConvert.ts` (append)
- Test: `src/lib/stackConvert.test.ts`

**Interfaces:**
- Consumes: `traceCurve`, `type CurveTrace` from `./stackCurve`; `splitPieceAtCut` (same file); `joinCenterline`, `solveJoinDrag`, `faceThickness` from `./stackJoin`; `transformFace`, `transformPt`, `transformCmds` from `./stackGeometry`; `pieceTransform` from `./stackOutline`; `flattenContours` from `./strokeCuts`; `pointInPolygon` from `./svgPath`.
- Produces: `export function bendCurveAt(pieces: readonly StackPiece[], joins: readonly StackJoin[], pieceId: string, press: Pt): { pieces: StackPiece[]; joins: StackJoin[]; joinId: string } | null` — `press` is piece-local. Task 6 calls it.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/stackConvert.test.ts` (it already has `area`, `shapeReal`, `convert`, and imports `assembleStackOutline`, `outlineBounds`, `flattenContours`):

```ts
import { bendCurveAt } from "./stackConvert";
import { arcBand } from "./stackCurve.test";

describe("bendCurveAt", () => {
  /** A bowl (radius 110, 20 thick, 0.15π–0.85π) with a 20-thick bar welded to each end, as one piece. */
  const bowlWithArms = (): StackPiece => {
    const band = arcBand(100, 120, Math.PI * 0.15, Math.PI * 0.85);
    const endR = [Math.cos(Math.PI * 0.15) * 110, Math.sin(Math.PI * 0.15) * 110];
    const endL = [Math.cos(Math.PI * 0.85) * 110, Math.sin(Math.PI * 0.85) * 110];
    const arm = (x: number, y: number, dir: 1 | -1): SvgCmd[] => [
      { type: "M", x, y: y - 10 }, { type: "L", x: x + dir * 150, y: y - 10 }, { type: "L", x: x + dir * 150, y: y + 10 }, { type: "L", x, y: y + 10 }, { type: "Z" },
    ];
    // Arms overlap the band's ends by a few units; the piece is three contours that overlap (nonzero fill).
    const cmds = [...band, ...arm(endR[0] - 5, endR[1], 1), ...arm(endL[0] + 5, endL[1], -1)];
    return { id: "b", cmds, x: 0, y: 0, rotation: 0, pivot: [0, 60], homeX: 0, homeY: 0, order: 0, role: "letter", faces: [] };
  };
  const nib = { width: 20, minFraction: 0.5 };

  it("frees the bowl into a join that reproduces it, with a rest bend and a width profile", () => {
    const piece = bowlWithArms();
    const before = area(assembleStackOutline([piece], [], nib));
    const r = bendCurveAt([piece], [], "b", [0, 110])!;
    expect(r).not.toBeNull();
    // Two fragments remain (body keeps the id; the far side rides on it), one join.
    expect(r.pieces).toHaveLength(2);
    const body = r.pieces.find((p) => p.id === "b")!, far = r.pieces.find((p) => p.id !== "b")!;
    expect(far.parentId).toBe("b");
    expect(r.joins).toHaveLength(1);
    const j = r.joins[0];
    expect(j.id).toBe(r.joinId);
    expect(j.rest).toEqual({ bow: j.bow, depth: j.depth });
    expect(j.profile).toHaveLength(16);
    expect(j.profile![0]).toBeCloseTo(1, 6); expect(j.profile![15]).toBeCloseTo(1, 6);
    // Identity: the assembled outline keeps its area within 5%.
    const after = area(assembleStackOutline(r.pieces, r.joins, nib));
    expect(Math.abs(after - before) / before).toBeLessThan(0.05);
    // The join's midpoint lands on the bowl's apex.
    const A = transformFace(body.faces[j.from.faceIndex], pieceTransform(body)), B = transformFace(far.faces[j.to.faceIndex], pieceTransform(far));
    const cl = joinCenterline(A, B, j.bow, j.depth ?? 0);
    const mid = [0.125 * cl[0][0] + 0.375 * cl[1][0] + 0.375 * cl[2][0] + 0.125 * cl[3][0], 0.125 * cl[0][1] + 0.375 * cl[1][1] + 0.375 * cl[2][1] + 0.125 * cl[3][1]];
    expect(Math.hypot(mid[0] - 0, mid[1] - 110)).toBeLessThan(6);
  });

  it("widens when depth grows, and the input is untouched", () => {
    const piece = bowlWithArms();
    const snapshot = JSON.stringify(piece);
    const r = bendCurveAt([piece], [], "b", [0, 110])!;
    expect(JSON.stringify(piece)).toBe(snapshot);
    const j = r.joins[0];
    const h = (joins: StackJoin[]) => { const b = outlineBounds(assembleStackOutline(r.pieces, joins, nib)); return b.y2 - b.y1; };
    expect(h([{ ...j, depth: (j.depth ?? 0) + 0.5 }])).toBeGreaterThan(h(r.joins) + 5);
  });

  it("keeps the body id off the arc when the arc is the largest fragment", () => {
    // A bowl with two tiny arms: the arc is by far the biggest fragment.
    const band = arcBand(100, 120, Math.PI * 0.1, Math.PI * 0.9);
    const endR = [Math.cos(Math.PI * 0.1) * 110, Math.sin(Math.PI * 0.1) * 110];
    const endL = [Math.cos(Math.PI * 0.9) * 110, Math.sin(Math.PI * 0.9) * 110];
    const stub = (x: number, y: number, dir: 1 | -1): SvgCmd[] => [
      { type: "M", x, y: y - 10 }, { type: "L", x: x + dir * 40, y: y - 10 }, { type: "L", x: x + dir * 40, y: y + 10 }, { type: "L", x, y: y + 10 }, { type: "Z" },
    ];
    const piece: StackPiece = { id: "r", cmds: [...band, ...stub(endR[0] - 5, endR[1], 1), ...stub(endL[0] + 5, endL[1], -1)], x: 0, y: 0, rotation: 0, pivot: [0, 60], homeX: 0, homeY: 0, order: 0, role: "letter", faces: [] };
    const neighbour: StackPiece = { id: "n", cmds: stub(200, 20, 1), x: 0, y: 0, rotation: 0, pivot: [220, 20], homeX: 0, homeY: 0, order: 1, role: "letter", faces: [{ a: [200, 10], b: [200, 30], tangent: Math.PI }] };
    const r = bendCurveAt([piece, neighbour], [], "r", [0, 110])!;
    expect(r).not.toBeNull();
    expect(r.pieces.some((p) => p.id === "r")).toBe(true);
    // The piece that kept the id is a stub, not the arc: its area is small.
    const kept = r.pieces.find((p) => p.id === "r")!;
    expect(area(kept.cmds)).toBeLessThan(2000);
    expect(r.pieces.some((p) => area(p.cmds) > 5000)).toBe(false);   // the arc is gone
  });

  it("returns null off a curve", () => {
    const bar: StackPiece = { id: "s", cmds: [{ type: "M", x: 0, y: -10 }, { type: "L", x: 300, y: -10 }, { type: "L", x: 300, y: 10 }, { type: "L", x: 0, y: 10 }, { type: "Z" }], x: 0, y: 0, rotation: 0, pivot: [150, 0], homeX: 0, homeY: 0, order: 0, role: "letter", faces: [] };
    expect(bendCurveAt([bar], [], "s", [150, 0])).toBeNull();
  });
});
```

Add to the file's imports: `import { joinCenterline } from "./stackJoin";`, `import { transformFace } from "./stackGeometry";`, `import { pieceTransform } from "./stackOutline";`. (`arcBand` is exported from the Task 1 test file; importing a test helper from another test file is already how `shapeReal` conventions spread here.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/stackConvert.test.ts -t bendCurveAt`
Expected: FAIL — `bendCurveAt` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/stackConvert.ts` (add imports: `import { traceCurve, PROFILE_SAMPLES } from "./stackCurve";` — export `const PROFILE_SAMPLES = 16` from `stackCurve.ts` — plus `joinCenterline, solveJoinDrag, faceThickness` from `./stackJoin`, `transformFace, transformPt, transformCmds` from `./stackGeometry`, `pieceTransform` from `./stackOutline`, `pointInPolygon` from `./svgPath`):

```ts
/** Which of `pieces` holds the world point `p` in its ink. */
function pieceAt(pieces: readonly StackPiece[], p: Pt): StackPiece | undefined {
  return pieces.find((q) => {
    const cs = flattenContours(transformCmds(q.cmds, pieceTransform(q)));
    let n = 0; for (const c of cs) if (pointInPolygon(p[0], p[1], c)) n++;
    return n % 2 === 1;
  });
}

/** Swap two pieces' ids everywhere: joins, parentIds, and the pieces themselves. */
function swapIds(pieces: StackPiece[], joins: StackJoin[], a: string, b: string): { pieces: StackPiece[]; joins: StackJoin[] } {
  const sw = (id: string) => (id === a ? b : id === b ? a : id);
  return {
    pieces: pieces.map((p) => ({ ...p, id: sw(p.id), parentId: p.parentId === undefined ? undefined : sw(p.parentId) })),
    joins: joins.map((j) => ({ ...j, from: { ...j.from, pieceId: sw(j.from.pieceId) }, to: { ...j.to, pieceId: sw(j.to.pieceId) } })),
  };
}

/**
 * Free the curved stroke under `press` (piece-local) and replace it with a
 * join. Two cuts with `splitPieceAtCut`; the fragment holding the trace's
 * middle is the arc and is dropped (with the join the split made to it);
 * the far fragment rides on the body as a pulled tail does; one join from
 * the body's new face to the far's, its bend solved so the cubic's midpoint
 * lands on the traced midpoint (`rest`), its width the trace's own
 * (`profile`). The body keeps the piece's id — swapped off the arc when the
 * arc is the largest fragment — so joins to neighbours survive. Null when
 * nothing under the press is a curve or a cut will not split cleanly.
 */
export function bendCurveAt(
  pieces: readonly StackPiece[], joins: readonly StackJoin[], pieceId: string, press: Pt
): { pieces: StackPiece[]; joins: StackJoin[]; joinId: string } | null {
  const piece = pieces.find((p) => p.id === pieceId);
  if (!piece || piece.role !== "letter") return null;
  const trace = traceCurve(piece.cmds, press, { faces: piece.faces });
  if (!trace) return null;
  const T = pieceTransform(piece);
  const world = (p: Pt) => transformPt(p, T);
  const n = trace.centre.length;
  const midW = world(trace.centre[Math.floor(n / 2)]);
  const endW = world(trace.centre[n - 1]);

  // First cut: body keeps the id, the far side is a cap on it.
  const r1 = splitPieceAtCut(pieces, joins, pieceId, trace.cuts[0]);
  if (!r1) return null;
  const cap1 = r1.pieces[r1.pieces.length - 1];
  // Second cut on whichever fragment holds the trace's far end.
  const holder = pieceAt([r1.pieces.find((p) => p.id === pieceId)!, cap1], endW);
  if (!holder) return null;
  const r2 = splitPieceAtCut(r1.pieces, r1.joins, holder.id, trace.cuts[1]);
  if (!r2) return null;
  // The arc is the fragment holding the trace's middle.
  const fragments = r2.pieces.filter((p) => p.id === pieceId || p.parentId === pieceId || p.id === cap1.id || p.parentId === cap1.id);
  const arc = pieceAt(fragments, midW);
  if (!arc) return null;
  let ps = r2.pieces, js = r2.joins;
  // The body id must not sit on the arc: give it to the largest other fragment.
  if (arc.id === pieceId) {
    const others = fragments.filter((p) => p.id !== arc.id);
    const biggest = others.reduce((a, b) => (outlineBounds(b.cmds).x2 - outlineBounds(b.cmds).x1) * (outlineBounds(b.cmds).y2 - outlineBounds(b.cmds).y1) > (outlineBounds(a.cmds).x2 - outlineBounds(a.cmds).x1) * (outlineBounds(a.cmds).y2 - outlineBounds(a.cmds).y1) ? b : a);
    ({ pieces: ps, joins: js } = swapIds(ps, js, arc.id, biggest.id));
  }
  const arcId = arc.id === pieceId ? ps.find((p) => p.cmds === arc.cmds)!.id : arc.id;
  // The joins the two splits made to the arc name the faces to join; drop them with the arc.
  const toArc = js.filter((j) => j.from.pieceId === arcId || j.to.pieceId === arcId);
  if (toArc.length !== 2) return null;
  const endRefs = toArc.map((j) => (j.from.pieceId === arcId ? j.to : j.from));
  js = js.filter((j) => !toArc.includes(j));
  ps = ps.filter((p) => p.id !== arcId);
  const bodyId = pieceId;
  const bodyRef = endRefs.find((r) => r.pieceId === bodyId) ?? endRefs[0];
  const farRef = endRefs.find((r) => r !== bodyRef)!;
  // The far fragment rides on the body, whatever the splits made it ride on.
  ps = ps.map((p) => (p.id === farRef.pieceId ? { ...p, parentId: bodyId, role: "letter", order: piece.order } : p));
  const body = ps.find((p) => p.id === bodyId)!, far = ps.find((p) => p.id === farRef.pieceId)!;
  const A = transformFace(body.faces[bodyRef.faceIndex], pieceTransform(body));
  const B = transformFace(far.faces[farRef.faceIndex], pieceTransform(far));
  // Fit the bend: three Gauss–Newton steps of the drag solver toward the traced midpoint.
  const chord = Math.hypot(B.a[0] + B.b[0] - A.a[0] - A.b[0], B.a[1] + B.b[1] - A.a[1] - A.b[1]) / 2;
  let bend = { bow: 0, depth: 0 };
  for (let k = 0; k < 3; k++) {
    const cl = joinCenterline(A, B, bend.bow, bend.depth);
    const m: Pt = [0.125 * cl[0][0] + 0.375 * cl[1][0] + 0.375 * cl[2][0] + 0.125 * cl[3][0], 0.125 * cl[0][1] + 0.375 * cl[1][1] + 0.375 * cl[2][1] + 0.125 * cl[3][1]];
    bend = solveJoinDrag(bend, A.tangent, B.tangent, chord, [midW[0] - m[0], midW[1] - m[1]]);
  }
  // The width profile: traced thickness over the linear interpolation of the faces.
  const tA = faceThickness(A), tB = faceThickness(B);
  const cum: number[] = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(trace.centre[i][0] - trace.centre[i - 1][0], trace.centre[i][1] - trace.centre[i - 1][1]));
  const total = cum[n - 1] || 1;
  const profile = Array.from({ length: PROFILE_SAMPLES }, (_, k) => {
    if (k === 0 || k === PROFILE_SAMPLES - 1) return 1;
    const t = k / (PROFILE_SAMPLES - 1), d = t * total;
    let i = 1; while (i < n - 1 && cum[i] < d) i++;
    const f = cum[i] === cum[i - 1] ? 0 : (d - cum[i - 1]) / (cum[i] - cum[i - 1]);
    const th = trace.thickness[i - 1] * (1 - f) + trace.thickness[i] * f;
    const lin = tA * (1 - t) + tB * t || 1;
    return Math.max(0.2, Math.min(3, th / lin));
  });
  const joinId = `j${bodyId}-${far.id}c`;
  js = [...js, { id: joinId, from: { pieceId: bodyId, faceIndex: bodyRef.faceIndex }, to: { pieceId: far.id, faceIndex: farRef.faceIndex }, bow: bend.bow, depth: bend.depth, rest: { ...bend }, profile }];
  return { pieces: ps, joins: js, joinId };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/stackConvert.test.ts`
Expected: PASS. If identity misses 5%: the default cubic's handles are chord/3 and a near-semicircle wants more; check the solver converged (`bend.depth` should be positive, around 0.3–0.6 for the fixture). If `toArc.length !== 2`: the second cut split the body rather than cap1 — check `pieceAt` tested world coordinates (the fragments' `x`/`y` changed under `rebasePiece`).

- [ ] **Step 5: Re-run the gate script and record**

Run: `npx --yes tsx scripts/measureCurves.mjs` and add the `freed`/`identity` columns to the spec's Evidence table (Task 3's format).

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint
git add src/lib/stackConvert.ts src/lib/stackConvert.test.ts src/lib/stackCurve.ts docs/superpowers/specs/2026-10-15-bend-curves-design.md
git commit -m "Stack curves: free a curved stroke into a fitted, profiled join"
```

---

### Task 6: Handler, overlay hit layer, press-and-drag, double-click to rest

**Files:**
- Modify: `src/App.tsx` (beside `splitStackPiece`, ~line 717; Sidebar/CanvasStage wiring ~line 3578)
- Modify: `src/components/CanvasStage.tsx:175-180, 305-310, 1222-1236`
- Modify: `src/components/StackEditOverlay.tsx`

**Interfaces:**
- Produces: App `bendStackCurve(blockId: number, pieceId: string, press: Pt): string | null`; CanvasStage prop `onBendStackCurve`; overlay prop `onBend?: (pieceId: string, press: Pt) => string | null`; hover kind `{ kind: "curve"; pieceId: string; index: number }`; Konva node name `stack-curve`.

- [ ] **Step 1: App handler**

Below `splitStackPiece` in `src/App.tsx`:

```ts
  /** Free the curved stroke under a press and replace it with a join; the
   *  overlay bends that join in the same gesture. One history step for both. */
  const bendStackCurve = useCallback(
    (blockId: number, pieceId: string, press: [number, number]) => {
      const block = blocks.find((b) => b.id === blockId);
      if (!block || !isStackBlock(block)) return null;
      const next = bendCurveAt(block.pieces, block.joins, pieceId, press);
      if (!next) return null;
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => (b.id === blockId && isStackBlock(b) ? { ...b, pieces: next.pieces, joins: next.joins } : b))
      );
      setExportStatus("Curve freed; drag to bend, double-click to restore.");
      return next.joinId;
    },
    [blocks, pushHistory]
  );
```

Import `bendCurveAt` from `./lib/stackConvert`. Pass `onBendStackCurve={bendStackCurve}` to `CanvasStage` next to `onSplitStackPiece`.

- [ ] **Step 2: CanvasStage plumbing**

Props type (after `onSplitStackPiece`): `onBendStackCurve: (blockId: number, pieceId: string, press: [number, number]) => string | null;`; destructure it; pass `onBend={(pieceId, press) => onBendStackCurve(block.id, pieceId, press)}` to `StackEditOverlay`.

- [ ] **Step 3: Overlay**

In `src/components/StackEditOverlay.tsx`:

- Imports: `import { curveRegions, type CurveRegion } from "../lib/stackCurve";`.
- `Hover` gains `| { kind: "curve"; pieceId: string; index: number }`.
- Props gain `/** Free the curve under a press (piece-local); returns the new join's id. Pushes history itself. */ onBend?: (pieceId: string, press: Pt) => string | null;`.
- A module-level cache: `const curveCache = new WeakMap<SvgCmd[], CurveRegion[]>();`
- After `cutSpans`, the regions of the hovered letter (same `hoveredPieceId`):

```ts
  const curves = useMemo(() => {
    const p = hoveredPieceId ? byId.get(hoveredPieceId) : undefined;
    if (!p || p.role !== "letter") return [];
    const upm = unitsPerEm || 1000;
    let regions = curveCache.get(p.cmds);
    if (!regions) { regions = curveRegions(p.cmds, { maxLength: 3 * upm, faces: p.faces }); curveCache.set(p.cmds, regions); }
    const t = pieceTransform(p);
    return regions.map((r, index) => ({
      id: `${p.id}:c${index}`, pieceId: p.id, index, apex: r.apex,
      points: r.polygon.flatMap((q) => { const w = transformPt(q, t); return [w[0] * scale, w[1] * scale]; }),
    }));
  }, [hoveredPieceId, byId, unitsPerEm, scale]);
```

- A `joinsRef` so the stage-level drag reads current joins: `const joinsRef = useRef(joins); joinsRef.current = joins;` and `const byIdRef = useRef(byId); byIdRef.current = byId;`.
- The bend gesture, beside `beginPull`:

```ts
  const bend = useRef<{ joinId: string; pointer: { x: number; y: number }; end: () => void } | null>(null);
  const beginBend = (c: typeof curves[number], stage: Konva.Stage | null) => {
    const p = byId.get(c.pieceId);
    if (!p || !stage || !onBend) return;
    const at = pointerIn();
    const local = invertTransform([at.x / scale, at.y / scale], pieceTransform(p));
    const joinId = onBend(p.id, local);
    if (!joinId) return;
    const end = () => { bend.current = null; stage.off(".stackbend"); window.removeEventListener("mouseup", end); window.removeEventListener("touchend", end); };
    bend.current = { joinId, pointer: at, end };
    setHover({ kind: "join", id: joinId });
    stage.on("mousemove.stackbend touchmove.stackbend", () => {
      const s = bend.current; if (!s) return;
      const j = joinsRef.current.find((x) => x.id === s.joinId); if (!j) return;
      const from = byIdRef.current.get(j.from.pieceId), to = byIdRef.current.get(j.to.pieceId);
      const fa = from?.faces[j.from.faceIndex], fb = to?.faces[j.to.faceIndex];
      if (!from || !to || !fa || !fb) return;
      const A = transformFace(fa, pieceTransform(from)), B = transformFace(fb, pieceTransform(to));
      const chord = Math.hypot(B.a[0] + B.b[0] - A.a[0] - A.b[0], B.a[1] + B.b[1] - A.a[1] - A.b[1]) / 2 * scale;
      const rest = j.rest ?? { bow: 0, depth: 0 };
      const now = pointerIn();
      onSetBow?.(s.joinId, solveJoinDrag(rest, A.tangent, B.tangent, chord, [now.x - s.pointer.x, now.y - s.pointer.y]));
    });
    stage.on("mouseup.stackbend touchend.stackbend", end);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchend", end);
  };
```

  (`solveJoinDrag`'s first argument is the bend at the press — the rest — and `delta` the pointer's total travel, exactly as the join drag does; both in px.) Add `useEffect(() => () => { bend.current?.end(); }, []);` beside the pull one, and guard `enter` with `if (!pull.current && !bend.current)`.
- The hit layer, mounted **after the body polygons and before `cutSpans`**:

```tsx
      {/* The apex of each curve of the hovered letter: press to free it, the drag bends it. */}
      {curves.map((c) => (
        <Line
          key={c.id} name="stack-curve" points={c.points} closed fill="transparent" strokeEnabled={false}
          onMouseEnter={() => enter({ kind: "curve", pieceId: c.pieceId, index: c.index })}
          onMouseDown={(e) => { e.cancelBubble = true; beginBend(c, e.target.getStage()); }}
          onTouchStart={(e) => { e.cancelBubble = true; beginBend(c, e.target.getStage()); }}
        />
      ))}
```

- The hover outline: `{hover?.kind === "curve" && (() => { const c = curves.find((x) => x.pieceId === hover.pieceId && x.index === hover.index); if (!c) return null; return <Line points={c.points} closed stroke={accent} strokeWidth={OUTLINE_PX} strokeScaleEnabled={false} listening={false} />; })()}`; cursor for `curve`: `"grab"`.
- Double-click on a join returns to rest: replace the `onDblClick` body with

```ts
            const rest = j.rest ?? { bow: 0, depth: 0 };
            if (j.bow === rest.bow && depth === rest.depth) return;
            onBegin?.();
            onSetBow?.(j.id, { ...rest });
```

- The doc comment at the top of the overlay gains the line `the apex of a curved stroke → press frees the curve, the drag bends it` and the z-order sentence: "…then the body polygons, then the curve apexes and the cut spans of the hovered letter".

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`. Then `npm run dev`: Amiri, type نحن, convert, hover the first ن's bowl — an outline appears over its apex; press and drag downward: the bowl deepens; release; double-click the curve: it returns; Ctrl+Z once: the ن is whole again (one step). UKIJ Diwani مصبح: hover the ح — at least the gate's count of curves is offered.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/CanvasStage.tsx src/components/StackEditOverlay.tsx
git commit -m "Stack curves: press a bowl's apex to free it, drag to bend, double-click to rest"
```

---

### Task 7: End-to-end

**Files:**
- Modify: `e2e/stack.spec.ts`

- [ ] **Step 1: Write the test**

Append to `e2e/stack.spec.ts` (uses its `convert`, `fullPiecesOf`, `namedNodeCount`, `hitTargetAt`, `settleFrames`, `chooseFont`, `setBlockText`, `gotoApp`, `blockClientBox`):

```ts
test("pressing a bowl's apex frees the curve and the same drag bends it; double-click restores; undo is one step", async ({ page }) => {
  await gotoApp(page);
  await chooseFont(page, "Amiri");
  await setBlockText(page, "نحن");
  await settleFrames(page);
  await convert(page);
  const before = await fullPiecesOf(page);
  const joinsBefore = await page.evaluate(() => (window.__HARF__!.getBlocks()[0] as unknown as { joins: unknown[] }).joins.length);
  expect(await namedNodeCount(page, "stack-curve")).toBe(0);

  // Hover each letter until a curve apex is offered, then press it.
  let at: Point | null = null;
  const letterIdx = before.map((p, i) => (p.role === "letter" && !p.parentId ? i : -1)).filter((i) => i >= 0);
  for (const i of letterIdx) {
    const c = await pieceCentre(page, i);
    await page.mouse.move(c.x, c.y);
    await settleFrames(page);
    if ((await namedNodeCount(page, "stack-curve")) === 0) continue;
    at = await page.evaluate(() => {
      const stage = window.__HARF__!.getStage()!;
      const node = stage.find(".stack-curve")[0];
      const r = node.getClientRect();
      const box = stage.container().getBoundingClientRect();
      return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
    });
    break;
  }
  expect(at, "a curve apex was offered").not.toBeNull();
  await page.mouse.move(at!.x, at!.y);
  await settleFrames(page);
  expect(await hitTargetAt(page, at!)).toBe("Line.stack-curve");
  const boxBefore = await blockClientBox(page, 1);
  await page.mouse.down();
  await expect.poll(async () => (window as never, page.evaluate(() => (window.__HARF__!.getBlocks()[0] as unknown as { joins: unknown[] }).joins.length))).toBe(joinsBefore + 1);
  await page.mouse.move(at!.x + 2, at!.y + 3);
  await page.mouse.move(at!.x, at!.y + 40, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);
  const boxBent = await blockClientBox(page, 1);
  expect(Math.abs(boxBent.height - boxBefore.height)).toBeGreaterThan(4);

  // Double-click the curve: back to its rest, which reproduces the letter.
  await page.mouse.move(at!.x, at!.y + 20);
  await settleFrames(page);
  await page.mouse.dblclick(at!.x, at!.y + 20);
  await settleFrames(page);
  const boxRest = await blockClientBox(page, 1);
  expect(Math.abs(boxRest.height - boxBefore.height)).toBeLessThan(3);

  // One undo restores the whole letter.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await fullPiecesOf(page)).length).toBe(before.length);
});
```

(If `Point` is not imported in the spec, add it to the `./harf` import, where it already exists.)

- [ ] **Step 2: Run**

Run: `npx playwright test e2e/stack.spec.ts`
Expected: all stack tests pass, including the new one. If the double-click lands on the body rather than the join (the bent curve moved), compute the join's midpoint from `stage.find(".stack-join")[joinsBefore].getClientRect()` and double-click there instead.

- [ ] **Step 3: Commit**

```bash
npx tsc --noEmit -p e2e/tsconfig.json
git add e2e/stack.spec.ts
git commit -m "e2e: free a bowl, bend it, double-click to rest, undo in one step"
```

---

### Task 8: Docs, guide section, deferred list

**Files:**
- Modify: `.claude/rules/stacked-compositions.md`, `.claude/rules/deferred-features.md`, `PROGRESS.md`, `CLAUDE.md` (one line in the stacked-compositions index entry)
- Create: `src/components/guide/sections/stackCurves.tsx`

- [ ] **Step 1: Rules note**

In `.claude/rules/stacked-compositions.md`, after the "**A tail is a split plus a join**" paragraph, add:

```
**A curve becomes a join** (`bendCurveAt`, `stackConvert.ts`; tracer in
`stackCurve.ts`, pure). Pressing the apex third of a curved stroke traces
it (`traceCurve`: nearest edge, cast across to the other edge, walk both
ways re-centring every quarter thickness; stops at a thickness outside
0.6–1.6× the seed or a 25% jump between steps, an inflection, a straight
run longer than a thickness, a face, or 3 em), cuts it half a thickness in
from each end with `splitPieceAtCut`, drops the arc fragment and the joins
the splits made to it, rides the far fragment on the body, and makes one
join whose `rest` bend is solved (three steps of `solveJoinDrag`) so the
cubic's midpoint lands on the traced midpoint and whose `profile` is the
traced width over the faces' linear interpolation (`joinEdges` scales its
rungs by it, never at the faces, floor still applied). The body keeps the
piece id, swapped off the arc when the arc is the largest fragment, so
joins to neighbours survive. The hover shows `curveRegions` (seeded along
the outline, deduped by shared samples, cached per `cmds`); its hit layer
sits above the body and below the cut spans; the press frees and the same
drag bends through a `.stackbend` stage listener (the join's node mounts a
render later), starting from `rest`. Double-click on any join returns to
`rest ?? {0, 0}`. Gate numbers: see the spec's Evidence table.
```

- [ ] **Step 2: Deferred, PROGRESS, CLAUDE.md**

`.claude/rules/deferred-features.md`: under *Bending letter bodies*, replace the "Includes widening the radius…" lines with "Widening or tightening a curved stroke shipped 2026-10-15 by turning the curve into a join (see stacked-compositions.md); bending a *whole* letter body with a skeleton stays deferred."

`PROGRESS.md`, under `## Shipped`:

```
### 2026-10-15 — Curved strokes bend

- **Press a bowl, drag to widen or tighten it.** The curve is traced, cut
  free and replaced by a join that reproduces it until dragged, with the
  stroke's own width; double-click restores. Spec:
  `docs/superpowers/specs/2026-10-15-bend-curves-design.md`; how the tracer
  works and where it stops:
  [stacked-compositions.md](.claude/rules/stacked-compositions.md).
```

`CLAUDE.md`, in the Stacked compositions one-liner, append: "A curved stroke bends by becoming a join (`bendCurveAt`); the tracer is pure and gated by `scripts/measureCurves.mjs`."

- [ ] **Step 3: Guide section**

Create `src/components/guide/sections/stackCurves.tsx`:

```tsx
import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "stack-curves",
  title: "Bending a curve",
  order: 72,
  keywords: ["curve", "bowl", "radius", "bend", "widen", "round", "stacked", "stack", "join", "double-click"],
  Body: () => (
    <>
      <p>
        In a stacked composition, the round strokes of a letter — the bowl of a
        nun, the hook of a hah, the sweep of a ra — can be bent. Hover the
        letter and the top of each curve is outlined. Press there and drag:
        the curve is freed and follows your hand, opening wider or closing
        tighter, keeping the pen's weight as it goes.
      </p>
      <p>
        Once freed, the curve behaves like the joins between letters: drag it
        again to bend it further, and <strong>double-click</strong> it to put
        it back exactly as the font drew it. Undo also restores the letter in
        one step.
      </p>
      <p>
        Not every curve is offered. A stroke that runs into another, or whose
        weight changes sharply along the turn, is left alone — the tool only
        bends what it can redraw faithfully.
      </p>
    </>
  ),
};
```

- [ ] **Step 4: Full verification and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
git add .claude/rules/stacked-compositions.md .claude/rules/deferred-features.md PROGRESS.md CLAUDE.md src/components/guide/sections/stackCurves.tsx
git commit -m "Docs: curved strokes bend; guide section; deferred list updated"
```

---

## Self-review notes

- Spec coverage: tracer (Task 1), regions (Task 2), gate script and Evidence (Tasks 3 and 5 step 5), profile/rest fields and `joinEdges` (Task 4), `bendCurveAt` with id swap and rider (Task 5), handler/plumbing/overlay/gesture/double-click (Task 6), e2e (Task 7), docs and guide (Task 8). Out-of-scope items untouched.
- Types: `TraceCut`, `CurveTrace`, `TraceOpts`, `CurveRegion`, `PROFILE_SAMPLES`, `bendCurveAt(pieces, joins, pieceId, press)` → `{ pieces, joins, joinId }`, `onBend(pieceId, press) → string | null`, `bendStackCurve(blockId, pieceId, press) → string | null`, hover `{ kind: "curve"; pieceId; index }`, node name `stack-curve` — consistent across tasks.
- Review Focus pins: 1 → Task 1 face-stop test; 2 → Task 5 id-swap test; 3 → Task 6 (history once) and Task 7 (undo); 4 → Task 2 timing test; 5 → Task 6 (rest) and Task 7 (bounding box returns).
