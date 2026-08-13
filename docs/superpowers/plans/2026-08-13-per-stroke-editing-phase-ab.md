# Per-stroke editing, Phases A and B — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop stretch handles from overshooting and from tearing letter joins, and make stretch read in calligraphers' nuqta units — i.e. changes 3, 5 and 1 of the approved design.

**Architecture:** Three self-contained pure modules (`lib/nuqta.ts`, `lib/strokeSchema/quantize.ts`, `lib/joinPins.ts`) plus one shared formula module (`lib/kashidaFactor.ts`), consumed by the existing displacement engine (`lib/glyphEdits.ts`), the single factor funnel (`App.tsx`'s `setStretchFactor`), and the two renderers/measurers that walk a shaped run (`ShapedText.tsx`, `lib/justify.ts`). No renderer's drawing loop is restructured: the axis math gains a clamp, `applyGlyphEdit` gains one optional trailing parameter, and everything else is new code behind it.

**Tech Stack:** React 19 + TypeScript + Vite, Konva/react-konva, HarfBuzz via `harfbuzzjs` WASM, `opentype.js`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-12-per-stroke-editing-design.md` — read it first, including its "Implementation notes" section. This plan implements its Phase A (changes 3 and 5) and Phase B (change 1). Phases C and D are deliberately **not** planned here: C is an investigation that gates D.

## Global Constraints

- **Regression bar (spec success criterion 4):** at `factor = 1`, rendering must be unchanged from today. Every change below must be a no-op at `factor = 1`.
- **Join invariance (criterion 1):** the pinned connection point moves 0px at every factor in `[minFactor, maxFactor]`.
- **No overshoot (criterion 2):** no outline point displaces further along the axis than the axis extent.
- **In-scope fonts** are every key in `FONT_URLS` (`src/hooks/useShapedGlyphs.ts`) **except** `Ruqaa` and `HarfCanvasDiwani`. Out-of-scope fonts must degrade to today's behaviour — no snapping, no pins — and must not error.
- **Join pins are plain-text-only** (user decision, 2026-08-13). `ShapeFillText.tsx` keeps calling `applyGlyphEdit` with four arguments and is not modified by this plan.
- **Off-grid factors must round-trip through save/load unchanged.** Quantization happens only at edit time, never on load and never in a renderer.
- **The kashida formula must not be duplicated any more.** It is `factor = 1 + (maxFactor - 1) * (amount/100) * (priority/10)`, currently copied in `App.tsx:600` and `src/lib/justify.ts:114`. Task 6 extracts it to one place; do not leave a second copy behind.
- **Correction to the spec's implementation notes:** the notes refer to `App.tsx`'s `addStretchHandle`. That function no longer exists — the funnel is now **`setStretchFactor`** (`src/App.tsx:740`), which creates the handle on first call and retunes `factor` afterwards. Every reference below uses the current name.
- After each task: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`. At the end of each phase also `npm run build`.
- Expect `package.json` / `package-lock.json` in every commit — the pre-commit hook bumps the patch version. Do not hand-edit them.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `src/lib/nuqta.ts` | The measured per-font nuqta table (dot/em ratios) and lookup. The single place that decides whether a font is in scope. |
| `src/lib/nuqta.test.ts` | Table shape, in-scope/out-of-scope lookups. |
| `src/lib/strokeSchema/quantize.ts` | Factor ⇄ nuqta arithmetic: half-nuqta step, delta snapping, the calligraphers'-units readout. |
| `src/lib/strokeSchema/quantize.test.ts` | Snapping identity at `factor = 1`, step size, clamping, formatting. |
| `src/lib/kashidaFactor.ts` | The one kashida distribution formula, shared by `App.tsx` and `justify.ts`. |
| `src/lib/kashidaFactor.test.ts` | Formula, eligibility gate, quantized variant. |
| `src/lib/joinPins.ts` | Overlap-based join detection, the join guard, and the per-run pin computation both `ShapedText` and `justify` call. |
| `src/lib/joinPins.test.ts` | Pure geometry: synthetic polygons, guard shape. |
| `src/lib/joinPins.fonts.test.ts` | Join invariance against real fonts and real HarfBuzz (criterion 1). |

**Modified files:**

| File | Change |
|---|---|
| `src/lib/glyphEdits.ts:52-84` | Clamp and taper `tAlong` in `applyAxisDisplacement`. |
| `src/lib/glyphEdits.ts:113-134` | `applyGlyphEdit` gains an optional 5th `pins` parameter and blends by the join guard. |
| `src/lib/glyphEdits.test.ts` | New overshoot/backwards/guard cases. |
| `src/lib/strokeSchema/deriveCatalog.ts` | Carry `lengthDots` onto `StretchDefinition`. |
| `src/lib/strokeSchema/deriveCatalog.test.ts` | Assert it is carried, for every authored schema. |
| `src/lib/strokeSchema/registry.ts` | Possibly one new export (`allStrokeSchemas`) if none already enumerates the set — see Task 3. |
| `src/types.ts:19-48` | `lengthDots?: number` on `GlyphStretchHandle`. |
| `src/App.tsx` | `setStretchFactor` sets `lengthDots` and snaps; `setBlockKashidaAmount` uses the shared formula; new `snapStrokesToNuqta` state threaded to `Sidebar`. |
| `src/components/StrokeStretchHoverHandles.tsx` | Alt-key snap bypass on drag. |
| `src/components/MorphGlyphEditor.tsx` | Nuqta readout beside each stroke row; typed input bypasses snapping. |
| `src/components/Sidebar.tsx` | "Snap strokes to nuqta" checkbox. |
| `src/components/ShapedText.tsx` | Compute join pins once per run; pass them through `drawWarpedGlyphRun` into `applyGlyphEdit`. |
| `src/lib/justify.ts` | Use the shared kashida formula; apply the same pins when measuring. |

---

# Phase A — changes 3 and 5

## Task 1: Clamp and taper the displacement axis

Change 3. Highest-confidence fix, no dependency on anything else in this plan.

**Files:**
- Modify: `src/lib/glyphEdits.ts:52-84`
- Test: `src/lib/glyphEdits.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: no signature change. `applyAxisDisplacement` stays private; behaviour changes for points with `tAlong` outside `[0, 1]`.

**Background you need:** `applyAxisDisplacement` displaces an outline point along an anchor→dragOrigin axis. `tAlong = along / axisLen` is the point's position along that axis: 0 at the anchor, 1 at the drag origin. Today it is unbounded and signed, so a point past the drag origin travels *further* than the drag itself and a point behind the anchor travels *backwards*. That overshoot is half of the reported cleft at letter joins.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/glyphEdits.test.ts`, inside the existing `describe("applyGlyphEdit", ...)` block:

```ts
  it("does not displace a point past the drag origin further than the drag itself", () => {
    const edit: GlyphEdit = {
      glyphIndex: 0,
      stretches: [
        {
          id: "h1",
          anchorX: 0,
          anchorY: 0,
          dragOriginX: 100,
          dragOriginY: 0,
          dragX: 150,
          dragY: 0,
          bandWidth: 20,
        },
      ],
    };
    // x=200 is twice as far along the axis as the drag origin. Unclamped,
    // tAlong=2 gave it a 100px displacement (double the 50px drag) — the
    // overshoot half of the cleft at a letter join.
    const p = applyGlyphEdit(200, 0, edit);
    expect(p.x).toBeCloseTo(250);
  });

  it("does not displace a point behind the anchor backwards", () => {
    const edit: GlyphEdit = {
      glyphIndex: 0,
      stretches: [
        {
          id: "h1",
          anchorX: 0,
          anchorY: 0,
          dragOriginX: 100,
          dragOriginY: 0,
          dragX: 150,
          dragY: 0,
          bandWidth: 20,
        },
      ],
    };
    // tAlong = -0.5 used to pull this point 25px in the *opposite* direction.
    const p = applyGlyphEdit(-50, 0, edit);
    expect(p.x).toBeCloseTo(-50);
  });

  it("still displaces the drag origin itself by the full drag delta", () => {
    const edit: GlyphEdit = {
      glyphIndex: 0,
      stretches: [
        {
          id: "h1",
          anchorX: 0,
          anchorY: 0,
          dragOriginX: 100,
          dragOriginY: 0,
          dragX: 150,
          dragY: 0,
          bandWidth: 20,
        },
      ],
    };
    expect(applyGlyphEdit(100, 0, edit).x).toBeCloseTo(150);
  });
```

- [ ] **Step 2: Run the tests to verify the first two fail**

Run: `npx vitest run src/lib/glyphEdits.test.ts`
Expected: the two new overshoot/backwards tests FAIL (`expected 300 to be close to 250`, `expected -75 to be close to -50`); every pre-existing test still passes.

- [ ] **Step 3: Implement the clamp and taper**

In `src/lib/glyphEdits.ts`, replace the `const tAlong = along / axisLen;` line (currently line 80) with:

```ts
  // Clamped, and eased with the same smoothstep the perpendicular band
  // already uses. Unbounded and signed, this was half of the cleft that
  // opens at a letter join: a point past the drag origin (tAlong > 1)
  // travelled further than the drag itself, and a point behind the anchor
  // (tAlong < 0) travelled backwards. Clamping makes the region past the
  // drag origin translate rigidly with the axis tip — which is what
  // "extending a stroke" means — and easing removes the crease the bare
  // clamp would leave at each boundary.
  const tRaw = Math.max(0, Math.min(1, along / axisLen));
  const tAlong = tRaw * tRaw * (3 - 2 * tRaw);
```

Then update `applyAxisDisplacement`'s doc comment: replace the phrase "1 at the `dragOrigin`, unbounded beyond it" with "1 at the `dragOrigin` and held at 1 beyond it (clamped — see the note at the `tAlong` computation)". Do the same in `applyGlyphEdit`'s doc comment (line ~110), which repeats the phrase "unbounded beyond it".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/glyphEdits.test.ts`
Expected: PASS, all cases. In particular `applyGlyphEdit(100, 0, edit).x === 150` still holds (smoothstep(1) = 1) and the schema-backed `factor = 1` case still returns the point untouched.

- [ ] **Step 5: Run the full verification loop**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test
```
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/glyphEdits.ts src/lib/glyphEdits.test.ts package.json package-lock.json
git commit -m "Stop stroke stretches overshooting past their own axis"
```

---

## Task 2: The measured per-font nuqta table

Half of change 5's scaffolding, and the mechanism that keeps Diwani and Ruq'ah out of scope for free.

**Files:**
- Create: `src/lib/nuqta.ts`
- Test: `src/lib/nuqta.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `NUQTA_EM_RATIO: Readonly<Record<string, number>>`
  - `nuqtaEmRatio(fontFamily: string): number | null`
  - `nuqtaPx(fontFamily: string, fontSize: number): number | null`

**Background you need:** traditional Arabic calligraphy measures stroke length in nuqta (the rhombic dot the nib makes). The intuitive rule that the alif's stem is one nuqta **fails** across this font library (`alif/dot` ranges 0.53–1.68), and `dot/em` itself varies ~2×, so there is no formula and no global constant — the table below is measured, cross-checked by two independent methods, and human-confirmed. Do not "improve" it by deriving values. `Ruqaa` and `HarfCanvasDiwani` are deliberately absent: a font that is not in the table returns `null`, which downstream disables both snapping and join pins.

- [ ] **Step 1: Write the failing test**

Create `src/lib/nuqta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NUQTA_EM_RATIO, nuqtaEmRatio, nuqtaPx } from "./nuqta";

/**
 * The in-scope half of `FONT_URLS` (src/hooks/useShapedGlyphs.ts), which is
 * the real source of truth for which fonts the app ships.
 *
 * It is written out rather than imported **deliberately**: that module
 * statically imports `../lib/harfbuzz`, which throws under Vitest's Node ESM
 * loader the moment this file evaluates it ("Method Promise.prototype.then
 * called on incompatible receiver") — the same constraint that keeps
 * `diacritics.ts` and `justify.ts` free of a static harfbuzz import. Adding a
 * font is already a multi-place edit (CLAUDE.md); the nuqta table is one more.
 */
const IN_SCOPE_FONTS = [
  "AlFatemi",
  "Amiri",
  "FatemiMaqala",
  "Kufi",
  "Kufi2",
  "Lateef",
  "NotoSans",
  "Qahiri",
  "Scheherazade",
  "TahaNaskhRegular",
  "Thuluth",
  "ThuluthDeco",
  "Urdu",
  "Wessam",
  "Yekan",
];

describe("nuqta table", () => {
  it("covers exactly the in-scope fonts", () => {
    expect(Object.keys(NUQTA_EM_RATIO).sort()).toEqual([...IN_SCOPE_FONTS].sort());
  });

  it("returns null for a font that was measured out of scope", () => {
    expect(nuqtaEmRatio("Ruqaa")).toBeNull();
    expect(nuqtaEmRatio("HarfCanvasDiwani")).toBeNull();
    expect(nuqtaPx("Ruqaa", 100)).toBeNull();
  });

  it("returns null for an unknown font rather than guessing", () => {
    expect(nuqtaEmRatio("NoSuchFont")).toBeNull();
    expect(nuqtaPx("NoSuchFont", 100)).toBeNull();
  });

  it("scales the ratio by font size", () => {
    // Amiri: 135/1000 upem.
    expect(nuqtaEmRatio("Amiri")).toBeCloseTo(0.135, 4);
    expect(nuqtaPx("Amiri", 200)).toBeCloseTo(27, 4);
  });

  it("keeps every ratio inside the measured range", () => {
    for (const [font, ratio] of Object.entries(NUQTA_EM_RATIO)) {
      expect(ratio, font).toBeGreaterThan(0.07);
      expect(ratio, font).toBeLessThan(0.16);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/nuqta.test.ts`
Expected: FAIL — `Failed to resolve import "./nuqta"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/nuqta.ts`:

```ts
/**
 * The nuqta — the rhombic dot a calligrapher's nib makes — is the unit
 * traditional Arabic calligraphy measures stroke length in, and the unit
 * every stroke schema's `lengthDots` is authored in.
 *
 * **It is measured per font, never derived.** The intuitive rule that the
 * alif's stem is one nuqta wide fails badly across this library: `alif/dot`
 * ranges 0.53 (Urdu) to 1.68 (Kufi2), a 3.2x spread where the rule predicts
 * 1.00. `dot/em` itself varies ~2x (0.0762 Wessam to 0.1538 Urdu), so no
 * global constant serves either. The figures below were measured two
 * independent ways — the beh (U+0628) dot contour, and a modal-contour sweep
 * over every glyph in the font — which agree within ~2% on every entry
 * except Yekan, where the beh-dot figure was reviewed and accepted by the
 * user (the ~6% spread is sub-pixel at normal sizes). Full derivation and
 * the per-font confidence column live in
 * docs/superpowers/specs/2026-08-12-per-stroke-editing-design.md.
 *
 * Stored as a dot/em **ratio**, not raw font units, so nuqta-in-pixels is
 * just `ratio * fontSize` with no unitsPerEm plumbing at the call site.
 *
 * `Ruqaa` and `HarfCanvasDiwani` are absent **deliberately**. They were
 * scoped out of per-stroke editing (every stroke schema declares
 * `calligraphicModel: "naskh"`, which fits Diwani's sloped letterforms worst,
 * and Ruq'ah merges dot pairs into strokes, making its measured nuqta the
 * least reliable figure available). An absent font returns `null`, which is
 * what disables nuqta snapping and join pins for it — that null is the
 * out-of-scope mechanism, not an oversight. Do not fill these in with a
 * guess.
 */
export const NUQTA_EM_RATIO: Readonly<Record<string, number>> = {
  AlFatemi: 0.0973,
  Amiri: 0.135,
  FatemiMaqala: 0.1138,
  Kufi: 0.121,
  Kufi2: 0.116,
  Lateef: 0.1016,
  NotoSans: 0.099,
  Qahiri: 0.1067,
  Scheherazade: 0.1118,
  TahaNaskhRegular: 0.1157,
  Thuluth: 0.0918,
  ThuluthDeco: 0.0918,
  Urdu: 0.1538,
  Wessam: 0.0762,
  Yekan: 0.1348,
};

/** The font's nuqta as a proportion of its em, or `null` when the font is out of scope / unknown. */
export function nuqtaEmRatio(fontFamily: string): number | null {
  return NUQTA_EM_RATIO[fontFamily] ?? null;
}

/** The font's nuqta in the same pixel space a block of this `fontSize` renders in, or `null` when out of scope. */
export function nuqtaPx(fontFamily: string, fontSize: number): number | null {
  const ratio = nuqtaEmRatio(fontFamily);
  if (ratio == null) return null;
  return ratio * fontSize;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/nuqta.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/nuqta.ts src/lib/nuqta.test.ts package.json package-lock.json
git commit -m "Add the measured per-font nuqta table"
```

---

## Task 3: Carry `lengthDots` from the schema onto the handle

`lengthDots` is authored on every stroke and read by nothing. Change 5 needs it on the handle.

**Files:**
- Modify: `src/lib/strokeSchema/deriveCatalog.ts:4-33` (type) and `:67-83` (construction)
- Modify: `src/types.ts:19-48`
- Modify: `src/App.tsx:795-818` (the handle literal inside `setStretchFactor`)
- Test: `src/lib/strokeSchema/deriveCatalog.test.ts`

**Interfaces:**
- Consumes: `Stroke.lengthDots?: number` (`src/lib/strokeSchema/types.ts:119`).
- Produces: `StretchDefinition.lengthDots?: number` and `GlyphStretchHandle.lengthDots?: number`, both optional — a schema file may omit `lengthDots`, and every project saved before this change has handles without it.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/strokeSchema/deriveCatalog.test.ts`, inside the existing top-level `describe`. That suite asserts against the **real registry** rather than fixtures, so these do too — and the values below are the ones actually authored in `src/data/strokeSchemas/`:

```ts
  it("carries the stroke's authored lengthDots onto its definitions", () => {
    // beh-isolated.json: S_BODY_1 is 4.2 nuqta long, with one stretch zone.
    const beh = deriveStretchCatalog(getStrokeSchema("0628", "isolated")!);
    expect(beh.find((d) => d.strokeId === "S_BODY_1")!.lengthDots).toBe(4.2);

    // seen-medial.json: only the connector stroke is stretchable, 1.6 long.
    const seen = deriveStretchCatalog(getStrokeSchema("0633", "medial")!);
    expect(seen[0].lengthDots).toBe(1.6);
  });

  it("carries a length onto every stretchable stroke in every authored schema", () => {
    // Every schema file authored so far gives its stretchable strokes a
    // lengthDots. If a newly added file forgets one, that stroke silently
    // loses nuqta quantization — it degrades rather than breaking, so
    // nothing else would catch it.
    for (const schema of allStrokeSchemas()) {
      for (const def of deriveStretchCatalog(schema)) {
        expect(def.lengthDots, `${schema.glyph.id} / ${def.strokeId}`).toBeGreaterThan(0);
      }
    }
  });
```

**Before writing the second test, check `src/lib/strokeSchema/registry.ts` for an existing exported way to enumerate every schema.** If there is none, add one:

```ts
/** Every registered schema, for suites that assert a property across the whole authored set. */
export function allStrokeSchemas(): GlyphDescription[] {
  return Array.from(registry.values());
}
```

matching whatever the module's internal map is actually called — read the file rather than assuming the name `registry`.

The `lengthDots` field stays **optional** on both types regardless: a schema file may omit it, and every project saved before this change has handles without one. Those simply do not snap.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/strokeSchema/deriveCatalog.test.ts`
Expected: FAIL — `expected undefined to be 4.2`.

- [ ] **Step 3: Add the field in all three places**

In `src/lib/strokeSchema/deriveCatalog.ts`, add to the `StretchDefinition` type (after `priority: number;`):

```ts
  /**
   * The stroke's natural length in nuqta, straight from the schema
   * (`Stroke.lengthDots`). Optional because a schema file may omit it. This
   * is what makes a half-nuqta stretch increment computable:
   * `step = 0.5 / lengthDots` in factor space (see lib/strokeSchema/quantize.ts).
   */
  lengthDots?: number;
```

and inside the `defs.push({ ... })` literal, after `priority: stroke.editBehavior.priority,`:

```ts
          lengthDots: stroke.lengthDots,
```

In `src/types.ts`, add to `GlyphStretchHandle` after `priority?: number;`:

```ts
  /** The schema stroke's natural length in nuqta, copied from StretchDefinition at handle creation — the divisor for the half-nuqta snap step. Absent on handles created before nuqta quantization existed, which simply do not snap. */
  lengthDots?: number;
```

In `src/App.tsx`, inside `setStretchFactor`'s new-handle literal, after `priority: definition.priority,`:

```ts
              lengthDots: definition.lengthDots,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/strokeSchema/deriveCatalog.test.ts && npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS, and a clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/lib/strokeSchema/deriveCatalog.ts src/lib/strokeSchema/deriveCatalog.test.ts src/types.ts src/App.tsx package.json package-lock.json
git commit -m "Carry each stroke's authored lengthDots onto its handle"
```

---

## Task 4: Factor ⇄ nuqta arithmetic

The pure maths of change 5. No UI, no state.

**Files:**
- Create: `src/lib/strokeSchema/quantize.ts`
- Test: `src/lib/strokeSchema/quantize.test.ts`

**Interfaces:**
- Consumes: `nuqtaEmRatio` from `src/lib/nuqta.ts` (Task 2); `lengthDots` from Task 3.
- Produces:
  - `halfNuqtaFactorStep(lengthDots: number | undefined): number | null`
  - `quantizeFactor(factor: number, step: number | null, minFactor: number, maxFactor: number): number`
  - `addedNuqta(factor: number, lengthDots: number | undefined): number | null`
  - `formatNuqtaDelta(added: number | null): string`
  - `snapStretchFactor(args: { factor: number; lengthDots?: number; fontFamily: string; minFactor: number; maxFactor: number; enabled: boolean }): number`

**The one thing to get right:** snap the **added** length, not the absolute length. A stroke's natural `lengthDots` is generally not itself a half-nuqta multiple (beh's body is 4.2), so snapping absolute length would move `factor = 1` off the font's natural rendering and break the regression bar. The formula is therefore `1 + round((factor - 1) / step) * step`, which maps `factor = 1` to exactly itself.

