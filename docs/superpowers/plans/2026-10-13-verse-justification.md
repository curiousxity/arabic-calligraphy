# Multi-line Verse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a calligrapher create a verse made of several ordinary text blocks, laid out as stacked lines or bayt couplets, with every line justified to one common width. Each line gets kashida first, spacing next, and shrinks if it is too wide.

**Architecture:** There are two pure modules. `verseLayout.ts` computes positions and `verseJustify.ts` justifies one line, with measurement injected. A `countSpacingBoundaries` helper goes in `spacing.ts`. Two `App.tsx` handlers, `createVerse` and `justifyVerse`, measure everything first, then call one `pushHistory()` and make one `setBlocks`. A `VerseDialog` (create) and a `VersePanel` (settings plus Justify) live in the Sidebar.

**Tech Stack:** React 19, TypeScript, Vite, Konva, harfbuzzjs (WASM), opentype.js, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-verse-justification-design.md`

## Global Constraints

- The pure modules (`verseLayout.ts`, `verseJustify.ts`, `spacing.ts`) must never import `./harfbuzz` at runtime. Vitest cannot load it.
- Shaping tests use real harfbuzzjs and real fonts from `public/fonts/` via a copied `shapeReal` helper, loaded through `createRequire`. No hand-written `{ g, cl }` fixtures.
- Every tatweel-inserting write goes through `kashidaTextPatch(block, text, edits)`, with `edits` highest-offset-first exactly as `solveFitToWidth` returns them.
- Each user gesture gets one `pushHistory()`. Async solves capture blocks by id and skip any block deleted mid-solve.
- A justified line must never overshoot the target, and the tolerance for "reached" is 1 px (`JUSTIFY_TOLERANCE = 1`).
- Style terms for measurement come only from `runStyleForBlock(block, cutWidthForBlock(block))`, and spacing goes to `measureShapedWidth`.
- Old saves have no `verse` field and must load and render unchanged. There is no save-format bump.
- Fonts always resolve through `resolveFontUrl`, never `FONT_URLS[...]`.
- `updateBlock` and `updateSelectedBlock` keep their `as Block` cast. Don't add new `as Block` casts elsewhere except in the existing `setBlocks` map-patch idiom already used by `applyNameDesign`.
- Commit message ending:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc
  ```
- Verification loop:
  - `npx tsc --noEmit -p tsconfig.app.json`
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `npm run e2e`, plus `npx tsc --noEmit -p e2e/tsconfig.json`

## Decisions this plan makes beyond the spec

These are additive or placement-only. Each is applied as stated, and the spec is updated in Task 7.

1. **`verse.fittedFontSize`** is a new field on the tag. It records the font size the last Justify wrote. If a line's `fontSize` no longer equals it, the user changed the size by hand, and that size becomes the new `baseFontSize`. Without this, Justify would silently undo a manual size change.
2. **The anchor is derived from the blocks rather than stored.**
   - Stacked: the anchor is line 0's `x`.
   - Bayt: the anchor is the midpoint of lines 0 and 1.
   - `y` is line 0's `y`.
   Because of this, a verse that was dragged stays where it was dragged. A stored anchor would snap it back.
3. **The "New verse…" button goes in Block Controls (canvas tier), not the document tier.** Block Controls is where every "add" action lives, and the document tier holds project-wide settings.
4. **The Width, Line gap and Column gap fields are number inputs that commit on blur or Enter, not RangeRows.** RangeRow fires on every frame, and each commit is a full async re-justify with one undo step.

## Review Focus

1. **A verse line edited by hand after Justify:** a new font size, typed text, or the user's own letter spacing. The next Justify must start from the user's values and not revert them. Pinned in Task 3 (`baseFontSizeForLine` and `baseSpacingForLine` tests).
2. **Lines in different fonts or sizes within one verse.** Each line is measured with its own font, style and alternates. The target is the widest natural width. Pinned in Task 4 by measuring through a per-line closure. The e2e uses one font only, so a reviewer should check the closure by eye.
3. **A line that needs a large spacing fill (few boundaries, big gap)** can get `letterSpacing` above the slider's maximum of 1. That is allowed: the slider clamps its display only, and the value still renders. Pinned in Task 3 ("fill may exceed the slider range").
4. **A line deleted, or the selection changed, while the async solve runs.** Patches are applied by id inside `setBlocks((prev) => ...)`, and missing ids are skipped. Pinned by code structure in Task 4. There's no unit test, because App can't be unit-tested.
5. **Justify pressed twice in a row** must give the same result as pressing it once, with no stacked spacing and no growing kashida. Pinned in Task 3 (idempotence) and Task 6 (e2e).

---

### Task 1: `countSpacingBoundaries` in `spacing.ts`

**Files:**
- Modify: `src/lib/spacing.ts` (append after `applySpacing`)
- Test: `src/lib/spacing.test.ts` (append a new `describe`)

**Interfaces:**
- Produces: `export function countSpacingBoundaries(text: string): { pieceBreaks: number; wordGaps: number }`

- [ ] **Step 1: Write the failing test.** Append it to `src/lib/spacing.test.ts`, changing the existing `./spacing` import line to also import `countSpacingBoundaries`:

```ts
import { applySpacing, countSpacingBoundaries, spacingForBlock } from "./spacing";
```

```ts
describe("countSpacingBoundaries", () => {
  it("counts piece breaks and word gaps on plain text", () => {
    // د and ر and و do not join forward: محمد|رسول → after د (end of word, then a
    // space — not a break), after ر and after و inside رسول.
    expect(countSpacingBoundaries("محمد رسول")).toEqual({ pieceBreaks: 2, wordGaps: 1 });
    expect(countSpacingBoundaries("بببب")).toEqual({ pieceBreaks: 0, wordGaps: 0 });
    expect(countSpacingBoundaries("")).toEqual({ pieceBreaks: 0, wordGaps: 0 });
  });

  it("agrees with where applySpacing actually adds advance (real shaping)", async () => {
    for (const text of ["محمد رسول", "درود درود", "سلام عليكم"]) {
      const { glyphs, upm } = await shaped(text);
      const { pieceBreaks, wordGaps } = countSpacingBoundaries(text);
      const lettered = applySpacing(glyphs, text, { letter: 0.3 }, upm);
      const worded = applySpacing(glyphs, text, { word: 0.3 }, upm);
      const changed = (out: HarfBuzzGlyph[]) => out.filter((g, i) => g.ax !== glyphs[i].ax).length;
      expect(changed(lettered)).toBe(pieceBreaks);
      expect(changed(worded)).toBe(wordGaps);
    }
  });
});
```

(`shaped` is the existing helper at the top of the file. It returns `{ glyphs, font, upm }`. Check its return shape and adapt the destructuring if the name differs.)

- [ ] **Step 2: Run the test and check that it fails.**
  Run: `npx vitest run src/lib/spacing.test.ts`
  Expected: FAIL, with `countSpacingBoundaries is not a function` or an import error.

- [ ] **Step 3: Implement it.** Append to `src/lib/spacing.ts`:

