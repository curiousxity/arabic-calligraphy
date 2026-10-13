# Letter and Word Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two sliders on text blocks — Letter spacing (acts only at gaps between a word's separate pieces) and Word spacing (acts at spaces) — both able to go negative.

**Architecture:** A pure `applySpacing` adjusts HarfBuzz advances (`ax`) right after shaping, preserving glyph count and order, so every downstream loop and index-keyed feature works unchanged. It is applied in `ShapedText` (drawing) and `measureShapedRun` (Fit to width, Name Designs).

**Tech Stack:** React 19 + TypeScript, react-konva, harfbuzzjs, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-letter-word-spacing-design.md`

## Global Constraints

- Text blocks only. Shape Fill, Curve, square kufi, practice sheet ignore spacing.
- Values are a fraction of font size. Letter −0.3…+1.0, word −0.5…+2.0, step 0.01. Absent = 0.
- Letter spacing never acts inside a join, inside a cluster (marks, ligatures), or before a space.
- Both 0/absent → `applySpacing` returns its input array by identity; old saves render byte-identically. No save-format version bump.
- `src/lib/spacing.ts` must not import `./harfbuzz` at runtime (type-only imports of `normalizeGlyphs` are fine).
- Spacing tests use real harfbuzzjs + real fonts from `public/fonts/` — never hand-written `{ g, cl }` fixtures.
- Verification loop after the code tasks: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, `npm run build`. Don't re-run the full loop after every small step (batch it).
- Commits: the pre-commit hook bumps `package.json`'s patch — expect `package.json`/`package-lock.json` in every commit. End each message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc
  ```

## Review Focus

- **Persian ZWNJ (`می‌خواهم`)** — a ZWNJ is a piece break; the gap must be widened exactly once, not once on each side of the ZWNJ glyph. Pinned in Task 1.
- **Lam-alef ligature (`سلام`, `لا`)** — one cluster spanning two letters; must not split and must not be double-counted. Pinned in Task 1.
- **Letter before a space** — a final letter followed by a space is a word gap, not a piece break; letter spacing must not touch it. Pinned in Task 1 and the e2e.
- **Fit to width with spacing set** — the solver must measure the spaced run or it overshoots. Pinned in Task 2 (measurement test).
- **Mirror of a spaced block** — must draw the same spacing; covered by `blockRenderProps` carrying the fields (Task 2 test).

---

### Task 1: `applySpacing` (pure module + real-shaping tests)

**Files:**
- Create: `src/lib/spacing.ts`
- Create: `src/lib/spacing.test.ts`
- Modify: `src/lib/arabicJoining.ts:36` (export `isTransparent`)
- Modify: `src/types.ts:127-133` (`TextBlock` gains the two fields — text in Task 2 Step 1)

**Interfaces:**
- Produces:
  ```ts
  export type Spacing = { letter?: number; word?: number };
  export const LETTER_SPACING_MIN = -0.3, LETTER_SPACING_MAX = 1;
  export const WORD_SPACING_MIN = -0.5, WORD_SPACING_MAX = 2;
  export function applySpacing(glyphs: readonly HarfBuzzGlyph[], text: string, spacing: Spacing, unitsPerEm: number): HarfBuzzGlyph[];
  export function spacingForBlock(b: Block): Spacing; // {} for non-text blocks
  ```
  and `export function isTransparent(cp: number): boolean` from `arabicJoining.ts`.

- [ ] **Step 1: Export `isTransparent`**

In `src/lib/arabicJoining.ts` line 36 change `function isTransparent(cp: number): boolean {` to `export function isTransparent(cp: number): boolean {`. No other change.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/spacing.test.ts`. Copy **lines 1–129 of `src/lib/diacritics.test.ts` verbatim** (the imports, the `createRequire` harfbuzzjs load, `resolveHbLoader`, `hbPromise`, and `shapeReal`), then replace the `import type { HarfBuzzGlyph } from "./harfbuzz";` line with `import type { HarfBuzzGlyph } from "./normalizeGlyphs";` and make sure `normalizeGlyphs` is imported the same way `diacritics.test.ts` imports it. Remove any import the copied block brings in that the file below doesn't use (lint will tell you). Then append:

```ts
import { applySpacing, spacingForBlock } from "./spacing";
import type { Block } from "../types";