- [ ] **Step 1: Write the failing test**

Create `src/lib/strokeSchema/quantize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  addedNuqta,
  formatNuqtaDelta,
  halfNuqtaFactorStep,
  quantizeFactor,
  snapStretchFactor,
} from "./quantize";

describe("halfNuqtaFactorStep", () => {
  it("is half a nuqta expressed in factor space", () => {
    // beh's body: 4.2 nuqta long, so half a nuqta is 0.5/4.2 of its length.
    expect(halfNuqtaFactorStep(4.2)).toBeCloseTo(0.11904, 5);
  });

  it("is null when the stroke authored no length", () => {
    expect(halfNuqtaFactorStep(undefined)).toBeNull();
    expect(halfNuqtaFactorStep(0)).toBeNull();
    expect(halfNuqtaFactorStep(-1)).toBeNull();
  });
});

describe("quantizeFactor", () => {
  it("leaves factor 1 exactly alone — the regression bar", () => {
    const step = halfNuqtaFactorStep(4.2)!;
    expect(quantizeFactor(1, step, 0.85, 1.8)).toBe(1);
  });

  it("snaps the ADDED length, not the absolute length", () => {
    const step = halfNuqtaFactorStep(4.2)!;
    // 1.1 is 0.84 of a step above 1 -> rounds to one whole step.
    expect(quantizeFactor(1.1, step, 0.85, 1.8)).toBeCloseTo(1 + step, 6);
    // 1.05 is 0.42 of a step -> rounds back down to no added length at all.
    expect(quantizeFactor(1.05, step, 0.85, 1.8)).toBeCloseTo(1, 6);
  });

  it("snaps shortening as well as lengthening", () => {
    const step = halfNuqtaFactorStep(4.2)!;
    expect(quantizeFactor(0.9, step, 0.85, 1.8)).toBeCloseTo(1 - step, 6);
  });

  it("stays inside the zone's own bounds", () => {
    const step = halfNuqtaFactorStep(1)!; // 0.5 — a coarse step
    expect(quantizeFactor(1.79, step, 0.85, 1.8)).toBeLessThanOrEqual(1.8);
    expect(quantizeFactor(0.86, step, 0.85, 1.8)).toBeGreaterThanOrEqual(0.85);
  });

  it("passes the factor straight through when there is no step", () => {
    expect(quantizeFactor(1.234, null, 0.85, 1.8)).toBe(1.234);
  });
});

describe("addedNuqta / formatNuqtaDelta", () => {
  it("reports the stretch in the units a calligrapher measures in", () => {
    expect(addedNuqta(1.5, 4)).toBeCloseTo(2, 6);
    expect(addedNuqta(1, 4)).toBeCloseTo(0, 6);
    expect(addedNuqta(1.5, undefined)).toBeNull();
  });

  it("formats whole and half nuqta, signed", () => {
    expect(formatNuqtaDelta(0)).toBe("natural");
    expect(formatNuqtaDelta(1.5)).toBe("+1½ nuqta");
    expect(formatNuqtaDelta(0.5)).toBe("+½ nuqta");
    expect(formatNuqtaDelta(2)).toBe("+2 nuqta");
    expect(formatNuqtaDelta(-0.5)).toBe("−½ nuqta");
    expect(formatNuqtaDelta(null)).toBe("");
  });
});

describe("snapStretchFactor", () => {
  const base = { lengthDots: 4.2, minFactor: 0.85, maxFactor: 1.8, enabled: true };

  it("snaps for an in-scope font", () => {
    const step = halfNuqtaFactorStep(4.2)!;
    expect(snapStretchFactor({ ...base, factor: 1.1, fontFamily: "Amiri" })).toBeCloseTo(
      1 + step,
      6
    );
  });

  it("does not snap for a font that is out of scope", () => {
    expect(snapStretchFactor({ ...base, factor: 1.1, fontFamily: "Ruqaa" })).toBe(1.1);
    expect(snapStretchFactor({ ...base, factor: 1.1, fontFamily: "HarfCanvasDiwani" })).toBe(1.1);
  });

  it("does not snap when the user has turned snapping off", () => {
    expect(
      snapStretchFactor({ ...base, enabled: false, factor: 1.1, fontFamily: "Amiri" })
    ).toBe(1.1);
  });

  it("does not snap a handle whose stroke authored no length", () => {
    expect(
      snapStretchFactor({ ...base, lengthDots: undefined, factor: 1.1, fontFamily: "Amiri" })
    ).toBe(1.1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/strokeSchema/quantize.test.ts`