```ts
/**
 * How many places `applySpacing` would add letter and word spacing to.
 *
 * Counted on the logical text with the same rules, so a caller dividing a
 * gap across the boundaries (verse justification) divides by the number
 * that will actually receive it. A ligature that swallows a break (the
 * Allah ligature's alef–lam) makes this an over-count; callers measure the
 * result rather than trust the arithmetic, so that costs a correction pass,
 * never an overshoot.
 */
export function countSpacingBoundaries(text: string): { pieceBreaks: number; wordGaps: number } {
  const forms = classifyJoiningForms(text);
  let pieceBreaks = 0;
  let wordGaps = 0;
  for (let i = 0; i < text.length; i++) {
    if (isSpace(text[i])) {
      wordGaps++;
      continue;
    }
    const form = forms[i]?.form;
    if (form !== "final" && form !== "isolated") continue;
    let k = i + 1;
    while (k < text.length && (isMark(text[k]) || text[k] === ZWNJ)) k++;
    if (k < text.length && forms[k]?.form != null) pieceBreaks++;
  }
  return { pieceBreaks, wordGaps };
}
```

- [ ] **Step 4: Run the test and check that it passes.**
  Run: `npx vitest run src/lib/spacing.test.ts`
  Expected: PASS, every test in the file.
  - If the hand-written count in the first `it` disagrees, the real-shaping agreement test is the authority. Fix the expected literal only if the second test passes and the first one's comment was miscounted, and record a ruling in the ledger.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/spacing.ts src/lib/spacing.test.ts
git commit -m "Spacing: count the boundaries spacing lands on" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```

---

### Task 2: Verse type and `verseLayout.ts`

**Files:**
- Modify: `src/types.ts` (add the `VerseLayout` and `VerseTag` types, and `verse?: VerseTag` on `TextBlock`)
- Create: `src/lib/verseLayout.ts`
- Test: `src/lib/verseLayout.test.ts`

**Interfaces:**
- Produces, in `src/types.ts`:

```ts
export type VerseLayout = "stacked" | "bayt";
export type VerseTag = {
  /** Shared by every line of one verse. */
  id: number;
  /** Reading order, 0-based. */
  index: number;
  layout: VerseLayout;
  /** Target width in px; absent = the widest line's natural width. */
  width?: number;
  /** Row pitch, × line 0's base font size. */
  lineGap: number;
  /** Bayt gutter between the two misra', × line 0's base font size. */
  columnGap: number;
  /** The size before any shrink-to-fit. */
  baseFontSize: number;
  /** The size the last Justify wrote; a different `fontSize` means the user changed it. */
  fittedFontSize: number;
  /** Spacing the last Justify added on top of the user's own; removed before the next run. */
  addedLetter: number;
  addedWord: number;
};
/** The verse-wide part of a tag — what the Verse panel edits. */
export type VerseSettings = Pick<VerseTag, "layout" | "width" | "lineGap" | "columnGap">;
```

- Produces, in `src/lib/verseLayout.ts`:
  - `export const DEFAULT_LINE_GAP = 1.6;`
  - `export const DEFAULT_COLUMN_GAP = 1.0;`
  - `export type VerseGeometry = { layout: VerseLayout; target: number; lineGap: number; columnGap: number; fontSize: number };`
  - `export function layoutVerse(count: number, g: VerseGeometry, anchor: { x: number; y: number }): { x: number; y: number }[]`
  - `export function verseAnchor(lines: readonly { x: number; y: number }[], layout: VerseLayout): { x: number; y: number }`

- [ ] **Step 1: Write the failing test.** Create `src/lib/verseLayout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { layoutVerse, verseAnchor } from "./verseLayout";

const g = { target: 300, lineGap: 1.5, columnGap: 1, fontSize: 40 };

describe("layoutVerse", () => {
  it("stacks rows on one column at lineGap × fontSize", () => {
    const pos = layoutVerse(3, { ...g, layout: "stacked" }, { x: 10, y: 20 });
    expect(pos).toEqual([
      { x: 10, y: 20 },
      { x: 10, y: 80 },
      { x: 10, y: 140 },
    ]);
  });

  it("pairs bayt lines with the first misra' on the right", () => {
    const pos = layoutVerse(4, { ...g, layout: "bayt" }, { x: 0, y: 0 });
    const half = (300 + 40) / 2;
    expect(pos[0]).toEqual({ x: half, y: 0 });
    expect(pos[1]).toEqual({ x: -half, y: 0 });
    expect(pos[2]).toEqual({ x: half, y: 60 });
    expect(pos[3]).toEqual({ x: -half, y: 60 });
  });

  it("centres an odd last bayt line on its own row", () => {
    const pos = layoutVerse(3, { ...g, layout: "bayt" }, { x: 5, y: 0 });
    expect(pos[2]).toEqual({ x: 5, y: 60 });
  });

  it("returns nothing for an empty verse", () => {
    expect(layoutVerse(0, { ...g, layout: "stacked" }, { x: 0, y: 0 })).toEqual([]);
  });
});

describe("verseAnchor", () => {
  it("is the inverse of layoutVerse, so laying out again never moves the verse", () => {
    for (const layout of ["stacked", "bayt"] as const) {
      for (const count of [1, 2, 3, 4]) {
        const anchor = { x: 37, y: -12 };
        const pos = layoutVerse(count, { ...g, layout }, anchor);
        expect(verseAnchor(pos, layout)).toEqual(anchor);
      }
    }
  });

  it("follows a dragged verse", () => {
    const pos = layoutVerse(2, { ...g, layout: "bayt" }, { x: 0, y: 0 }).map((p) => ({
      x: p.x + 50,
      y: p.y + 7,
    }));
    expect(verseAnchor(pos, "bayt")).toEqual({ x: 50, y: 7 });
  });
});
```

- [ ] **Step 2: Run the test and check that it fails.**
  Run: `npx vitest run src/lib/verseLayout.test.ts`
  Expected: FAIL, because the `./verseLayout` module can't be found.

- [ ] **Step 3: Implement it.**
  - Add the three types to `src/types.ts` just above `export type TextBlock`.
  - Add `verse?: VerseTag;` to `TextBlock` after `wordSpacing`, with the doc comment `/** Set when this block is a line of a verse; see .claude/rules/verse.md. */`.
  - Then create `src/lib/verseLayout.ts`:

```ts
import type { VerseLayout } from "../types";

/**
 * Where each line of a verse sits. Pure: positions only — the lines' own
 * widths, kashida and spacing are `verseJustify.ts`'s job.
 *
 * Positions are the blocks' `x`/`y` with `align: "center"`, so `x` is a
 * line's horizontal centre. Stacked lines share one column; a bayt row holds
 * two misra' in equal columns either side of the anchor, the first on the
 * right (Arabic reads right to left).
 */

export const DEFAULT_LINE_GAP = 1.6;
export const DEFAULT_COLUMN_GAP = 1.0;

export type VerseGeometry = {
  layout: VerseLayout;
  /** The justified line width — one bayt column's width. */
  target: number;
  lineGap: number;
  columnGap: number;
  /** Line 0's base font size; gaps are multiples of it. */
  fontSize: number;
};

export function layoutVerse(
  count: number,
  g: VerseGeometry,
  anchor: { x: number; y: number }
): { x: number; y: number }[] {
  const pitch = g.lineGap * g.fontSize;
  const half = (g.target + g.columnGap * g.fontSize) / 2;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (g.layout === "stacked") {
      out.push({ x: anchor.x, y: anchor.y + i * pitch });
      continue;
    }
    const row = Math.floor(i / 2);
    const alone = i % 2 === 0 && i === count - 1;
    const x = alone ? anchor.x : i % 2 === 0 ? anchor.x + half : anchor.x - half;
    out.push({ x, y: anchor.y + row * pitch });
  }
  return out;
}