const sumAx = (gs: readonly HarfBuzzGlyph[]) => gs.reduce((s, g) => s + (g.ax ?? 0), 0);

async function shaped(text: string, file = "Amiri.ttf") {
  const { glyphs, font } = await shapeReal(text, file);
  return { glyphs, upm: font.unitsPerEm || 1000 };
}

describe("applySpacing (real HarfBuzz shaping)", () => {
  it("returns the input array itself when both values are zero or absent", async () => {
    const { glyphs, upm } = await shaped("درود");
    expect(applySpacing(glyphs, "درود", {}, upm)).toBe(glyphs);
    expect(applySpacing(glyphs, "درود", { letter: 0, word: 0 }, upm)).toBe(glyphs);
  });

  it("preserves glyph count and order and changes nothing but ax", async () => {
    const { glyphs, upm } = await shaped("محمد رسول");
    const out = applySpacing(glyphs, "محمد رسول", { letter: 0.2, word: 0.3 }, upm);
    expect(out).toHaveLength(glyphs.length);
    out.forEach((g, i) => {
      expect(g.g).toBe(glyphs[i].g);
      expect(g.cl).toBe(glyphs[i].cl);
      expect(g.dx).toBe(glyphs[i].dx);
      expect(g.dy).toBe(glyphs[i].dy);
    });
    // Does not mutate its input.
    expect(sumAx(glyphs)).toBe(sumAx((await shaped("محمد رسول")).glyphs));
  });

  it("widens each piece break by exactly letter × upm (درود has three)", async () => {
    const { glyphs, upm } = await shaped("درود");
    const out = applySpacing(glyphs, "درود", { letter: 0.2 }, upm);
    expect(sumAx(out) - sumAx(glyphs)).toBeCloseTo(3 * 0.2 * upm, 6);
  });

  it("touches exactly one glyph where a word has one break (بابا)", async () => {
    const { glyphs, upm } = await shaped("بابا");
    const out = applySpacing(glyphs, "بابا", { letter: 0.25 }, upm);
    const changed = out.filter((g, i) => g.ax !== glyphs[i].ax);
    expect(changed).toHaveLength(1);
    expect(sumAx(out) - sumAx(glyphs)).toBeCloseTo(0.25 * upm, 6);
  });

  it("never parts joined letters: a fully joined word does not change", async () => {
    const { glyphs, upm } = await shaped("بببب");
    expect(sumAx(applySpacing(glyphs, "بببب", { letter: 0.5 }, upm))).toBe(sumAx(glyphs));
  });

  it("letter spacing ignores the gap before a space; word spacing widens only the space", async () => {
    const text = "بب بب";
    const { glyphs, upm } = await shaped(text);
    expect(sumAx(applySpacing(glyphs, text, { letter: 0.5 }, upm))).toBe(sumAx(glyphs));
    const out = applySpacing(glyphs, text, { word: 0.5 }, upm);
    expect(sumAx(out) - sumAx(glyphs)).toBeCloseTo(0.5 * upm, 6);
    const changed = out.map((g, i) => (g.ax !== glyphs[i].ax ? g.cl : null)).filter((c) => c !== null);
    expect(changed).toEqual([2]); // the space's cluster
  });

  it("treats a lam-alef as one piece: سلام has one break, لا has none", async () => {
    const a = await shaped("سلام");
    expect(sumAx(applySpacing(a.glyphs, "سلام", { letter: 0.2 }, a.upm)) - sumAx(a.glyphs)).toBeCloseTo(0.2 * a.upm, 6);
    const b = await shaped("لا");
    expect(sumAx(applySpacing(b.glyphs, "لا", { letter: 0.2 }, b.upm))).toBe(sumAx(b.glyphs));
  });

  it("gives marks nothing: دَرَ has one break whether or not it carries harakat", async () => {
    const { glyphs, upm } = await shaped("دَرَ");
    const out = applySpacing(glyphs, "دَرَ", { letter: 0.2 }, upm);
    expect(sumAx(out) - sumAx(glyphs)).toBeCloseTo(0.2 * upm, 6);
  });

  it("counts a ZWNJ break once (ب‌ب)", async () => {
    const text = "ب‌ب";
    const { glyphs, upm } = await shaped(text);
    const out = applySpacing(glyphs, text, { letter: 0.2 }, upm);
    expect(sumAx(out) - sumAx(glyphs)).toBeCloseTo(0.2 * upm, 6);
  });

  it("tightens by the same exact amount when negative", async () => {
    const { glyphs, upm } = await shaped("درود");
    const out = applySpacing(glyphs, "درود", { letter: -0.1 }, upm);
    expect(sumAx(out) - sumAx(glyphs)).toBeCloseTo(-3 * 0.1 * upm, 6);
  });

  it("works on a second font (Scheherazade)", async () => {
    const { glyphs, upm } = await shaped("درود", "Scheherazade.ttf");
    const out = applySpacing(glyphs, "درود", { letter: 0.2 }, upm);
    expect(sumAx(out) - sumAx(glyphs)).toBeCloseTo(3 * 0.2 * upm, 6);
  });
});