Expected: FAIL — `Failed to resolve import "./quantize"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/strokeSchema/quantize.ts`:

```ts
import { nuqtaEmRatio } from "../nuqta";

/**
 * Half a nuqta, expressed as a step in *factor* space.
 *
 * A stroke `lengthDots` nuqta long, stretched by `factor`, becomes
 * `lengthDots * factor` nuqta long — so a half-nuqta increment of length is a
 * `0.5 / lengthDots` increment of factor. Note this needs no per-font
 * measurement at all: it is pure schema arithmetic. The font's measured
 * nuqta (lib/nuqta.ts) is used only to decide whether the font is *in scope*
 * for this feature, and to size the join-pin radius in lib/joinPins.ts.
 */
export function halfNuqtaFactorStep(lengthDots: number | undefined): number | null {
  if (lengthDots == null || !(lengthDots > 0)) return null;
  return 0.5 / lengthDots;
}

/**
 * Snaps a stretch factor to the nearest half-nuqta of **added** length.
 *
 * Snapping the *added* length rather than the absolute length is the whole
 * point: a stroke's natural `lengthDots` is generally not itself a
 * half-nuqta multiple (beh's body is 4.2), so snapping `lengthDots * factor`
 * to a half-nuqta grid would move `factor = 1` off the font's own natural
 * rendering — silently violating the rule that factor 1 renders exactly as
 * it does today. `1 + round((factor - 1) / step) * step` maps 1 to itself
 * exactly, at every step size.
 */
export function quantizeFactor(
  factor: number,
  step: number | null,
  minFactor: number,
  maxFactor: number
): number {
  if (step == null || !(step > 0)) return factor;
  const snapped = 1 + Math.round((factor - 1) / step) * step;
  return Math.max(minFactor, Math.min(maxFactor, snapped));
}

/** How much length this factor adds, in nuqta — the number a calligrapher would name. Null when the stroke authored no length. */
export function addedNuqta(factor: number, lengthDots: number | undefined): number | null {
  if (lengthDots == null || !(lengthDots > 0)) return null;
  return lengthDots * (factor - 1);
}

/** Renders `addedNuqta`'s figure the way a calligrapher writes it: "+1½ nuqta", "−½ nuqta", "natural". */
export function formatNuqtaDelta(added: number | null): string {
  if (added == null) return "";
  const halves = Math.round(added * 2);
  if (halves === 0) return "natural";

  const sign = halves < 0 ? "−" : "+";
  const abs = Math.abs(halves);
  const whole = Math.floor(abs / 2);
  const half = abs % 2 === 1;
  const magnitude = `${whole > 0 ? whole : ""}${half ? "½" : ""}`;
  return `${sign}${magnitude} nuqta`;
}

/**
 * The one entry point the app uses: snap this factor if — and only if —
 * snapping is switched on, the font is one whose nuqta has actually been
 * measured, and the stroke authored a length to measure against. Any of
 * those missing returns the factor untouched, which is what gives the
 * out-of-scope fonts (Ruq'ah, Diwani) their correct behaviour for free.
 *
 * Snapping is deliberately applied at *edit* time only, never on load and
 * never in a renderer, so a deliberately off-grid value saved by a user
 * round-trips through save/load unchanged.
 */
export function snapStretchFactor(args: {
  factor: number;
  lengthDots?: number;
  fontFamily: string;
  minFactor: number;
  maxFactor: number;
  enabled: boolean;
}): number {
  if (!args.enabled) return args.factor;
  if (nuqtaEmRatio(args.fontFamily) == null) return args.factor;
  return quantizeFactor(
    args.factor,
    halfNuqtaFactorStep(args.lengthDots),
    args.minFactor,
    args.maxFactor
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/strokeSchema/quantize.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/strokeSchema/quantize.ts src/lib/strokeSchema/quantize.test.ts package.json package-lock.json
git commit -m "Add half-nuqta quantization for stroke stretch factors"
```

