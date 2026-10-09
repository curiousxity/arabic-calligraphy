# Practice Sheet Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the selected text block as a printable PDF practice sheet (model row, faint trace rows, ruled blank rows) on a nuqta grid sized to the learner's pen.

**Architecture:** A pure layout module (`src/lib/practiceSheet.ts`) turns options plus an injected measured run into a page description in millimetres. A thin writer (`src/lib/practiceSheetPdf.ts`) shapes the text with the existing HarfBuzz pipeline, converts opentype glyph outlines to jsPDF vector paths, and draws the layout. A portaled dialog opened from the Export panel owns all UI state; nothing reaches `App.tsx`.

**Tech Stack:** TypeScript, React 19, jsPDF 4 (already a dependency, lazily imported), opentype.js, harfbuzzjs, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-practice-sheet-design.md`

## Global Constraints

- Shaping tests use real harfbuzzjs and real fonts from `public/fonts/`, never hand-written `{ g, cl }` fixtures; harfbuzzjs is loaded via `createRequire` (CLAUDE.md test convention).
- Font URLs are resolved through `resolveFontUrl`, never by indexing `FONT_URLS` (`.claude/rules/custom-fonts.md`).
- `src/lib/practiceSheet.ts` must not import `./harfbuzz` (keeps it Vitest-importable, same rule as `strokeCuts.ts` / `customFonts.ts`).
- Dialog state never reaches `App.tsx`; the dialog is portaled to `document.body` like `FontUploadDialog`.
- v1 ignores diacritic overrides, glyph transforms, stroke cuts, gradients. Kashida is honoured because it is text.
- Pages are A4 (210 × 297 mm) or US Letter (215.9 × 279.4 mm), portrait only.
- Trace rows stroke 0.15 mm in `#B4B4B4`; model rows fill black.
- Verification loop after each task: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, and `npm run build` on the last task.
- Commits bump `package.json`/`package-lock.json` automatically via the pre-commit hook; that is expected.

## Review Focus

1. **Text wider than the printable area** (a long phrase at a 4 mm nib): the sheet must shrink to fit and report `fitScale < 1`, never wrap or clip. Pinned in Task 1 ("shrinks an over-wide run").
2. **Row counts that overflow the page** (e.g. 1 / 10 / 10 at a large nib): rows are dropped from the end and `droppedRows` says how many; nothing overlaps the footer. Pinned in Task 1 ("drops rows that do not fit").
3. **Empty or whitespace-only text**: zero rows, no throw, dialog says so. Pinned in Task 1 ("returns no rows for empty text") and Task 3 (dialog readout).
4. **Uploaded font key whose bytes are gone** (`isFontUnavailable`): `shapeText` rejects; the dialog must show the error inline and keep Download disabled rather than throwing. Pinned in Task 3 (error state test is manual; the dialog catches and renders `message`).
5. **Nib width of 0 or negative, or NaN from a cleared input**: the layout must clamp to a sane minimum (0.5 mm) rather than produce an infinite em. Pinned in Task 1 ("clamps a non-positive nib width").

---

### Task 1: Pure layout module

**Files:**
- Create: `src/lib/practiceSheet.ts`
- Test: `src/lib/practiceSheet.test.ts`

**Interfaces:**
- Consumes: `nuqtaUnits(fontFamily, fontSize)` from `./nuqta`; `HarfBuzzGlyph` type from `./normalizeGlyphs`.
- Produces (used by Tasks 2 and 3):

```ts
export type PracticeSheetPage = "a4" | "letter";
export type PracticeSheetScale = { nibWidthMm: number } | { emHeightMm: number };
export type PracticeSheetRowKind = "model" | "trace" | "blank";
export type PracticeSheetOptions = {
  page: PracticeSheetPage;
  marginMm: number;
  scale: PracticeSheetScale;
  rows: { model: number; trace: number; blank: number };
  fontFamily: string;
};
export type MeasuredRun = {
  advanceUnits: number;   // sum of glyph advances, font units
  ascenderUnits: number;  // font.ascender
  descenderUnits: number; // font.descender (negative)
  unitsPerEm: number;
};
export type PracticeSheetRow = { kind: PracticeSheetRowKind; baselineY: number; leftX: number };
export type PracticeSheetLayout = {
  pageMm: { width: number; height: number };
  marginMm: number;
  emHeightMm: number;   // effective, after fitScale
  nuqtaMm: number;      // effective, after fitScale
  fitScale: number;     // 1 unless the run was shrunk to fit
  runWidthMm: number;   // effective
  rows: PracticeSheetRow[];
  droppedRows: number;
  grid: { x: number[]; y: number[]; heavyEvery: number };
  footer: string;
};
export const PAGE_SIZES_MM: Record<PracticeSheetPage, { width: number; height: number }>;
export const DEFAULT_PRACTICE_SHEET_OPTIONS: Omit<PracticeSheetOptions, "fontFamily">;
export const MIN_NIB_MM = 0.5;
export function emHeightFromScale(scale: PracticeSheetScale, fontFamily: string): number;
export function measuredRunFromGlyphs(
  glyphs: HarfBuzzGlyph[],
  font: { ascender: number; descender: number },
  unitsPerEm: number
): MeasuredRun;
export function layoutPracticeSheet(options: PracticeSheetOptions, run: MeasuredRun): PracticeSheetLayout;
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/practiceSheet.test.ts`:

```ts
/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import { normalizeGlyphs } from "./normalizeGlyphs";
import { nuqtaUnits } from "./nuqta";
import {
  DEFAULT_PRACTICE_SHEET_OPTIONS,
  MIN_NIB_MM,
  PAGE_SIZES_MM,
  emHeightFromScale,
  layoutPracticeSheet,
  measuredRunFromGlyphs,
  type MeasuredRun,
  type PracticeSheetOptions,
} from "./practiceSheet";

// harfbuzzjs's CommonJS entrypoint exports a Promise, which Node's ESM
// interop tries to await during a static `import` and throws on. `require`
// sidesteps it. Copied from fitToWidth.test.ts per CLAUDE.md.
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");

type HbModule = {
  createBlob: (data: Uint8Array) => { destroy?: () => void };
  createFace: (blob: unknown, index: number) => { destroy?: () => void };
  createFont: (face: unknown) => {
    setScale?: (x: number, y: number) => void;
    destroy?: () => void;
  };
  createBuffer: () => {
    addText: (t: string) => void;
    guessSegmentProperties?: () => void;
    setDirection?: (d: string) => void;
    setScript?: (s: string) => void;
    setLanguage?: (l: string) => void;
    json: (font?: unknown) => unknown[];
    destroy?: () => void;
  };
  shape: (font: unknown, buffer: unknown) => void;
};

function resolveHbLoader(mod: unknown): Promise<HbModule> {
  let m: unknown = mod;
  let rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;
  if (typeof m === "function") {
    return (m as () => Promise<HbModule> | HbModule)() as Promise<HbModule>;
  }
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec && typeof rec.then === "function") return m as Promise<HbModule>;
  throw new Error("Unable to resolve harfbuzzjs loader in test");
}

const hbPromise = resolveHbLoader(hbjsModule);

async function shapeReal(
  text: string,
  fontFile: string
): Promise<{ glyphs: HarfBuzzGlyph[]; font: opentype.Font; unitsPerEm: number }> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const fontPath = path.resolve(dir, "../../public/fonts", fontFile);
  const fontData = fs.readFileSync(fontPath);
  const arrayBuffer = fontData.buffer.slice(
    fontData.byteOffset,
    fontData.byteOffset + fontData.byteLength
  );
  const parsedFont = opentype.parse(arrayBuffer);
  const upm = parsedFont.unitsPerEm || 1000;
  if (text.length === 0) return { glyphs: [], font: parsedFont, unitsPerEm: upm };

  const hb = await hbPromise;
  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();
  try {
    if (typeof font.setScale === "function") font.setScale(upm, upm);
    buffer.addText(text);
    buffer.guessSegmentProperties?.();
    buffer.setDirection?.("rtl");
    buffer.setScript?.("arab");
    buffer.setLanguage?.("ar");
    hb.shape(font, buffer);
    let raw: unknown[] = [];
    try {
      raw = buffer.json(font);
    } catch {
      raw = buffer.json();
    }
    return { glyphs: normalizeGlyphs(raw as never), font: parsedFont, unitsPerEm: upm };
  } finally {
    buffer.destroy?.();
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

/** A synthetic run with round numbers so the arithmetic is checkable by hand. */
const syntheticRun = (advanceUnits: number): MeasuredRun => ({
  advanceUnits,
  ascenderUnits: 800,
  descenderUnits: -200,
  unitsPerEm: 1000,
});

const opts = (over: Partial<PracticeSheetOptions> = {}): PracticeSheetOptions => ({
  ...DEFAULT_PRACTICE_SHEET_OPTIONS,
  fontFamily: "Thuluth",
  ...over,
});

describe("emHeightFromScale", () => {
  it("derives the em from nib width through the font's nuqta ratio", () => {
    const ratio = nuqtaUnits("Thuluth", 1); // 0.0918
    expect(emHeightFromScale({ nibWidthMm: 4 }, "Thuluth")).toBeCloseTo(4 / ratio, 6);
  });

  it("uses a direct em height unchanged", () => {
    expect(emHeightFromScale({ emHeightMm: 30 }, "Thuluth")).toBe(30);
  });

  it("clamps a non-positive nib width", () => {
    const ratio = nuqtaUnits("Thuluth", 1);
    expect(emHeightFromScale({ nibWidthMm: 0 }, "Thuluth")).toBeCloseTo(MIN_NIB_MM / ratio, 6);
    expect(emHeightFromScale({ nibWidthMm: Number.NaN }, "Thuluth")).toBeCloseTo(MIN_NIB_MM / ratio, 6);
  });
});

describe("layoutPracticeSheet", () => {
  it("reports the page size and a nuqta equal to the nib when nothing shrinks", () => {
    const layout = layoutPracticeSheet(opts({ scale: { nibWidthMm: 4 } }), syntheticRun(2000));
    expect(layout.pageMm).toEqual(PAGE_SIZES_MM.a4);
    expect(layout.fitScale).toBe(1);
    expect(layout.nuqtaMm).toBeCloseTo(4, 6);
    expect(layout.emHeightMm).toBeCloseTo(emHeightFromScale({ nibWidthMm: 4 }, "Thuluth"), 6);
  });

  it("lays rows out model, trace, blank in order with real row heights", () => {
    const layout = layoutPracticeSheet(
      opts({ scale: { emHeightMm: 20 }, rows: { model: 1, trace: 2, blank: 1 } }),
      syntheticRun(1000)
    );
    expect(layout.rows.map((r) => r.kind)).toEqual(["model", "trace", "trace", "blank"]);
    // Row height = (800 - -200)/1000 * 20 + one nuqta of air.
    const rowHeight = 20 + layout.nuqtaMm;
    const first = layout.rows[0].baselineY;
    expect(first).toBeCloseTo(layout.marginMm + (800 / 1000) * 20, 6);
    expect(layout.rows[1].baselineY - first).toBeCloseTo(rowHeight, 6);
    expect(layout.rows[3].baselineY - layout.rows[2].baselineY).toBeCloseTo(rowHeight, 6);
  });

  it("right-aligns the run to the printable area", () => {
    const layout = layoutPracticeSheet(opts({ scale: { emHeightMm: 20 } }), syntheticRun(1500));
    // 1500 units at a 20 mm em is 30 mm wide.
    expect(layout.runWidthMm).toBeCloseTo(30, 6);
    for (const row of layout.rows) {
      expect(row.leftX).toBeCloseTo(PAGE_SIZES_MM.a4.width - layout.marginMm - 30, 6);
    }
  });

  it("shrinks an over-wide run to the printable width and reports fitScale", () => {
    const o = opts({ scale: { nibWidthMm: 4 }, marginMm: 15 });
    const layout = layoutPracticeSheet(o, syntheticRun(20000)); // far wider than A4
    expect(layout.fitScale).toBeLessThan(1);
    expect(layout.runWidthMm).toBeCloseTo(PAGE_SIZES_MM.a4.width - 2 * 15, 6);
    expect(layout.nuqtaMm).toBeCloseTo(4 * layout.fitScale, 6);
    expect(layout.footer).toContain("nuqta");
  });

  it("drops rows that do not fit and says how many", () => {
    const layout = layoutPracticeSheet(
      opts({ scale: { emHeightMm: 60 }, rows: { model: 1, trace: 10, blank: 10 } }),
      syntheticRun(1000)
    );
    expect(layout.rows.length).toBeLessThan(21);
    expect(layout.droppedRows).toBe(21 - layout.rows.length);
    const last = layout.rows[layout.rows.length - 1];
    expect(last.baselineY).toBeLessThan(PAGE_SIZES_MM.a4.height - layout.marginMm);
  });

  it("returns no rows for an empty run", () => {
    const layout = layoutPracticeSheet(opts(), syntheticRun(0));
    expect(layout.rows).toEqual([]);
    expect(layout.droppedRows).toBe(0);
  });

  it("spaces grid lines one nuqta apart across the printable area", () => {
    const layout = layoutPracticeSheet(opts({ scale: { nibWidthMm: 5 } }), syntheticRun(1000));
    expect(layout.grid.heavyEvery).toBe(5);
    expect(layout.grid.x[0]).toBeCloseTo(layout.marginMm, 6);
    expect(layout.grid.x[1] - layout.grid.x[0]).toBeCloseTo(5, 6);
    const lastX = layout.grid.x[layout.grid.x.length - 1];
    expect(lastX).toBeLessThanOrEqual(PAGE_SIZES_MM.a4.width - layout.marginMm + 1e-9);
    expect(layout.grid.y[0]).toBeCloseTo(layout.marginMm, 6);
  });

  it("uses Letter dimensions when asked", () => {
    const layout = layoutPracticeSheet(opts({ page: "letter" }), syntheticRun(1000));
    expect(layout.pageMm).toEqual(PAGE_SIZES_MM.letter);
  });
});

describe("measuredRunFromGlyphs (real font)", () => {
  it("sums real advances and carries the font's vertical metrics", async () => {
    const { glyphs, font, unitsPerEm } = await shapeReal("محمد", "Amiri.ttf");
    const run = measuredRunFromGlyphs(glyphs, font, unitsPerEm);
    const expected = glyphs.reduce((s, g) => s + (g.ax ?? 0), 0);
    expect(run.advanceUnits).toBe(expected);
    expect(run.advanceUnits).toBeGreaterThan(0);
    expect(run.ascenderUnits).toBe(font.ascender);
    expect(run.descenderUnits).toBe(font.descender);
    expect(run.descenderUnits).toBeLessThan(0);
    expect(run.unitsPerEm).toBe(unitsPerEm);
  });

  it("keeps a real Amiri run inside the margin at a 3 mm nib", async () => {
    const { glyphs, font, unitsPerEm } = await shapeReal("بسم الله", "Amiri.ttf");
    const run = measuredRunFromGlyphs(glyphs, font, unitsPerEm);
    const layout = layoutPracticeSheet(
      opts({ fontFamily: "Amiri", scale: { nibWidthMm: 3 } }),
      run
    );
    expect(layout.rows.length).toBeGreaterThan(0);
    const right = layout.rows[0].leftX + layout.runWidthMm;
    expect(right).toBeCloseTo(layout.pageMm.width - layout.marginMm, 6);
    expect(layout.rows[0].leftX).toBeGreaterThanOrEqual(layout.marginMm - 1e-9);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/practiceSheet.test.ts`