/**
 * The anchor a laid-out verse currently sits at — `layoutVerse`'s inverse.
 *
 * Read from the blocks rather than stored, so a verse the user dragged is
 * re-laid-out where it now is instead of snapping back.
 */
export function verseAnchor(
  lines: readonly { x: number; y: number }[],
  layout: VerseLayout
): { x: number; y: number } {
  if (lines.length === 0) return { x: 0, y: 0 };
  const first = lines[0];
  if (layout === "bayt" && lines.length >= 2) {
    return { x: (first.x + lines[1].x) / 2, y: first.y };
  }
  return { x: first.x, y: first.y };
}
```

- [ ] **Step 4: Run the test and check that it passes.**
  Run: `npx vitest run src/lib/verseLayout.test.ts && npx tsc --noEmit -p tsconfig.app.json`
  Expected: PASS and no type errors.

- [ ] **Step 5: Commit.**

```bash
git add src/types.ts src/lib/verseLayout.ts src/lib/verseLayout.test.ts
git commit -m "Verse: tag type and layout" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```

---

### Task 3: `verseJustify.ts`

**Files:**
- Create: `src/lib/verseJustify.ts`
- Test: `src/lib/verseJustify.test.ts`

**Interfaces:**
- Consumes:
  - `countSpacingBoundaries` and `type Spacing` from Task 1;
  - `solveFitToWidth`, `applyDistributionWithEdits` and `type DistributionEdit` from `./fitToWidth`;
  - `findKashidaSlots` and `MAX_KASHIDA_PER_SLOT` from `./tatweel`;
  - `TextBlock` from `../types`.
- Produces:

```ts
export const JUSTIFY_TOLERANCE = 1;
export type LineSpacing = { letter: number; word: number };
export type LineMeasure = (text: string, fontSize: number, spacing: LineSpacing) => Promise<number>;
export type JustifyLineInput = {
  text: string; baseFontSize: number; userSpacing: LineSpacing; target: number;
  measure: LineMeasure; maxPerSlot?: number;
};
export type JustifyLineResult = {
  text: string; edits: DistributionEdit[]; fontSize: number;
  addedLetter: number; addedWord: number; width: number;
  shrunk: boolean; reason: "justified" | "short";
};
export function stripKashida(text: string): string;
export function naturalWidth(text: string, fontSize: number, spacing: LineSpacing, measure: LineMeasure): Promise<number>;
export function justifyLine(input: JustifyLineInput): Promise<JustifyLineResult>;
export function baseFontSizeForLine(b: TextBlock): number;
export function baseSpacingForLine(b: TextBlock): LineSpacing;
export function describeVerseResult(results: readonly JustifyLineResult[], target: number): string;
```

- [ ] **Step 1: Write the failing test.** Create `src/lib/verseJustify.test.ts`.
  - Copy `resolveHbLoader`, `HbModule`, `hbPromise` and `shapeReal` verbatim from the top of `src/lib/spacing.test.ts` (lines 1–129: imports, `createRequire`, the loader and the `shapeReal` function).
  - Then add:

```ts
import { inkExtentWidth } from "./fitToWidth";
import { applySpacing, countSpacingBoundaries } from "./spacing";
import { TATWEEL } from "./tatweel";
import {
  JUSTIFY_TOLERANCE,
  baseFontSizeForLine,
  baseSpacingForLine,
  describeVerseResult,
  justifyLine,
  naturalWidth,
  stripKashida,
  type LineMeasure,
} from "./verseJustify";
import type { TextBlock } from "../types";

/**
 * Synthetic measure, exact and linear: per font-size unit, 0.5 per visible
 * character, 0.1 per tatweel, and one spacing unit per boundary that
 * `countSpacingBoundaries` reports — the same places applySpacing acts.
 */
const fake: LineMeasure = async (text, fontSize, spacing) => {
  const tatweels = [...text].filter((c) => c === TATWEEL).length;
  const chars = text.length - tatweels;
  const { pieceBreaks, wordGaps } = countSpacingBoundaries(text);
  return fontSize * (0.5 * chars + 0.1 * tatweels + pieceBreaks * spacing.letter + wordGaps * spacing.word);
};
const none = { letter: 0, word: 0 };

describe("justifyLine (synthetic measure)", () => {
  it("stretches a short line with kashida alone when kashida can reach", async () => {
    const r = await justifyLine({ text: "بببب سسسس", baseFontSize: 10, userSpacing: none, target: 50, measure: fake });
    expect(r.width).toBeLessThanOrEqual(50);
    expect(50 - r.width).toBeLessThanOrEqual(JUSTIFY_TOLERANCE);
    expect(r.text).toContain(TATWEEL);
    expect(r.addedLetter).toBe(0);
    expect(r.addedWord).toBe(0);
    expect(r.reason).toBe("justified");
    expect(r.shrunk).toBe(false);
  });

  it("fills the rest with spacing when kashida is capped", async () => {
    const r = await justifyLine({ text: "بب دد", baseFontSize: 10, userSpacing: none, target: 40, measure: fake });
    expect(r.addedLetter).toBeGreaterThan(0);
    expect(r.addedWord).toBe(r.addedLetter);
    expect(r.width).toBeLessThanOrEqual(40);
    expect(40 - r.width).toBeLessThanOrEqual(JUSTIFY_TOLERANCE);
    expect(r.reason).toBe("justified");
  });

  it("never overshoots across a sweep of targets", async () => {
    for (let target = 12; target <= 120; target += 7) {
      const r = await justifyLine({ text: "بب دد", baseFontSize: 10, userSpacing: none, target, measure: fake });
      expect(r.width).toBeLessThanOrEqual(target);
    }
  });

  it("shrinks a line wider than the target, and grows it back when the target widens", async () => {
    const narrow = await justifyLine({ text: "بببب", baseFontSize: 10, userSpacing: none, target: 15, measure: fake });
    expect(narrow.shrunk).toBe(true);
    expect(narrow.fontSize).toBeLessThan(10);
    expect(narrow.width).toBeLessThanOrEqual(15);
    const wide = await justifyLine({ text: narrow.text, baseFontSize: 10, userSpacing: none, target: 22, measure: fake });
    expect(wide.shrunk).toBe(false);
    expect(wide.fontSize).toBe(10);
  });

  it("is idempotent: justifying its own output changes nothing", async () => {
    const first = await justifyLine({ text: "بب دد", baseFontSize: 10, userSpacing: none, target: 40, measure: fake });
    const again = await justifyLine({ text: first.text, baseFontSize: 10, userSpacing: none, target: 40, measure: fake });
    expect(again.text).toBe(first.text);
    expect(again.addedLetter).toBeCloseTo(first.addedLetter, 9);
    expect(again.fontSize).toBe(first.fontSize);
  });

  it("reports a line with no slots and no boundaries as short", async () => {
    const r = await justifyLine({ text: "د", baseFontSize: 10, userSpacing: none, target: 40, measure: fake });
    expect(r.reason).toBe("short");
    expect(r.addedLetter).toBe(0);
  });

  it("lets the fill exceed the slider range rather than stop short", async () => {
    const r = await justifyLine({ text: "د د", baseFontSize: 10, userSpacing: none, target: 200, measure: fake });
    expect(r.addedWord).toBeGreaterThan(2);
    expect(r.reason).toBe("justified");
  });
});