---

## Task 5: Wire snapping into the editor

Every path that sets a stretch factor — the on-canvas drag, the typed field, the Shape Fill slider — funnels through `App.tsx`'s `setStretchFactor`. Snapping goes **there**, once, rather than being plumbed into each overlay.

**Files:**
- Modify: `src/App.tsx:740-822` (`setStretchFactor`), plus new `snapStrokesToNuqta` state and its prop threading
- Modify: `src/components/StrokeStretchHoverHandles.tsx:219-230` (Alt bypass)
- Modify: `src/components/MorphGlyphEditor.tsx` (nuqta readout; typed field bypasses snapping)
- Modify: `src/components/Sidebar.tsx` (checkbox)

**Interfaces:**
- Consumes: `snapStretchFactor`, `addedNuqta`, `formatNuqtaDelta` (Task 4); `StretchDefinition.lengthDots` (Task 3).
- Produces: `setStretchFactor(blockId, glyphIndex, definition, factor, opts?: { snap?: boolean })` — `opts.snap === false` bypasses quantization for this one call. Every existing call site keeps working unchanged, snapping per the user's toggle.
- Produces: `onSetStretchFactor` on `StrokeStretchHoverHandlesProps` gains the same optional 4th argument.

- [ ] **Step 1: Add the app-level toggle**

In `src/App.tsx`, beside the other editor-only booleans (find `snapToBlockEdges` and put this next to it):

```tsx
  // Advisory, like grid snapping: on by default, bypassed per-drag by holding
  // Alt, and applied only when a factor is *edited* — a value already stored
  // off-grid is never re-snapped, so deliberate off-grid work survives a
  // save/load round trip. Deliberately not persisted, matching snapToBlockEdges.
  const [snapStrokesToNuqta, setSnapStrokesToNuqta] = useState(true);
```

- [ ] **Step 2: Snap inside `setStretchFactor`**

In `src/App.tsx`, change `setStretchFactor`'s signature and its clamp line. Replace:

```tsx
    (blockId: number, glyphIndex: number, definition: StretchDefinition, factor: number) => {
      const block = blocks.find((b) => b.id === blockId);
      if (!block || block.type === "image" || block.type === "textPath") return;

      const clamped = Math.max(definition.minFactor, Math.min(definition.maxFactor, factor));
```

with:

```tsx
    (
      blockId: number,
      glyphIndex: number,
      definition: StretchDefinition,
      factor: number,
      // `snap: false` is the deliberate off-grid escape — the typed precision
      // field in the Morph panel, and an Alt-held canvas drag, both pass it.
      opts?: { snap?: boolean }
    ) => {
      const block = blocks.find((b) => b.id === blockId);
      if (!block || block.type === "image" || block.type === "textPath") return;

      // Snap before clamping: the snap can only move a value by less than one
      // half-nuqta step, and quantizeFactor already keeps its own result
      // inside [minFactor, maxFactor], so clamping afterwards is a no-op
      // safety net rather than something the snap has to work around.
      const snapped = snapStretchFactor({
        factor,
        lengthDots: definition.lengthDots,
        fontFamily: block.fontFamily,
        minFactor: definition.minFactor,
        maxFactor: definition.maxFactor,
        enabled: snapStrokesToNuqta && opts?.snap !== false,
      });
      const clamped = Math.max(definition.minFactor, Math.min(definition.maxFactor, snapped));
```

Add `snapStrokesToNuqta` to that `useCallback`'s dependency array, and add the import near the other `strokeSchema` imports:

```tsx
import { snapStretchFactor } from "./lib/strokeSchema/quantize";
```

- [ ] **Step 3: Alt bypasses the snap during a canvas drag**

In `src/components/StrokeStretchHoverHandles.tsx`, widen the callback type:

```ts
  onSetStretchFactor?: (
    glyphIndex: number,
    definition: StretchDefinition,
    factor: number,
    opts?: { snap?: boolean }
  ) => void;
```

and in `onDragMove` (currently line 229) replace `onSetStretchFactor?.(glyphIndex, def, nextFactor);` with:

```tsx
                        // Alt held = free, unsnapped positioning, the same
                        // escape the artboard's grid snapping offers.
                        onSetStretchFactor?.(glyphIndex, def, nextFactor, {
                          snap: !e.evt.altKey,
                        });
```

Then follow the `onSetStretchFactor` prop back through `ShapedText.tsx` and `CanvasStage.tsx` to `App.tsx` and widen each intermediate type the same way — the compiler will point at every one.

- [ ] **Step 4: Typed precision field stays exact; add the nuqta readout**

In `src/components/MorphGlyphEditor.tsx`:

Import the readout helpers:

```tsx
import { addedNuqta, formatNuqtaDelta } from "../lib/strokeSchema/quantize";
```

In the per-definition row (around line 431, just after `const value = handle?.factor ?? 1;`) add:

```tsx
                  const nuqtaLabel = formatNuqtaDelta(addedNuqta(value, def.lengthDots));
```

In the text-block branch, change the label span to carry it:

```tsx
                              <span style={{ fontSize: 12, flex: 1, minWidth: 0 }}>
                                {def.label.en ?? def.componentType}
                                {def.kashidaEligible ? " · kashida" : ""}
                                {nuqtaLabel ? ` · ${nuqtaLabel}` : ""}
                              </span>
```

and make the typed field bypass the snap — this field is the precision escape, so a typed 1.07 must stay 1.07:

```tsx
                                onCommit={(factor) =>
                                  onSetStretchFactor?.(
                                    selectedBlock.id,
                                    glyphIndex,
                                    def,
                                    factor,
                                    { snap: false }
                                  )
                                }
```

In the Shape Fill branch, put the readout in the slider's suffix so it reads in nuqta rather than an abstract factor:

```tsx
                              suffix={nuqtaLabel || value.toFixed(2)}
```

Widen `MorphGlyphEditorProps`'s `onSetStretchFactor` to accept the same optional 4th argument.

- [ ] **Step 5: Add the checkbox**

In `src/components/Sidebar.tsx`, in the **Background & Grid** panel directly below the existing "Snap to block edges" `CheckboxRow` (currently around line 733 — note that row uses a plain string `id` and no `name`, so match it rather than reaching for `makeId`):

```tsx
                <CheckboxRow
                  id="snap-strokes-to-nuqta"
                  label="Snap strokes to nuqta"
                  checked={snapStrokesToNuqta ?? true}
                  onChange={(checked) => onToggleSnapStrokesToNuqta?.(checked)}
                />
```

Add to `SidebarProps`, beside `snapToBlockEdges`:

```tsx
  snapStrokesToNuqta?: boolean;
  onToggleSnapStrokesToNuqta?: (checked: boolean) => void;
```

destructure both in the component signature alongside `snapToBlockEdges`, and pass `snapStrokesToNuqta={snapStrokesToNuqta}` / `onToggleSnapStrokesToNuqta={setSnapStrokesToNuqta}` from `App.tsx`.

While you are in this file: the `// ---- STREAM-A ----` style comment markers around the neighbouring rows are leftovers from a finished parallel-stream merge contract. Leave them alone — removing them is unrelated churn.

- [ ] **Step 6: Verify by hand in the browser**

Run `npm run dev`, then:
1. Default text `حرف`, plain text block, font Amiri, zoom ~275%.
2. Hover the ra, drag its green dot. The stretch should advance in visible discrete increments, and the Morph panel row should read "+½ nuqta", "+1 nuqta", …
3. Hold Alt and drag: motion is continuous, no steps.
4. Type `1.07` into the Morph panel's factor field and press Enter: the value stays `1.07`.
5. Switch the block's font to Ruqaa: dragging is continuous, with no nuqta readout.
6. Untick "Snap strokes to nuqta": dragging is continuous again in Amiri.

Konva's hover-mounted handles do not take scripted drags reliably — drive this by hand rather than through browser automation.

- [ ] **Step 7: Run the full verification loop**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
```
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/StrokeStretchHoverHandles.tsx src/components/MorphGlyphEditor.tsx src/components/Sidebar.tsx src/components/ShapedText.tsx src/components/CanvasStage.tsx package.json package-lock.json
git commit -m "Snap stroke stretches to half-nuqta increments"
```

---

## Task 6: One kashida formula, quantized

The distribution formula is currently written out twice. Task 5 quantized the per-stroke path; the dial has to quantize identically or the auto-justify solver optimises a width applying its own answer would not produce.

**Files:**
- Create: `src/lib/kashidaFactor.ts`
- Test: `src/lib/kashidaFactor.test.ts`
- Modify: `src/App.tsx:600-629` (`setBlockKashidaAmount`)
- Modify: `src/lib/justify.ts:103-132` (`applyKashidaAmountToEdits`) and `:228-257` (`solveJustifyForBlock`)

**Interfaces:**
- Consumes: `snapStretchFactor` (Task 4); `GlyphStretchHandle.lengthDots` (Task 3).
- Produces:
  - `type KashidaSnap = { fontFamily: string; enabled: boolean }`
  - `kashidaFactorForHandle(h: GlyphStretchHandle, amount: number, snap?: KashidaSnap): number | null` — `null` means "this handle is not kashida-eligible, leave it exactly as it is".

- [ ] **Step 1: Write the failing test**