Expected: FAIL, "Cannot find module './practiceSheet'".

- [ ] **Step 3: Write the module**

Create `src/lib/practiceSheet.ts`:

```ts
/**
 * Practice-sheet page layout, in millimetres.
 *
 * Pure: no React, no Konva, no HarfBuzz. Shaping is injected as a
 * `MeasuredRun` the way `fitToWidth` takes a measurement, so this module is
 * Vitest-importable and the page arithmetic is testable with round numbers.
 *
 * The one idea: **one nuqta on paper equals the nib width.** `nuqta.ts`
 * holds a measured nuqta-to-font-size ratio per face, so the em height in mm
 * is nib ÷ ratio, and the grid is drawn in that unit. See
 * `docs/superpowers/specs/2026-10-09-practice-sheet-design.md`.
 */
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import { nuqtaUnits } from "./nuqta";

export type PracticeSheetPage = "a4" | "letter";
export type PracticeSheetScale = { nibWidthMm: number } | { emHeightMm: number };
export type PracticeSheetRowKind = "model" | "trace" | "blank";

export type PracticeSheetOptions = {
  page: PracticeSheetPage;
  marginMm: number;
  scale: PracticeSheetScale;
  rows: { model: number; trace: number; blank: number };
  fontFamily: string;
};

export type MeasuredRun = {
  /** Sum of glyph advances, font units. */
  advanceUnits: number;
  /** `font.ascender`, font units. */
  ascenderUnits: number;
  /** `font.descender`, font units (negative). */
  descenderUnits: number;
  unitsPerEm: number;
};

export type PracticeSheetRow = {
  kind: PracticeSheetRowKind;
  /** Baseline y from the page top, mm. */
  baselineY: number;
  /** x of the run's left edge, mm. Glyphs walk rightward from here. */
  leftX: number;
};

export type PracticeSheetLayout = {
  pageMm: { width: number; height: number };
  marginMm: number;
  /** Effective em height after any fit shrink, mm. */
  emHeightMm: number;
  /** Effective nuqta after any fit shrink, mm. Also the grid pitch. */
  nuqtaMm: number;
  /** 1 unless the run was wider than the printable area. */
  fitScale: number;
  runWidthMm: number;
  rows: PracticeSheetRow[];
  droppedRows: number;
  grid: { x: number[]; y: number[]; heavyEvery: number };
  footer: string;
};

export const PAGE_SIZES_MM: Record<PracticeSheetPage, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

export const DEFAULT_PRACTICE_SHEET_OPTIONS: Omit<PracticeSheetOptions, "fontFamily"> = {
  page: "a4",
  marginMm: 15,
  scale: { nibWidthMm: 4 },
  rows: { model: 1, trace: 3, blank: 3 },
};

/** Below this a nib makes no sense and the em would explode. */
export const MIN_NIB_MM = 0.5;
/** Space reserved at the page foot for the footer line, mm. */
const FOOTER_RESERVE_MM = 8;
const GRID_HEAVY_EVERY = 5;

function clampNib(nib: number): number {
  return Number.isFinite(nib) && nib >= MIN_NIB_MM ? nib : MIN_NIB_MM;
}

export function emHeightFromScale(scale: PracticeSheetScale, fontFamily: string): number {
  const ratio = nuqtaUnits(fontFamily, 1);
  if ("nibWidthMm" in scale) return clampNib(scale.nibWidthMm) / ratio;
  const em = scale.emHeightMm;
  return Number.isFinite(em) && em > 0 ? em : MIN_NIB_MM / ratio;
}

export function measuredRunFromGlyphs(
  glyphs: HarfBuzzGlyph[],
  font: { ascender: number; descender: number },
  unitsPerEm: number
): MeasuredRun {
  let advanceUnits = 0;
  for (const g of glyphs) advanceUnits += g.ax ?? 0;
  return {
    advanceUnits,
    ascenderUnits: font.ascender,
    descenderUnits: font.descender,
    unitsPerEm: Math.max(unitsPerEm || 1000, 1),
  };
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  if (step <= 0) return out;
  for (let v = from; v <= to + 1e-9; v += step) out.push(v);
  return out;
}

export function layoutPracticeSheet(
  options: PracticeSheetOptions,
  run: MeasuredRun
): PracticeSheetLayout {
  const pageMm = PAGE_SIZES_MM[options.page];
  const marginMm = Math.max(0, Math.min(options.marginMm, Math.min(pageMm.width, pageMm.height) * 0.45));
  const printableW = pageMm.width - 2 * marginMm;
  const printableBottom = pageMm.height - marginMm - FOOTER_RESERVE_MM;

  const ratio = nuqtaUnits(options.fontFamily, 1);
  const upm = Math.max(run.unitsPerEm || 1000, 1);
  const requestedEm = emHeightFromScale(options.scale, options.fontFamily);
  const requestedWidth = (run.advanceUnits / upm) * requestedEm;

  const fitScale = requestedWidth > printableW ? printableW / requestedWidth : 1;
  const emHeightMm = requestedEm * fitScale;
  const nuqtaMm = emHeightMm * ratio;
  const runWidthMm = requestedWidth * fitScale;

  const ascMm = (run.ascenderUnits / upm) * emHeightMm;
  const descMm = (-run.descenderUnits / upm) * emHeightMm;
  const rowHeight = ascMm + descMm + nuqtaMm;
  const leftX = pageMm.width - marginMm - runWidthMm;

  const wanted: PracticeSheetRowKind[] = [];
  if (run.advanceUnits > 0) {
    for (let i = 0; i < options.rows.model; i++) wanted.push("model");
    for (let i = 0; i < options.rows.trace; i++) wanted.push("trace");
    for (let i = 0; i < options.rows.blank; i++) wanted.push("blank");
  }

  const rows: PracticeSheetRow[] = [];
  let top = marginMm;
  for (const kind of wanted) {
    if (top + rowHeight > printableBottom) break;
    rows.push({ kind, baselineY: top + ascMm, leftX });
    top += rowHeight;
  }
  const droppedRows = wanted.length - rows.length;

  const grid = {
    x: range(marginMm, pageMm.width - marginMm, nuqtaMm),
    y: range(marginMm, printableBottom, nuqtaMm),
    heavyEvery: GRID_HEAVY_EVERY,
  };

  const nibNote =
    "nibWidthMm" in options.scale && fitScale < 1
      ? ` (shrunk to fit; your ${clampNib(options.scale.nibWidthMm).toFixed(1)} mm nib is wider)`
      : "";
  const footer = `${options.fontFamily} · em ${emHeightMm.toFixed(1)} mm · nuqta ${nuqtaMm.toFixed(2)} mm${nibNote}`;

  return {
    pageMm,
    marginMm,
    emHeightMm,
    nuqtaMm,
    fitScale,
    runWidthMm,
    rows,
    droppedRows,
    grid,
    footer,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/practiceSheet.test.ts`