describe("line bases", () => {
  const line = (over: Partial<TextBlock>): TextBlock =>
    ({ type: "text", fontSize: 30, letterSpacing: 0.4, wordSpacing: 0.1, verse: {
      id: 1, index: 0, layout: "stacked", lineGap: 1.6, columnGap: 1,
      baseFontSize: 40, fittedFontSize: 30, addedLetter: 0.3, addedWord: 0.05,
    }, ...over }) as TextBlock;

  it("takes Justify's own additions back off, never stacking them", () => {
    expect(baseSpacingForLine(line({}))).toEqual({ letter: 0.4 - 0.3, word: 0.1 - 0.05 });
  });

  it("keeps the base size while the fitted size is untouched", () => {
    expect(baseFontSizeForLine(line({}))).toBe(40);
  });

  it("adopts a size the user set by hand after Justify", () => {
    expect(baseFontSizeForLine(line({ fontSize: 55 }))).toBe(55);
  });

  it("treats a block with no tag as its own base", () => {
    expect(baseFontSizeForLine(line({ verse: undefined }))).toBe(30);
    expect(baseSpacingForLine(line({ verse: undefined }))).toEqual({ letter: 0.4, word: 0.1 });
  });
});

describe("helpers", () => {
  it("strips every tatweel a slot holds", () => {
    expect(stripKashida(`ب${TATWEEL}${TATWEEL}ب`)).toBe("بب");
  });

  it("measures natural width with kashida removed", async () => {
    expect(await naturalWidth(`ب${TATWEEL}ب`, 10, none, fake)).toBe(10);
  });

  it("describes the result in one line", () => {
    const base = { text: "", edits: [], fontSize: 10, addedLetter: 0, addedWord: 0, width: 0 };
    const msg = describeVerseResult(
      [
        { ...base, shrunk: false, reason: "justified" },
        { ...base, shrunk: true, reason: "justified" },
        { ...base, shrunk: false, reason: "short" },
      ],
      840.4
    );
    expect(msg).toBe("3 lines justified to 840 px · 1 shrunk · 1 couldn't reach full width");
  });
});

describe("justifyLine (real HarfBuzz, Amiri)", () => {
  const real: LineMeasure = async (text, fontSize, spacing) => {
    const { glyphs, font } = await shapeReal(text, "Amiri.ttf");
    const upm = font.unitsPerEm || 1000;
    return inkExtentWidth(applySpacing(glyphs, text, spacing, upm), font, fontSize, upm);
  };

  it("brings a short line to the width of a longer one without passing it", async () => {
    const target = await naturalWidth("سلام عليكم ورحمة الله", 40, none, real);
    const r = await justifyLine({ text: "محمد رسول الله", baseFontSize: 40, userSpacing: none, target, measure: real });
    expect(r.width).toBeLessThanOrEqual(target);
    expect(target - r.width).toBeLessThanOrEqual(JUSTIFY_TOLERANCE);
  });
});
```

  (Check how `inkExtentWidth` is called in `src/lib/fitToWidth.test.ts` around line 146, `realMeasure`, and match its argument order exactly.)

- [ ] **Step 2: Run the test and check that it fails.**
  Run: `npx vitest run src/lib/verseJustify.test.ts`
  Expected: FAIL, because the `./verseJustify` module can't be found.

- [ ] **Step 3: Implement it.** Create `src/lib/verseJustify.ts`:

```ts
import type { TextBlock } from "../types";
import {
  applyDistributionWithEdits,
  solveFitToWidth,
  type DistributionEdit,
} from "./fitToWidth";
import { countSpacingBoundaries } from "./spacing";
import { findKashidaSlots, MAX_KASHIDA_PER_SLOT } from "./tatweel";

/**
 * Justifies one line of a verse to a target width: shrink if too wide,
 * kashida first, then spacing for what kashida cannot reach.
 *
 * Pure, with measurement injected — the same shape as `solveFitToWidth`,
 * which it reuses — so it stays Vitest-importable and never imports
 * `./harfbuzz`. Never overshoots: every width it returns was measured at or
 * under the target.
 */

export const JUSTIFY_TOLERANCE = 1;
const SHRINK_STEP = 0.99;
const MAX_SHRINK_STEPS = 40;

export type LineSpacing = { letter: number; word: number };
export type LineMeasure = (text: string, fontSize: number, spacing: LineSpacing) => Promise<number>;

export type JustifyLineInput = {
  text: string;
  baseFontSize: number;
  /** The user's own spacing, with any earlier Justify's additions already removed. */
  userSpacing: LineSpacing;
  target: number;
  measure: LineMeasure;
  maxPerSlot?: number;
};

export type JustifyLineResult = {
  text: string;
  /** Replay over offset-keyed data via `kashidaTextPatch`, in this order. */
  edits: DistributionEdit[];
  fontSize: number;
  addedLetter: number;
  addedWord: number;
  width: number;
  shrunk: boolean;
  reason: "justified" | "short";
};

/** `text` with every slot's kashida removed. */
export function stripKashida(text: string): string {
  const slots = findKashidaSlots(text);
  return applyDistributionWithEdits(text, slots, slots.map(() => 0)).text;
}

/** A line's width with no kashida — what "the widest line" is judged by. */
export function naturalWidth(
  text: string,
  fontSize: number,
  spacing: LineSpacing,
  measure: LineMeasure
): Promise<number> {
  return measure(stripKashida(text), fontSize, spacing);
}

export async function justifyLine({
  text,
  baseFontSize,
  userSpacing,
  target,
  measure,
  maxPerSlot = MAX_KASHIDA_PER_SLOT,
}: JustifyLineInput): Promise<JustifyLineResult> {
  // 1. Shrink. Always judged from the base size, so a line shrunk for a
  //    narrow target grows back when the target widens.
  const stripped = stripKashida(text);
  let fontSize = baseFontSize;
  let shrunk = false;
  const natural = await measure(stripped, fontSize, userSpacing);
  if (natural > target && natural > 0) {
    shrunk = true;
    fontSize = (baseFontSize * target) / natural;
    for (let i = 0; i < MAX_SHRINK_STEPS; i++) {
      if ((await measure(stripped, fontSize, userSpacing)) <= target) break;
      fontSize *= SHRINK_STEP;
    }
  }

  // 2. Kashida. Absolute counts from the caller's text, so an earlier run's
  //    tatweel is replaced, not added to.
  const fit = await solveFitToWidth({
    text,
    target,
    measure: (candidate) => measure(candidate, fontSize, userSpacing),
    maxPerSlot,
  });
  let width = fit.width;
  let added = 0;

  // 3. Spacing fill for what kashida could not reach. Width is linear in the
  //    added amount, so a first guess plus one secant correction lands on
  //    it; both candidates are measured, and only one at or under the target
  //    is ever kept.
  if (target - width > JUSTIFY_TOLERANCE) {
    const { pieceBreaks, wordGaps } = countSpacingBoundaries(fit.text);
    const n = pieceBreaks + wordGaps;
    if (n > 0 && fontSize > 0) {
      const at = (e: number) =>
        measure(fit.text, fontSize, { letter: userSpacing.letter + e, word: userSpacing.word + e });
      const e1 = (target - width) / n / fontSize;
      const w1 = await at(e1);
      let best = 0;
      let bestWidth = width;
      if (w1 <= target && w1 > bestWidth) {
        best = e1;
        bestWidth = w1;
      }
      if (w1 !== width) {
        const e2 = (e1 * (target - width)) / (w1 - width);
        if (Number.isFinite(e2) && e2 > 0 && e2 !== e1) {
          const w2 = await at(e2);
          if (w2 <= target && w2 > bestWidth) {
            best = e2;
            bestWidth = w2;
          }
        }
      }
      added = best;
      width = bestWidth;
    }
  }

  return {
    text: fit.text,
    edits: fit.edits,
    fontSize,
    addedLetter: added,
    addedWord: added,
    width,
    shrunk,
    reason: target - width <= JUSTIFY_TOLERANCE ? "justified" : "short",
  };
}

