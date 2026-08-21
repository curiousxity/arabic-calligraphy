# Straight-Stroke Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a calligrapher lengthen a letter's own straight strokes by dragging them on canvas, with the run genuinely widening rather than the letter deforming.

**Architecture:** A cut is a line perpendicular to the baseline plus a distance. Everything past the cut in pen order translates by `d`; every glyph whose outline the line crosses is cut and bridged with straight edges; the run's advance grows by `d`. A cut is legal only where every crossed outline segment runs parallel to the baseline — which makes "is this stroke straight enough" a cheap predicate instead of hand-authored per-font data.

**Tech Stack:** TypeScript, React 19, Konva/react-konva, opentype.js, harfbuzzjs (WASM), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-21-straight-stroke-extension-design.md`

## Status: complete — Tasks 1–10 built 2026-08-21

**Execution stopped after Task 3.** Task 3 was this plan's own go/no-go
coverage measurement, placed deliberately before any UI work. It failed: at
the shipped `maxSlope` and at both looser values this plan authorizes trying,
no setting cleared both the isolated-letter and join thresholds on all four
gate fonts (Amiri, Scheherazade, NotoSans, Kufi) **at once** — three of the
four clear the join bar on the design doc's own denominator, but the
letterform-internal (isolated-letter) half is what failed, and the reason is
structural rather than a tuning miss — see `docs/archive/stroke-zone-coverage.md`
for the measurement (the single home for these numbers) and CLAUDE.md,
"Straight-stroke cut detection (kept, unused)" for what it established. A
human reviewed that record and decided not to proceed.

**Resumed 2026-08-21.** The stop above stood for as long as its predicate
did. That predicate was then diagnosed as conflating two opposite defects
behind one `maxSlope` knob — inclined stems rejected, curve vertices
accepted — and was replaced rather than retuned: detection now sweeps the
stroke's own axis, and straightness is measured as per-edge bow away from a
chord. See "Amendment: axis-relative cuts" in the design doc.

Re-measured against the same gate, the same four fonts and the same script:
**isolated-letter coverage now clears 60% on all four (75–86%)**, where
before it was the half that structurally could not. Join coverage clears 80%
on three; Amiri remains the outlier the first pass already identified as a
genuine property of that font, and is also the half that duplicates tatweel
kashida.

A human reviewed that record and decided to proceed — the gate is met on the
metric it existed to protect (the letterform-internal capability, which
tatweel cannot provide), and its one remaining failure is on the metric that
was never the point. Amiri's joins are accepted as a known per-font
limitation rather than a blocker. Numbers:
`docs/archive/stroke-zone-coverage.md`, "Second pass".

**Tasks 4–10 were amended by that decision and are now built.** A cut carries
an angle, and extension runs along the stroke axis, so a cut of distance `d`
grows the advance by `d * cos t` rather than by `d`. Three defects in the
task sketches below were found and fixed while executing them, and are worth
knowing if this plan is ever used as a model:

- **Task 4's `L` bridge was wrong** — it emitted `shift(cutX)` for both
  bridge points, putting them both at `cutX + d`.
- **Task 4 never handled `Q` segments**, which opentype.js returns for every
  TrueType font, and never bridged a contour's *implied closing segment*.
- **Task 5's assertion restated its own assumption**: it checked that
  `plan.addedAdvance` grows with `d`, and `addedAdvance` is computed as
  `+= d`. The real assertion measures the outline's own extent after surgery
  in three real fonts, which is what the task's own comment asked for.

The end state is in CLAUDE.md, "Straight-stroke cut detection".

## Global Constraints

- **`src/lib/strokeCuts.ts` must not import `./harfbuzz`.** That module statically imports harfbuzzjs, whose CJS/ESM shape throws under Vitest's Node loader before any test code runs. Callers pass geometry in. Same rule `tatweel.ts`, `fitToWidth.ts` and `diacritics.ts` follow.
- **It must not import `opentype.js` either.** Keep it dependency-free; adapt opentype's `PathCommand[]` at the boundary via the structural `toSvgCmds` adapter defined in Task 1.
- **Any test asserting something about *shaped text* uses real harfbuzzjs and real fonts from `public/fonts/`** — copy `shapeReal` from `src/lib/diacritics.test.ts`, loading harfbuzzjs via `createRequire`. Never hand-written `{ g, cl }` fixtures. Tests of *pure geometry* on synthetic outlines (a rectangle, a circle) are fine and expected — the rule is about fabricating shaping output, not about all test data.
- **Plain `text` blocks only.** Shape Fill and text-on-path are out of scope.
- **Verification loop after every task:** `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, `npm run build` — in that order.
- **e2e specs live in `e2e/`, never under `src/`** (Vitest and Playwright both claim `*.spec.ts`; `vite.config.ts` excludes `e2e/**`).
- **`package.json` version is bumped by a pre-commit hook.** Expect `package.json` and `package-lock.json` in every commit; that is the mechanism working.
- Amounts are in **nuqta**, resolved from `docs/archive/nuqta-measurements.md` × `fontSize`, px fallback for the two unmeasured faces (HarfCanvasDiwani, Ruqaa).

## Deviation from the spec, decided here

The spec says detection "reuses `lib/svgPath.ts`'s `pathToPolygon`". **It cannot**, and Task 1 does not. `pathToPolygon` returns a single flat `Array<[number, number]>` for the whole path — correct for Shape Fill's silhouettes, wrong for glyphs. A letter with a counter (ه، و، ق، ص) has two or more contours, and concatenating them inserts an implicit segment from one contour's end to the next contour's start. The cut line can cross those phantom segments, which corrupts both the crossing parity check and the thickness measurement.

Task 1 therefore adds a contour-preserving `flattenContours` returning `Pt[][]`, using the same fixed-step subdivision (`steps = 8`) so the two agree wherever they overlap. `pathToPolygon` is left untouched.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/strokeCuts.ts` (new) | All cut geometry: flattening, crossings, legality, zone discovery, outline surgery, plan building. Pure. |
| `src/lib/strokeCuts.test.ts` (new) | Geometry tests on synthetic outlines; shaped-run tests on real fonts. |
| `scripts/measureStrokeZones.mjs` (new) | Offline coverage sweep over all 17 fonts. Kept, not throwaway. |
| `docs/archive/stroke-zone-coverage.md` (new) | The measured coverage table, committed as the gate's evidence. |
| `src/types.ts` | `StrokeCut` type; `strokeCuts?: StrokeCut[]` on `BlockCommon`. |
| `src/components/ShapedText.tsx` | Consume `CutPlan` in both the draw loop and the metrics loop. |
| `src/lib/fitToWidth.ts` | `styledRunWidth` gains the cut-extension term. |
| `src/components/StrokeCutHoverHandles.tsx` (new) | The on-canvas drag overlay. |
| `src/App.tsx` | State, `supportsStrokeCuts` gate, handlers, kashida cluster remap. |
| `src/components/Sidebar.tsx` | "Stretch strokes" checkbox in Typography. |
| `e2e/stroke-cuts.spec.ts` (new) | Drag widens ink; undo reverts; save round-trips. |

---

### Task 1: Outline flattening and cut legality

**Files:**
- Create: `src/lib/strokeCuts.ts`
- Create: `src/lib/strokeCuts.test.ts`

**Interfaces:**
- Consumes: `SvgCmd` from `src/lib/svgPath.ts`.
- Produces: `Pt`, `Contour`, `toSvgCmds`, `flattenContours`, `crossingsAt`, `legalCutAt`, `DetectOpts`, `DEFAULT_DETECT_OPTS`.

- [x] **Step 1: Write the failing test**

```ts
// src/lib/strokeCuts.test.ts
import { describe, it, expect } from "vitest";
import { flattenContours, crossingsAt, legalCutAt } from "./strokeCuts";
import type { SvgCmd } from "./svgPath";