Expected: PASS, all tests green. (The real-font suite loads harfbuzzjs; first run takes a few seconds.)

- [ ] **Step 5: Typecheck and lint, then commit**

Run: `npx tsc --noEmit -p tsconfig.app.json; npm run lint`
Expected: no errors.

```bash
git add src/lib/practiceSheet.ts src/lib/practiceSheet.test.ts
git commit -m "Add pure practice-sheet page layout

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Outline-to-PDF converter and sheet writer

**Files:**
- Create: `src/lib/practiceSheetPdf.ts`
- Test: `src/lib/practiceSheetPdf.test.ts`

**Interfaces:**
- Consumes: `layoutPracticeSheet`, `measuredRunFromGlyphs`, `PracticeSheetOptions`, `PracticeSheetLayout` from `./practiceSheet`; `shapeText` from `./harfbuzz`; `resolveFontUrl` from `../hooks/useShapedGlyphs`; `HarfBuzzGlyph` from `./normalizeGlyphs`.
- Produces (used by Task 3):

```ts
export type PdfPathOp = { op: "m" | "l" | "c" | "h"; c?: number[] };
/** opentype path commands → jsPDF `path()` ops, scaled by `scale`, translated to (ox, oy), y flipped. */
export function glyphPathToPdfOps(
  commands: opentype.PathCommand[],
  scale: number,
  ox: number,
  oy: number
): PdfPathOp[];
/** Shapes `text` in `fontFamily`, lays the sheet out, draws it. Returns the jsPDF document. */
export function buildPracticeSheetPdf(
  text: string,
  options: PracticeSheetOptions
): Promise<{ pdf: import("jspdf").jsPDF; layout: PracticeSheetLayout }>;
export function practiceSheetFilename(text: string): string;
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/practiceSheetPdf.test.ts`:

```ts
/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as opentype from "opentype.js";
import { glyphPathToPdfOps, practiceSheetFilename } from "./practiceSheetPdf";