describe("spacingForBlock", () => {
  it("reads a text block's fields and gives other types nothing", () => {
    const text = { type: "text", letterSpacing: 0.1, wordSpacing: 0.4 } as unknown as Block;
    expect(spacingForBlock(text)).toEqual({ letter: 0.1, word: 0.4 });
    const fill = { type: "shapeFill" } as unknown as Block;
    expect(spacingForBlock(fill)).toEqual({});
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/spacing.test.ts`
Expected: FAIL — cannot resolve `./spacing`.

- [ ] **Step 4: Implement `src/lib/spacing.ts`**

```ts
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import type { Block } from "../types";
import { classifyJoiningForms, isTransparent } from "./arabicJoining";

/**
 * Letter and word spacing for a shaped run (Kelk's تقارب / تباعد).
 *
 * Arabic cannot take Latin tracking — space between every glyph pair would
 * part every join — so letter spacing acts only where a word already
 * breaks: after a letter that does not join forward, when another letter
 * follows. Word spacing acts at whitespace. Both are a fraction of the
 * font size, and both may be negative (tightening, overlap allowed).
 *
 * Only advances change. Glyph count, order, ids and clusters are untouched,
 * so everything keyed by glyph index — diacritic overrides, stroke cuts,
 * Next Shape targets — needs no remapping, and every loop that sums `ax`
 * moves the run correctly by itself.
 *
 * Pure: no React, no Konva, no `./harfbuzz` (Vitest cannot load it).
 */

export type Spacing = { letter?: number; word?: number };

export const LETTER_SPACING_MIN = -0.3;
export const LETTER_SPACING_MAX = 1;
export const WORD_SPACING_MIN = -0.5;
export const WORD_SPACING_MAX = 2;

const ZWNJ = "‌";
const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);
const isMark = (ch: string | undefined) => ch !== undefined && isTransparent(ch.codePointAt(0) ?? 0);

/** The spacing a block's own fields ask for; non-text blocks have none. */
export function spacingForBlock(b: Block): Spacing {
  if (b.type !== "text") return {};
  return { letter: b.letterSpacing, word: b.wordSpacing };
}

export function applySpacing(
  glyphs: readonly HarfBuzzGlyph[],
  text: string,
  spacing: Spacing,
  unitsPerEm: number
): HarfBuzzGlyph[] {
  const letterUnits = (spacing.letter ?? 0) * unitsPerEm;
  const wordUnits = (spacing.word ?? 0) * unitsPerEm;
  if ((letterUnits === 0 && wordUnits === 0) || glyphs.length === 0) {
    return glyphs as HarfBuzzGlyph[];
  }

  const forms = classifyJoiningForms(text);
  const isLetter = (i: number) => forms[i]?.form != null;

  /**
   * Whether a piece break sits at text offset `hi` — the start of the later
   * of two neighbouring clusters. The earlier cluster's last non-mark
   * character must be a letter in final or isolated form, and the next
   * non-mark character from `hi` must be a letter.
   *
   * The backward scan deliberately does not skip a ZWNJ: the break is
   * counted on the boundary *before* the ZWNJ (where the forward scan skips
   * it), so the boundary after it must not count it a second time.
   */
  const pieceBreakAt = (lo: number, hi: number): boolean => {
    let j = hi - 1;
    while (j >= lo && isMark(text[j])) j--;
    if (j < lo) return false;
    const form = forms[j]?.form;
    if (form !== "final" && form !== "isolated") return false;
    let k = hi;
    while (k < text.length && (isMark(text[k]) || text[k] === ZWNJ)) k++;
    return k < text.length && isLetter(k);
  };

  const out = glyphs.map((g) => ({ ...g }));
  const spacedWordClusters = new Set<number>();

  for (let i = 0; i < out.length; i++) {
    const cl = out[i].cl;
    if (cl === undefined) continue;

    // Word gap: the first glyph of a whitespace cluster takes the amount.
    if (wordUnits !== 0 && isSpace(text[cl]) && !spacedWordClusters.has(cl)) {
      spacedWordClusters.add(cl);
      out[i].ax = (out[i].ax ?? 0) + wordUnits;
    }

    // Piece break: between array neighbours i and i+1 the gap is glyph i's
    // advance, whichever direction the array runs, so i takes the amount.
    if (letterUnits !== 0 && i + 1 < out.length) {
      const next = out[i + 1].cl;
      if (next === undefined || next === cl) continue;
      const lo = Math.min(cl, next);
      const hi = Math.max(cl, next);
      if (pieceBreakAt(lo, hi)) out[i].ax = (out[i].ax ?? 0) + letterUnits;
    }
  }

  return out;
}
```

`spacingForBlock` reads `b.letterSpacing`, so this task also adds the two `TextBlock` fields — make the edit in Task 2 Step 1 now, and skip that step there.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/spacing.test.ts`
Expected: all PASS. If the "earlier glyph" assumption is wrong for some font, the exact-amount tests still pass (the sum is what they check); if a count test fails, print `glyphs.map(g => g.cl)` for that word and fix the boundary logic, not the expected count — the counts are the spec.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spacing.ts src/lib/spacing.test.ts src/lib/arabicJoining.ts src/types.ts
git commit -m "Letter and word spacing: applySpacing over real shaping"
```

---

### Task 2: Data, drawing and measurement wiring

**Files:**
- Modify: `src/lib/blockRenderProps.ts` (`shapedTextProps`)
- Modify: `src/components/ShapedText.tsx` (Props type near line 63; destructure near line 339; shaping at line 374)
- Modify: `src/lib/measureShapedText.ts`
- Modify: `src/App.tsx` (~line 2431 fit-to-width measure, ~line 2504 name-design measure)
- Modify: `src/components/sidebar/FormControls.tsx:7` (`SLIDER_DEFAULTS`)
- Test: `src/lib/blockRenderProps.test.ts` (create if absent, else append)

**Interfaces:**
- Consumes: `applySpacing`, `spacingForBlock`, `Spacing` from Task 1.
- Produces: `TextBlock.letterSpacing?: number`, `TextBlock.wordSpacing?: number`; `ShapedText` props `letterSpacing?: number; wordSpacing?: number`; `measureShapedRun(text, fontUrl, fontSize, style?, alternates?, styleSets?, spacing?: Spacing)` and the same trailing `spacing?` on `measureShapedWidth`.

- [ ] **Step 1: Fields on `TextBlock`** (already done in Task 1 — listed here for reference)

```ts
export type TextBlock = BlockCommon & {
  type: "text";
  align?: TextAlign;
  lineHeight?: number;
  warpX?: number;
  warpY?: number;
  /** Space at gaps between a word's pieces, as a fraction of font size. Absent = 0. See lib/spacing.ts. */
  letterSpacing?: number;
  /** Space at word gaps, as a fraction of font size. Absent = 0. */
  wordSpacing?: number;
};
```

- [ ] **Step 2: Failing test — mirrors carry spacing**

If `src/lib/blockRenderProps.test.ts` doesn't exist, create it:

```ts
import { describe, it, expect } from "vitest";
import { shapedTextProps } from "./blockRenderProps";
import type { Block } from "../types";

describe("shapedTextProps", () => {
  it("carries letter and word spacing, defaulting to 0", () => {
    const b = { type: "text", text: "x", fontSize: 10, color: "#000", fontFamily: "Amiri", stroke: "#000",
      shadowColor: "#000", letterSpacing: 0.2, wordSpacing: -0.1 } as unknown as Extract<Block, { type: "text" }>;
    expect(shapedTextProps(b)).toMatchObject({ letterSpacing: 0.2, wordSpacing: -0.1 });
    const plain = { ...b, letterSpacing: undefined, wordSpacing: undefined };
    expect(shapedTextProps(plain)).toMatchObject({ letterSpacing: 0, wordSpacing: 0 });
  });
});
```

If it exists, append the `it(...)` inside a new `describe`. Run `npx vitest run src/lib/blockRenderProps.test.ts` — expect FAIL.

- [ ] **Step 3: Map the fields**

In `shapedTextProps` add after `warpY: b.warpY ?? 0,`:

```ts
    letterSpacing: b.letterSpacing ?? 0,
    wordSpacing: b.wordSpacing ?? 0,
```

Run the test — expect PASS.

- [ ] **Step 4: Apply in `ShapedText`**

1. In the `Props` type, after `lineHeight?: number;` add:
   ```ts
   /** Fraction of font size; see lib/spacing.ts. */
   letterSpacing?: number;
   wordSpacing?: number;
   ```
2. In the destructure, after `lineHeight = 1.2,` add `letterSpacing = 0,` and `wordSpacing = 0,`.
3. Replace line 374 `const shapeData = useShapedGlyphs(text, fontFamily, glyphAlternates, styleSets);` with:
   ```ts
   const rawShape = useShapedGlyphs(text, fontFamily, glyphAlternates, styleSets);
   // Spacing changes only advances, so applying it here — once, before
   // anything below reads the run — reaches every loop, the bounding box and
   // every overlay. At 0/0 it is the identity and nothing re-renders.
   const spacedGlyphs = useMemo(
     () =>
       applySpacing(
         rawShape.glyphs,
         rawShape.shapableText,
         { letter: letterSpacing, word: wordSpacing },
         Math.max(rawShape.unitsPerEm || 1000, 1)
       ),
     [rawShape.glyphs, rawShape.shapableText, rawShape.unitsPerEm, letterSpacing, wordSpacing]
   );
   const shapeData = spacedGlyphs === rawShape.glyphs ? rawShape : { ...rawShape, glyphs: spacedGlyphs };
   ```
4. Add `import { applySpacing } from "../lib/spacing";` (and `useMemo` to the React import if missing).

- [ ] **Step 5: Measurement takes spacing**

In `src/lib/measureShapedText.ts`:

```ts
import { applySpacing, type Spacing } from "./spacing";
```

Add a trailing `spacing?: Spacing` parameter to both functions; `measureShapedWidth` forwards it. In `measureShapedRun`:

```ts
  const { glyphs, font, unitsPerEm, shapableText } = await shapeText(text, fontUrl, alternates, styleSets);
  // What is measured must be what is drawn: ShapedText applies the same spacing.
  const spaced = applySpacing(glyphs, shapableText ?? text, spacing ?? {}, Math.max(unitsPerEm || 1000, 1));
  const box = inkExtentBox(spaced, font, fontSize, unitsPerEm);
```

(Check `shapeText`'s result type names `shapableText`; `useShapedGlyphs.ts` reads `r.shapableText`.)

- [ ] **Step 6: Pass spacing from `App.tsx`**

- Fit to width (~line 2431): add `spacingForBlock(selectedBlock)` as the seventh argument to `measureShapedWidth(...)`, after `selectedBlock.styleSets`.
- Name designs (~line 2504): `measureShapedRun(text, url, fontSize, runStyleForBlock(...))` → add `undefined, undefined, spacingForBlock(source)` so spacing lands in the seventh slot.
- Import `spacingForBlock` from `./lib/spacing`.

- [ ] **Step 7: Slider defaults**

In `SLIDER_DEFAULTS` add `letterSpacing: 0,` and `wordSpacing: 0,` after `lineHeight: 1.2,`.

- [ ] **Step 8: Verify and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: clean.

```bash
git add src/lib/blockRenderProps.ts src/lib/blockRenderProps.test.ts src/components/ShapedText.tsx src/lib/measureShapedText.ts src/App.tsx src/components/sidebar/FormControls.tsx
git commit -m "Letter and word spacing: draw, mirror and measure the spaced run"
```

---

### Task 3: Sidebar controls + end-to-end test

**Files:**
- Modify: `src/components/Sidebar.tsx` (after the Line height `RangeRow`, ~line 3238)
- Create: `e2e/spacing.spec.ts`

**Interfaces:**
- Consumes: `LETTER_SPACING_MIN/MAX`, `WORD_SPACING_MIN/MAX` from `src/lib/spacing.ts`; `TextBlock.letterSpacing/wordSpacing`.

- [ ] **Step 1: Write the failing e2e spec**

```ts
import { expect, test, type Page } from "@playwright/test";
import { blockClientBox, getBlocks, gotoApp, openTypography, setBlockText, settleFrames } from "./harf";

/** Sets a range input the way a drag would: native setter, then an `input` event React listens for. */
async function setRange(page: Page, label: RegExp, value: number) {
  await page.getByLabel(label).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function firstBlockWidth(page: Page) {
  const id = (await getBlocks(page))[0].id;
  return (await blockClientBox(page, id)).width;
}

test("letter spacing widens a run at its piece breaks", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, "درود درود");
  await openTypography(page);
  await settleFrames(page);
  const before = await firstBlockWidth(page);

  await setRange(page, /^Letter spacing/, 0.5);
  await expect.poll(async () => (await getBlocks(page))[0].letterSpacing).toBe(0.5);
  await expect.poll(() => firstBlockWidth(page)).toBeGreaterThan(before + 10);
});

test("letter spacing leaves a fully joined word alone", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, "بببب");
  await openTypography(page);
  await settleFrames(page);
  const before = await firstBlockWidth(page);

  await setRange(page, /^Letter spacing/, 0.8);
  await expect.poll(async () => (await getBlocks(page))[0].letterSpacing).toBe(0.8);
  await settleFrames(page);
  expect(Math.abs((await firstBlockWidth(page)) - before)).toBeLessThan(1);
});