Create `src/lib/kashidaFactor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { kashidaFactorForHandle } from "./kashidaFactor";
import type { GlyphStretchHandle } from "../types";

const handle = (patch: Partial<GlyphStretchHandle> = {}): GlyphStretchHandle => ({
  id: "h1",
  anchorX: 0,
  anchorY: 0,
  dragOriginX: 100,
  dragOriginY: 0,
  dragX: 200,
  dragY: 0,
  bandWidth: 20,
  minFactor: 0.85,
  maxFactor: 1.8,
  kashidaEligible: true,
  priority: 10,
  lengthDots: 4.2,
  ...patch,
});

describe("kashidaFactorForHandle", () => {
  it("returns null for a handle the dial must not touch", () => {
    expect(kashidaFactorForHandle(handle({ kashidaEligible: false }), 50)).toBeNull();
    expect(kashidaFactorForHandle(handle({ maxFactor: undefined }), 50)).toBeNull();
  });

  it("reproduces the established distribution formula", () => {
    // 1 + (1.8 - 1) * (50/100) * (10/10) = 1.4
    expect(kashidaFactorForHandle(handle(), 50)).toBeCloseTo(1.4, 6);
    // priority 5 halves it: 1 + 0.8 * 0.5 * 0.5 = 1.2
    expect(kashidaFactorForHandle(handle({ priority: 5 }), 50)).toBeCloseTo(1.2, 6);
  });

  it("defaults a missing priority to 5, as before", () => {
    expect(kashidaFactorForHandle(handle({ priority: undefined }), 50)).toBeCloseTo(1.2, 6);
  });

  it("never exceeds the handle's own maxFactor", () => {
    expect(kashidaFactorForHandle(handle(), 100)).toBeCloseTo(1.8, 6);
  });

  it("leaves the dial at 0 exactly at the natural factor", () => {
    expect(kashidaFactorForHandle(handle(), 0)).toBe(1);
  });

  it("quantizes to half-nuqta when asked, for an in-scope font", () => {
    const step = 0.5 / 4.2;
    const raw = kashidaFactorForHandle(handle(), 50)!;
    const snapped = kashidaFactorForHandle(handle(), 50, {
      fontFamily: "Amiri",
      enabled: true,
    })!;
    expect(snapped).toBeCloseTo(1 + Math.round((raw - 1) / step) * step, 6);
  });

  it("does not quantize for an out-of-scope font or when disabled", () => {
    const raw = kashidaFactorForHandle(handle(), 50)!;
    expect(
      kashidaFactorForHandle(handle(), 50, { fontFamily: "Ruqaa", enabled: true })
    ).toBeCloseTo(raw, 6);
    expect(
      kashidaFactorForHandle(handle(), 50, { fontFamily: "Amiri", enabled: false })
    ).toBeCloseTo(raw, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/kashidaFactor.test.ts`
Expected: FAIL — `Failed to resolve import "./kashidaFactor"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/kashidaFactor.ts`:

```ts
import type { GlyphStretchHandle } from "../types";
import { snapStretchFactor } from "./strokeSchema/quantize";

export type KashidaSnap = {
  fontFamily: string;
  /** The user's "Snap strokes to nuqta" toggle. */
  enabled: boolean;
};

/**
 * The block-level Kashida dial's distribution formula, in one place.
 *
 * It used to be written out twice — once in `App.tsx`'s
 * `setBlockKashidaAmount` (a state mutator) and once in `lib/justify.ts`'s
 * `applyKashidaAmountToEdits` (pure, so the auto-justify solver can evaluate
 * dozens of candidate dial positions without touching state). Those two
 * copies had to be kept in step by hand: if they ever diverged, the solver
 * would report a width that applying the very amount it returned would not
 * produce, and nothing would fail loudly. Nuqta quantization is exactly the
 * kind of change that would have diverged them, so the formula moved here
 * and both call sites now call this.
 *
 * Returns `null` for a handle the dial must not touch, so a caller can
 * cleanly leave that handle's object identity alone.
 */
export function kashidaFactorForHandle(
  h: GlyphStretchHandle,
  amount: number,
  snap?: KashidaSnap
): number | null {
  if (!h.kashidaEligible || h.maxFactor == null) return null;

  const clampedAmount = Math.max(0, Math.min(100, amount));
  const weight = (h.priority ?? 5) / 10;
  const raw = Math.min(h.maxFactor, 1 + (h.maxFactor - 1) * (clampedAmount / 100) * weight);

  if (!snap) return raw;

  return snapStretchFactor({
    factor: raw,
    lengthDots: h.lengthDots,
    fontFamily: snap.fontFamily,
    minFactor: h.minFactor ?? 0,
    maxFactor: h.maxFactor,
    enabled: snap.enabled,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/kashidaFactor.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Replace both copies of the formula**

In `src/App.tsx`, in `setBlockKashidaAmount`, replace the `stretches.map` body:

```tsx
              stretches: edit.stretches.map((h) => {
                const factor = kashidaFactorForHandle(h, clampedAmount, {
                  fontFamily: b.fontFamily,
                  enabled: snapStrokesToNuqta,
                });
                return factor == null ? h : { ...h, factor };
              }),
```

with `import { kashidaFactorForHandle } from "./lib/kashidaFactor";` added, and `snapStrokesToNuqta` added to that `useCallback`'s dependency array.

In `src/lib/justify.ts`, replace `applyKashidaAmountToEdits`'s body and doc comment:

```ts
/**
 * Applies the kashida dial's distribution across a block's edits, without
 * touching state — this is what lets `solveKashidaAmount` evaluate dozens of
 * candidate dial positions.
 *
 * The formula itself lives in `lib/kashidaFactor.ts` and is shared with
 * `App.tsx`'s `setBlockKashidaAmount`. It used to be duplicated here, which
 * meant the two had to be kept in step by hand or the solver would optimise
 * a width that applying its own answer would not reproduce. Pass the same
 * `snap` the app is using, for the same reason.
 */
export function applyKashidaAmountToEdits(
  glyphEdits: GlyphEdit[],
  amount: number,
  snap?: KashidaSnap
): GlyphEdit[] {
  return glyphEdits.map((edit) => ({
    ...edit,
    stretches: edit.stretches.map((h) => {
      const factor = kashidaFactorForHandle(h, amount, snap);
      return factor == null ? h : { ...h, factor };
    }),
  }));
}
```

with `import { kashidaFactorForHandle, type KashidaSnap } from "./kashidaFactor";` at the top.

Then thread the snap through `solveJustifyForBlock`: add `snapToNuqta?: boolean;` to its `args` type and pass

```ts
        glyphEdits: applyKashidaAmountToEdits(args.glyphEdits, amount, {
          fontFamily: args.fontFamily,
          enabled: args.snapToNuqta ?? false,
        }),
```

Finally, in `App.tsx`'s `justifyBlock`, pass `snapToNuqta: snapStrokesToNuqta` into the `solveJustifyForBlock` call, and add `snapStrokesToNuqta` to that callback's dependency array.

- [ ] **Step 6: Verify the whole loop**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
```
Expected: all clean — in particular `src/lib/justify.test.ts` still passes, since `applyKashidaAmountToEdits` with no `snap` argument behaves exactly as before.

- [ ] **Step 7: Verify auto-justify by hand**

`npm run dev` → a plain text block in Amiri with a few kashida-eligible strokes → Typography → Fit width → "Fit to composition". The result should still land on the target width (the sidebar reports the fit), and the per-stroke rows should read in whole/half nuqta.

- [ ] **Step 8: Commit**

```bash
git add src/lib/kashidaFactor.ts src/lib/kashidaFactor.test.ts src/lib/justify.ts src/App.tsx package.json package-lock.json
git commit -m "Share one kashida formula and quantize the dial with it"
```

**Phase A is complete at this point.** Changes 3 and 5 are in.

---

# Phase B — change 1, join pins

## Task 7: Overlap-based join detection

Find the actual connection point between two shaped letters from where their outlines physically overlap. This assumes nothing about baselines, slopes or letterform style, so it is correct per font by construction.

**An earlier draft proposed scanning a vertical line near the joining edge and taking the midpoint of ink crossing the baseline. It was rejected — it assumes joins happen at the baseline, which is Naskh-shaped thinking and false for sloped styles. Do not reintroduce it.**

**Files:**
- Create: `src/lib/joinPins.ts`
- Test: `src/lib/joinPins.test.ts`

**Interfaces:**
- Consumes: `pointInPolygon`, `pathToPolygon` (`src/lib/svgPath.ts`); `splitContours`, `contoursToPolygons` (`src/lib/glyphContours.ts`).
- Produces:
  - `type JoinPin = { x: number; y: number; radius: number }`
  - `insideContours(x: number, y: number, polygons: Array<[number, number]>[]): boolean`
  - `overlapCentroid(a: Array<[number, number]>[], b: Array<[number, number]>[], samples?: number): { x: number; y: number } | null`
  - `joinGuard(x: number, y: number, pins: JoinPin[] | undefined): number`
  - `computeJoinPins(args: { glyphs: HarfBuzzGlyph[]; font: opentype.Font; fontSize: number; unitsPerEm: number; pinRadius: number }): Map<number, JoinPin[]>`
  - `PIN_RADIUS_NUQTA: number`

- [ ] **Step 1: Write the failing test**