function loadFont(file: string): opentype.Font {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const data = fs.readFileSync(path.resolve(dir, "../../public/fonts", file));
  return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

describe("glyphPathToPdfOps", () => {
  it("translates, scales and flips y for move and line commands", () => {
    const ops = glyphPathToPdfOps(
      [
        { type: "M", x: 100, y: 200 },
        { type: "L", x: 300, y: 0 },
        { type: "Z" },
      ],
      0.01,
      10,
      50
    );
    expect(ops).toEqual([
      { op: "m", c: [11, 48] },
      { op: "l", c: [13, 50] },
      { op: "h" },
    ]);
  });

  it("promotes a quadratic to a cubic with the standard control-point formula", () => {
    const ops = glyphPathToPdfOps(
      [
        { type: "M", x: 0, y: 0 },
        { type: "Q", x1: 300, y1: 300, x: 600, y: 0 },
      ],
      1,
      0,
      0
    );
    // Q(P0, P1, P2) → C(P0 + 2/3 (P1−P0), P2 + 2/3 (P1−P2), P2), then y flipped.
    expect(ops[1].op).toBe("c");
    expect(ops[1].c).toEqual([200, -200, 400, -200, 600, 0]);
  });

  it("passes cubic commands through with y flipped", () => {
    const ops = glyphPathToPdfOps(
      [
        { type: "M", x: 0, y: 0 },
        { type: "C", x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
      ],
      1,
      0,
      0
    );
    expect(ops[1]).toEqual({ op: "c", c: [1, -2, 3, -4, 5, -6] });
  });

  it("converts a real Amiri glyph into a closed path list", () => {
    const font = loadFont("Amiri.ttf");
    const glyph = font.charToGlyph("ب");
    const ops = glyphPathToPdfOps(glyph.getPath(0, 0, font.unitsPerEm).commands, 0.02, 0, 0);
    expect(ops.length).toBeGreaterThan(4);
    expect(ops[0].op).toBe("m");
    expect(ops.some((o) => o.op === "h")).toBe(true);
    expect(ops.every((o) => o.op === "h" || (o.c ?? []).every(Number.isFinite))).toBe(true);
  });
});

describe("practiceSheetFilename", () => {
  it("keeps Arabic letters and replaces spaces and separators", () => {
    expect(practiceSheetFilename("بسم الله")).toBe("practice-بسم-الله.pdf");
  });

  it("falls back when the text has nothing usable", () => {
    expect(practiceSheetFilename("   ")).toBe("practice-sheet.pdf");
  });
});
```

The full `buildPracticeSheetPdf` is exercised in the browser (jsPDF under jsdom has no canvas but does produce documents; a smoke test is included in Step 5 after the writer exists).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/practiceSheetPdf.test.ts`
Expected: FAIL, "Cannot find module './practiceSheetPdf'".

- [ ] **Step 3: Write the module**

Create `src/lib/practiceSheetPdf.ts`:

```ts
/**
 * Draws a `PracticeSheetLayout` into a jsPDF document as vector paths.
 *
 * Model rows fill black; trace rows stroke a hairline grey; blank rows get
 * only the rules. Glyph outlines come from opentype.js (font y up) and are
 * flipped into PDF space (y down) by `glyphPathToPdfOps`. jsPDF is imported
 * lazily, as `useExport.ts` does, so it stays out of the main bundle.
 */
import type * as opentype from "opentype.js";
import type { jsPDF } from "jspdf";
import { shapeText } from "./harfbuzz";
import { resolveFontUrl } from "../hooks/useShapedGlyphs";
import {
  layoutPracticeSheet,
  measuredRunFromGlyphs,
  type PracticeSheetLayout,
  type PracticeSheetOptions,
} from "./practiceSheet";

export type PdfPathOp = { op: "m" | "l" | "c" | "h"; c?: number[] };

const TRACE_STROKE_MM = 0.15;
const TRACE_GREY = 0xb4;
const GRID_LIGHT_MM = 0.08;
const GRID_HEAVY_MM = 0.2;
const GRID_GREY = 0xd0;
const BASELINE_MM = 0.25;

/**
 * opentype path commands → jsPDF `path()` ops. `scale` is mm per font unit,
 * `(ox, oy)` the pen origin in mm. Font y points up, PDF y points down, so y
 * is negated. jsPDF has no quadratic op; `Q` is promoted to the equivalent
 * cubic (control points at 2/3 of the way from each end to the quadratic
 * control point).
 */
export function glyphPathToPdfOps(
  commands: opentype.PathCommand[],
  scale: number,
  ox: number,
  oy: number
): PdfPathOp[] {
  const ops: PdfPathOp[] = [];
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy - y * scale;
  let cx = 0;
  let cy = 0;
  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        ops.push({ op: "m", c: [X(cmd.x), Y(cmd.y)] });
        cx = cmd.x;
        cy = cmd.y;
        break;
      case "L":
        ops.push({ op: "l", c: [X(cmd.x), Y(cmd.y)] });
        cx = cmd.x;
        cy = cmd.y;
        break;
      case "C":
        ops.push({ op: "c", c: [X(cmd.x1), Y(cmd.y1), X(cmd.x2), Y(cmd.y2), X(cmd.x), Y(cmd.y)] });
        cx = cmd.x;
        cy = cmd.y;
        break;
      case "Q": {
        const c1x = cx + (2 / 3) * (cmd.x1 - cx);
        const c1y = cy + (2 / 3) * (cmd.y1 - cy);
        const c2x = cmd.x + (2 / 3) * (cmd.x1 - cmd.x);
        const c2y = cmd.y + (2 / 3) * (cmd.y1 - cmd.y);
        ops.push({ op: "c", c: [X(c1x), Y(c1y), X(c2x), Y(c2y), X(cmd.x), Y(cmd.y)] });
        cx = cmd.x;
        cy = cmd.y;
        break;
      }
      case "Z":
        ops.push({ op: "h" });
        break;
    }
  }
  return ops;
}

export function practiceSheetFilename(text: string): string {
  const slug = text
    .trim()
    .replace(/[\s/\\:*?"<>|]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `practice-${slug}.pdf` : "practice-sheet.pdf";
}

function drawRules(pdf: jsPDF, layout: PracticeSheetLayout): void {
  const { grid, marginMm, pageMm } = layout;
  const right = pageMm.width - marginMm;
  const top = grid.y[0] ?? marginMm;
  const bottom = grid.y[grid.y.length - 1] ?? top;

  pdf.setDrawColor(GRID_GREY, GRID_GREY, GRID_GREY);
  grid.x.forEach((x, i) => {
    pdf.setLineWidth(i % grid.heavyEvery === 0 ? GRID_HEAVY_MM : GRID_LIGHT_MM);
    pdf.line(x, top, x, bottom);
  });
  grid.y.forEach((y, i) => {
    pdf.setLineWidth(i % grid.heavyEvery === 0 ? GRID_HEAVY_MM : GRID_LIGHT_MM);
    pdf.line(marginMm, y, right, y);
  });

  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(BASELINE_MM);
  for (const row of layout.rows) {
    pdf.line(marginMm, row.baselineY, right, row.baselineY);
  }
}

function drawFooter(pdf: jsPDF, layout: PracticeSheetLayout): void {
  pdf.setFontSize(8);
  pdf.setTextColor(90, 90, 90);
  pdf.text(layout.footer, layout.marginMm, layout.pageMm.height - layout.marginMm + 4);
}

export async function buildPracticeSheetPdf(
  text: string,
  options: PracticeSheetOptions
): Promise<{ pdf: jsPDF; layout: PracticeSheetLayout }> {
  const shaped = await shapeText(text, resolveFontUrl(options.fontFamily));
  const upm = Math.max(shaped.unitsPerEm || 1000, 1);
  const run = measuredRunFromGlyphs(shaped.glyphs, shaped.font, upm);
  const layout = layoutPracticeSheet(options, run);

  const { default: JsPDF } = await import("jspdf");
  const pdf = new JsPDF({
    orientation: "portrait",
    unit: "mm",
    format: [layout.pageMm.width, layout.pageMm.height],
  });

  drawRules(pdf, layout);

  const scale = layout.emHeightMm / upm;
  for (const row of layout.rows) {
    if (row.kind === "blank") continue;
    const style = row.kind === "model" ? "F" : "S";
    if (row.kind === "model") {
      pdf.setFillColor(0, 0, 0);
    } else {
      pdf.setDrawColor(TRACE_GREY, TRACE_GREY, TRACE_GREY);
      pdf.setLineWidth(TRACE_STROKE_MM);
    }
    let penX = 0;
    for (const g of shaped.glyphs) {
      const glyph = shaped.font.glyphs.get(g.g);
      const ox = row.leftX + (penX + (g.dx ?? 0)) * scale;
      const oy = row.baselineY - (g.dy ?? 0) * scale;
      const ops = glyphPathToPdfOps(glyph.getPath(0, 0, upm).commands, scale, ox, oy);
      if (ops.length > 0) pdf.path(ops, style);
      penX += g.ax ?? 0;
    }
  }

  drawFooter(pdf, layout);
  return { pdf, layout };
}
```

Note on `pdf.path(ops, style)`: jsPDF's op objects are `{ op: "m" | "l" | "c" | "h", c: number[] }`; `"F"` fills, `"S"` strokes. If `tsc` rejects the `ops` argument because the `.d.ts` types it as `any[]`, the call is already fine; if it rejects `opentype.PathCommand`, use `ReturnType<opentype.Glyph["getPath"]>["commands"]` as the parameter type instead.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/practiceSheetPdf.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the document smoke test**

Append to `src/lib/practiceSheetPdf.test.ts`:

```ts
import { buildPracticeSheetPdf } from "./practiceSheetPdf";
import { DEFAULT_PRACTICE_SHEET_OPTIONS } from "./practiceSheet";

describe("buildPracticeSheetPdf", () => {
  it("produces a one-page document for a short run", async () => {
    const { pdf, layout } = await buildPracticeSheetPdf("محمد", {
      ...DEFAULT_PRACTICE_SHEET_OPTIONS,
      fontFamily: "Amiri",
    });
    expect(layout.rows.length).toBeGreaterThan(0);
    expect(layout.rows.length).toBeLessThanOrEqual(7);
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(pdf.output("arraybuffer").byteLength).toBeGreaterThan(1000);
  });
});
```

Run: `npx vitest run src/lib/practiceSheetPdf.test.ts`

If this test fails because `shapeText` fetches `/fonts/Amiri.ttf` over `fetch` (which jsdom cannot serve), do **not** mock the shaper. Instead delete this `describe` block and record in the rules note (Task 4) that the writer is verified in the browser only, matching the existing export convention. Either outcome is acceptable; the converter and filename tests above are the unit coverage.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit -p tsconfig.app.json; npm run lint`
Expected: no errors.

```bash
git add src/lib/practiceSheetPdf.ts src/lib/practiceSheetPdf.test.ts
git commit -m "Add practice-sheet PDF writer with vector glyph outlines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Dialog and Export-panel button

**Files:**
- Create: `src/components/PracticeSheetDialog.tsx`
- Modify: `src/components/Sidebar.tsx` (import block near line 101; Export panel after the Copy PNG / Export all grid near line 1636)
- Modify: `src/index.css` (after the `.fontUploadError` rule near line 418)

**Interfaces:**
- Consumes: `buildPracticeSheetPdf`, `practiceSheetFilename` from `../lib/practiceSheetPdf`; `layoutPracticeSheet`, `emHeightFromScale`, `DEFAULT_PRACTICE_SHEET_OPTIONS`, types from `../lib/practiceSheet`; `nuqtaUnits` from `../lib/nuqta`; `Block` from `../types`; `CloseIcon`, `FileTextIcon` from `./Icons`.
- Produces: `PracticeSheetButton: React.FC<{ block: Block | undefined }>` — launcher plus dialog in one element, the `FontUploadButton` pattern.

- [ ] **Step 1: Write the dialog**

Create `src/components/PracticeSheetDialog.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Block } from "../types";
import {
  DEFAULT_PRACTICE_SHEET_OPTIONS,
  emHeightFromScale,
  type PracticeSheetOptions,
  type PracticeSheetPage,
} from "../lib/practiceSheet";
import { nuqtaUnits } from "../lib/nuqta";
import { buildPracticeSheetPdf, practiceSheetFilename } from "../lib/practiceSheetPdf";
import { CloseIcon, FileTextIcon } from "./Icons";

export type PracticeSheetDialogProps = {
  block: Block;
  onClose: () => void;
};

/**
 * Practice-sheet export. Portaled to `document.body` like `FontUploadDialog`
 * (the sidebar clips modals, and nothing non-artwork may live in the stage).
 * All state is local: nib or em, page, row counts. The live readout is the
 * pure layout's own numbers for the *scale* only — row placement needs the
 * shaped run, which is only fetched on Download.
 */
export const PracticeSheetDialog: React.FC<PracticeSheetDialogProps> = ({ block, onClose }) => {
  const [nibMm, setNibMm] = useState(4);
  const [directEm, setDirectEm] = useState(false);
  const [emMm, setEmMm] = useState(40);
  const [page, setPage] = useState<PracticeSheetPage>("a4");
  const [rows, setRows] = useState(DEFAULT_PRACTICE_SHEET_OPTIONS.rows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const text = block.text ?? "";
  const empty = text.trim().length === 0;

  const options: PracticeSheetOptions = useMemo(
    () => ({
      ...DEFAULT_PRACTICE_SHEET_OPTIONS,
      page,
      rows,
      scale: directEm ? { emHeightMm: emMm } : { nibWidthMm: nibMm },
      fontFamily: block.fontFamily,
    }),
    [page, rows, directEm, emMm, nibMm, block.fontFamily]
  );

  const em = emHeightFromScale(options.scale, block.fontFamily);
  const nuqta = em * nuqtaUnits(block.fontFamily, 1);
  const totalRows = rows.model + rows.trace + rows.blank;

  const download = async () => {
    if (busy || empty) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { pdf, layout } = await buildPracticeSheetPdf(text, options);
      pdf.save(practiceSheetFilename(text));
      const notes: string[] = [];
      if (layout.fitScale < 1) {
        notes.push(`Shrunk to fit the page: nuqta is ${layout.nuqtaMm.toFixed(2)} mm.`);
      }
      if (layout.droppedRows > 0) {
        notes.push(`${layout.droppedRows} row${layout.droppedRows === 1 ? "" : "s"} did not fit and were left off.`);
      }
      setNotice(notes.length ? notes.join(" ") : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the sheet.");
    } finally {
      setBusy(false);
    }
  };

  const rowInput = (key: keyof typeof rows, label: string) => (
    <label className="practiceSheetRowField">
      <span className="fieldTitle">{label}</span>
      <input
        type="number"
        min={0}
        max={20}
        step={1}
        className="hexInput"
        value={rows[key]}
        onChange={(e) => {
          const n = Math.max(0, Math.min(20, Math.floor(Number(e.target.value) || 0)));
          setRows((r) => ({ ...r, [key]: n }));
        }}
      />
    </label>
  );

  return createPortal(
    <div
      className="confirmDialogOverlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="confirmDialog fontUploadDialog practiceSheetDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="practiceSheetTitle"
      >
        <div className="fontUploadHeader">
          <div id="practiceSheetTitle" className="confirmDialogTitle">
            Practice sheet
          </div>
          <button
            ref={closeRef}
            type="button"
            className="sidebarCircleButton"
            onClick={onClose}
            aria-label="Close practice sheet"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="confirmDialogMessage">
          Prints the selected text as a model row to study, faint rows to trace,
          and ruled rows to write on your own. One square of the grid is one
          nuqta — the dot your pen makes.
        </div>

        {empty ? (
          <div className="fontUploadError" role="alert">
            The selected block has no text to practise.
          </div>
        ) : null}

        <label className="fontUploadField">
          <span className="fieldTitle">
            {directEm ? "Letter size (em height, mm)" : "Pen nib width (mm)"}
          </span>
          <input
            type="number"
            min={directEm ? 5 : 0.5}
            max={directEm ? 150 : 15}
            step={0.5}
            className="hexInput"
            value={directEm ? emMm : nibMm}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              if (directEm) setEmMm(n);
              else setNibMm(n);
            }}
          />
        </label>
        <label className="practiceSheetToggle">
          <input
            type="checkbox"
            checked={directEm}
            onChange={(e) => setDirectEm(e.target.checked)}
          />{" "}
          Set letter size directly instead of from the pen
        </label>

        <label className="fontUploadField">
          <span className="fieldTitle">Page</span>
          <select
            className="hexInput"
            value={page}
            onChange={(e) => setPage(e.target.value as PracticeSheetPage)}
          >
            <option value="a4">A4 (210 × 297 mm)</option>
            <option value="letter">US Letter (8.5 × 11 in)</option>
          </select>
        </label>

        <div className="practiceSheetRows">
          {rowInput("model", "Model rows")}
          {rowInput("trace", "Trace rows")}
          {rowInput("blank", "Blank rows")}
        </div>

        <div className="practiceSheetReadout" aria-live="polite">
          Em {em.toFixed(1)} mm · nuqta {nuqta.toFixed(2)} mm · {totalRows} row
          {totalRows === 1 ? "" : "s"}
        </div>

        {notice ? <div className="practiceSheetNotice">{notice}</div> : null}
        {error ? (
          <div className="fontUploadError" role="alert">
            {error}
          </div>
        ) : null}

        <div className="confirmDialogActions">
          <button type="button" className="sidebarSmallAction" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sidebarSmallAction sidebarSmallAction--accent"
            disabled={busy || empty || totalRows === 0}
            onClick={() => void download()}
          >
            {busy ? "Building…" : "Download PDF"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export type PracticeSheetButtonProps = { block: Block | undefined };

/** Launcher + dialog as one element, so the Export panel needs no open/closed state. */
export const PracticeSheetButton: React.FC<PracticeSheetButtonProps> = ({ block }) => {
  const [open, setOpen] = useState(false);
  const textBlock = block && block.type === "text" ? block : null;
  return (
    <>
      <button
        type="button"
        className="sidebarPillButton"
        disabled={!textBlock}
        onClick={() => setOpen(true)}
        title={
          textBlock
            ? "Print a tracing and writing sheet of this text"
            : "Select a single plain text block to make a practice sheet"
        }
        aria-label="Practice sheet"
        style={{ minWidth: 0 }}
      >
        <FileTextIcon size={13} /> Practice sheet…
      </button>
      {open && textBlock && (
        <PracticeSheetDialog block={textBlock} onClose={() => setOpen(false)} />
      )}
    </>
  );
};

export default PracticeSheetDialog;
```

- [ ] **Step 2: Add the styles**

In `src/index.css`, after the `.fontUploadError` rule:

```css
/* ---- practice sheet dialog ---- */
.practiceSheetDialog { width: min(460px, 100%); }
.practiceSheetToggle { display: block; margin: -6px 0 12px; font-size: 12px; color: var(--text-secondary); }
.practiceSheetRows { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
.practiceSheetRows > * { min-width: 0; }
.practiceSheetRowField { display: block; }
.practiceSheetRowField .hexInput { width: 100%; min-width: 0; }
.practiceSheetReadout { margin-bottom: 12px; font-size: 12px; color: var(--text-muted); }
.practiceSheetNotice { margin-bottom: 12px; padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.5; background: var(--accent-soft); color: var(--text-secondary); }
```

- [ ] **Step 3: Mount the button in the Export panel**

In `src/components/Sidebar.tsx`, next to the existing `FontUploadButton` import (line ~101):

```ts
import { PracticeSheetButton } from "./PracticeSheetDialog";
```

Then, inside the Export panel, directly **after** the closing `</div>` of the two-column grid that holds "Copy PNG" and "Export all" (the `<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>` near line 1615) and **before** the `Scale` row, add:

```tsx
<PracticeSheetButton block={selectedBlock} />
```

`selectedBlock` is already a `Sidebar` prop (line ~189), so no `App.tsx` change is needed.

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`, open the app, select the default text block, open the Export panel.

Check, in order:
1. The "Practice sheet…" button is enabled with a text block selected and disabled with a Shape Fill or image block selected.
2. The dialog opens; the readout shows em and nuqta; changing the nib changes both; toggling "Set letter size directly" swaps the input.
3. Download produces a PDF. Open it: one solid row, three grey outline rows, three ruled rows, a grid, a footer. Grey rows should print visibly but faintly.
4. Type a long phrase (twenty words) and download: a notice says the sheet was shrunk, and the PDF fits the page.
5. Set rows to 1 / 10 / 10 at nib 6: the notice says rows were left off.
6. Clear the text in the block and reopen: the dialog says there is no text and Download is disabled.
7. Escape and clicking the backdrop both close the dialog.

- [ ] **Step 5: Typecheck, lint, test, commit**

Run: `npx tsc --noEmit -p tsconfig.app.json; npm run lint; npm test`
Expected: no errors, all green.

```bash
git add src/components/PracticeSheetDialog.tsx src/components/Sidebar.tsx src/index.css
git commit -m "Add Practice sheet dialog to the Export panel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Documentation and guide section

**Files:**
- Create: `.claude/rules/practice-sheet.md`
- Create: `src/components/guide/sections/practice-sheet.tsx`
- Modify: `CLAUDE.md` ("Subsystem notes" list at the bottom, after the "Export" line)
- Modify: `PROGRESS.md` (new entry at the top of "## Shipped", line ~93)

**Interfaces:**
- Consumes: the `GuideSection` type from `src/components/guide/types.ts` (fields `id`, `title`, `order`, `keywords`, `Body`). Sections are auto-globbed; dropping the file in is the whole integration.

- [ ] **Step 1: Write the rules note**

Create `.claude/rules/practice-sheet.md`:

```markdown
---
paths:
  - "src/lib/practiceSheet*.ts"
  - "src/components/PracticeSheetDialog.tsx"
---

# Practice sheet export (`src/lib/practiceSheet.ts`, `src/lib/practiceSheetPdf.ts`, `PracticeSheetDialog.tsx`)

Turns the selected plain `text` block into a printable PDF *mashq* sheet: a
solid model row, faint rows to trace, ruled blank rows, all on a nuqta grid.
The argument for the design is `docs/superpowers/specs/2026-10-09-practice-sheet-design.md`.

**The whole feature turns on one equation: one nuqta on paper equals the nib
width.** `nuqta.ts` holds a measured nuqta-to-font-size ratio per bundled face
(`FALLBACK_RATIO` for uploaded fonts), so `emHeightMm = nib / ratio`, and the
grid pitch is that nuqta. The "set letter size directly" override sets the em
and derives the nuqta from it, so the grid is always true to the drawn letters.

- **`practiceSheet.ts` is pure and must not import `./harfbuzz`.** Shaping is
  injected as a `MeasuredRun` (sum of advances plus the font's
  ascender/descender), the `fitToWidth` pattern. That is what keeps the page
  arithmetic testable with round numbers in `practiceSheet.test.ts`.
- **Overflow never wraps.** A run wider than the printable area shrinks the
  whole sheet (`fitScale < 1`); the layout's `emHeightMm`/`nuqtaMm` are the
  *effective* post-shrink values and the footer says so. Rows that do not
  fit are dropped from the end, never squeezed; `droppedRows` counts them.
- **Rows walk left to right from `leftX`** with `penX += ax`, the same walk
  `ShapedText.tsx` does; `leftX` is the right margin minus the run width, so
  the run is right-aligned. Nothing here handles bidi beyond what HarfBuzz
  already emitted.
- **Outlines are vector, not raster.** `glyphPathToPdfOps` converts opentype
  commands to jsPDF `path()` ops, flipping y (font up, PDF down) and
  promoting quadratics to cubics. Model rows fill, trace rows stroke
  0.15 mm `#B4B4B4`. Drawing the outline *and* filling it is deliberately
  not done on model rows; an outline over a fill thickens the letter
  (see the stroke-before-fill note in CLAUDE.md).
- **Deliberately ignored in v1:** diacritic overrides, glyph transforms,
  stroke cuts, gradients. Kashida works because it is real tatweel text.
  Non-text block types never reach the dialog; the launcher is disabled.
- **Dialog state never reaches `App.tsx`.** `PracticeSheetButton` is launcher
  plus dialog in one element (the `FontUploadButton` pattern), mounted in
  the Export panel with only `selectedBlock` as input. Its `aria-label` is
  `Practice sheet`; renaming it means updating `e2e/` in the same commit.
- **The writer is verified in the browser**, not by pixel tests: jsdom
  cannot rasterise. Unit coverage is the converter and the filename slug.

Planned follow-up on the same page machinery, not built: alphabet sheets
(one letter and its forms per page).
```

If Task 2's `buildPracticeSheetPdf` smoke test survived, change the last bullet to say the writer has a one-page smoke test plus browser verification.

- [ ] **Step 2: Add the CLAUDE.md index line**

In `CLAUDE.md`, after the `- **Export** — ...` line in "Subsystem notes", add:

```markdown
- **Practice sheet** — [`.claude/rules/practice-sheet.md`](.claude/rules/practice-sheet.md). One nuqta on paper equals the nib width; `practiceSheet.ts` is pure (injected run, never imports `./harfbuzz`). Overflow shrinks, never wraps; vector outlines via jsPDF `path()`. v1 ignores per-glyph edits.
```

- [ ] **Step 3: Add the PROGRESS.md entry**

In `PROGRESS.md`, directly under `## Shipped`, before the 2026-09-06 entry:

```markdown
### 2026-10-09 — Practice sheet export

**Practice sheet…** in the Export panel prints the selected text block as a
PDF *mashq* sheet: a solid model row, faint rows to trace, ruled blank rows,
on a grid whose square is one nuqta of the pen the learner enters. A4 or
Letter, vector outlines, no account needed.

Not in this version, on purpose: per-glyph editor edits (diacritic overrides,
glyph transforms, stroke cuts), gradients, and every non-text block type.
Alphabet sheets are the planned follow-up. Design and reasoning in
`.claude/rules/practice-sheet.md`.
```

- [ ] **Step 4: Write the guide section**

Create `src/components/guide/sections/practice-sheet.tsx`:

```tsx
import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "practice-sheet",
  title: "Printing a practice sheet",
  order: 46,
  keywords: [
    "practice",
    "practise",
    "mashq",
    "tracing",
    "trace",
    "print",
    "worksheet",
    "nuqta",
    "nib",
    "qalam",
    "pen",
    "learn",
    "beginner",
  ],
  Body: () => (
    <>
      <p>
        Select a text block, open <strong>Export</strong>, and click{" "}
        <strong>Practice sheet…</strong>. You get a PDF to print: the text once
        in solid ink to study, a few times in faint grey to trace over, and then
        ruled lines to write it on your own.
      </p>

      <h4>Why it asks for your pen</h4>
      <p>
        Traditional Arabic calligraphy measures every letter in{" "}
        <em>nuqta</em> — the rhombic dot a reed pen makes when pressed to the
        page. An alif in Thuluth is about seven dots tall. Because the dot
        depends on the pen, the right size for a practice sheet depends on the
        pen too. Enter the width of your nib in millimetres and the sheet is
        scaled so that one square of the grid is one dot of <em>your</em> pen.
        If you don't have a specific pen yet, tick{" "}
        <strong>Set letter size directly</strong> and choose a letter height
        instead.
      </p>

      <h4>Reading the sheet</h4>
      <ul>
        <li>
          <strong>Model row.</strong> Solid black. Look at it; count the dots.
        </li>
        <li>
          <strong>Trace rows.</strong> Faint grey. Write over them with your
          pen, keeping the nib angle steady.
        </li>
        <li>
          <strong>Blank rows.</strong> Only the baseline and grid. Write from
          memory and compare with the model.
        </li>
      </ul>

      <h4>If the sheet says it was shrunk</h4>
      <p>
        A long phrase at a wide nib will not fit across the page. Rather than
        break the line, the sheet is scaled down and the footer tells you the
        size the grid now represents. Use a shorter phrase, or a narrower pen,
        to practise at true size.
      </p>
    </>
  ),
};
```

Check `order` against the neighbouring sections first (`grep -h "order:" src/components/guide/sections/*.tsx | sort -n`); pick a free number after the export section so this appears beside it.

- [ ] **Step 5: Full verification loop, then commit**

Run, in order:

```
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npm test
npm run build
```

Expected: all four succeed. Open the in-app guide in `npm run dev` and confirm "Printing a practice sheet" appears and searches by "nib".

```bash
git add .claude/rules/practice-sheet.md CLAUDE.md PROGRESS.md src/components/guide/sections/practice-sheet.tsx
git commit -m "Document the practice-sheet export and add its guide section

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