test("word spacing widens the gap between words, and undo restores it", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, "بب بب");
  await openTypography(page);
  await settleFrames(page);
  const before = await firstBlockWidth(page);

  await setRange(page, /^Word spacing/, 1);
  await expect.poll(() => firstBlockWidth(page)).toBeGreaterThan(before + 10);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await getBlocks(page))[0].wordSpacing ?? 0).toBe(0);
});
```

Check `settleFrames` is exported from `e2e/harf.ts` (it is used by `glyph-alternates.spec.ts`). If the undo assertion fails because focus is in the range input, click the canvas background first (follow whatever `core.spec.ts` does before pressing `Control+z`).

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test e2e/spacing.spec.ts`
Expected: FAIL — no element labelled "Letter spacing".

- [ ] **Step 3: Add the two rows**

In `Sidebar.tsx`, directly after the Line height block (`{selectedBlock.type === "text" && ( <RangeRow ... fieldKey="lineHeight" /> )}`):

```tsx
                {selectedBlock.type === "text" && (
                  <RangeRow
                    id={makeId("letter-spacing", selectedId)}
                    name={makeId("letterSpacing", selectedId)}
                    label="Letter spacing"
                    value={selectedBlock.letterSpacing ?? 0}
                    min={LETTER_SPACING_MIN}
                    max={LETTER_SPACING_MAX}
                    step={0.01}
                    onChange={(v) => onUpdateSelectedBlock({ letterSpacing: v })}
                    suffix={(selectedBlock.letterSpacing ?? 0).toFixed(2)}
                    fieldKey="letterSpacing"
                  />
                )}

                {selectedBlock.type === "text" && (
                  <RangeRow
                    id={makeId("word-spacing", selectedId)}
                    name={makeId("wordSpacing", selectedId)}
                    label="Word spacing"
                    value={selectedBlock.wordSpacing ?? 0}
                    min={WORD_SPACING_MIN}
                    max={WORD_SPACING_MAX}
                    step={0.01}
                    onChange={(v) => onUpdateSelectedBlock({ wordSpacing: v })}
                    suffix={(selectedBlock.wordSpacing ?? 0).toFixed(2)}
                    fieldKey="wordSpacing"
                  />
                )}
```