Create `src/lib/joinPins.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { insideContours, joinGuard, overlapCentroid, type JoinPin } from "./joinPins";

/** Axis-aligned rectangle as a closed polygon, in the [x, y] pair form svgPath uses. */
const rect = (
  x: number,
  y: number,
  w: number,
  h: number
): Array<[number, number]> => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
  [x, y],
];

describe("insideContours", () => {
  it("uses the even-odd rule, so a counter is outside the letter", () => {
    const outer = rect(0, 0, 100, 100);
    const counter = rect(40, 40, 20, 20);
    expect(insideContours(10, 10, [outer, counter])).toBe(true);
    expect(insideContours(50, 50, [outer, counter])).toBe(false);
    expect(insideContours(200, 200, [outer, counter])).toBe(false);
  });
});

describe("overlapCentroid", () => {
  it("finds the middle of the region two shapes share", () => {
    const a = [rect(0, 0, 100, 100)];
    const b = [rect(80, 0, 100, 100)];
    const c = overlapCentroid(a, b);
    expect(c).not.toBeNull();
    // Shared strip is x in [80, 100], y in [0, 100].
    expect(c!.x).toBeGreaterThan(80);
    expect(c!.x).toBeLessThan(100);
    expect(c!.y).toBeCloseTo(50, 0);
  });

  it("returns null when the shapes do not touch", () => {
    expect(overlapCentroid([rect(0, 0, 10, 10)], [rect(50, 50, 10, 10)])).toBeNull();
  });

  it("returns null when their bounding boxes overlap but their ink does not", () => {
    // An L, and a square sitting in the L's notch. The bounding boxes
    // overlap almost completely; the ink does not touch at all. This is the
    // case a naive bounding-box test would call a join.
    const ell: Array<[number, number]> = [
      [0, 0],
      [100, 0],
      [100, 20],
      [20, 20],
      [20, 100],
      [0, 100],
      [0, 0],
    ];
    expect(overlapCentroid([ell], [rect(40, 40, 50, 50)])).toBeNull();
  });
});

describe("joinGuard", () => {
  const pin: JoinPin = { x: 0, y: 0, radius: 10 };

  it("is 1 — full displacement — with no pins at all", () => {
    expect(joinGuard(5, 5, undefined)).toBe(1);
    expect(joinGuard(5, 5, [])).toBe(1);
  });

  it("is exactly 0 at the pin, so the join cannot move at all", () => {
    expect(joinGuard(0, 0, [pin])).toBe(0);
  });

  it("is 1 outside the pin radius, so the rest of the letter is untouched", () => {
    expect(joinGuard(10, 0, [pin])).toBe(1);
    expect(joinGuard(40, 0, [pin])).toBe(1);
  });

  it("ramps smoothly between, with no crease at the release point", () => {
    const mid = joinGuard(5, 0, [pin]);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // smoothstep is flat at both ends: near the boundary it approaches 1
    // faster than a straight line would.
    expect(joinGuard(9, 0, [pin])).toBeGreaterThan(0.9);
    expect(joinGuard(1, 0, [pin])).toBeLessThan(0.1);
  });

  it("takes the strictest pin when a point sits near two joins", () => {
    const pins: JoinPin[] = [pin, { x: 6, y: 0, radius: 10 }];
    expect(joinGuard(3, 0, pins)).toBeLessThanOrEqual(joinGuard(3, 0, [pin]));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/joinPins.test.ts`
Expected: FAIL — `Failed to resolve import "./joinPins"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/joinPins.ts`:

```ts
import type * as opentype from "opentype.js";
import type { PathCommand } from "opentype.js";
import { pointInPolygon } from "./svgPath";
import { contoursToPolygons, splitContours } from "./glyphContours";
// Types only, from `normalizeGlyphs` rather than `harfbuzz` — importing the
// latter drags in harfbuzzjs, which throws under Vitest's Node ESM loader the
// moment this module is evaluated. Same reasoning as lib/justify.ts.
import type { HarfBuzzGlyph } from "./normalizeGlyphs";

/**
 * A point at which two adjacent shaped letters actually connect, plus the
 * radius over which a stroke edit's displacement is suppressed around it.
 * Coordinates are in the shaped run's own local space — the same space
 * `applyGlyphEdit` receives, i.e. `outlinePoint + (gx, gy)`.
 */
export type JoinPin = { x: number; y: number; radius: number };

/** The pin radius, as a multiple of the font's measured nuqta. Tunable — see the spec's open questions. */
export const PIN_RADIUS_NUQTA = 0.5;

/** Even-odd containment across a glyph's whole contour set, so a counter (a hole) reads as outside the ink. */
export function insideContours(
  x: number,
  y: number,
  polygons: Array<[number, number]>[]
): boolean {
  let crossings = 0;
  for (const poly of polygons) {
    if (pointInPolygon(x, y, poly)) crossings++;
  }
  return crossings % 2 === 1;
}

function bounds(polygons: Array<[number, number]>[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polygons) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * The centroid of the region where two glyphs' ink physically overlaps —
 * i.e. where they connect.
 *
 * After shaping, two cursively connected Arabic letters' outlines genuinely
 * overlap; the connection is simply wherever that overlap is. Deriving the
 * pin this way assumes nothing about baselines, slopes or letterform style,
 * so it is correct per font by construction — unlike the schema's
 * `anchorNorm`, which is a proportional guess mapped from an idealized
 * bounding box and is exactly what tore the seam in the first place.
 *
 * Sampled on a grid inside the two glyphs' bounding-box intersection rather
 * than solved analytically: polygon clipping would need a new dependency,
 * and the pin only has to be accurate to a fraction of a nuqta for the guard
 * radius to cover the join.
 *
 * Returns null when they do not overlap — an unconnected pair (a
 * right-joining letter followed by anything, a space, a mark) simply gets no
 * pin, which is the correct outcome, not a failure.
 */
export function overlapCentroid(
  a: Array<[number, number]>[],
  b: Array<[number, number]>[],
  samples = 24
): { x: number; y: number } | null {
  if (!a.length || !b.length) return null;

  const ba = bounds(a);
  const bb = bounds(b);
  const minX = Math.max(ba.minX, bb.minX);
  const maxX = Math.min(ba.maxX, bb.maxX);
  const minY = Math.max(ba.minY, bb.minY);
  const maxY = Math.min(ba.maxY, bb.maxY);
  if (!(maxX > minX) || !(maxY > minY)) return null;

  let sumX = 0;
  let sumY = 0;
  let hits = 0;

  for (let i = 0; i < samples; i++) {
    const x = minX + ((i + 0.5) / samples) * (maxX - minX);
    for (let j = 0; j < samples; j++) {
      const y = minY + ((j + 0.5) / samples) * (maxY - minY);
      if (insideContours(x, y, a) && insideContours(x, y, b)) {
        sumX += x;
        sumY += y;
        hits++;
      }
    }
  }

  if (hits === 0) return null;
  return { x: sumX / hits, y: sumY / hits };
}

/**
 * How much of a stroke edit's displacement a point is allowed to keep: 0
 * exactly at a join, ramping smoothly to 1 at the pin radius and beyond.
 *
 * Smoothstep rather than a linear ramp so there is no visible crease where
 * the guard releases — the same easing the band falloff in
 * lib/glyphEdits.ts already uses. When a point sits near two joins the
 * strictest pin wins, so a medial letter pinned on both sides holds both.
 */
export function joinGuard(x: number, y: number, pins: JoinPin[] | undefined): number {
  if (!pins?.length) return 1;

  let guard = 1;
  for (const pin of pins) {
    const radius = Math.max(pin.radius, 1e-6);
    const d = Math.hypot(x - pin.x, y - pin.y);
    if (d >= radius) continue;
    const t = d / radius;
    guard = Math.min(guard, t * t * (3 - 2 * t));
  }
  return guard;
}

/**
 * Every join in a shaped run, keyed by the glyph index each one constrains.
 *
 * A join between glyphs i and i+1 is recorded against **both** of them: each
 * glyph's own edits have to leave the shared seam alone, or one letter pulls
 * away from a neighbour that stayed put.
 *
 * The walk mirrors the renderers' *drawing* loop exactly — same pen advance,
 * same `dx`/`dy` handling, same `fontSize`-scaled outline — so the pins land
 * in the same local space `applyGlyphEdit` is called in
 * (`ShapedText.tsx`'s `drawWarpedGlyphRun`, and `lib/justify.ts`'s
 * `measureStretchedRunWidth`, which both call this). Both of those callers
 * must use the same pins, or the auto-justify solver would measure a width
 * the renderer does not draw.
 *
 * `pinRadius` is in the same pixel space, and should come from the font's
 * measured nuqta (`lib/nuqta.ts`'s `nuqtaPx`) times `PIN_RADIUS_NUQTA`. A
 * font with no measured nuqta is out of scope for this feature: pass no
 * pins at all rather than guessing a radius.
 */
export function computeJoinPins(args: {
  glyphs: HarfBuzzGlyph[];
  font: opentype.Font;
  fontSize: number;
  unitsPerEm: number;
  pinRadius: number;
}): Map<number, JoinPin[]> {
  const { glyphs, font, fontSize, pinRadius } = args;
  const pins = new Map<number, JoinPin[]>();
  if (!font || glyphs.length < 2 || !(pinRadius > 0)) return pins;

  const upm = Math.max(args.unitsPerEm || 1000, 1);
  const scale = fontSize / upm;

  // Outline polygons per glyph, in run-local space, computed once.
  const polygons: Array<Array<[number, number]>[]> = [];
  let penX = 0;
  for (const g of glyphs) {
    const glyphObj = font.glyphs.get(g.g);
    if (!glyphObj) {
      polygons.push([]);
      penX += g.ax ?? 0;
      continue;
    }
    const gx = (penX + (g.dx ?? 0)) * scale;
    const gy = -(g.dy ?? 0) * scale;
    const commands = glyphObj.getPath(gx, gy, fontSize).commands as PathCommand[];
    polygons.push(contoursToPolygons(splitContours(commands)));
    penX += g.ax ?? 0;
  }

  const add = (glyphIndex: number, pin: JoinPin) => {
    const list = pins.get(glyphIndex);
    if (list) list.push(pin);
    else pins.set(glyphIndex, [pin]);
  };

  for (let i = 0; i < glyphs.length - 1; i++) {
    const centre = overlapCentroid(polygons[i], polygons[i + 1]);
    if (!centre) continue;
    const pin: JoinPin = { x: centre.x, y: centre.y, radius: pinRadius };
    add(i, pin);
    add(i + 1, pin);
  }

  return pins;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/joinPins.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/joinPins.ts src/lib/joinPins.test.ts package.json package-lock.json
git commit -m "Detect letter joins from where adjacent glyph outlines overlap"
```

---

## Task 8: Guard the displacement at pinned joins

**Files:**
- Modify: `src/lib/glyphEdits.ts:113-134`
- Test: `src/lib/glyphEdits.test.ts`

**Interfaces:**
- Consumes: `joinGuard`, `JoinPin` (Task 7).
- Produces: `applyGlyphEdit(x, y, edit, contourIndex = -1, pins?: JoinPin[])`. **Optional fifth parameter** — the four existing call sites (`ShapedText.tsx:291/307/323`, `ShapeFillText.tsx:596`, `justify.ts:85/88/91`) keep compiling and behaving identically until they pass it.