/** The size Justify should start from: the user's own if they changed it since. */
export function baseFontSizeForLine(b: TextBlock): number {
  const v = b.verse;
  if (!v) return b.fontSize;
  return b.fontSize === v.fittedFontSize ? v.baseFontSize : b.fontSize;
}

/** The user's own spacing, with the last Justify's additions taken back off. */
export function baseSpacingForLine(b: TextBlock): LineSpacing {
  return {
    letter: (b.letterSpacing ?? 0) - (b.verse?.addedLetter ?? 0),
    word: (b.wordSpacing ?? 0) - (b.verse?.addedWord ?? 0),
  };
}

export function describeVerseResult(results: readonly JustifyLineResult[], target: number): string {
  const n = results.length;
  const shrunk = results.filter((r) => r.shrunk).length;
  const short = results.filter((r) => r.reason === "short").length;
  let msg = `${n} ${n === 1 ? "line" : "lines"} justified to ${Math.round(target)} px`;
  if (shrunk > 0) msg += ` · ${shrunk} shrunk`;
  if (short > 0) msg += ` · ${short} couldn't reach full width`;
  return msg;
}
```

- [ ] **Step 4: Run the test and check that it passes.**
  Run: `npx vitest run src/lib/verseJustify.test.ts`
  Expected: PASS.
  - If a synthetic case misses because of how `findKashidaSlots` classifies a letter pair (for example, "بب دد" has no slot), change the test's text to one that has the stated property: it is capped with boundaries, or has no slots. Record a ruling.
  - Never loosen the overshoot or tolerance assertions.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/verseJustify.ts src/lib/verseJustify.test.ts
git commit -m "Verse: justify one line with kashida, spacing and shrink" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```

---

### Task 4: App wiring for `createVerse` and `justifyVerse`

**Files:**
- Modify: `src/App.tsx`:
  - imports near line 143;
  - new handlers placed directly after `fitSelectedBlockToWidth`, which ends around line 2467;
  - props passed to `Sidebar`.
- Modify: `src/components/Sidebar.tsx` (prop types only, in `SidebarProps` near line 167, plus destructuring near line 461)

**Interfaces:**
- Consumes: Task 2 (`layoutVerse`, `verseAnchor`, `DEFAULT_LINE_GAP`, `DEFAULT_COLUMN_GAP`, the `VerseTag`/`VerseSettings`/`VerseLayout` types) and Task 3 (`justifyLine`, `naturalWidth`, `baseFontSizeForLine`, `baseSpacingForLine`, `describeVerseResult`, `type JustifyLineResult`, `type LineMeasure`).
- Produces these Sidebar props:
  - `onCreateVerse?: (lines: string[], layout: VerseLayout) => void`
  - `onJustifyVerse?: (overrides?: Partial<VerseSettings>) => void`
  - `isJustifyingVerse?: boolean`

There is no unit test, because App calls `shapeText` (fetch). Task 6's e2e covers it. This task's gate is typecheck plus the full unit suite staying green.

- [ ] **Step 1: Add the imports to `App.tsx`.**

```ts
import { layoutVerse, verseAnchor, DEFAULT_LINE_GAP, DEFAULT_COLUMN_GAP } from "./lib/verseLayout";
import {
  justifyLine,
  naturalWidth,
  baseFontSizeForLine,
  baseSpacingForLine,
  describeVerseResult,
  type JustifyLineResult,
  type LineMeasure,
} from "./lib/verseJustify";
import { captureStyle, styleToPatch } from "./lib/textStyles"; // only if not already imported
```

  Also add `TextBlock`, `VerseLayout` and `VerseSettings` to the existing `./types` import.

- [ ] **Step 2: Add the solver and handlers** after `fitSelectedBlockToWidth`:

```ts
  // Verse: several ordinary text blocks justified to one width and laid out
  // as stacked lines or bayt couplets. See .claude/rules/verse.md.
  const [isJustifyingVerse, setIsJustifyingVerse] = useState(false);

  /** A per-line measure: each line's own font, style, alternates and size. */
  const measureForLine = (line: TextBlock): LineMeasure => {
    const fontUrl = resolveFontUrl(line.fontFamily);
    return (text, fontSize, spacing) => {
      const sized = { ...line, fontSize };
      return measureShapedWidth(
        text,
        fontUrl,
        fontSize,
        runStyleForBlock(sized, cutWidthForBlock(sized)),
        line.glyphAlternates,
        line.styleSets,
        spacing
      );
    };
  };

  /**
   * Measures and solves every line, returning one patch per line id. Async and
   * side-effect free; callers push history and write the patches in one go.
   */
  const solveVerse = async (
    lines: readonly TextBlock[],
    verseId: number,
    settings: VerseSettings,
    anchor: { x: number; y: number }
  ) => {
    const inputs = lines.map((line) => ({
      line,
      measure: measureForLine(line),
      baseFontSize: baseFontSizeForLine(line),
      base: baseSpacingForLine(line),
    }));
    const target =
      settings.width ??
      Math.max(
        0,
        ...(await Promise.all(
          inputs.map((i) => naturalWidth(i.line.text, i.baseFontSize, i.base, i.measure))
        ))
      );
    const results: JustifyLineResult[] = [];
    for (const i of inputs) {
      results.push(
        await justifyLine({
          text: i.line.text,
          baseFontSize: i.baseFontSize,
          userSpacing: i.base,
          target,
          measure: i.measure,
        })
      );
    }
    const positions = layoutVerse(
      lines.length,
      { ...settings, target, fontSize: inputs[0]?.baseFontSize ?? DEFAULT_NEW_BLOCK_FONT_SIZE },
      anchor
    );
    const patches = new Map<number, Partial<Block>>();
    inputs.forEach((i, index) => {
      const r = results[index];
      patches.set(i.line.id, {
        ...kashidaTextPatch(i.line, r.text, r.edits),
        fontSize: r.fontSize,
        letterSpacing: i.base.letter + r.addedLetter,
        wordSpacing: i.base.word + r.addedWord,
        x: positions[index].x,
        y: positions[index].y,
        align: "center",
        verse: {
          ...settings,
          id: verseId,
          index,
          baseFontSize: i.baseFontSize,
          fittedFontSize: r.fontSize,
          addedLetter: r.addedLetter,
          addedWord: r.addedWord,
        },
      });
    });
    return { patches, status: describeVerseResult(results, target) };
  };

  /** Re-justifies the selected block's verse, optionally with new settings. One undo step. */
  const justifyVerse = useCallback(
    async (overrides?: Partial<VerseSettings>) => {
      if (!selectedBlock || selectedBlock.type !== "text" || !selectedBlock.verse) return;
      if (isJustifyingVerse) return;
      const verseId = selectedBlock.verse.id;
      const lines = blocks
        .filter((b): b is TextBlock => b.type === "text" && b.verse?.id === verseId)
        .sort((a, b) => a.verse!.index - b.verse!.index || a.id - b.id);
      const tag = lines[0].verse!;
      const settings: VerseSettings = {
        layout: tag.layout,
        width: tag.width,
        lineGap: tag.lineGap,
        columnGap: tag.columnGap,
        ...overrides,
      };
      // Read the anchor in the layout the blocks are in *now*, before any
      // override changes it — that is what keeps a dragged verse in place.
      const anchor = verseAnchor(lines, tag.layout);
      setIsJustifyingVerse(true);
      try {
        const { patches, status } = await solveVerse(lines, verseId, settings, anchor);
        pushHistory();
        setBlocks((prev) =>
          prev.map((b) => {
            const patch = patches.get(b.id);
            // A line deleted during the solve has no entry to match; the rest still land.
            return patch ? ({ ...b, ...patch } as Block) : b;
          })
        );
        setExportStatus(status);
      } catch (err) {
        console.error("verse justify failed", err);
        setExportStatus("Could not justify this verse.");
      } finally {
        setIsJustifyingVerse(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedBlock, blocks, isJustifyingVerse, pushHistory, kashidaTextPatch]
  );

  /** Creates a verse from typed lines, justified and laid out. One undo step. */
  const createVerse = async (rawLines: string[], layout: VerseLayout) => {
    const texts = rawLines.map((l) => l.trim()).filter((l) => l !== "");
    if (texts.length === 0) {
      setExportStatus("Type at least one line of verse.");
      return;
    }
    const style =
      selectedBlock?.type === "text" ? styleToPatch(captureStyle(selectedBlock, "verse")) : {};
    const verseId =
      1 + Math.max(0, ...blocks.map((b) => (b.type === "text" ? b.verse?.id ?? 0 : 0)));
    const groupId = texts.length > 1 ? nextGroupIdRef.current++ : undefined;
    const settings: VerseSettings = {
      layout,
      lineGap: DEFAULT_LINE_GAP,
      columnGap: DEFAULT_COLUMN_GAP,
    };
    const lines: TextBlock[] = texts.map((text) => ({
      ...DEFAULT_BLOCK,
      fontSize: DEFAULT_NEW_BLOCK_FONT_SIZE,
      ...style,
      id: createNextId(),
      text,
      type: "text",
      groupId,
    }) as TextBlock);
    const fontSize = lines[0].fontSize;
    const rows = layout === "bayt" ? Math.ceil(lines.length / 2) : lines.length;
    // Centre the new verse on the artboard (whose centre is the origin) or the
    // freeform origin, which is where a fresh session's content sits.
    const anchor = { x: 0, y: -((rows - 1) * DEFAULT_LINE_GAP * fontSize) / 2 };
    setIsJustifyingVerse(true);
    try {
      const { patches, status } = await solveVerse(lines, verseId, settings, anchor);
      pushHistory();
      const built = lines.map((l) => ({ ...l, ...patches.get(l.id) }) as Block);
      setBlocks((prev) => [...prev, ...built]);
      setSelectedIds([]);
      setSelectedId(built[0].id);
      setExportStatus(status);
    } catch (err) {
      console.error("verse create failed", err);
      setExportStatus("Could not create this verse.");
    } finally {
      setIsJustifyingVerse(false);
    }
  };
```

  Checks for the executor:
  - `DEFAULT_BLOCK` carries `id: 1` and `type: "text"`. Both are overridden above.
  - If `captureStyle` or `styleToPatch` are already imported under other names, reuse those names.
  - If `useCallback`'s dependency list makes the lint rule complain in a way the `eslint-disable` line doesn't cover, add `measureForLine` and `solveVerse` as plain functions (as written), keep the disable comment, and record a ruling.

- [ ] **Step 3: Pass the props to Sidebar.** Add them in the same props object or spread that carries `onFitToWidth` (`p1dSidebarProps`, around line 2560):

```ts
    onCreateVerse: createVerse,
    onJustifyVerse: justifyVerse,
    isJustifyingVerse,
```

  In `Sidebar.tsx`, add these to `SidebarProps` next to `onApplyNameDesign`, and to the destructuring:

```ts
  onCreateVerse?: (lines: string[], layout: VerseLayout) => void;
  onJustifyVerse?: (overrides?: Partial<VerseSettings>) => void;
  isJustifyingVerse?: boolean;
```

  Import `VerseLayout` and `VerseSettings` from `../types`.

- [ ] **Step 4: Typecheck, lint and run the unit suite.**
  Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
  Expected: no type errors and no lint errors. The unit suite passes in full (the count from before plus the Task 1–3 additions).
  - Unused-prop lint warnings in Sidebar are acceptable only until Task 5. If lint fails on them, prefix the destructured names with an underscore for now, or do Task 5 before committing, and record a ruling.

- [ ] **Step 5: Commit.**

```bash
git add src/App.tsx src/components/Sidebar.tsx
git commit -m "Verse: create and justify handlers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```

---

### Task 5: `VerseDialog` and `VersePanel` UI

**Files:**
- Create: `src/components/VerseDialog.tsx` (the `VerseButton` plus the portaled modal)
- Create: `src/components/sidebar/VersePanel.tsx`
- Modify: `src/components/Sidebar.tsx`:
  - render `VerseButton` at the end of the Block Controls panel, just before that panel's closing `</div>` (after the `blockControlSplit` block, around line 2030);
  - render `VersePanel` in the selected tier directly after the Content panel's closing `</div>`.
- Modify: the existing sidebar stylesheet that defines `.sidebarSectionButton` (find it with `grep -rn "sidebarSectionButton" src/*.css src/**/*.css`). Add only what the dialog needs, reusing the NameDesignDialog's modal classes where they exist.

**Interfaces:**
- Consumes the Task 4 props (`onCreateVerse`, `onJustifyVerse`, `isJustifyingVerse`) and `selectedBlock`.
- Produces these accessible names, which Task 6 selects by:
  - button **"New verse…"**;
  - dialog textarea labelled **"Verse lines"**;
  - radio buttons **"Stacked"** and **"Bayt"**;
  - button **"Create verse"**;
  - panel title **"Verse"**;
  - number inputs labelled **"Verse width"**, **"Line gap"** and **"Column gap"**;
  - button **"Justify"**.

- [ ] **Step 1: Create `src/components/VerseDialog.tsx`.** Follow `NameDesignDialog.tsx`'s portal and close pattern: read its first 120 lines for the overlay, the Escape handling and the class names, and reuse the same classes.