/** A 100x20 horizontal bar — the model of an extendable straight stroke. */
const BAR: SvgCmd[] = [
  { type: "M", x: 0, y: 0 },
  { type: "L", x: 100, y: 0 },
  { type: "L", x: 100, y: 20 },
  { type: "L", x: 0, y: 20 },
  { type: "Z" },
];

/** A bar with a square hole — models a counter, two contours. */
const BAR_WITH_HOLE: SvgCmd[] = [
  ...BAR,
  { type: "M", x: 40, y: 5 },
  { type: "L", x: 60, y: 5 },
  { type: "L", x: 60, y: 15 },
  { type: "L", x: 40, y: 15 },
  { type: "Z" },
];

describe("flattenContours", () => {
  it("keeps contours separate rather than concatenating them", () => {
    expect(flattenContours(BAR)).toHaveLength(1);
    expect(flattenContours(BAR_WITH_HOLE)).toHaveLength(2);
  });
});

describe("crossingsAt", () => {
  it("finds the two horizontal edges of a bar", () => {
    const cs = crossingsAt(flattenContours(BAR), 50);
    expect(cs).toHaveLength(2);
    expect(cs.map((c) => c.y).sort((a, b) => a - b)).toEqual([0, 20]);
    for (const c of cs) expect(Math.abs(c.slope)).toBeLessThan(1e-9);
  });

  it("does not invent a crossing on a phantom segment between contours", () => {
    // x=50 passes through the hole: outer top, hole top, hole bottom, outer
    // bottom = 4 crossings. Concatenating the contours would add a spurious
    // segment from (0,20) to (40,5) and change this count.
    expect(crossingsAt(flattenContours(BAR_WITH_HOLE), 50)).toHaveLength(4);
  });
});