Import the four constants from `../lib/spacing`.

- [ ] **Step 4: Run the e2e and the e2e typecheck**

Run: `npx playwright test e2e/spacing.spec.ts && npx tsc --noEmit -p e2e/tsconfig.json`
Expected: 3 passed; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx e2e/spacing.spec.ts
git commit -m "Letter and word spacing: Typography sliders and e2e"
```

---

### Task 4: Documentation + full verification

**Files:**
- Create: `.claude/rules/spacing.md`
- Modify: `CLAUDE.md` (Subsystem notes list — add one line after "Kashida elongation")
- Modify: `src/components/guide/sections/typography.tsx` (~line 86, after the Alignment/Line height `<li>`)
- Modify: `.claude/rules/practice-sheet.md` (one line: spacing ignored in v1)
- Modify: `PROGRESS.md` (new entry at the top of `## Shipped`)

- [ ] **Step 1: Rule file**

```markdown
---
paths:
  - "src/lib/spacing*.ts"
  - "e2e/spacing.spec.ts"
---

# Letter and word spacing (`src/lib/spacing.ts`, Sidebar → Typography)

Kelk's تقارب / تباعد. Text blocks only. Spec:
`docs/superpowers/specs/2026-10-13-letter-word-spacing-design.md`.

- **Letter spacing acts only at piece breaks** — after a letter in final or
  isolated form when the next non-mark character is a letter. Never inside
  a join, never inside a cluster (marks, lam-alef, Allah), never before a
  space (that is word spacing's gap). A ZWNJ is a break, counted once: the
  forward scan skips it, the backward scan does not.
- **Only `ax` changes.** Count, order, ids, clusters and offsets are
  preserved, which is why diacritic overrides, stroke cuts and Next Shape
  needed no remapping. Don't add or remove glyphs here.
- **The gap between array neighbours `i`, `i+1` is glyph `i`'s advance**,
  whichever direction the array runs — so the earlier glyph takes the
  amount.
- **Applied in exactly two places:** `ShapedText` (right after
  `useShapedGlyphs`) and `measureShapedRun`. A third consumer that shapes
  on its own must call `applySpacing` too, or it will measure a narrower
  run than is drawn — Fit to width would overshoot.
- **0/0 is the identity** (same array back), so unspaced blocks never
  re-render and old saves are byte-identical.
- Not on Shape Fill or Curve: both renormalise the run to a fixed span
  (see [deferred-features.md](deferred-features.md)).
- Tests use real shaping; the counts in `spacing.test.ts` (درود has three
  breaks, بابا one, سلام one, لا none) are the spec.
```