**Why the guard wraps the whole result rather than being threaded into `applyAxisDisplacement`:** a glyph can carry several handles that compose, and what must not move is the *net* result at the join. Guarding each handle separately would let two handles that each individually respect the pin still add up to a net movement there.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/glyphEdits.test.ts`:

```ts
  it("does not move a point at a pinned join, at any factor", () => {
    const edit: GlyphEdit = {
      glyphIndex: 0,
      stretches: [
        {
          id: "h1",
          anchorX: 0,
          anchorY: 0,
          dragOriginX: 100,
          dragOriginY: 0,
          dragX: 200,
          dragY: 0,
          bandWidth: 200,
          minFactor: 0.85,
          maxFactor: 1.8,
        },
      ],
    };
    const pins = [{ x: 60, y: 0, radius: 20 }];

    for (const factor of [0.85, 1, 1.2, 1.5, 1.8]) {
      const withFactor: GlyphEdit = {
        ...edit,
        stretches: [{ ...edit.stretches[0], factor }],
      };
      const p = applyGlyphEdit(60, 0, withFactor, -1, pins);
      expect(p.x, `factor ${factor}`).toBeCloseTo(60, 9);
      expect(p.y, `factor ${factor}`).toBeCloseTo(0, 9);
    }
  });

  it("leaves displacement untouched well outside the pin radius", () => {
    const edit: GlyphEdit = {
      glyphIndex: 0,
      stretches: [
        {
          id: "h1",
          anchorX: 0,
          anchorY: 0,
          dragOriginX: 100,
          dragOriginY: 0,
          dragX: 150,
          dragY: 0,
          bandWidth: 200,
        },
      ],
    };
    const unpinned = applyGlyphEdit(100, 0, edit);
    const pinnedFarAway = applyGlyphEdit(100, 0, edit, -1, [{ x: 0, y: 0, radius: 20 }]);
    expect(pinnedFarAway.x).toBeCloseTo(unpinned.x, 9);
  });

  it("partially suppresses displacement inside the pin radius", () => {
    const edit: GlyphEdit = {
      glyphIndex: 0,
      stretches: [
        {
          id: "h1",
          anchorX: 0,
          anchorY: 0,
          dragOriginX: 100,
          dragOriginY: 0,
          dragX: 150,
          dragY: 0,
          bandWidth: 200,
        },
      ],
    };
    const unpinned = applyGlyphEdit(100, 0, edit).x;
    const pinned = applyGlyphEdit(100, 0, edit, -1, [{ x: 90, y: 0, radius: 20 }]).x;
    expect(pinned).toBeGreaterThan(100);
    expect(pinned).toBeLessThan(unpinned);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/glyphEdits.test.ts`
Expected: FAIL — TypeScript rejects the 5th argument (`Expected 3-4 arguments, but got 5`), and the pinned assertions fail at runtime.

- [ ] **Step 3: Implement the guard**

In `src/lib/glyphEdits.ts`, add the import:

```ts
import { joinGuard, type JoinPin } from "./joinPins";
```

and replace `applyGlyphEdit` with:

```ts
/**
 * Applies a glyph's edits to a single outline point: each stretch handle
 * pulls points near its anchor→drag axis along that axis, proportional to
 * clamped distance from the anchor (0 at the anchor, 1 at the drag handle's
 * original position and held there beyond it) and tapered by perpendicular
 * distance from the axis (a smoothstep band falloff).
 *
 * `pins` are the connection points this glyph shares with its neighbours
 * (see lib/joinPins.ts). Displacement is scaled to zero at each pin and
 * ramped smoothly back to full beyond its radius, so stretching a letter
 * cannot tear the seam where it joins the next one. The guard is applied to
 * the *net* result rather than per handle deliberately: a glyph can carry
 * several handles, and guarding each one separately would let two of them
 * each individually respect the pin while still summing to a net movement
 * there. Optional, and absent for every caller that does not have pins —
 * Shape Fill blocks tile their run through a per-tile affine transform, so
 * computing pins in that space is separate work and they deliberately pass
 * none.
 */
export function applyGlyphEdit(
  x: number,
  y: number,
  edit: GlyphEdit | undefined,
  contourIndex = -1,
  pins?: JoinPin[]
): { x: number; y: number } {
  if (!edit) return { x, y };

  let px = x;
  let py = y;

  for (const h of edit.stretches) {
    // Masked against the original (pre-stretch) position so a point can't be
    // carried out of, or into, its own mask by an earlier handle in the chain.
    if (!passesMask(h.mask, x, y, contourIndex)) continue;
    const p = applyAxisDisplacement(px, py, h, resolveValueMultiplier(h));
    px = p.x;
    py = p.y;
  }

  // Evaluated at the point's original position, for the same reason the mask
  // is: a point must not be able to escape its own join guard by being
  // displaced out of the pin radius first.
  const guard = joinGuard(x, y, pins);
  if (guard >= 1) return { x: px, y: py };

  return { x: x + (px - x) * guard, y: y + (py - y) * guard };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/glyphEdits.test.ts`
Expected: PASS, all cases including every pre-existing one (no caller passes `pins` yet, so `joinGuard` returns 1 and the function is byte-for-byte equivalent).

- [ ] **Step 5: Commit**

```bash
git add src/lib/glyphEdits.ts src/lib/glyphEdits.test.ts package.json package-lock.json
git commit -m "Suppress stroke displacement at a pinned letter join"
```

---

## Task 9: Feed pins to the renderer and the width solver

**Files:**
- Modify: `src/components/ShapedText.tsx:185-205` (signature), `:290-330` (the three `applyGlyphEdit` calls), plus a new memo and the `drawWarpedGlyphRun` call site (~line 913)
- Modify: `src/lib/justify.ts:37-101` (`measureStretchedRunWidth`) and `:228-257` (`solveJustifyForBlock`)

**Interfaces:**
- Consumes: `computeJoinPins`, `PIN_RADIUS_NUQTA`, `JoinPin` (Task 7); `nuqtaPx` (Task 2); `applyGlyphEdit`'s 5th parameter (Task 8).
- Produces: no new public API. `drawWarpedGlyphRun` gains a trailing `joinPins: Map<number, JoinPin[]> = new Map()` parameter; `measureStretchedRunWidth`'s args gain `joinPins?: Map<number, JoinPin[]>`.

**Both call sites must get the same pins.** `measureStretchedRunWidth` exists because nothing else in the app knows how wide a *stretched* run is; if it measured unpinned ink while the renderer drew pinned ink, the auto-justify solver would optimise a width the user never sees and nothing would fail loudly.

- [ ] **Step 1: Compute the pins in `ShapedText`**

In `src/components/ShapedText.tsx`, add the imports:

```tsx
import { computeJoinPins, PIN_RADIUS_NUQTA, type JoinPin } from "../lib/joinPins";
import { nuqtaPx } from "../lib/nuqta";
```

and add a memo beside the existing `glyphMetrics` memo (it needs the same inputs):

```tsx
  /**
   * Where this run's letters actually connect, so a stroke stretch cannot
   * tear a seam. Memoized per shaped run because it flattens every glyph's
   * outline to polygons and grid-samples each adjacent pair — far too much
   * to redo per drawn point.
   *
   * A font with no measured nuqta (Ruq'ah, Diwani — deliberately out of
   * scope for per-stroke editing) yields no pins at all, which is exactly
   * today's behaviour for them.
   */
  const joinPins = useMemo<Map<number, JoinPin[]>>(() => {
    const { font, glyphs, unitsPerEm } = shapeData;
    const nuqta = nuqtaPx(fontFamily, fontSize);
    if (!font || glyphs.length < 2 || nuqta == null) return new Map();
    return computeJoinPins({
      glyphs,
      font,
      fontSize,
      unitsPerEm,
      pinRadius: nuqta * PIN_RADIUS_NUQTA,
    });
  }, [shapeData, fontFamily, fontSize]);
```

- [ ] **Step 2: Thread them into the drawing loop**

Add a trailing parameter to `drawWarpedGlyphRun`:

```tsx
  glyphTransforms: GlyphTransform[] = [],
  joinPins: Map<number, JoinPin[]> = new Map()
) {
```

Inside its glyph loop, beside `const edit = glyphEdits.find(...)` (line ~230):

```tsx
    const pins = joinPins.get(glyphIndex);
```

and pass `pins` as the 5th argument to all three `applyGlyphEdit` calls (lines ~291, ~307, ~323):

```tsx
          const handled = applyGlyphEdit(c.x + gx, c.y + gy, edit, contourIndex, pins);
```
```tsx
          const handled1 = applyGlyphEdit(c.x1 + gx, c.y1 + gy, edit, contourIndex, pins);
```
```tsx
          const handled2 = applyGlyphEdit(c.x2 + gx, c.y2 + gy, edit, contourIndex, pins);
```

Then add `joinPins` as the final argument at the `drawWarpedGlyphRun(` call site (~line 913).

- [ ] **Step 3: Give the width solver the same pins**

In `src/lib/justify.ts`, add `joinPins?: Map<number, JoinPin[]>` to `measureStretchedRunWidth`'s args type with `import type { JoinPin } from "./joinPins";`, read it inside the glyph loop beside `const edit = ...`:

```ts
      const pins = args.joinPins?.get(i);
```

and pass it as the 5th argument to all three `applyGlyphEdit` calls (lines 85/88/91).

Extend that function's doc comment with:

```
 * `joinPins` must be the same set `ShapedText` is rendering with (both come
 * from `lib/joinPins.ts`'s `computeJoinPins`). Measuring unpinned ink while
 * the renderer draws pinned ink would make the solver optimise a width the
 * user never sees, and nothing would fail loudly.
```

Then in `solveJustifyForBlock`, compute the pins once after shaping and pass them in:

```ts
  const { computeJoinPins, PIN_RADIUS_NUQTA } = await import("./joinPins");
  const { nuqtaPx } = await import("./nuqta");
  const nuqta = nuqtaPx(args.fontFamily, args.fontSize);
  const joinPins =
    nuqta == null
      ? undefined
      : computeJoinPins({
          glyphs,
          font,
          fontSize: args.fontSize,
          unitsPerEm,
          pinRadius: nuqta * PIN_RADIUS_NUQTA,
        });
```

and add `joinPins,` to the `measureStretchedRunWidth({ ... })` literal inside the solver callback.

(`joinPins.ts` and `nuqta.ts` are both harfbuzz-free, so static imports would work too — but `solveJustifyForBlock` already uses dynamic imports for its other dependencies, so keeping them together reads consistently. Either is acceptable; do not add a *static* `harfbuzzjs` import to this module's graph under any circumstances, as that throws under Vitest's Node ESM loader.)

- [ ] **Step 4: Verify the loop**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
```
Expected: all clean.

- [ ] **Step 5: Verify the original bug is gone, by hand**

`npm run dev`, default text `حرف` at 275% zoom, font Naskh (TahaNaskhRegular):
1. Select the block → hover the ra → drag its stretch dot down and left.
2. **The hairline gap at the hah/ra junction must not appear**, at any point in the drag. This is the originally reported bug.
3. Repeat at several fonts: Amiri, Thuluth, Kufi, Urdu.
4. Switch to Ruqaa: behaviour is unchanged from before this plan (no pins) and nothing errors.

Konva's hover-mounted handles do not take scripted drags reliably — drive this by hand.

- [ ] **Step 6: Commit**

```bash
git add src/components/ShapedText.tsx src/lib/justify.ts package.json package-lock.json
git commit -m "Pin letter joins while stretching a stroke"
```

---

## Task 10: Prove join invariance against real fonts

Success criterion 1, turned into a test. The precedent is `src/lib/diacritics.test.ts`: real harfbuzzjs, real fonts from `public/fonts/`, no hand-written glyph fixtures. **A fabricated-fixture version of that suite is exactly what let a bug ship unnoticed once before** — do not mock shaping here.

**Files:**
- Create: `src/lib/joinPins.fonts.test.ts`

**Interfaces:**
- Consumes: `shapeText` (`src/lib/harfbuzz.ts`), `computeJoinPins`, `applyGlyphEdit`, `nuqtaPx`.
- Produces: nothing — this is a test.

- [ ] **Step 1: Read the precedent**

Read `src/lib/diacritics.test.ts` first, specifically how it loads a font from `public/fonts/` and awaits `shapeText`. Reuse that exact mechanism (URL/path form, any `beforeAll`) rather than inventing a second one.

- [ ] **Step 2: Write the test**

Create `src/lib/joinPins.fonts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shapeText } from "./harfbuzz";
import { computeJoinPins, PIN_RADIUS_NUQTA } from "./joinPins";
import { applyGlyphEdit } from "./glyphEdits";
import { nuqtaPx } from "./nuqta";
import type { GlyphEdit } from "../types";

// Deliberately spread across styles, not only the Naskh faces the schemas
// were authored against — the mapping's error is expected to grow with
// distance from Naskh proportions.
const FONTS = [
  "/fonts/TahaNaskhRegular.ttf",
  "/fonts/Amiri.ttf",
  "/fonts/Thuluth.ttf",
  "/fonts/Kufi.ttf",
  "/fonts/Urdu.ttf",
];

const FONT_FAMILY_BY_URL: Record<string, string> = {
  "/fonts/TahaNaskhRegular.ttf": "TahaNaskhRegular",
  "/fonts/Amiri.ttf": "Amiri",
  "/fonts/Thuluth.ttf": "Thuluth",
  "/fonts/Kufi.ttf": "Kufi",
  "/fonts/Urdu.ttf": "Urdu",
};

// Connected words, each exercising several joining forms.
const WORDS = ["حرف", "بسم", "كتب", "سلام"];
const FONT_SIZE = 200;

describe("join invariance against real fonts", () => {
  for (const fontUrl of FONTS) {
    const fontFamily = FONT_FAMILY_BY_URL[fontUrl];

    for (const word of WORDS) {
      it(`${fontFamily} / ${word}: a pinned join does not move at any factor`, async () => {
        const { glyphs, font, unitsPerEm } = await shapeText(word, fontUrl);
        expect(font).toBeTruthy();

        const nuqta = nuqtaPx(fontFamily, FONT_SIZE)!;
        expect(nuqta).toBeGreaterThan(0);

        const pins = computeJoinPins({
          glyphs,
          font: font!,
          fontSize: FONT_SIZE,
          unitsPerEm,
          pinRadius: nuqta * PIN_RADIUS_NUQTA,
        });

        // A connected Arabic word must produce at least one join. If this
        // fails, overlap detection is broken — not the guard.
        expect(pins.size).toBeGreaterThan(0);

        for (const [glyphIndex, glyphPins] of pins) {
          for (const pin of glyphPins) {
            for (const factor of [0.85, 1, 1.2, 1.5, 1.8]) {
              const edit: GlyphEdit = {
                glyphIndex,
                stretches: [
                  {
                    id: "h1",
                    // A deliberately brutal axis: anchored far from the pin,
                    // aimed straight through it, with a band wide enough to
                    // cover the whole glyph. Nothing a real schema handle
                    // produces is harsher than this.
                    anchorX: pin.x - 400,
                    anchorY: pin.y,
                    dragOriginX: pin.x,
                    dragOriginY: pin.y,
                    dragX: pin.x + 400,
                    dragY: pin.y,
                    bandWidth: 4000,
                    minFactor: 0.85,
                    maxFactor: 1.8,
                    factor,
                  },
                ],
              };

              const moved = applyGlyphEdit(pin.x, pin.y, edit, -1, [pin]);
              expect(
                Math.hypot(moved.x - pin.x, moved.y - pin.y),
                `${fontFamily} ${word} glyph ${glyphIndex} factor ${factor}`
              ).toBeLessThan(1e-9);
            }
          }
        }
      });
    }
  }

  it("gives an out-of-scope font no pins at all", () => {
    expect(nuqtaPx("Ruqaa", FONT_SIZE)).toBeNull();
    expect(nuqtaPx("HarfCanvasDiwani", FONT_SIZE)).toBeNull();
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run src/lib/joinPins.fonts.test.ts`
Expected: PASS.

If `pins.size` is 0 for some font/word pair, that is a **real finding, not a test to weaken**: it means adjacent glyphs in that face do not overlap under the grid sampling. Before touching the assertion, raise `overlapCentroid`'s `samples` (24 → 48) and re-run. If it still finds nothing, stop and report which font/word combinations produce no join — the design assumes connected letters physically overlap, and a counterexample belongs back in the spec, not silently absorbed here.

- [ ] **Step 4: Run the full loop**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
```
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/joinPins.fonts.test.ts package.json package-lock.json
git commit -m "Assert join invariance across five real fonts"
```

---

## Task 11: Update the documentation

CLAUDE.md's "Known defects in the stretch math" section describes behaviour this plan changes. Leaving it stale would mislead the next reader into re-diagnosing fixed bugs.

**Files:**
- Modify: `CLAUDE.md` (the "Known defects in the stretch math…" and "The nuqta is per-font…" subsections, and the Deferred-features list)
- Modify: `docs/superpowers/specs/2026-08-12-per-stroke-editing-design.md` (status line)

- [ ] **Step 1: Rewrite the known-defects section**

In CLAUDE.md, under **Stroke-schema-driven glyph editor**:

- In "Known defects in the stretch math, and the schema data nobody reads": mark **Symptom 1 (the cleft) as fixed**, naming both halves of the fix — `tAlong` is now clamped and eased (`lib/glyphEdits.ts`), and joins are pinned from real glyph overlap (`lib/joinPins.ts`), applied as a guard on the *net* displacement via `applyGlyphEdit`'s optional 5th parameter. Say explicitly that join pins are **plain-text only**: `ShapeFillText` tiles its run through a per-tile affine transform, so pins there are separate work.
- Leave **Symptom 2 unchanged and still open** — `axis: "path"` and inverted `protectedZones` are changes 2 and 4, gated behind the spec's Phase C measurement.
- Update the "three layers of authored data consumed by nothing" list: `lengthDots` is now consumed (it is the half-nuqta step divisor). `preserveCurvature`, `preserveThickness`, the zones' own `axis` field, `verticalLevels` and `styleProfile.measurementSystem.dotUnit` are still consumed by nothing.
- In "The nuqta is per-font and must be measured": note the table now lives in code at `src/lib/nuqta.ts` as dot/em ratios, that an absent font returns `null`, and that this null is the out-of-scope mechanism for Ruq'ah and Diwani — it disables both nuqta snapping and join pins. Record that quantization snaps the **added** length (`1 + round((factor-1)/step)*step`), not the absolute length, and why: a stroke's natural `lengthDots` is not itself a half-nuqta multiple, so absolute snapping would move `factor = 1` off the font's natural rendering.
- Amend the bullet stating the kashida formula is duplicated: it now lives once in `src/lib/kashidaFactor.ts`, called by both `App.tsx`'s `setBlockKashidaAmount` and `justify.ts`'s `applyKashidaAmountToEdits`.

In the **Kashida auto-justify** section, amend the paragraph asserting `applyKashidaAmountToEdits` duplicates the formula — it now delegates — and note that `measureStretchedRunWidth` must be given the same `joinPins` the renderer uses, for the same reason it must import rather than reimplement `applyGlyphEdit`.

- [ ] **Step 2: Update the spec's status**

In `docs/superpowers/specs/2026-08-12-per-stroke-editing-design.md`, change the status line to record that Phases A and B are implemented (plan: `docs/superpowers/plans/2026-08-13-per-stroke-editing-phase-ab.md`), that join pins landed plain-text-only per the user's 2026-08-13 decision, and that Phase C — the measurement that gates Phase D — is the next step. Leave the diagnosis and the five changes intact as the record of why.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-12-per-stroke-editing-design.md package.json package-lock.json
git commit -m "Document the clamped axis, nuqta quantization, and join pins"
```

---

## What this plan deliberately does not do

- **Change 2 (a real spine instead of a chord) and change 4 (enforce `protectedZones`).** Both are built on the proportional schema→real-glyph mapping — the exact mechanism that caused the cleft. Spec Phase C measures how far that mapping's error actually goes before either is attempted; change 4 in particular can freeze the *wrong* part of a letter, which is a new failure mode rather than a fixed one.
- **Join pins on Shape Fill or text-on-path blocks.** Plain text only, per the user's 2026-08-13 decision.
- **Any parametric letterform rendering.** The schemas carry no joining geometry, so drawing from skeletons would forfeit the seamless joining this feature exists to protect.