describe("legalCutAt", () => {
  it("accepts a cut through a flat bar and reports its thickness", () => {
    const r = legalCutAt(flattenContours(BAR), 50);
    expect(r.legal).toBe(true);
    expect(r.thickness).toBeCloseTo(20, 6);
  });

  it("rejects a cut through a gap", () => {
    expect(legalCutAt(flattenContours(BAR), 150).legal).toBe(false);
  });

  it("rejects a cut whose crossings are steep", () => {
    const wedge: SvgCmd[] = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 100, y: 80 },
      { type: "L", x: 100, y: 100 },
      { type: "L", x: 0, y: 20 },
      { type: "Z" },
    ];
    expect(legalCutAt(flattenContours(wedge), 50).legal).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/strokeCuts.test.ts`
Expected: FAIL — "Failed to resolve import ./strokeCuts".

- [x] **Step 3: Write minimal implementation**

```ts
// src/lib/strokeCuts.ts
import type { SvgCmd } from "./svgPath";

export type Pt = [number, number];
export type Contour = Pt[];

/** Structural shape of an opentype.js PathCommand, so this module needs no
 *  dependency on opentype.js to accept one. */
type AnyCmd = {
  type: string;
  x?: number; y?: number;
  x1?: number; y1?: number;
  x2?: number; y2?: number;
};

/** Adapt opentype.js commands to this codebase's own SvgCmd union. The two
 *  are structurally identical; this exists so the conversion is one checked
 *  place rather than a cast at each call site. */
export function toSvgCmds(cmds: readonly AnyCmd[]): SvgCmd[] {
  const out: SvgCmd[] = [];
  for (const c of cmds) {
    switch (c.type) {
      case "M": out.push({ type: "M", x: c.x ?? 0, y: c.y ?? 0 }); break;
      case "L": out.push({ type: "L", x: c.x ?? 0, y: c.y ?? 0 }); break;
      case "C": out.push({
        type: "C", x1: c.x1 ?? 0, y1: c.y1 ?? 0,
        x2: c.x2 ?? 0, y2: c.y2 ?? 0, x: c.x ?? 0, y: c.y ?? 0,
      }); break;
      case "Q": out.push({
        type: "Q", x1: c.x1 ?? 0, y1: c.y1 ?? 0, x: c.x ?? 0, y: c.y ?? 0,
      }); break;
      case "Z": out.push({ type: "Z" }); break;
    }
  }
  return out;
}

/**
 * Flatten to one polyline PER CONTOUR.
 *
 * Deliberately not `pathToPolygon`, which returns a single flat list for the
 * whole path. That is right for a Shape Fill silhouette and wrong for a glyph:
 * a letter with a counter has two contours, and concatenating them inserts a
 * phantom segment from one contour's end to the next one's start, which a cut
 * line can cross — corrupting both the crossing parity and the thickness.
 * Same fixed-step subdivision (8) so the two agree where they overlap.
 */
export function flattenContours(cmds: SvgCmd[], steps = 8): Contour[] {
  const contours: Contour[] = [];
  let cur: Contour = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;

  const close = () => {
    if (cur.length > 1) contours.push(cur);
    cur = [];
  };

  for (const cmd of cmds) {
    switch (cmd.type) {
      case "M":
        close();
        cx = sx = cmd.x; cy = sy = cmd.y;
        cur = [[cx, cy]];
        break;
      case "L":
        cx = cmd.x; cy = cmd.y;
        cur.push([cx, cy]);
        break;
      case "C": {
        const x0 = cx, y0 = cy;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps, u = 1 - t;
          cur.push([
            u*u*u*x0 + 3*u*u*t*cmd.x1 + 3*u*t*t*cmd.x2 + t*t*t*cmd.x,
            u*u*u*y0 + 3*u*u*t*cmd.y1 + 3*u*t*t*cmd.y2 + t*t*t*cmd.y,
          ]);
        }
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case "Q": {
        const x0 = cx, y0 = cy;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps, u = 1 - t;
          cur.push([
            u*u*x0 + 2*u*t*cmd.x1 + t*t*cmd.x,
            u*u*y0 + 2*u*t*cmd.y1 + t*t*cmd.y,
          ]);
        }
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case "Z":
        if (cur.length > 0) cur.push([sx, sy]);
        close();
        cx = sx; cy = sy;
        break;
    }
  }
  close();
  return contours;
}

/** One intersection of the vertical line x=cutX with the outline. */
export type Crossing = {
  y: number;
  /** dy/dx of the crossed segment. 0 is parallel to the baseline. */
  slope: number;
};

export function crossingsAt(contours: Contour[], cutX: number): Crossing[] {
  const out: Crossing[] = [];
  for (const c of contours) {
    for (let i = 0; i + 1 < c.length; i++) {
      const [x0, y0] = c[i];
      const [x1, y1] = c[i + 1];
      if (x0 === x1) continue;
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
      // Half-open so a vertex shared by two segments counts once.
      if (cutX < lo || cutX >= hi) continue;
      const t = (cutX - x0) / (x1 - x0);
      out.push({ y: y0 + t * (y1 - y0), slope: (y1 - y0) / (x1 - x0) });
    }
  }
  return out.sort((a, b) => a.y - b.y);
}

export type DetectOpts = {
  /** Max |dy/dx| for a crossed segment to count as parallel to the baseline. */
  maxSlope: number;
  /** Sampling step, font units. */
  step: number;
  /** Thickness must hold within this fraction across a zone. */
  thicknessTolerance: number;
  /** Minimum zone width to be worth offering, font units. */
  minZoneWidth: number;
};

/** Starting values only. Task 3's coverage sweep is what sets these for real. */
export const DEFAULT_DETECT_OPTS: DetectOpts = {
  maxSlope: 0.18,
  step: 10,
  thicknessTolerance: 0.12,
  minZoneWidth: 25,
};

export function legalCutAt(
  contours: Contour[],
  cutX: number,
  opts: DetectOpts = DEFAULT_DETECT_OPTS
): { legal: boolean; thickness: number } {
  const cs = crossingsAt(contours, cutX);
  if (cs.length < 2 || cs.length % 2 !== 0) return { legal: false, thickness: 0 };
  for (const c of cs) {
    if (Math.abs(c.slope) > opts.maxSlope) return { legal: false, thickness: 0 };
  }
  // Thickness is the total ink the line passes through: sum of the spans
  // between successive crossing pairs, so a counter's hole is excluded.
  let thickness = 0;
  for (let i = 0; i + 1 < cs.length; i += 2) thickness += cs[i + 1].y - cs[i].y;
  return { legal: thickness > 0, thickness };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/strokeCuts.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 5: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add src/lib/strokeCuts.ts src/lib/strokeCuts.test.ts
git commit -m "Add stroke-cut geometry: contour flattening and cut legality"
```

---

### Task 2: Zone discovery

**Files:**
- Modify: `src/lib/strokeCuts.ts`
- Modify: `src/lib/strokeCuts.test.ts`

**Interfaces:**
- Consumes: `flattenContours`, `legalCutAt`, `DetectOpts` from Task 1.
- Produces: `CutZone`, `findCutZones(contours, meta, opts?) => CutZone[]`.

- [x] **Step 1: Write the failing test**

```ts
// append to src/lib/strokeCuts.test.ts
import { findCutZones, DEFAULT_DETECT_OPTS } from "./strokeCuts";

describe("findCutZones", () => {
  const meta = { glyphIndex: 3, cluster: 1 };

  it("finds one zone spanning a flat bar", () => {
    const zones = findCutZones(flattenContours(BAR), meta, {
      ...DEFAULT_DETECT_OPTS, step: 5, minZoneWidth: 10,
    });
    expect(zones).toHaveLength(1);
    expect(zones[0].glyphIndex).toBe(3);
    expect(zones[0].cluster).toBe(1);
    expect(zones[0].thickness).toBeCloseTo(20, 1);
    expect(zones[0].toX - zones[0].fromX).toBeGreaterThan(50);
  });

  it("finds no zone on a circle", () => {
    // Every cut through a circle crosses steeply sloped segments.
    const r = 50;
    const pts: SvgCmd[] = [{ type: "M", x: r, y: 0 }];
    for (let i = 1; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pts.push({ type: "L", x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    pts.push({ type: "Z" });
    expect(findCutZones(flattenContours(pts), meta)).toHaveLength(0);
  });

  it("rejects a zone narrower than minZoneWidth", () => {
    const zones = findCutZones(flattenContours(BAR), meta, {
      ...DEFAULT_DETECT_OPTS, step: 5, minZoneWidth: 500,
    });
    expect(zones).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/strokeCuts.test.ts -t findCutZones`
Expected: FAIL — `findCutZones is not a function`.

- [x] **Step 3: Write minimal implementation**

```ts
// append to src/lib/strokeCuts.ts

/** A contiguous run of legal cut positions: one extendable stroke, one handle. */
export type CutZone = {
  glyphIndex: number;
  cluster: number;
  /** Glyph-local x range, font units. */
  fromX: number;
  toX: number;
  /** Ink thickness through the zone — for weight checks and for the UI. */
  thickness: number;
};

export function findCutZones(
  contours: Contour[],
  meta: { glyphIndex: number; cluster: number },
  opts: DetectOpts = DEFAULT_DETECT_OPTS
): CutZone[] {
  let minX = Infinity, maxX = -Infinity;
  for (const c of contours) for (const [x] of c) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  if (!isFinite(minX) || maxX <= minX) return [];

  const zones: CutZone[] = [];
  let runStart: number | null = null;
  let runThickness: number[] = [];

  const flush = (endX: number) => {
    if (runStart === null) return;
    const width = endX - runStart;
    if (width >= opts.minZoneWidth && runThickness.length > 0) {
      const mean = runThickness.reduce((a, b) => a + b, 0) / runThickness.length;
      const spread = Math.max(...runThickness) - Math.min(...runThickness);
      // A zone must hold its weight: a momentary flat on a curve does not
      // count as a straight stroke.
      if (mean > 0 && spread / mean <= opts.thicknessTolerance) {
        zones.push({ ...meta, fromX: runStart, toX: endX, thickness: mean });
      }
    }
    runStart = null;
    runThickness = [];
  };

  for (let x = minX; x <= maxX; x += opts.step) {
    const { legal, thickness } = legalCutAt(contours, x, opts);
    if (legal) {
      if (runStart === null) runStart = x;
      runThickness.push(thickness);
    } else {
      flush(x - opts.step);
    }
  }
  flush(maxX);
  return zones;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/strokeCuts.test.ts`
Expected: PASS, 9 tests.

- [x] **Step 5: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`

- [x] **Step 6: Commit**

```bash
git add src/lib/strokeCuts.ts src/lib/strokeCuts.test.ts
git commit -m "Add stroke-cut zone discovery"
```

---

### Task 3: The coverage sweep — GO/NO-GO GATE

**STOP AFTER THIS TASK.** Report the table and wait for a human decision before starting Task 4. If the naskh faces land near the removed subsystem's 14%, the correct outcome is to stop and rethink, not to build a UI over a detector that finds nothing.

**Files:**
- Create: `scripts/measureStrokeZones.mjs`
- Create: `docs/archive/stroke-zone-coverage.md`

**Interfaces:**
- Consumes: `toSvgCmds`, `flattenContours`, `findCutZones`, `DEFAULT_DETECT_OPTS`.
- Produces: the measured table, and tuned `DEFAULT_DETECT_OPTS` values if the sweep shows the starting ones are wrong.

- [x] **Step 1: Write the script**

**The sketch below is what Step 1 originally wrote, kept for the historical
record of how this task was planned. It is not what shipped.** Its
`connectorPct`/join computation was found to score the wrong population
(every adjacent glyph pair rather than the positions where a tatweel is
actually legal, which is what the gate in this task's own header specifies)
and was rewritten twice more after that — see `docs/archive/stroke-zone-coverage.md`'s
own revision history for what changed and why, and read that file rather
than this code block for the script's actual current behaviour.

```js
// scripts/measureStrokeZones.mjs
// Coverage sweep for straight-stroke extension. Kept, not throwaway — the
// same reasoning that keeps measureNuqta.py: it is the other half of
// "don't redo the work". Run: node scripts/measureStrokeZones.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as opentype from "opentype.js";

const require = createRequire(import.meta.url);
const hbjs = require("harfbuzzjs");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(DIR, "../public/fonts");

const LETTERS = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي".split("");
const WORDS = ["حرف", "محمد", "بسم", "سلام", "كتاب"];

// tsx runs the TS module directly; see step 2 for how this is invoked.
const { toSvgCmds, flattenContours, findCutZones, DEFAULT_DETECT_OPTS } =
  await import("../src/lib/strokeCuts.ts");

async function resolveHb(mod) {
  let m = mod;
  while (m && typeof m === "object" && m.default !== undefined) m = m.default;
  if (typeof m === "function") return m();
  return m;
}

async function shape(hb, fontData, upm, text) {
  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();
  try {
    font.setScale?.(upm, upm);
    buffer.addText(text);
    buffer.guessSegmentProperties?.();
    buffer.setDirection?.("rtl");
    buffer.setScript?.("arab");
    buffer.setLanguage?.("ar");
    hb.shape(font, buffer, "");
    return buffer.json?.(font) ?? [];
  } finally {
    buffer.destroy?.(); font.destroy?.(); face.destroy?.(); blob.destroy?.();
  }
}

const hb = await resolveHb(hbjs);
const files = fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f));
const rows = [];

for (const file of files) {
  const bytes = fs.readFileSync(path.join(FONT_DIR, file));
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const parsed = opentype.parse(ab);
  const upm = parsed.unitsPerEm || 1000;
  const opts = { ...DEFAULT_DETECT_OPTS, step: upm / 100, minZoneWidth: upm / 40 };

  let lettersWithZone = 0, totalZones = 0;
  const widths = [];

  for (const ch of LETTERS) {
    const glyphs = await shape(hb, bytes, upm, ch);
    let has = false;
    for (const g of glyphs) {
      const cmds = toSvgCmds(parsed.glyphs.get(g.g).getPath(0, 0, upm).commands);
      const zones = findCutZones(flattenContours(cmds), { glyphIndex: 0, cluster: 0 }, opts);
      if (zones.length) { has = true; totalZones += zones.length; }
      for (const z of zones) widths.push((z.toX - z.fromX) / upm);
    }
    if (has) lettersWithZone++;
  }

  let connectorSlots = 0, connectorZones = 0;
  for (const w of WORDS) {
    const glyphs = await shape(hb, bytes, upm, w);
    connectorSlots += Math.max(0, glyphs.length - 1);
    for (const g of glyphs) {
      const cmds = toSvgCmds(parsed.glyphs.get(g.g).getPath(0, 0, upm).commands);
      if (findCutZones(flattenContours(cmds), { glyphIndex: 0, cluster: 0 }, opts).length) {
        connectorZones++;
      }
    }
  }

  widths.sort((a, b) => a - b);
  rows.push({
    font: file,
    letterPct: Math.round((lettersWithZone / LETTERS.length) * 100),
    totalZones,
    medianEm: widths.length ? widths[Math.floor(widths.length / 2)].toFixed(3) : "-",
    connectorPct: connectorSlots ? Math.round((connectorZones / connectorSlots) * 100) : 0,
  });
}

console.log("| Font | letters with a zone | zones | median zone (em) | connector positions |");
console.log("|---|---|---|---|---|");
for (const r of rows) {
  console.log(`| ${r.font} | ${r.letterPct}% | ${r.totalZones} | ${r.medianEm} | ${r.connectorPct}% |`);
}
```

- [x] **Step 2: Run the sweep**

Run: `npx tsx scripts/measureStrokeZones.mjs`

(`tsx` is needed because the script imports a `.ts` module. If it is not present, run `npx --yes tsx scripts/measureStrokeZones.mjs`.)

Expected: a markdown table, 17 rows, no exceptions.

- [x] **Step 3: Tune the detector if the sweep says to**

If Amiri/Scheherazade/NotoSans/Kufi come in far below the gate, try `maxSlope` at 0.25 and 0.35 and re-run before concluding anything. Record which value produced the table you report. **Do not tune past the point where zones appear on obviously curved letters** (ن، س tails) — that is the detector lying, and it is exactly the failure the old subsystem shipped.

- [x] **Step 4: Write the coverage record**

Create `docs/archive/stroke-zone-coverage.md` containing: the date, the `DetectOpts` used, the full table, and a one-paragraph verdict against the gate.

- [x] **Step 5: Commit**

```bash
git add scripts/measureStrokeZones.mjs docs/archive/stroke-zone-coverage.md
git commit -m "Measure straight-stroke coverage across the font library"
```

- [x] **Step 6: STOP and report**

Report the table against the gate: **≥60%** of base letters on Amiri, Scheherazade, NotoSans and Kufi, and **≥80%** of connector positions. Wait for a human go/no-go.

---

### Task 4: Outline surgery

**Files:**
- Modify: `src/lib/strokeCuts.ts`
- Modify: `src/lib/strokeCuts.test.ts`

**Interfaces:**
- Consumes: `SvgCmd`, `flattenContours`, `legalCutAt`.
- Produces: `ResolvedCut = { cutX: number; d: number }`, `applyCutsToCommands(cmds, cuts) => SvgCmd[]`.

- [x] **Step 1: Write the failing test**

```ts
// append to src/lib/strokeCuts.test.ts
import { applyCutsToCommands } from "./strokeCuts";

function extentX(cmds: SvgCmd[]): number {
  let min = Infinity, max = -Infinity;
  for (const c of flattenContours(cmds)) for (const [x] of c) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return max - min;
}

describe("applyCutsToCommands", () => {
  it("widens the bar by exactly the cut distance", () => {
    const out = applyCutsToCommands(BAR, [{ cutX: 50, d: 30 }]);
    expect(extentX(out)).toBeCloseTo(130, 6);
  });

  it("preserves stroke weight across the bridge", () => {
    const out = applyCutsToCommands(BAR, [{ cutX: 50, d: 30 }]);
    // Sample inside the inserted span: thickness must be unchanged.
    const before = legalCutAt(flattenContours(BAR), 50);
    const after = legalCutAt(flattenContours(out), 65);
    expect(after.legal).toBe(true);
    expect(after.thickness).toBeCloseTo(before.thickness, 6);
  });

  it("leaves geometry before the cut untouched", () => {
    const out = applyCutsToCommands(BAR, [{ cutX: 50, d: 30 }]);
    expect(legalCutAt(flattenContours(out), 10).thickness).toBeCloseTo(20, 6);
  });

  it("splits a curve that crosses the cut", () => {
    const flat: SvgCmd[] = [
      { type: "M", x: 0, y: 0 },
      { type: "C", x1: 33, y1: 1, x2: 66, y2: 1, x: 100, y: 0 },
      { type: "L", x: 100, y: 20 },
      { type: "C", x1: 66, y1: 21, x2: 33, y2: 21, x: 0, y: 20 },
      { type: "Z" },
    ];
    const out = applyCutsToCommands(flat, [{ cutX: 50, d: 40 }]);
    expect(extentX(out)).toBeCloseTo(140, 1);
  });

  it("applies multiple cuts without the earlier one shifting the later", () => {
    const out = applyCutsToCommands(BAR, [{ cutX: 25, d: 10 }, { cutX: 75, d: 10 }]);
    expect(extentX(out)).toBeCloseTo(120, 6);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/strokeCuts.test.ts -t applyCutsToCommands`
Expected: FAIL — not a function.

- [x] **Step 3: Write minimal implementation**

```ts
// append to src/lib/strokeCuts.ts

export type ResolvedCut = {
  /** Cut position in the same space as the commands. */
  cutX: number;
  /** Distance to open, same units. */
  d: number;
};

/** Split a cubic at t, returning [left, right] control points. */
function splitCubic(
  p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number
): [[Pt, Pt, Pt, Pt], [Pt, Pt, Pt, Pt]] {
  const lerp = (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const a = lerp(p0, p1), b = lerp(p1, p2), c = lerp(p2, p3);
  const d = lerp(a, b), e = lerp(b, c);
  const f = lerp(d, e);
  return [[p0, a, d, f], [f, e, c, p3]];
}

/** Find t where a cubic crosses x=cutX, by bisection. Monotone-x assumed,
 *  which validity guarantees: a legal crossing is near-parallel, so the
 *  segment runs along x rather than doubling back. */
function tAtX(p0: Pt, p1: Pt, p2: Pt, p3: Pt, cutX: number): number {
  const at = (t: number) => {
    const u = 1 - t;
    return u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0];
  };
  let lo = 0, hi = 1;
  const rising = at(1) >= at(0);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const v = at(mid);
    if ((v < cutX) === rising) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Open the outline by `d` at each cut. Points past the cut move; points
 * before it do not; a segment straddling the cut is split at the crossing
 * and its far half translated, so the bridge is a straight edge at the
 * stroke's own weight.
 *
 * Cuts are applied from the HIGHEST cutX down, so an earlier application
 * never shifts a later cut's position — the same reason `applyDistribution`
 * in fitToWidth.ts walks its slots from the highest text offset down.
 */
export function applyCutsToCommands(cmds: SvgCmd[], cuts: ResolvedCut[]): SvgCmd[] {
  let out = cmds;
  for (const cut of [...cuts].sort((a, b) => b.cutX - a.cutX)) {
    out = applyOneCut(out, cut);
  }
  return out;
}

function applyOneCut(cmds: SvgCmd[], { cutX, d }: ResolvedCut): SvgCmd[] {
  const shift = (x: number) => (x >= cutX ? x + d : x);
  const out: SvgCmd[] = [];
  let cx = 0, cy = 0;

  for (const cmd of cmds) {
    switch (cmd.type) {
      case "M":
        out.push({ type: "M", x: shift(cmd.x), y: cmd.y });
        cx = cmd.x; cy = cmd.y;
        break;
      case "L": {
        const crosses = (cx < cutX) !== (cmd.x < cutX);
        if (crosses) {
          const t = (cutX - cx) / (cmd.x - cx);
          const my = cy + t * (cmd.y - cy);
          // Land on the cut, bridge across it, then continue.
          out.push({ type: "L", x: shift(cx < cutX ? cutX : cutX + d), y: my });
          out.push({ type: "L", x: shift(cx < cutX ? cutX : cutX), y: my });
        }
        out.push({ type: "L", x: shift(cmd.x), y: cmd.y });
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case "C": {
        const p0: Pt = [cx, cy];
        const p1: Pt = [cmd.x1, cmd.y1];
        const p2: Pt = [cmd.x2, cmd.y2];
        const p3: Pt = [cmd.x, cmd.y];
        const crosses = (cx < cutX) !== (cmd.x < cutX);
        if (crosses) {
          const t = tAtX(p0, p1, p2, p3, cutX);
          const [L, R] = splitCubic(p0, p1, p2, p3, t);
          const sh = (p: Pt): Pt => [shift(p[0]), p[1]];
          out.push({ type: "C", x1: sh(L[1])[0], y1: L[1][1], x2: sh(L[2])[0], y2: L[2][1], x: sh(L[3])[0], y: L[3][1] });
          out.push({ type: "L", x: shift(R[0][0]) + (cx < cutX ? d : 0), y: R[0][1] });
          out.push({ type: "C", x1: shift(R[1][0]) + (cx < cutX ? d : 0), y1: R[1][1], x2: shift(R[2][0]) + (cx < cutX ? d : 0), y2: R[2][1], x: shift(R[3][0]), y: R[3][1] });
        } else {
          out.push({ type: "C", x1: shift(cmd.x1), y1: cmd.y1, x2: shift(cmd.x2), y2: cmd.y2, x: shift(cmd.x), y: cmd.y });
        }
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case "Q":
        out.push({ type: "Q", x1: shift(cmd.x1), y1: cmd.y1, x: shift(cmd.x), y: cmd.y });
        cx = cmd.x; cy = cmd.y;
        break;
      case "Z":
        out.push({ type: "Z" });
        break;
    }
  }
  return out;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/strokeCuts.test.ts`
Expected: PASS. If the curve-splitting case fails, the bug is almost certainly in the bridge-insertion arithmetic in the `C` branch — fix it there rather than loosening the assertion, since "widens by exactly `d`" is the property the whole feature rests on.

- [x] **Step 5: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`

- [x] **Step 6: Commit**

```bash
git add src/lib/strokeCuts.ts src/lib/strokeCuts.test.ts
git commit -m "Add stroke-cut outline surgery with bezier splitting"
```

---

### Task 5: The cut plan, and the assertion the whole feature rests on

**Files:**
- Modify: `src/lib/strokeCuts.ts`
- Modify: `src/lib/strokeCuts.test.ts`

**Interfaces:**
- Consumes: `HarfBuzzGlyph` from `src/lib/normalizeGlyphs.ts`; `StrokeCut` (declared here, moved to `types.ts` in Task 6).
- Produces: `CutPlan`, `buildCutPlan(glyphs, cuts, upm, fontSize) => CutPlan`.

- [x] **Step 1: Write the failing test — real fonts, real harfbuzzjs**

Copy the `shapeReal` helper and its `resolveHbLoader`/`HbModule` scaffolding verbatim from `src/lib/diacritics.test.ts` into `src/lib/strokeCuts.test.ts`, then:

```ts
// append to src/lib/strokeCuts.test.ts
import { buildCutPlan } from "./strokeCuts";

const FONTS = ["Amiri.ttf", "Scheherazade.ttf", "NotoSans.ttf"];

describe("a cut really widens the run", () => {
  it.each(FONTS)("total advance grows with cut distance in %s", async (file) => {
    const { glyphs, font } = await shapeReal("حرف", file);
    const upm = font.unitsPerEm || 1000;

    const widths = [0, 40, 80, 160].map((d) => {
      const plan = buildCutPlan(
        glyphs,
        d === 0 ? [] : [{ cluster: glyphs[0].cl ?? 0, localX: upm / 4, nuqta: 0, _dOverride: d }],
        upm,
        upm
      );
      return plan.addedAdvance;
    });

    // Strictly increasing. This is tatweel.test.ts's bar, and its absence is
    // why an inert feature shipped once. A fixture-based version of this test
    // would restate the assumption instead of testing it.
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
  });

  it("shifts only glyphs past the cut", async () => {
    const { glyphs, font } = await shapeReal("حرف", file0());
    const upm = font.unitsPerEm || 1000;
    const plan = buildCutPlan(glyphs, [], upm, upm);
    expect(plan.shift.every((s) => s === 0)).toBe(true);
    expect(plan.addedAdvance).toBe(0);
  });
});

function file0() { return "Amiri.ttf"; }
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/strokeCuts.test.ts -t "really widens"`
Expected: FAIL — `buildCutPlan is not a function`.

- [x] **Step 3: Write minimal implementation**

```ts
// append to src/lib/strokeCuts.ts
import type { HarfBuzzGlyph } from "./normalizeGlyphs";

export type StrokeCut = {
  cluster: number;
  localX: number;
  glyphId?: number;
  nuqta: number;
  /** Test-only escape hatch: an absolute distance in font units, bypassing
   *  the nuqta conversion. Never written by the app. */
  _dOverride?: number;
};

export type CutPlan = {
  /** Extra x per glyph index, font units. */
  shift: number[];
  /** Cuts landing inside a glyph, keyed by glyph index, in glyph-local x. */
  surgery: Map<number, ResolvedCut[]>;
  /** Total width the run gained. */
  addedAdvance: number;
};

/**
 * Resolve cuts against a shaped run.
 *
 * `nuqtaRatio * fontSize` is the distance one nuqta represents; callers pass
 * it already multiplied out as `nuqtaUnits`. A cut whose cluster matches no
 * glyph is dropped rather than applied to the wrong letter.
 */
export function buildCutPlan(
  glyphs: HarfBuzzGlyph[],
  cuts: StrokeCut[],
  nuqtaUnits: number,
  _fontSize: number
): CutPlan {
  const shift = new Array(glyphs.length).fill(0);
  const surgery = new Map<number, ResolvedCut[]>();
  let addedAdvance = 0;

  // Pen positions so "past the cut" can be decided in pen order, which is
  // the only unambiguous axis for an RTL run.
  const penAt: number[] = [];
  let pen = 0;
  for (const g of glyphs) { penAt.push(pen); pen += g.ax ?? 0; }

  for (const cut of cuts) {
    const idx = glyphs.findIndex((g) => (g.cl ?? -1) === cut.cluster);
    if (idx < 0) continue;
    if (cut.glyphId !== undefined && glyphs[idx].g !== cut.glyphId) continue;

    const d = cut._dOverride ?? cut.nuqta * nuqtaUnits;
    if (!(d > 0)) continue;

    const list = surgery.get(idx) ?? [];
    list.push({ cutX: cut.localX, d });
    surgery.set(idx, list);

    for (let i = idx + 1; i < glyphs.length; i++) shift[i] += d;
    addedAdvance += d;
  }

  return { shift, surgery, addedAdvance };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/strokeCuts.test.ts`
Expected: PASS in all three fonts.

- [x] **Step 5: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`

- [x] **Step 6: Commit**

```bash
git add src/lib/strokeCuts.ts src/lib/strokeCuts.test.ts
git commit -m "Add cut plan building, with the run-really-widens assertion"
```

---

### Task 6: Storage, types and the edit gate

**Files:**
- Modify: `src/types.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `StrokeCut` from `src/lib/strokeCuts.ts`.
- Produces: `strokeCuts?: StrokeCut[]` and `strokeCutEditMode?: boolean` on `BlockCommon`; `supportsStrokeCuts(b)`; `setStrokeCut`, `clearStrokeCuts` handlers.

- [x] **Step 1: Add the type and field**

In `src/types.ts`, re-export the type beside the existing `BlockFill` re-export and add both fields to `BlockCommon`:

```ts
export type { StrokeCut } from "./lib/strokeCuts";

// inside BlockCommon:
  /** Straight-stroke extensions. Absent means none — a project saved before
   *  this feature renders byte-identically. Text blocks only; the field lives
   *  on BlockCommon the way glyphTransforms does. */
  strokeCuts?: StrokeCut[];
  /** Arms the on-canvas stretch handles. */
  strokeCutEditMode?: boolean;
```

- [x] **Step 2: Add the gate and handlers in `App.tsx`**

Place these beside `supportsGlyphTransforms`. **The guard must be exactly this** — a narrower one type-checks perfectly while silently discarding every edit, which is the trap CLAUDE.md records for `supportsDiacriticOverrides`:

```ts
const supportsStrokeCuts = (b: Block): boolean => b.type === "text";

const setStrokeCut = useCallback((cut: StrokeCut) => {
  const b = blocks.find((x) => x.id === selectedId);
  if (!b || !supportsStrokeCuts(b)) return;
  pushHistory();
  const rest = (b.strokeCuts ?? []).filter(
    (c) => !(c.cluster === cut.cluster && c.localX === cut.localX)
  );
  updateBlock(b.id, {
    strokeCuts: cut.nuqta > 0 ? [...rest, cut] : rest,
  });
}, [blocks, selectedId, pushHistory, updateBlock]);

const clearStrokeCuts = useCallback(() => {
  const b = blocks.find((x) => x.id === selectedId);
  if (!b || !supportsStrokeCuts(b)) return;
  pushHistory();
  updateBlock(b.id, { strokeCuts: [] });
}, [blocks, selectedId, pushHistory, updateBlock]);
```

Both must be defined **above** any `useEffect`/`useCallback` that references them — handlers in `App.tsx` close over each other by declaration order, and moving one below its consumer produces a used-before-declaration error.

- [x] **Step 3: Verify the round-trip by hand**

Run `npm run dev`, add a text block, and in the console:

```js
__HARF__.getBlocks()[0].strokeCuts
```

Expected: `undefined` on a fresh block. Save a project, reload, load it back, and confirm no console errors — the payload version stays 5 because an absent field needs no migration.

- [x] **Step 4: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`

- [x] **Step 5: Commit**

```bash
git add src/types.ts src/App.tsx
git commit -m "Add strokeCuts to the block model, with a text-only edit gate"
```

---

### Task 7: Render integration

**Files:**
- Modify: `src/components/ShapedText.tsx`
- Modify: `src/lib/fitToWidth.ts`

**Interfaces:**
- Consumes: `buildCutPlan`, `applyCutsToCommands`, `toSvgCmds`.
- Produces: a `cutPlan` memo consumed by both loops; `styledRunWidth` gains a cut term.

- [x] **Step 0: Restore the per-font nuqta table**

Nothing in Tasks 1-6 produces `nuqtaUnits`; `buildCutPlan` takes it as a
parameter and every caller so far passed a test value. Create
`src/lib/nuqta.ts` from the measured table in
`docs/archive/nuqta-measurements.md` — **copy the ratios, never re-derive
them**, that file exists precisely so this is not re-measured:

```ts
/** Measured dot/em ratios. Source: docs/archive/nuqta-measurements.md, where
 *  each was measured two independent ways and cross-checked by eye. The
 *  intuitive "alif stem is one nuqta" rule fails across this library by up to
 *  3.2x, which is why these are per-font and never derived. */
const NUQTA_RATIO: Record<string, number> = {
  AlFatemi: 0.0973, Amiri: 0.135, FatemiMaqala: 0.1138, Kufi: 0.121,
  Kufi2: 0.116, Lateef: 0.1016, NotoSans: 0.099, Qahiri: 0.1067,
  Scheherazade: 0.1118, TahaNaskhRegular: 0.1157, Thuluth: 0.0918,
  ThuluthDeco: 0.0918, Urdu: 0.1538, Wessam: 0.0762, Yekan: 0.1348,
};

/** Fallback for the two faces the archive does not cover (HarfCanvasDiwani,
 *  Ruqaa) and for any uploaded font, which can never have a measured entry.
 *  The library's own median. */
const FALLBACK_RATIO = 0.11;

/** One nuqta, in the same units as a glyph path drawn at `fontSize`. */
export function nuqtaUnits(fontFamily: string, fontSize: number): number {
  return (NUQTA_RATIO[fontFamily] ?? FALLBACK_RATIO) * fontSize;
}
```

Add `src/lib/nuqta.test.ts` asserting every bundled family key in
`FONT_URLS` resolves to a positive number, and that an unknown family falls
back rather than returning `undefined` — a silent `undefined` here would
make every cut zero-width and the feature would look broken rather than
mis-sized.

- [x] **Step 1: Build the plan once, in a memo**

In `ShapedText.tsx`, beside the existing metrics memo:

```ts
const cutPlan = useMemo(
  () => buildCutPlan(glyphs, strokeCuts ?? [], nuqtaUnits, fontSize),
  [glyphs, strokeCuts, nuqtaUnits, fontSize]
);
```

- [x] **Step 2: Use it in the draw loop**

At the `gx` computation (currently line ~160), add the shift; at the command mapping (line ~211), apply surgery before the existing warp mapping:

```ts
const gx = (penX + (g.dx ?? 0) + cutPlan.shift[i]) * scale;
// ...
const opPath = glyphObj.getPath(0, 0, fontSize);
const cutsHere = cutPlan.surgery.get(i);
const baseCmds = cutsHere
  ? applyCutsToCommands(toSvgCmds(opPath.commands), cutsHere)
  : toSvgCmds(opPath.commands);
```

Then map `baseCmds` through the existing warp logic instead of `opPath.commands`.

- [x] **Step 3: Use it in the metrics loop**

At line ~419, apply the same `cutPlan.shift[i]` to `gx`, and box the surgically modified path so `bounds` reflects the real ink. `bounds` growing is what makes snapping, alignment and Fit to width see the true width.

- [x] **Step 4: Add the fifth term to `styledRunWidth`**

In `src/lib/fitToWidth.ts`, beside the italic-shear, faux-bold, stroke-width and warp terms:

```ts
// Cuts add width the shaping measurement cannot see: they are geometry, not
// characters. Without this term a fit promises a width a stretched block
// then visibly exceeds — the exact bug this term list exists to prevent.
const cutTerm = (block.strokeCuts ?? []).reduce((sum, c) => sum + c.nuqta * nuqtaUnits, 0);
```

- [x] **Step 5: Verify the loops agree**

There is no UI yet, so verify at the unit level rather than by eye — visual
confirmation is Task 8, Step 3. Add to `src/lib/strokeCuts.test.ts`:

```ts
it("a cut grows the measured extent by the cut distance", async () => {
  const { glyphs, font } = await shapeReal("حرف", "Amiri.ttf");
  const upm = font.unitsPerEm || 1000;
  const plan = buildCutPlan(
    glyphs,
    [{ cluster: glyphs[0].cl ?? 0, localX: upm / 4, nuqta: 0, _dOverride: 100 }],
    upm, upm
  );
  expect(plan.addedAdvance).toBeCloseTo(100, 6);
  // Every glyph after the cut moved by exactly that much, and none before it.
  expect(plan.shift[0]).toBe(0);
  expect(plan.shift[plan.shift.length - 1]).toBeCloseTo(100, 6);
});
```

Run: `npx vitest run src/lib/strokeCuts.test.ts` — expected PASS.

- [x] **Step 6: Run the full verification loop and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
git add src/components/ShapedText.tsx src/lib/fitToWidth.ts
git commit -m "Render stroke cuts in both of ShapedText's glyph loops"
```

---

### Task 8: The drag handles

**Files:**
- Create: `src/components/StrokeCutHoverHandles.tsx`
- Modify: `src/components/ShapedText.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `CutZone`, `findCutZones`, `setStrokeCut` from Task 6, `projectOntoAxis` from `src/lib/dragAxis.ts`.
- Produces: `<StrokeCutHoverHandles zones onSetCut armed />`.

- [x] **Step 1: Write the component**

Three rules, each of which this codebase has already paid for once:

```tsx
// Hover handlers go on the per-zone Group, NEVER on the hit Rect. Konva
// fires mouseleave on the old target and suppresses it only at an ANCESTOR
// of the newly-entered shape. With handlers on the Rect, a mounted handle
// covering the pointer makes the next mousemove a genuine Rect->Circle
// leave: hover clears, the handle unmounts, and it is present on exactly
// every other frame. Measured — see CLAUDE.md, "End-to-end tests".
<Group
  onMouseEnter={() => setHovered(key)}
  onMouseLeave={() => setHovered(null)}
>
  <Rect {...hitBox} />
  {hovered === key && <Circle {...handle} draggable dragBoundFunc={rail} />}
</Group>
```

- Mount **after** `GlyphTransformHoverHandles` and **before** `DiacriticHoverHandles` in `ShapedText`'s JSX. Konva routes to the topmost listening shape and later siblings are on top; a zone is a slice of a glyph and a mark is smaller still, so this ordering is largest → smallest.
- Drag rail via `projectOntoAxis` from `src/lib/dragAxis.ts`.
- History via `useDebouncedHistoryPush`, matching block dragging.
- Snap the dragged distance to half-nuqta unless `e.evt.altKey`.

- [x] **Step 2: Mount it and add the checkbox**

In `Sidebar.tsx`'s Typography panel, beside "Move & scale glyph":

```tsx
<CheckboxRow
  label="Stretch strokes"
  checked={!!selectedBlock.strokeCutEditMode}
  onChange={(v) => onUpdateSelectedBlock({ strokeCutEditMode: v })}
/>
```

Gate it on `selectedBlock.type === "text"`, matching the Move & scale row beside it.

- [x] **Step 3: Verify by hand**

`npm run dev` → add a text block with `حرف` in Amiri → select it → tick "Stretch strokes" → hover a letter. A handle should appear on each detected zone and dragging it should widen the run. Confirm the handle does **not** flicker as the pointer moves across it — if it does, the handlers are on the Rect.

- [x] **Step 4: Run the full verification loop and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
git add src/components/StrokeCutHoverHandles.tsx src/components/ShapedText.tsx src/components/Sidebar.tsx
git commit -m "Add on-canvas stroke-stretch handles"
```

---

### Task 9: Kashida cluster remapping

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/lib/strokeCuts.test.ts`

**Interfaces:**
- Consumes: `applyKashida` from `src/lib/tatweel.ts`, `StrokeCut`.
- Produces: `remapCutsAfterInsert(cuts, atOffset, inserted) => StrokeCut[]`.

- [x] **Step 1: Write the failing test**

```ts
// append to src/lib/strokeCuts.test.ts
import { remapCutsAfterInsert } from "./strokeCuts";

describe("remapCutsAfterInsert", () => {
  it("shifts cuts after the insertion point and leaves earlier ones alone", () => {
    const cuts = [
      { cluster: 0, localX: 10, nuqta: 1 },
      { cluster: 5, localX: 10, nuqta: 1 },
    ];
    const out = remapCutsAfterInsert(cuts, 2, 3);
    expect(out[0].cluster).toBe(0);
    expect(out[1].cluster).toBe(8);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/strokeCuts.test.ts -t remapCutsAfterInsert`

- [x] **Step 3: Implement, and wire it into `setKashidaAtSlot`**

```ts
// src/lib/strokeCuts.ts
/** A tatweel insertion rewrites the text, so every source offset after it
 *  moves — and cuts are keyed by cluster. applyKashida knows exactly where
 *  and how much, so remap rather than letting the glyphId checksum drop the
 *  cuts silently. */
export function remapCutsAfterInsert(
  cuts: StrokeCut[], atOffset: number, inserted: number
): StrokeCut[] {
  return cuts.map((c) =>
    c.cluster >= atOffset ? { ...c, cluster: c.cluster + inserted } : c
  );
}
```

In `App.tsx`'s `setKashidaAtSlot`, compute the length delta between the old and new text and pass `strokeCuts: remapCutsAfterInsert(b.strokeCuts ?? [], slot.index, delta)` in the same `updateSelectedBlock` patch, so one `pushHistory()` still covers the whole edit.

- [x] **Step 4: Verify and commit**

```bash
npx vitest run src/lib/strokeCuts.test.ts
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
git add src/lib/strokeCuts.ts src/lib/strokeCuts.test.ts src/App.tsx
git commit -m "Remap stroke cuts when a kashida shifts the text"
```

---

### Task 10: End-to-end coverage and documentation

**Files:**
- Create: `e2e/stroke-cuts.spec.ts`
- Create: `src/components/guide/sections/stretching.tsx`
- Modify: `CLAUDE.md`, `PROGRESS.md`

**Interfaces:**
- Consumes: `gotoApp`, `inkPixels`, `dragFromHere` from `e2e/harf.ts`.

- [x] **Step 1: Write the e2e spec**

Read `e2e/harf.ts` first and use its real helper names; the sketch below
assumes `gotoApp`, `addTextBlock`, `inkPixels`, `dragFromHere` and
`stageNodeBox` exist with those signatures, and any that differ must be
adapted rather than added to.

```ts
// e2e/stroke-cuts.spec.ts
import { test, expect } from "@playwright/test";
import { gotoApp, addTextBlock, inkPixels, dragFromHere } from "./harf";

/** Arms the tool and returns the first zone handle's page coordinates. */
async function armAndFindHandle(page) {
  await page.getByLabel(/Stretch strokes/).check();
  const box = await page.evaluate(() => {
    const stage = window.__HARF__.getStage();
    const node = stage.findOne(".stroke-cut-zone");
    if (!node) return null;
    const r = node.getClientRect();
    const c = stage.container().getBoundingClientRect();
    return { x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2 };
  });
  expect(box, "no stroke-cut zone was detected on حرف in the default font").not.toBeNull();
  return box;
}

test("dragging a stroke handle widens the run", async ({ page }) => {
  await gotoApp(page);
  await addTextBlock(page, "حرف");
  const handle = await armAndFindHandle(page);

  const before = await inkPixels(page);
  await dragFromHere(page, handle, { dx: 40, dy: 0 });
  const after = await inkPixels(page);

  expect(after.width).toBeGreaterThan(before.width);
});

test("undo reverts a stretch", async ({ page }) => {
  await gotoApp(page);
  await addTextBlock(page, "حرف");
  const handle = await armAndFindHandle(page);
  const before = await inkPixels(page);

  await dragFromHere(page, handle, { dx: 40, dy: 0 });
  expect((await inkPixels(page)).width).toBeGreaterThan(before.width);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await inkPixels(page)).width)
    .toBeLessThanOrEqual(before.width);
});

test("a saved project round-trips its cuts", async ({ page }) => {
  await gotoApp(page);
  await addTextBlock(page, "حرف");
  const handle = await armAndFindHandle(page);
  await dragFromHere(page, handle, { dx: 40, dy: 0 });

  const saved = await page.evaluate(() => window.__HARF__.getBlocks()[0].strokeCuts);
  expect(saved?.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: /Save project/ }).click();
  await page.reload();
  await page.getByRole("button", { name: /Load/ }).first().click();

  const loaded = await page.evaluate(() => window.__HARF__.getBlocks()[0].strokeCuts);
  expect(loaded).toEqual(saved);
});
```

Two things that will otherwise cost an afternoon:

- **Drag in interpolated steps, never one jump.** Konva suppresses hover
  retargeting only once a drag reaches `dragging` rather than `ready`, so a
  small first step unmounts the handle mid-gesture and the drag continues
  attached to an orphan. `dragFromHere` already does 24 steps for exactly
  this reason — measured at the app's default 2.75x zoom, first steps of 2px
  and 10px lost the handle while 20px and 40px completed.
- **Name the zone node** `.stroke-cut-zone` in Task 8 so `findOne` can reach
  it. If Task 8 used a different name, use that one here rather than adding
  a second.

- [x] **Step 2: Run the e2e suite**

Run: `npx tsc --noEmit -p e2e/tsconfig.json && npm run e2e`
Expected: all pass, including the 54 that existed before.

- [x] **Step 3: Write the guide section**

`src/components/guide/sections/stretching.tsx`, a plain TSX component exporting a `GuideSection` with `order: 55` and `keywords` a calligrapher would actually type — "kashida", "madd", "elongation", "stretch", "extend", "tatweel". Dropping the file in `sections/` is the whole integration step; there is no index to edit.

Say plainly that not every letter in every font offers a handle, and why.

- [x] **Step 4: Document it**

Add a "Straight-stroke extension" section to `CLAUDE.md` after "Kashida elongation", covering: the cut model, the legality predicate, why `flattenContours` exists rather than `pathToPolygon`, cluster keying, the broken reflow invariant, and the measured coverage. Add a dated `PROGRESS.md` entry under Shipped linking to it rather than restating it.

- [x] **Step 5: Final verification and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
npx tsc --noEmit -p e2e/tsconfig.json && npm run e2e
git add -A
git commit -m "Add stroke-stretch e2e coverage, guide section and docs"
```

---

## Open items carried from the spec

- **`maxSlope`, `step`, `thicknessTolerance` and `minZoneWidth`** have starting values in `DEFAULT_DETECT_OPTS` chosen to be plausible, not measured. Task 3 sets them for real, and whichever values produced the reported table must be the ones committed.
- **One handle per zone or two** (extend from either end) is left to Task 8. The data model supports either, since a cut is a position plus a distance rather than an edge.
- **Whether tatweel kashida is retired** is not decided by this plan and no task removes it. That is a separate decision, gated on comparing the two mechanisms once both exist.