- [ ] **Step 2: CLAUDE.md index line** (after the Kashida line)

```markdown
- **Letter & word spacing** — [`.claude/rules/spacing.md`](.claude/rules/spacing.md). Letter spacing only at piece breaks (never inside a join or cluster); only `ax` changes so index-keyed data needs no remap. Applied in `ShapedText` and `measureShapedRun` only — a new shaping consumer must apply it too.
```

- [ ] **Step 3: Guide paragraph** — after the Alignment/Line height `<li>` in `typography.tsx`:

```tsx
        <li>
          <strong>Letter spacing</strong> and <strong>Word spacing</strong> —
          for plain text blocks. Letter spacing opens or closes the gaps
          between the separate pieces of a word (after ا, د, ر, و and the
          other letters that don't join forward); joined letters never come
          apart. Word spacing changes the space between words. Drag below
          zero to tighten until pieces touch or overlap — useful for compact
          compositions. Double-click a slider to reset it.
        </li>
```

- [ ] **Step 4: Practice sheet note** — add to the limitations in `.claude/rules/practice-sheet.md`: `- Letter and word spacing are ignored (v1), like other per-letter edits.`

- [ ] **Step 5: PROGRESS entry** at the top of `## Shipped`:

```markdown
### 2026-10-13 — Letter and word spacing

Two Typography sliders on text blocks. Letter spacing acts only at the gaps
between a word's pieces, word spacing at spaces; both go negative to
tighten. Fit to width and Name Designs measure the spaced run; mirrors
follow. Details in [spacing.md](.claude/rules/spacing.md).
```

- [ ] **Step 6: Full verification loop**

Run, in order: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e`.
Expected: all clean; the full e2e suite passes (spacing must not have changed any existing spec's pixels — blocks without spacing are untouched).

- [ ] **Step 7: Commit**

```bash
git add .claude/rules/spacing.md CLAUDE.md src/components/guide/sections/typography.tsx .claude/rules/practice-sheet.md PROGRESS.md
git commit -m "Letter and word spacing: docs and guide"
```