```tsx
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { VerseLayout } from "../types";
import { CloseIcon } from "./Icons";

/**
 * "New verse": type a poem one line per line, choose stacked or bayt, and
 * get one justified text block per line. Portaled to `document.body` for the
 * same reason every modal here is (the sidebar clips, the stage exports).
 */
export const VerseDialog: React.FC<{
  onCreate: (lines: string[], layout: VerseLayout) => void;
  onClose: () => void;
}> = ({ onCreate, onClose }) => {
  const [text, setText] = useState("");
  const [layout, setLayout] = useState<VerseLayout>("stacked");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");

  return createPortal(
    <div className="modalOverlay" onMouseDown={onClose}>
      <div
        className="modalCard"
        role="dialog"
        aria-modal="true"
        aria-label="New verse"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <h2>New verse</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <label htmlFor="verse-lines">Verse lines</label>
        <textarea
          id="verse-lines"
          className="sidebarTextarea"
          dir="rtl"
          lang="ar"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="One line of the poem per line"
          spellCheck={false}
        />
        <fieldset>
          <legend>Layout</legend>
          <label>
            <input type="radio" name="verse-layout" checked={layout === "stacked"} onChange={() => setLayout("stacked")} />
            Stacked
          </label>
          <label>
            <input type="radio" name="verse-layout" checked={layout === "bayt"} onChange={() => setLayout("bayt")} />
            Bayt
          </label>
        </fieldset>
        <button
          type="button"
          className="sidebarSectionButton"
          disabled={lines.length === 0}
          onClick={() => {
            onCreate(lines, layout);
            onClose();
          }}
        >
          Create verse
        </button>
      </div>
    </div>,
    document.body
  );
};

export const VerseButton: React.FC<{
  onCreate: (lines: string[], layout: VerseLayout) => void;
  disabled?: boolean;
}> = ({ onCreate, disabled }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="sidebarSectionButton" disabled={disabled} onClick={() => setOpen(true)}>
        <span>New verse…</span>
      </button>
      {open && <VerseDialog onCreate={onCreate} onClose={() => setOpen(false)} />}
    </>
  );
};
```

  If NameDesignDialog's overlay, card and header classes are named differently, use its names instead of `modalOverlay`, `modalCard` and `modalHeader`, and add no new CSS.

- [ ] **Step 2: Create `src/components/sidebar/VersePanel.tsx`.**

```tsx
import { useEffect, useState } from "react";
import type { VerseSettings, VerseTag } from "../../types";

/** A number field that commits on blur or Enter — each commit is a full re-justify. */
const CommitNumber: React.FC<{
  id: string;
  label: string;
  value: number | undefined;
  placeholder?: string;
  step: number;
  min: number;
  onCommit: (v: number | undefined) => void;
}> = ({ id, label, value, placeholder, step, min, onCommit }) => {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  useEffect(() => setDraft(value === undefined ? "" : String(value)), [value]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") return value === undefined ? undefined : onCommit(undefined);
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < min) return setDraft(value === undefined ? "" : String(value));
    if (n !== value) onCommit(n);
  };
  return (
    <div className="sidebarRow">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        step={step}
        min={min}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </div>
  );
};

/**
 * Settings for the verse the selected line belongs to. Every change re-runs
 * Justify across all its lines as one undo step; editing a line's own text
 * does not — press Justify after typing.
 */
export const VersePanel: React.FC<{
  verse: VerseTag;
  busy: boolean;
  onJustify: (overrides?: Partial<VerseSettings>) => void;
}> = ({ verse, busy, onJustify }) => (
  <div className="sectionPanel">
    <div className="sidebarRow" role="radiogroup" aria-label="Verse layout">
      {(["stacked", "bayt"] as const).map((layout) => (
        <label key={layout}>
          <input
            type="radio"
            name={`verse-${verse.id}-layout`}
            checked={verse.layout === layout}
            disabled={busy}
            onChange={() => onJustify({ layout })}
          />
          {layout === "stacked" ? "Stacked" : "Bayt"}
        </label>
      ))}
    </div>
    <CommitNumber
      id={`verse-${verse.id}-width`}
      label="Verse width"
      value={verse.width}
      placeholder="Widest line"
      step={1}
      min={1}
      onCommit={(width) => onJustify({ width })}
    />
    <CommitNumber
      id={`verse-${verse.id}-line-gap`}
      label="Line gap"
      value={verse.lineGap}
      step={0.1}
      min={0}
      onCommit={(v) => v !== undefined && onJustify({ lineGap: v })}
    />
    {verse.layout === "bayt" && (
      <CommitNumber
        id={`verse-${verse.id}-column-gap`}
        label="Column gap"
        value={verse.columnGap}
        step={0.1}
        min={0}
        onCommit={(v) => v !== undefined && onJustify({ columnGap: v })}
      />
    )}
    <button type="button" className="sidebarSectionButton" disabled={busy} onClick={() => onJustify()}>
      <span>{busy ? "Justifying…" : "Justify"}</span>
    </button>
  </div>
);
```

  Match `sidebarRow` to whichever row class `FormControls.tsx`'s `SelectRow` uses, and check it there before relying on it.

- [ ] **Step 3: Wire both into `Sidebar.tsx`.**
  - Import `VerseButton` from `./VerseDialog` and `VersePanel` from `./sidebar/VersePanel`.
  - Add a `showVerse` collapse state beside `showContent`, defaulting to `true`.
  - In Block Controls, before the panel's closing `</div>`:

```tsx
          {onCreateVerse && (
            <VerseButton onCreate={onCreateVerse} disabled={isJustifyingVerse} />
          )}
```

  - In the selected tier, directly after the Content panel's block:

```tsx
        {selectedBlock?.type === "text" && selectedBlock.verse && onJustifyVerse && (
          <div className="sidebarPanel">
            <CollapsibleSection title="Verse" isOpen={showVerse} onToggle={() => setShowVerse((v) => !v)}>
              <VersePanel
                verse={selectedBlock.verse}
                busy={!!isJustifyingVerse}
                onJustify={onJustifyVerse}
              />
            </CollapsibleSection>
          </div>
        )}
```

- [ ] **Step 4: Run the full static loop.**
  Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
  Expected: everything passes.

- [ ] **Step 5: Commit.**

```bash
git add src/components/VerseDialog.tsx src/components/sidebar/VersePanel.tsx src/components/Sidebar.tsx src
git commit -m "Verse: New verse dialog and Verse panel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```

---

### Task 6: e2e

**Files:**
- Create: `e2e/verse.spec.ts`

**Interfaces:**
- Consumes the Task 5 accessible names and the `e2e/harf.ts` helpers `gotoApp`, `getBlocks`, `blockClientBox` and `settleFrames`.

- [ ] **Step 1: Write the spec.**

```ts
import { expect, test, type Page } from "@playwright/test";
import { blockClientBox, getBlocks, gotoApp, settleFrames } from "./harf";
import type { TextBlock } from "../src/types";

/**
 * The unit suites prove the solver and the layout against real shaping; what
 * only a browser shows is that the drawn lines come out the same width, that
 * bayt really puts the first misra' on the right, and that a whole Justify is
 * one undo.
 */

const POEM = ["محمد رسول الله", "بسم الله", "سلام عليكم ورحمة الله"];

async function verseLines(page: Page): Promise<TextBlock[]> {
  return (await getBlocks(page))
    .filter((b): b is TextBlock => b.type === "text" && b.verse !== undefined)
    .sort((a, b) => a.verse!.index - b.verse!.index);
}

async function createVerse(page: Page, layout: "Stacked" | "Bayt") {
  await page.getByRole("button", { name: "New verse…" }).click();
  await page.getByLabel("Verse lines").fill(POEM.join("\n"));
  await page.getByRole("dialog", { name: "New verse" }).getByLabel(layout).check();
  await page.getByRole("button", { name: "Create verse" }).click();
  await expect.poll(async () => (await verseLines(page)).length).toBe(3);
  await settleFrames(page);
}

async function widths(page: Page) {
  const lines = await verseLines(page);
  return Promise.all(lines.map(async (l) => (await blockClientBox(page, l.id)).width));
}

test("a new stacked verse justifies every line to the same width", async ({ page }) => {
  await gotoApp(page);
  await createVerse(page, "Stacked");
  await expect
    .poll(async () => {
      const w = await widths(page);
      return (Math.max(...w) - Math.min(...w)) / Math.max(...w);
    })
    .toBeLessThan(0.03);
  const lines = await verseLines(page);
  expect(lines[1].y).toBeGreaterThan(lines[0].y);
  expect(lines[0].x).toBeCloseTo(lines[1].x, 3);
});

test("bayt puts the first misra' on the right, the second on the left", async ({ page }) => {
  await gotoApp(page);
  await createVerse(page, "Bayt");
  const [a, b, c] = await verseLines(page);
  expect(a.x).toBeGreaterThan(b.x);
  expect(a.y).toBeCloseTo(b.y, 3);
  expect(c.y).toBeGreaterThan(a.y);
});

test("Justify twice changes nothing, and a width change is one undo", async ({ page }) => {
  await gotoApp(page);
  await createVerse(page, "Stacked");
  const before = (await verseLines(page)).map((l) => l.text);

  await page.getByRole("button", { name: "Justify", exact: true }).click();
  await settleFrames(page);
  expect((await verseLines(page)).map((l) => l.text)).toEqual(before);

  const wider = Math.round((await verseLines(page))[0].fontSize * 12);
  await page.getByLabel("Verse width").fill(String(wider));
  await page.getByLabel("Verse width").press("Enter");
  await expect.poll(async () => (await verseLines(page))[0].verse?.width).toBe(wider);
  await expect.poll(async () => (await verseLines(page)).map((l) => l.text)).not.toEqual(before);

  await page.getByRole("button", { name: "Justify", exact: true }).focus();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await verseLines(page)).map((l) => l.text)).toEqual(before);
});
```

  If `getByLabel(layout)` matches more than one control, scope it to the dialog as written. If the app's undo shortcut ignores key presses while a button has focus, click an empty part of the canvas first, the way the existing specs do in `core.spec.ts`. Record a ruling either way.

- [ ] **Step 2: Run it.**
  Run: `npx tsc --noEmit -p e2e/tsconfig.json && npx playwright test e2e/verse.spec.ts`
  Expected: 3 passed.
  - A failure here means a real bug in Tasks 4–5. Debug it; don't loosen a tolerance past 3%.

- [ ] **Step 3: Run the whole e2e suite.**
  Run: `npm run e2e`
  Expected: everything passes.

- [ ] **Step 4: Commit.**

```bash
git add e2e/verse.spec.ts
git commit -m "Verse: e2e for create, bayt and undo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```

---

### Task 7: Docs, guide, and spec sync

**Files:**
- Create: `.claude/rules/verse.md`
- Create: `src/components/guide/sections/verse.tsx` (copy the export shape of an existing section, e.g. the one for typography or name designs, exactly)
- Modify: `CLAUDE.md` (one line under "Subsystem notes", after "Letter & word spacing")
- Modify: `PROGRESS.md` (a new dated entry at the top of the shipped list, following the existing format)
- Modify: `.claude/rules/fit-to-width.md` (one line saying verse Justify reuses `solveFitToWidth`)
- Modify: `docs/superpowers/specs/2026-10-13-verse-justification-design.md` (bring in the four decisions from this plan's "Decisions" section)

- [ ] **Step 1: Write `.claude/rules/verse.md`.**

```markdown
---
paths:
  - "src/lib/verseLayout*"
  - "src/lib/verseJustify*"
  - "src/components/VerseDialog.tsx"
  - "src/components/sidebar/VersePanel.tsx"
  - "e2e/verse.spec.ts"
---

# Multi-line verse

A verse is **ordinary text blocks** sharing a `verse` tag (`VerseTag` in
`types.ts`) and a `groupId`. Every per-letter tool works on a line unchanged
because a line *is* a text block; that was the reason for not making a
verse block type.

- **Layout** (`verseLayout.ts`, pure): stacked on one column, or bayt with
  the first misra' in the right column. The anchor is *derived* from the
  blocks (`verseAnchor`), never stored, so a dragged verse re-justifies in
  place.
- **Justify** (`verseJustify.ts`, pure, measure injected): shrink from
  `baseFontSize` if too wide → `solveFitToWidth` → spread the remainder over
  `countSpacingBoundaries`, measured, never overshooting. Kashida writes go
  through `kashidaTextPatch`.
- **Undo and async:** `solveVerse` measures every line first; `justifyVerse` and
  `createVerse` then `pushHistory()` once and write all patches in one
  `setBlocks`, by id.
- **Traps:**
  - `addedLetter` and `addedWord` are what the last Justify added. `baseSpacingForLine`
    takes them off before solving, so spacing never stacks. Writing
    `letterSpacing` on a verse line without updating the tag makes the next
    Justify subtract the wrong amount.
  - `fittedFontSize` is how a manual size change is detected. Justify writes
    it with `fontSize`. Anything else that writes a verse line's `fontSize`
    is treated as the user's new base.
  - The fill can push `letterSpacing` past the slider's range. That is allowed.
  - Editing a line's text does not re-justify it; the user presses Justify.
- **Not supported:** rows of more than two half-lines, unequal columns, Shape Fill,
  Curve and kufi lines, the practice sheet, or converting existing blocks into a verse.
```

- [ ] **Step 2: Add the CLAUDE.md index line.**

```markdown
- **Multi-line verse** — [`.claude/rules/verse.md`](.claude/rules/verse.md). Lines are plain text blocks with a `verse` tag; anchor derived from the blocks, not stored; Justify's own spacing is tracked (`addedLetter`/`addedWord`) and removed before re-solving, so it never stacks.
```

- [ ] **Step 3: Write the guide section and the PROGRESS entry.**
  - The guide is written for calligraphers. It covers making a verse with New verse…, stacked vs bayt, what Justify does (kashida first, then spacing, shrinking a line that is too long), that you press Justify after editing a line, and that Width left empty means "match the longest line".
  - The PROGRESS entry is `2026-10-13: Multi-line verse with per-line justification`. It gets two lines and a pointer to the rule file.

- [ ] **Step 4: Sync the spec.**
  - Edit the spec's Data block to add `fittedFontSize`.
  - Replace "The first time, it comes from line 0's current position" with the derived-anchor rule.
  - Change "The document tier gets the Verse creation entry" to "Block Controls gets the New verse… button".
  - Note that the Width and gap fields are commit-on-blur number inputs.

- [ ] **Step 5: Run the full loop and commit.**
  Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
  Expected: everything passes.

```bash
git add .claude/rules/verse.md .claude/rules/fit-to-width.md CLAUDE.md PROGRESS.md src/components/guide/sections/verse.tsx docs/superpowers/specs/2026-10-13-verse-justification-design.md
git commit -m "Verse: docs, guide and spec sync" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```
