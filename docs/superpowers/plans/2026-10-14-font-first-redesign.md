# Font-First Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Square Kufi, warp, image blocks and the ornament library; make the font gallery the app's start screen and a one-click strip inside the editor.

**Architecture:** The font catalogue becomes its own module (`src/lib/fontCatalog.ts`) and the gallery grid its own component (`FontGallery`), so the dialog, the new start screen and the new sidebar strip share one list and one renderer. The four removals follow the repo's removal protocol: delete the code, filter old saves in `applyParsedLayoutPayload`, record the removal in `removed-subsystems.md`. The start screen is a fixed overlay above the mounted editor, so the existing hydration and fit-to-view logic in `App.tsx` is untouched.

**Tech Stack:** React 19, TypeScript, Vite, Konva, Vitest (unit), Playwright (e2e, Chromium only).

**Spec:** `docs/superpowers/specs/2026-10-14-font-first-redesign.md`

## Global Constraints

- Delete, never hide. No "advanced" toggles.
- All 22 active fonts stay; `FontChoice.value` keys are persisted in saves and must never be renamed.
- Every commit leaves `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, `npm run build` green. Also `npx tsc --noEmit -p e2e/tsconfig.json` when `e2e/` changes.
- `package.json` / `package-lock.json` version bumps appear in every commit from the pre-commit hook. That is expected; never edit the version by hand.
- Nothing under `src/lib/` that Vitest imports may import `./harfbuzz` (it throws under Vitest's loader). `fontCatalog.ts` is pure data.
- Icon-button labels are sentence case and name the outcome. Renaming any accessible name means updating `e2e/` in the same commit.
- Grid and flex children get `min-width: 0` explicitly (sidebar.md footgun).
- Commit messages end with the attribution lines in the session's system reminder.

## Review Focus

Inputs the spec implies but no task's tests would otherwise exercise. Each has a test pinned to the task that owns it.

1. **An old save with a mirror whose source was an image block.** After the image filter the mirror is orphaned; `dropOrphanedMirrors` must remove it. Test in Task 6.
2. **A saved block carrying `warpX: 40`.** Must load with the field gone and render straight, not throw. Test in Task 6.
3. **Start screen with an empty text field.** Picking a card must create the block with the starter word, never an empty string. Test in Task 9 (unit) and Task 10 (e2e).
4. **A block whose font is an uploaded family missing from this browser.** The strip has no card for it; the strip must still render and the missing-font notice must still show. Test in Task 8.
5. **Compositions dialog opened on an old `framed` saved preference.** `CompositionLayoutId` narrows to two values; a stale `"framed"` must fall back to `"muthanna"`, not crash. Test in Task 5.

---

### Task 0: Safety tag

**Files:** none.

- [ ] **Step 1: Tag the last pre-removal commit**

```bash
git tag pre-font-first-redesign
git tag --list "pre-font*"
```
Expected: `pre-font-first-redesign` printed.

---

### Task 1: Extract the font catalogue to `src/lib/fontCatalog.ts`

**Files:**
- Create: `src/lib/fontCatalog.ts`, `src/lib/fontCatalog.test.ts`
- Modify: `src/components/FontPickerDialog.tsx:4-18, 34-44` (type + `groupByGenre` move out), `src/components/Sidebar.tsx:27, 362-404, 655-671`, `src/lib/bundledFonts.test.ts:104-112`

**Interfaces:**
- Produces:
  ```ts
  export type FontChoice = { value: string; label: string; cssFamily: string; genre?: string; retired?: boolean };
  export const FONT_OPTIONS: FontChoice[];            // the 23 entries verbatim from Sidebar.tsx (22 active + retired Layla Diwani)
  export const SAMPLE_FALLBACK = "أبجد";
  export function groupByGenre(fonts: FontChoice[]): { genre: string; fonts: FontChoice[] }[];
  export function fontChoicesWith(customFonts: { key: string; label: string }[]): FontChoice[]; // FONT_OPTIONS then uploads tagged genre "Uploaded", label `${label} (uploaded)`, cssFamily `'${key}'`
  export function visibleFonts(fonts: FontChoice[], current?: string): FontChoice[]; // drops retired unless it is `current`
  ```

- [ ] **Step 1: Write the failing test**

`src/lib/fontCatalog.test.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { FONT_OPTIONS, fontChoicesWith, groupByGenre, visibleFonts } from "./fontCatalog";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** `FONT_URLS` keys as written in useShapedGlyphs.ts (which cannot be imported: it pulls in harfbuzz). */
function registeredKeys(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "src/hooks/useShapedGlyphs.ts"), "utf8");
  const body = src.slice(src.indexOf("FONT_URLS"));
  return [...body.matchAll(/^\s*["']?([A-Za-z0-9_]+)["']?\s*:\s*["']\/fonts\//gm)].map((m) => m[1]);
}

describe("fontCatalog", () => {
  it("lists every font FONT_URLS can shape with", () => {
    const keys = registeredKeys();
    expect(keys.length).toBeGreaterThan(15);
    const missing = keys.filter((k) => !FONT_OPTIONS.some((f) => f.value === k));
    expect(missing, "missing from FONT_OPTIONS").toEqual([]);
  });

  it("keeps each genre's fonts together so the gallery heads each genre once", () => {
    const genres = groupByGenre(FONT_OPTIONS).map((g) => g.genre);
    expect(new Set(genres).size).toBe(genres.length);
  });

  it("hides retired fonts unless one is the current font", () => {
    const retired = FONT_OPTIONS.find((f) => f.retired)!;
    expect(visibleFonts(FONT_OPTIONS).some((f) => f.value === retired.value)).toBe(false);
    expect(visibleFonts(FONT_OPTIONS, retired.value).some((f) => f.value === retired.value)).toBe(true);
  });

  it("appends uploads under their own genre with the (uploaded) suffix", () => {
    const list = fontChoicesWith([{ key: "MyFont", label: "My Font" }]);
    const last = list[list.length - 1];
    expect(last).toEqual({ value: "MyFont", label: "My Font (uploaded)", cssFamily: "'MyFont'", genre: "Uploaded" });
    expect(list.length).toBe(FONT_OPTIONS.length + 1);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/lib/fontCatalog.test.ts`
Expected: FAIL, cannot resolve `./fontCatalog`.

- [ ] **Step 3: Create the module**

Create `src/lib/fontCatalog.ts`. Move the `FontChoice` type from `FontPickerDialog.tsx:4-18` and the `FONT_OPTIONS` array from `Sidebar.tsx:362-404` **verbatim, including comments**. Then add:

```ts
/** Shown when the block has no text yet, so every card still has letters. */
export const SAMPLE_FALLBACK = "أبجد";

/** Consecutive runs of the same genre, in list order. */
export const groupByGenre = (fonts: FontChoice[]) => {
  const groups: { genre: string; fonts: FontChoice[] }[] = [];
  for (const font of fonts) {
    const genre = font.genre ?? "Other";
    const last = groups[groups.length - 1];
    if (last && last.genre === genre) last.fonts.push(font);
    else groups.push({ genre, fonts: [font] });
  }
  return groups;
};

/** Built-ins then uploads. An upload has to reach this list, not only the shaping seam. */
export const fontChoicesWith = (customFonts: { key: string; label: string }[]): FontChoice[] => [
  ...FONT_OPTIONS,
  ...customFonts.map((f) => ({
    value: f.key,
    label: `${f.label} (uploaded)`,
    cssFamily: `'${f.key}'`,
    genre: "Uploaded",
  })),
];

/** Retired fonts stay in the list for saved blocks but are offered only when already chosen. */
export const visibleFonts = (fonts: FontChoice[], current?: string): FontChoice[] =>
  fonts.filter((f) => !f.retired || f.value === current);
```

- [ ] **Step 4: Repoint consumers**

- `FontPickerDialog.tsx`: delete the local `FontChoice` type, `SAMPLE_FALLBACK` and `groupByGenre`; add `import { groupByGenre, SAMPLE_FALLBACK, visibleFonts, type FontChoice } from "../lib/fontCatalog"; export type { FontChoice };` (the re-export keeps `Sidebar.tsx:27` compiling until the next bullet). Replace `fonts.filter((f) => !f.retired || f.value === value)` with `visibleFonts(fonts, value)`.
- `Sidebar.tsx`: delete lines 362-404 (`FONT_OPTIONS` and its doc comment); change line 27 to `import { FontPickerField } from "./FontPickerDialog"; import { fontChoicesWith, type FontChoice } from "../lib/fontCatalog";`; replace the `fontChoices` memo body (655-671) with `() => fontChoicesWith(customFonts)`.
- `bundledFonts.test.ts:104`: change `read("src/components/Sidebar.tsx")` to `read("src/lib/fontCatalog.ts")`.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/lib/fontCatalog.test.ts src/lib/bundledFonts.test.ts && npx tsc --noEmit -p tsconfig.app.json && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fontCatalog.ts src/lib/fontCatalog.test.ts src/components/FontPickerDialog.tsx src/components/Sidebar.tsx src/lib/bundledFonts.test.ts
git commit -m "Font catalogue: move FONT_OPTIONS out of Sidebar into lib/fontCatalog"
```

---

### Task 2: Extract `FontGallery` from the picker dialog

**Files:**
- Create: `src/components/FontGallery.tsx`
- Modify: `src/components/FontPickerDialog.tsx` (body of the dialog, lines ~118-150)

**Interfaces:**
- Produces:
  ```ts
  export type FontGalleryProps = {
    text: string;            // sample; empty falls back to SAMPLE_FALLBACK
    value?: string;          // highlighted card, scrolled into view and focused on mount
    fonts: FontChoice[];     // already filtered by visibleFonts
    onPick: (value: string) => void;
    autoFocus?: boolean;     // default true: focus the active card on mount
    testId?: string;         // data-testid on the scrolling body, default "font-picker"
  };
  export const FontGallery: React.FC<FontGalleryProps>;
  ```
  Markup and class names unchanged: `.fontPickerBody > section[aria-label=genre] > h3.fontPickerGenre + .fontPickerGrid > button.fontPickerCard[data-font-key][aria-pressed] > .fontPickerSample + .fontPickerLabel`. The e2e suite addresses these.

- [ ] **Step 1: Write the component**

`src/components/FontGallery.tsx`:
```tsx
import { useEffect, useRef } from "react";
import { groupByGenre, SAMPLE_FALLBACK, type FontChoice } from "../lib/fontCatalog";

export type FontGalleryProps = {
  text: string;
  value?: string;
  fonts: FontChoice[];
  onPick: (value: string) => void;
  autoFocus?: boolean;
  testId?: string;
};

/**
 * The block's text written in every font, under genre headings. Previews are
 * CSS `@font-face`, not canvas: the browser shapes Arabic natively, so a
 * gallery of every style costs no HarfBuzz shaping. Shared by the picker
 * dialog, the start screen and the sidebar strip's full view.
 */
export const FontGallery: React.FC<FontGalleryProps> = ({
  text,
  value,
  fonts,
  onPick,
  autoFocus = true,
  testId = "font-picker",
}) => {
  const activeRef = useRef<HTMLButtonElement>(null);
  const sample = text.trim() || SAMPLE_FALLBACK;

  useEffect(() => {
    const active = activeRef.current;
    if (!active) return;
    active.scrollIntoView({ block: "center" });
    if (autoFocus) active.focus({ preventScroll: true });
  }, [autoFocus]);

  return (
    <div className="fontPickerBody" data-testid={testId}>
      {groupByGenre(fonts).map((group) => (
        <section key={group.genre} aria-label={group.genre}>
          <h3 className="fontPickerGenre">{group.genre}</h3>
          <div className="fontPickerGrid">
            {group.fonts.map((font) => {
              const active = font.value === value;
              return (
                <button
                  key={font.value}
                  ref={active ? activeRef : undefined}
                  type="button"
                  className={active ? "fontPickerCard fontPickerCard--active" : "fontPickerCard"}
                  data-font-key={font.value}
                  aria-pressed={active}
                  onClick={() => onPick(font.value)}
                >
                  <span className="fontPickerSample" style={{ fontFamily: font.cssFamily }} dir="rtl" lang="ar">
                    {sample}
                  </span>
                  <span className="fontPickerLabel">{font.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Use it in the dialog**

In `FontPickerDialog.tsx` replace everything from `<div className="fontPickerBody" ...>` to its closing `</div>` with:
```tsx
<FontGallery text={text} value={value} fonts={visibleFonts(fonts, value)} onPick={onPick} />
```
Delete the dialog's `activeRef`, its `sample` constant and the scroll/focus effect (the gallery owns them now). Keep `closeRef` and the fallback focus: change the effect to `useEffect(() => { if (!fonts.some((f) => f.value === value)) closeRef.current?.focus(); }, []);` with the existing eslint-disable for deps if lint demands it.

- [ ] **Step 3: Verify with the existing e2e spec**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npx playwright test e2e/font-picker.spec.ts e2e/font-upload.spec.ts`
Expected: pass (no behaviour change).

- [ ] **Step 4: Commit**

```bash
git add src/components/FontGallery.tsx src/components/FontPickerDialog.tsx
git commit -m "Font gallery: extract the grid from the picker dialog"
```

---

### Task 3: Remove Square Kufi

**Files:**
- Delete: `src/components/SquareKufiText.tsx`, `src/components/KufiCellEditOverlay.tsx`, `src/lib/squareKufi.ts`, `src/lib/squareKufi.test.ts`, `src/lib/squareKufiAlphabet.ts`, `e2e/square-kufi.spec.ts`, `src/components/guide/sections/square-kufi.tsx`, `public/demos/add-square-kufi.gif`, `.claude/rules/square-kufi.md`
- Modify: `src/types.ts:7, 49, 52, 344-388, 397`, `src/App.tsx:30, 150-158, 316-317, 903-925, 2186-2280, 3578-3580, 3701-3702`, `src/components/Sidebar.tsx:61-66, 271-281, 471, 583-585, 673-730, 1919-1935, 2558-2735, 3081, 3272-3284`, `src/components/CanvasStage.tsx:60, 62, 92, 102, 169-173, 311-312, 1110-1145`, `src/lib/blockRenderProps.ts:85-110`, `src/lib/blockCapabilities.ts:53-67` (+ test), `src/components/guide/sections/blocks.tsx:16, 72-80`, `src/components/guide/sections/typography.tsx` (any Square Kufi mention), `e2e/demos/record.spec.ts:193-198`, `.claude/rules/deferred-features.md:5, 41-47`, `src/lib/blockRenderProps.test.ts` (kufi case if any)

**Interfaces:**
- Produces: `Block` union without `SquareKufiBlock`; `applyParsedLayoutPayload` filter for `type === "squareKufi"` (tested in Task 6).

- [ ] **Step 1: Delete the files listed above**

```bash
git rm src/components/SquareKufiText.tsx src/components/KufiCellEditOverlay.tsx src/lib/squareKufi.ts src/lib/squareKufi.test.ts src/lib/squareKufiAlphabet.ts e2e/square-kufi.spec.ts src/components/guide/sections/square-kufi.tsx public/demos/add-square-kufi.gif .claude/rules/square-kufi.md
```

- [ ] **Step 2: Remove the type**

In `src/types.ts` delete `| "squareKufi"` (line 7), both `KufiCellEdit, KufiComposition` import/export lines (49, 52), the `SquareKufiBlock` type and its doc comment (344-388), and `| SquareKufiBlock` from the union (397).

- [ ] **Step 3: Let tsc list every remaining reference, then remove each**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | head -80`

Remove, in order:
- `App.tsx`: import of `supportsKufiCellEdits` (30); the `./lib/squareKufi` import block (150-157) and `SquareKufiBlock` from the types import (158); `SQUARE_KUFI_DEFAULT_TEXT` (316-317); `setKufiCell` and its comment (≈903-925); `addSquareKufiBlock`, `fitSelectedKufiToSquare`, `setKufiComposition` (≈2186-2280); the three Sidebar props (3578-3580); the two CanvasStage props (3701-3702).
- `Sidebar.tsx`: the `../lib/squareKufi` import (61-66); props `onAddSquareKufiBlock`, `onFitKufiToSquare`, `onSetKufiComposition` with their comments (271-281) and destructuring (583-585); `BLOCK_DEMOS.squareKufi` (471); `kufiBlock`/`kufiReadout` memo (673-730); the Add square kufi button (1919-1935); the Square Kufi panel (2558-2735); the `selectedBlock.type !== "squareKufi" &&` guards at 3081 and 3272-3284 (keep the `!== "stack"` half, and shorten the comment to the stack reason).
- `CanvasStage.tsx`: imports (60, 62), `KufiCellEdit` from types (92), `squareKufiProps` (102), the two props and their comment (169-173, 311-312), and the `block.type === "squareKufi"` branch (1110-1145).
- `blockRenderProps.ts`: `squareKufiProps` (85-110); its test case if `blockRenderProps.test.ts` has one.
- `blockCapabilities.ts`: `supportsKufiCellEdits` (61-67) and the Square kufi sentence at 53; its test case.
- `guide/sections/blocks.tsx`: `"square kufi"` keyword (16) and the `<h4>Square Kufi</h4>` paragraph (72-80). Grep `typography.tsx` for "kufi" and remove any Square Kufi sentence (the "Naskh to Kufi" font-genre sentence at 76 stays).
- `e2e/demos/record.spec.ts`: the "add square kufi" test (193-198).
- `.claude/rules/deferred-features.md`: the `squareKufiAlphabet.ts` path (5) and the two square-kufi deferred items (≈41-47).

Repeat tsc until clean. Then `npx tsc --noEmit -p e2e/tsconfig.json`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p e2e/tsconfig.json && npm run lint && npm test && npm run build`
Expected: all green. `grep -rni "kufi" src e2e --include=*.ts --include=*.tsx | grep -vi "fontCatalog\|RanaKufi\|Kufi2\|\"Kufi\"\|Reem Kufi\|Mushaf Kufi\|Decorated Kufi\|Wide Kufi\|genre"` should return only font-name mentions.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Remove Square Kufi"
```

---

### Task 4: Remove warp

**Files:**
- Delete: `src/lib/warp.ts`, `src/lib/warp.test.ts`
- Modify: `src/types.ts:183-184`, `src/App.tsx:299-300, 3124-3125`, `src/components/Sidebar.tsx:3606-3637`, `src/components/ShapedText.tsx:6, 90-91, 159-…` (warp pass), `src/lib/blockRenderProps.ts:54-55`, `src/lib/fitToWidth.ts:215-222, 229-230, 261, 268, 278-300`, `src/lib/fitToWidth.test.ts:462-485`, `src/components/DiacriticHoverHandles.tsx` (warp inverse branch, ≈70, 109-130), `src/components/guide/sections/typography.tsx:28, 103-…`, `.claude/rules/detached-marks.md` ("Marks, then cuts, then warp"), `src/lib/composition.ts:220` (comment only)

**Interfaces:**
- Produces: `RunStyle` without `warpX`; `runStyleForBlock(block, cutWidth)` no longer reads `warpX`; `styledRunWidth` sums shear + bold + outline + cuts.

- [ ] **Step 1: Update the fit-to-width test first**

In `src/lib/fitToWidth.test.ts` delete the two warp tests (462-473) and remove `warpX: 50,` from the combined case (≈481), updating its expected sum accordingly. Add:
```ts
it("has no warp term: the four style terms sum alone", () => {
  const box = { width: 100, height: 40 };
  expect(styledRunWidth(box, 50, { italic: true, bold: true, strokeWidth: 2, cutWidth: 10 }))
    .toBeCloseTo(100 + 0.25 * 40 + Math.max(50 * 0.035, 0.6) + 2 + 10);
});
```

- [ ] **Step 2: Run it, expect a type error or failure**

Run: `npx vitest run src/lib/fitToWidth.test.ts`
Expected: the combined-case expectation fails (or tsc complains later). Proceed.

- [ ] **Step 3: Remove warp from the solver**

In `fitToWidth.ts` delete `WARP_X_SPREAD` and its comment (215-222), `warpX` from `RunStyle` (229-230), from `runStyleForBlock`'s parameter type and return (261, 268), the `warp` term and its two doc paragraphs in `styledRunWidth` (≈278-300). The return becomes `box.width + shear + bold + outline + cuts`.

- [ ] **Step 4: Remove warp everywhere else**

```bash
git rm src/lib/warp.ts src/lib/warp.test.ts
```
Then, guided by `npx tsc --noEmit -p tsconfig.app.json`:
- `types.ts`: delete `warpX?`/`warpY?` (183-184) and their comment.
- `App.tsx`: `warpX: 0, warpY: 0,` in `DEFAULT_BLOCK` (299-300); the stack-conversion guard (3124-3125) in full, including its `setExportStatus` call.
- `Sidebar.tsx`: the whole `{selectedBlock.type === "text" && (<div ...><div className="sidebarSectionTitle">Warp</div> … </div>)}` block (≈3606-3637).
- `ShapedText.tsx`: the `warpPoint`/`GlyphBounds` import (6), `warpX`/`warpY` props (90-91), and the warp pass in the glyph draw. Read the draw loop around line 159 before editing: where it computes bounds for `warpPoint` and maps every path point through it, replace with the un-warped point. Delete the `GlyphBounds` computation if nothing else uses it.
- `blockRenderProps.ts`: lines 54-55.
- `DiacriticHoverHandles.tsx`: the warp-inverse branch (Newton's method bail-out comment at ≈126 marks it). Keep the rotation handling. Rewrite the comments at 13, 43, 70, 109 to drop "warp".
- `guide/sections/typography.tsx`: `"warp"` keyword (28) and the Horizontal/Vertical warp list item (≈103).
- `.claude/rules/detached-marks.md`: change the ordering sentence to "Marks, then cuts." Same one-liner in `CLAUDE.md` (line 161) — defer that edit to Task 12 but note it.
- `composition.ts:220`: comment "text/warp/glyph fields" → "text/glyph fields" (the whole `buildFrameBlock` goes in Task 5 anyway; skip if Task 5 is executed first).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build && npx playwright test e2e/fit-to-width.spec.ts e2e/diacritics.spec.ts e2e/detached-marks.spec.ts`
Expected: green. `grep -rn "warp" src --include=*.ts --include=*.tsx` returns nothing (the `shapeWarp` filter string in `App.tsx` is the one allowed hit).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Remove horizontal and vertical warp"
```

---

### Task 5: Remove image blocks and the ornament library

Done together because a frame *is* an image block; splitting them leaves an intermediate commit where ornaments can insert a type nothing renders.

**Files:**
- Delete: `src/components/ImageBlockView.tsx`, `src/components/OrnamentPicker.tsx`, `src/lib/ornaments.ts`, `src/lib/ornaments.test.ts`, `src/data/ornaments/` (whole folder), `e2e/ornaments.spec.ts`, `src/components/guide/sections/ornaments.tsx`, `public/demos/add-image.gif`, `public/demos/add-ornament.gif`, `.claude/rules/ornaments.md`
- Modify: `src/types.ts:4, 78, 84, 204-208, 327, 394`, `src/App.tsx:253, 298, 1296, 1379-1382, 2285-2330, 2688-2701, 3221, 3478, 3503, 3581, 3717`, `src/components/Sidebar.tsx:104, 205-206, 282, 473, 531-532, 586, 1943-1975, 2418-2460, 2744-2750, 3647 (image guard), 3672 (image guard)`, `src/components/CanvasStage.tsx:64, 196, 327, 1033-1050`, `src/components/MirrorBlockView.tsx:8, 13, 126-128`, `src/lib/blockRenderProps.ts:112-120` (+ test), `src/lib/composition.ts` and `composition.test.ts`, `src/components/CompositionDialog.tsx`, `src/components/FontUploadDialog.tsx:15, 171` (comments), `src/components/guide/sections/blocks.tsx:13, 91-…`, `getting-started.tsx:30`, `smart-guides.tsx:36`, `compositions.tsx` (framed mention), `e2e/harf.ts:258-291`, `e2e/detached-marks.spec.ts:4, 80`, `e2e/glyph-alternates.spec.ts:3, 167, 178-180, 227`, `e2e/ink-surface.spec.ts:3, 254-255`, `e2e/demos/record.spec.ts:200-215`, `src/index.css:376-378` (`.ornamentPickerDialog` selector), `.claude/rules/compositions.md`
- Create: `e2e/fixtures/circle.svg` (copy of `e2e/demos/circle.svg`)

**Interfaces:**
- Produces: `Block` union without `ImageBlock`; `CompositionLayoutId = "muthanna" | "medallion"`; `CompositionRequest` without `frameId`/`frameColor`; e2e helper
  ```ts
  export async function addShapeFillFromSvg(page: Page, at?: { fx: number; fy: number }): Promise<number>
  ```

- [ ] **Step 1: Write the composition test for the narrowed layout list**

In `src/lib/composition.test.ts` delete imports and cases for `frameBoxFor`, `frameOrnaments`, `framePadding`, `FRAME_TAG`, `DEFAULT_FRAME_ID`, `buildFrameBlock`, and the `"framed"` plan case. Add:
```ts
it("offers exactly muthanna and medallion", () => {
  expect(COMPOSITION_LAYOUTS.map((l) => l.id)).toEqual(["muthanna", "medallion"]);
});

it("normalises an unknown layout id (an old 'framed' preference) to muthanna", () => {
  expect(normalizeCompositionLayout("framed")).toBe("muthanna");
  expect(normalizeCompositionLayout("medallion")).toBe("medallion");
});
```
(`COMPOSITION_LAYOUTS` is the existing exported array at `composition.ts:≈40-60`; confirm the name when editing.)

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run src/lib/composition.test.ts`
Expected: FAIL, `normalizeCompositionLayout` not exported.

- [ ] **Step 3: Narrow compositions**

In `composition.ts`: delete the `./ornaments` import (5-9); set `export type CompositionLayoutId = "muthanna" | "medallion";`; delete the `framed` entry from the layouts array (≈55-60); delete `framePadding`, `frameBoxFor`, `FRAME_TAG`, `DEFAULT_FRAME_ID`, `DEFAULT_FRAME_COLOR`, `frameOrnaments`, `buildFrameBlock` and the `case "framed"` branch; delete `frameId`/`frameColor` from the request type (188-189); change the "Nothing was added" message at 321 to `"Nothing was added."`. Add:
```ts
export const normalizeCompositionLayout = (id: string | undefined): CompositionLayoutId =>
  id === "medallion" ? "medallion" : "muthanna";
```
In `CompositionDialog.tsx`: delete `frameOrnaments`, `DEFAULT_FRAME_ID`, `DEFAULT_FRAME_COLOR` imports and the `OrnamentDef` type import (7, 17); the `frameId`/`frameColor` state and `frames`/`frame` memo (58-63); pass only `{ layout, radialCount }` to `onApply` (79); the `frame`/`frameColor` props on the preview (142-143); the `layout === "framed"` block (177-199); `OrnamentFillSwatches`; and the `frame?: OrnamentDef` preview prop (227). Wrap the initial `layout` state in `normalizeCompositionLayout(...)`.

- [ ] **Step 4: Remove image blocks and ornaments**

```bash
git rm -r src/components/ImageBlockView.tsx src/components/OrnamentPicker.tsx src/lib/ornaments.ts src/lib/ornaments.test.ts src/data/ornaments e2e/ornaments.spec.ts src/components/guide/sections/ornaments.tsx public/demos/add-image.gif public/demos/add-ornament.gif .claude/rules/ornaments.md
```
Then, guided by tsc:
- `types.ts`: `| "image"` (4), `ornamental?: boolean` (78), the `ImageBlock` type (204-208), `| ImageBlock` (394); fix the comments at 84 and 327.
- `App.tsx`: `ornamental: false` (298); the `b.type === "image" ||` half of 1296; `resizeImageBlock` (1379-1382); `addImageBlock` + `uploadImageBlock` (2285-2330); `insertOrnamentShapeFill`, `insertOrnamentFrame` and their two props (2688-2701); `ornamental: source.ornamental,` (3221); `b.type !== "image" &&` (3478); `selectedBlock.type !== "image" &&` (3503); `onAddImageBlock` (3581); `onResizeImageBlock` (3717). Comment at 253: "shape/image" → "shape".
- `Sidebar.tsx`: `OrnamentPickerButton` import (104); props 205-206, 282 and destructuring 531-532, 586; `BLOCK_DEMOS.ornament` (473) and `.image` if present; the Add image and Add ornament buttons (1943-1975); the Image panel (2418-2460); the `OrnamentPickerButton` inside Shape Fill (2744-2750); the `selectedBlock.type !== "image" &&` guards on Transform (3647) and Effects (3672).
- `CanvasStage.tsx`: import (64), prop (196, 327), the `block.type === "image"` branch (1033-1050).
- `MirrorBlockView.tsx`: import (8), `imageProps` (13), the `source.type === "image"` branch (126-128).
- `blockRenderProps.ts`: `imageProps` (112-120) and its test case.
- `index.css:378`: drop `.ornamentPickerDialog,` from the selector; fix the comments at 376 and 442.
- `FontUploadDialog.tsx:15, 171`: comments referring to `OrnamentPicker` → refer to `FontPickerDialog`.
- Guide sections: `blocks.tsx` `"image"` keyword (13) and the `<h4>Image</h4>` paragraph (91-…); `getting-started.tsx:30` "an image" removed from the list; `smart-guides.tsx:36` "a title over an ornament" → "a title over a shape"; `compositions.tsx`: any frame sentence.
- `e2e/demos/record.spec.ts`: "add image" and "add ornament" tests (200-215) and the `clearCanvasAt(4)` helper if it is now unused.
- `.claude/rules/compositions.md`: remove the frame paragraphs; "composes mirrors and image frames" → "composes mirrors".

- [ ] **Step 5: Replace the e2e ornament fixture**

```bash
mkdir -p e2e/fixtures && cp e2e/demos/circle.svg e2e/fixtures/circle.svg
```
In `e2e/harf.ts` replace `addOrnamentShapeFill` (258-291) with:
```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * Adds a Shape Fill block from the bundled circle fixture and returns its id.
 * The Add button opens a native file chooser; Playwright intercepts it, so no
 * dialog is shown. The circle is drawn with curves — SVG `A` commands don't
 * survive the shape-fill importer.
 */
export async function addShapeFillFromSvg(
  page: Page,
  at: { fx: number; fy: number } = { fx: 0.5, fy: 0.5 }
): Promise<number> {
  const before = new Set((await getBlocks(page)).map((b) => b.id));
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add shape fill" }).click();
  await (await chooser).setFiles(path.join(FIXTURES, "circle.svg"));
  await placeAtCanvas(page, at.fx, at.fy);

  await expect
    .poll(async () => (await getBlocks(page)).some((b) => b.type === "shapeFill" && !before.has(b.id)))
    .toBe(true);
  const block = (await getBlocks(page)).find((b) => b.type === "shapeFill" && !before.has(b.id))!;
  const box = await blockClientBox(page, block.id);
  await expect.poll(() => inkPixels(page, box)).toBeGreaterThan(0);
  return block.id;
}
```
Check `e2e/tsconfig.json` allows Node types (`font-upload.spec.ts` already uses a fixture path, copy its import style if it differs).

Update the three callers: `detached-marks.spec.ts:4,80`, `glyph-alternates.spec.ts:3,167,227`, `ink-surface.spec.ts:3,255` → `addShapeFillFromSvg`. In `glyph-alternates.spec.ts:178-180` the comment says the ornament exceeds the viewport; the 200px circle does not. Keep the nearest-to-centre selection (it is still correct) and rewrite the comment: "aim at the tile nearest the block's centre so the pick is on a fully visible letter." If any of the three specs' pixel assertions were tuned to the ornament's size, re-derive the numbers from a run; preserve each assertion's intent.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p e2e/tsconfig.json && npm run lint && npm test && npm run build && npx playwright test e2e/detached-marks.spec.ts e2e/glyph-alternates.spec.ts e2e/ink-surface.spec.ts e2e/composition.spec.ts e2e/mirror.spec.ts`
Expected: green. `grep -rni "ornament\|imageDataUrl\|ImageBlock" src e2e` returns nothing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Remove image blocks and the ornament & frame library"
```

---

### Task 6: Old saves load clean

**Files:**
- Modify: `src/App.tsx:332-351` (`REMOVED_BLOCK_FIELDS`, `stripRemovedFields`), `src/App.tsx:1770-1775` (filter)
- Create: `src/lib/legacySaves.ts`, `src/lib/legacySaves.test.ts`

The filter and stripper currently live inline in `App.tsx`, which Vitest cannot import (it pulls in harfbuzz). Move them to a pure module so they can be tested, and have `App.tsx` call it.

**Interfaces:**
- Produces:
  ```ts
  export const REMOVED_BLOCK_TYPES: readonly string[];   // ["shapeWarp", "squareKufi", "image"]
  export const REMOVED_BLOCK_FIELDS: readonly string[];  // existing list + "warpX", "warpY", "ornamental", "imageDataUrl", "imageScale", "kufiColumns", "kufiComposition", "kufiLineGap", "kufiWordGap", "kufiCellEdits", "kufiCellEditMode"
  export function sanitizeLegacyBlocks(blocks: unknown[]): Block[]; // drop removed types, strip removed fields
  ```

- [ ] **Step 1: Write the failing test**

`src/lib/legacySaves.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sanitizeLegacyBlocks } from "./legacySaves";

const text = { id: 1, type: "text", text: "حرف", fontFamily: "Amiri", fontSize: 72, color: "#000", x: 0, y: 0 };

describe("sanitizeLegacyBlocks", () => {
  it("drops squareKufi, image and shapeWarp blocks", () => {
    const out = sanitizeLegacyBlocks([
      text,
      { ...text, id: 2, type: "squareKufi", kufiColumns: 4 },
      { ...text, id: 3, type: "image", imageDataUrl: "data:," },
      { ...text, id: 4, type: "shapeWarp" },
    ]);
    expect(out.map((b) => b.id)).toEqual([1]);
  });

  it("strips warp, ornamental and image fields from surviving blocks", () => {
    const [out] = sanitizeLegacyBlocks([{ ...text, warpX: 40, warpY: -10, ornamental: true, imageScale: 2 }]);
    expect(out).toEqual(text);
  });

  it("leaves a mirror whose source was an image for dropOrphanedMirrors to remove", () => {
    // The sanitizer only knows types and fields; orphan removal is App's existing pass.
    const out = sanitizeLegacyBlocks([
      text,
      { ...text, id: 2, type: "image", imageDataUrl: "data:," },
      { ...text, id: 3, type: "mirror", sourceId: 2, mirrorMode: "horizontal" },
    ]);
    expect(out.map((b) => b.id)).toEqual([1, 3]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run src/lib/legacySaves.test.ts` — FAIL, module missing.

- [ ] **Step 3: Create the module and call it from App**

`src/lib/legacySaves.ts`:
```ts
import type { Block } from "../types";

/**
 * Block types that no longer exist. A save from before each removal can still
 * carry them; nothing renders them, so they are dropped on load rather than
 * left to occupy the layer list. See .claude/rules/removed-subsystems.md.
 */
export const REMOVED_BLOCK_TYPES = ["shapeWarp", "squareKufi", "image"] as const;

/** Per-block fields of removed subsystems, stripped so old saves load byte-clean. */
export const REMOVED_BLOCK_FIELDS = [
  // Morph Glyph Editor, removed 2026-08-14.
  "glyphEdits", "glyphRigValues", "glyphMaskEdit", "glyphEditTool", "selectedGlyphIndex", "kashidaAmount", "kashidaEditMode",
  // Per-glyph move, scale & rotate, removed 2026-10-10.
  "glyphTransforms", "glyphTransformMode",
  // Warp, removed 2026-10-14.
  "warpX", "warpY",
  // Ornament library, removed 2026-10-14.
  "ornamental",
  // Image blocks, removed 2026-10-14 (fields could linger on a mirror copy).
  "imageDataUrl", "imageScale",
  // Square Kufi, removed 2026-10-14.
  "kufiColumns", "kufiComposition", "kufiLineGap", "kufiWordGap", "kufiCellEdits", "kufiCellEditMode",
] as const;

export function sanitizeLegacyBlocks(blocks: unknown[]): Block[] {
  return blocks
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .filter((b) => !(REMOVED_BLOCK_TYPES as readonly string[]).includes(String(b.type)))
    .map((b) => {
      const next = { ...b };
      for (const field of REMOVED_BLOCK_FIELDS) delete next[field];
      return next as unknown as Block;
    });
}
```
In `App.tsx`: delete `REMOVED_BLOCK_FIELDS` and `stripRemovedFields` (≈325-351) and their comment; import `sanitizeLegacyBlocks`; replace the `.filter(...shapeWarp).map(stripRemovedFields)` chain (≈1771-1775) with `sanitizeLegacyBlocks(parsed.blocks as unknown[])`. Trim the long comment above it to one sentence pointing at `legacySaves.ts`.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/lib/legacySaves.test.ts && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/legacySaves.ts src/lib/legacySaves.test.ts src/App.tsx
git commit -m "Old saves: drop removed block types and fields through one tested sanitizer"
```

---

### Task 7: Fold Transform into Typography

**Files:**
- Modify: `src/components/Sidebar.tsx` (Transform panel ≈3640-3668; Typography panel; `showTransform` state at 647), `e2e/*.spec.ts` that open Transform (grep `/^Transform/`), `src/components/guide/sections/typography.tsx` (mention rotation), `.claude/rules/sidebar.md` (Transform sentence)

- [ ] **Step 1: Find e2e uses**

Run: `grep -rn "Transform" e2e/*.ts` and note each.

- [ ] **Step 2: Move the row**

Cut the `RangeRow` for rotation (id `rotation`) out of the Transform panel and paste it at the end of Typography's `sectionPanel`, wrapped in the existing guard `!(selectedBlock.type === "textPath" && selectedBlock.guide) &&` (attached curve text has inert rotation; keep the comment). Delete the Transform panel and `showTransform`. Guides and mirrors have no Typography panel: check whether a Guide or Mirror block's rotation was reachable through Transform. If so, add the same `RangeRow` to the Guide panel (`GuidePanel.tsx`) and keep the one already in the Mirror panel (2545).

- [ ] **Step 3: Update e2e callers**

Each `openPanel(page, /^Transform/)` becomes `openTypography(page)` (or `openPanel(page, /^Guide/)` for guide specs).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p e2e/tsconfig.json && npm run lint && npx playwright test e2e/guides.spec.ts e2e/mirror.spec.ts e2e/core.spec.ts`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Sidebar: rotation lives in Typography; Transform panel removed"
```

---

### Task 8: Font strip panel

**Files:**
- Create: `src/components/sidebar/FontPanel.tsx`
- Modify: `src/components/Sidebar.tsx` (new panel first in the `selected` tier at ≈2252; remove the font row, missing-font notice and upload row from Typography ≈3272-3330), `src/index.css` (strip styles), `e2e/harf.ts:220-256`, `e2e/font-upload.spec.ts:19-22`, `e2e/font-picker.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FontPanelProps = {
    id: string;                      // makeId("font-family", selectedId)
    text: string;                    // selected block's text
    value: string;                   // selected block's fontFamily
    fonts: FontChoice[];             // fontChoicesWith(customFonts)
    missingFontKey: string | null;
    describeFontKey: (key: string) => string;
    customFonts: CustomFont[];
    onChange: (value: string) => void;
    onAddCustomFont: (...)           // same type as Sidebar's prop today
    onRemoveCustomFont?: (key: string) => void;
    isOpen: boolean; onToggle: () => void;
  };
  ```
  Panel header accessible name: `"Font −"` / `"Font +"` (CollapsibleSection renders title then the glyph). Starts **open**. Strip cards: `button.fontStripCard[data-font-key][aria-pressed]` with `aria-label` = font label. The trailing full-gallery trigger is the existing `FontPickerField` (accessible name `/^Font family\b/`), so `chooseFont` keeps working once it opens this panel instead of Typography.

- [ ] **Step 1: Write the e2e test first**

Append to `e2e/font-picker.spec.ts`:
```ts
test("the Font panel's strip applies a font in one click and highlights it", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, "محمد");
  const strip = page.getByTestId("font-strip");
  await expect(strip).toBeVisible(); // the panel starts open
  await expect(strip.locator('[data-font-key="Amiri"] .fontStripSample')).toHaveText("محمد");

  await strip.locator('[data-font-key="Amiri"]').click();
  await expect.poll(async () => (await getBlocks(page))[0].fontFamily).toBe("Amiri");
  await expect(strip.locator('[data-font-key="Amiri"]')).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await getBlocks(page))[0].fontFamily).not.toBe("Amiri");
});

test("a block on a font this browser lacks still shows the strip and the notice", async ({ page }) => {
  // The bridge is read-only, so reach the state through the UI: upload a
  // font, put the block on it, then remove the upload. The block now names a
  // key the catalogue no longer knows.
  await gotoApp(page);
  await uploadFixtureFont(page);            // copy this helper and FIXTURE_FONT from font-upload.spec.ts into harf.ts and export them
  await chooseFont(page, UPLOAD_LABEL, { uploaded: true });
  await page.getByRole("button", { name: `Remove uploaded font ${UPLOAD_LABEL}` }).click();
  await expect(page.getByTestId("font-strip")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("isn't available");
});
```
Move `uploadFixtureFont`, `UPLOAD_LABEL` and `FIXTURE_FONT` from `e2e/font-upload.spec.ts:17-40` into `e2e/harf.ts` as exports and import them back in that spec. Do not add a write path to `window.__HARF__` (it is read-only by rule).

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test e2e/font-picker.spec.ts -g "strip"` — FAIL, no `font-strip`.

- [ ] **Step 3: Write the panel**

`src/components/sidebar/FontPanel.tsx`:
```tsx
import { useEffect, useRef } from "react";
import { CollapsibleSection } from "./FormControls";
import { FontPickerField } from "../FontPickerDialog";
import { FontUploadButton } from "../FontUploadDialog";
import { TrashIcon } from "../Icons";
import { SAMPLE_FALLBACK, visibleFonts, type FontChoice } from "../../lib/fontCatalog";
import type { CustomFont } from "../../lib/customFonts";

export type FontPanelProps = { /* as in Interfaces */ };

/**
 * The first panel of the selected tier: the block's text in every face, one
 * click to switch. CSS previews, same as the gallery. The full genre-grouped
 * view is one button further (FontPickerField), and font upload lives here
 * because it is the app's only surface for managing the browser's font store.
 */
export const FontPanel: React.FC<FontPanelProps> = (p) => {
  const activeRef = useRef<HTMLButtonElement>(null);
  const sample = p.text.trim() || SAMPLE_FALLBACK;
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [p.value]);

  return (
    <div className="sidebarPanel">
      <CollapsibleSection title="Font" isOpen={p.isOpen} onToggle={p.onToggle}>
        <div className="sectionPanel">
          {p.missingFontKey && (
            <div className="fontMissingNotice" role="status">
              Font '{p.describeFontKey(p.missingFontKey)}' isn't available in this browser — using Noto Sans.
              Upload the font file to get it back, or pick another font below.
            </div>
          )}
          <div className="fontStrip" data-testid="font-strip" role="group" aria-label="Fonts">
            {visibleFonts(p.fonts, p.value).map((font) => {
              const active = font.value === p.value;
              return (
                <button
                  key={font.value}
                  ref={active ? activeRef : undefined}
                  type="button"
                  className={active ? "fontStripCard fontStripCard--active" : "fontStripCard"}
                  data-font-key={font.value}
                  aria-pressed={active}
                  aria-label={font.label}
                  title={font.label}
                  onClick={() => { if (!active) p.onChange(font.value); }}
                >
                  <span className="fontStripSample" style={{ fontFamily: font.cssFamily }} dir="rtl" lang="ar">
                    {sample}
                  </span>
                </button>
              );
            })}
          </div>
          <FontPickerField id={p.id} label="Font family" value={p.value} text={p.text} fonts={p.fonts} onChange={p.onChange} />
          <div className="customFontRow">
            <FontUploadButton onAdd={p.onAddCustomFont} />
            {p.customFonts.length > 0 && (
              <ul className="customFontList">
                {p.customFonts.map((f) => (
                  <li className="customFontItem" key={f.key} data-font-key={f.key}>
                    <span className="customFontName" style={{ fontFamily: `'${f.key}'` }}>{f.label}</span>
                    <button type="button" className="sidebarCircleButton" aria-label={`Remove uploaded font ${f.label}`} onClick={() => p.onRemoveCustomFont?.(f.key)}>
                      <TrashIcon size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};
```
Fix the imports to where `FontUploadButton` and `CustomFont` actually live (`grep -n "export const FontUploadButton" src/components/*.tsx`).

CSS, appended to `src/index.css` near the `.fontPicker*` rules:
```css
.fontStrip { display: flex; gap: 6px; overflow-x: auto; padding: 2px 0 6px; scroll-snap-type: x proximity; }
.fontStrip > * { min-width: 0; flex: 0 0 auto; }
.fontStripCard { scroll-snap-align: center; width: 112px; padding: 8px 6px; border: 1px solid var(--border-soft); border-radius: 8px; background: var(--overlay-hover); color: var(--text-primary); cursor: pointer; }
.fontStripCard:hover { border-color: var(--border); }
.fontStripCard--active { border-color: var(--accent); outline: 1px solid var(--accent); }
.fontStripSample { display: block; font-size: 24px; line-height: 1.5; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 4: Wire it in Sidebar**

In `Sidebar.tsx`: add `const [showFont, setShowFont] = useState(true);`. Directly after `<SidebarTier label="selected" />` (≈2252), when `selectedBlock` exists and `selectedBlock.type` is not `"mirror" | "guide" | "stack"`, render `<FontPanel id={makeId("font-family", selectedId)} text={selectedText} value={selectedBlock.fontFamily} fonts={fontChoices} missingFontKey={missingFontKey} describeFontKey={describeFontKey} customFonts={customFonts} onChange={(v) => onUpdateSelectedBlock({ fontFamily: v })} onAddCustomFont={onAddCustomFont} onRemoveCustomFont={onRemoveCustomFont} isOpen={showFont} onToggle={() => setShowFont((v) => !v)} />`. Delete from Typography the missing-font notice, `FontPickerField` and the `customFontRow` block (≈3272-3330), plus the `!== "stack"` wrapper that only guarded them.

- [ ] **Step 5: Update e2e helpers**

`e2e/harf.ts`: add
```ts
/** Opens the Font panel (first in the selected tier; open on boot, so this is usually a no-op). */
export async function openFontPanel(page: Page): Promise<void> {
  await openPanel(page, /^Font [−+]$/);
}
```
In `chooseFont` replace `await openTypography(page);` with `await openFontPanel(page);` and fix its doc comment. In `font-upload.spec.ts:19-22` `openFontPicker` → call `openFontPanel`. In `font-picker.spec.ts` `openPicker` → `openFontPanel`. Keep `openTypography` for the specs that still need Typography.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p e2e/tsconfig.json && npm run lint && npm test && npx playwright test e2e/font-picker.spec.ts e2e/font-upload.spec.ts e2e/styles.spec.ts e2e/glyph-alternates.spec.ts`
Expected: green, including the two new tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Font panel: one-click strip of the block's text in every face, first in the selected tier"
```

---

### Task 9: Start screen component

**Files:**
- Create: `src/components/StartScreen.tsx`, `src/lib/startScreen.ts`, `src/lib/startScreen.test.ts`
- Modify: `src/index.css`

**Interfaces:**
- Produces:
  ```ts
  // lib/startScreen.ts (pure)
  export const STARTER_TEXT = "حرف";
  export function startingText(typed: string): string;   // trimmed typed text, or STARTER_TEXT when empty
  export function shouldShowStartScreen(storage: { getItem(k: string): string | null }, storageKey: string): boolean; // true when no quick-save
  // components/StartScreen.tsx
  export type StartScreenProps = { fonts: FontChoice[]; onPick: (text: string, fontFamily: string) => void; onSkip: () => void };
  ```
  Markup: `div.startScreen[data-testid="start-screen"][role="dialog"][aria-label="Choose a font to begin"]` > header with `h1` "HarfCanvas", `input.startScreenInput[aria-label="Your text"][dir=rtl]`, `button` "Skip" (accessible name exactly `Skip`), then `<FontGallery testId="start-gallery" autoFocus={false} />`.

- [ ] **Step 1: Write the failing unit test**

`src/lib/startScreen.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { STARTER_TEXT, shouldShowStartScreen, startingText } from "./startScreen";

describe("startScreen", () => {
  it("uses the starter word when the field is blank", () => {
    expect(startingText("")).toBe(STARTER_TEXT);
    expect(startingText("   ")).toBe(STARTER_TEXT);
    expect(startingText(" محمد ")).toBe("محمد");
  });
  it("shows only when there is nothing to restore", () => {
    const empty = { getItem: () => null };
    const saved = { getItem: (k: string) => (k === "key" ? "{}" : null) };
    expect(shouldShowStartScreen(empty, "key")).toBe(true);
    expect(shouldShowStartScreen(saved, "key")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect failure**

`npx vitest run src/lib/startScreen.test.ts` — FAIL.

- [ ] **Step 3: Implement**

`src/lib/startScreen.ts`:
```ts
/** The word a fresh canvas starts with; also `DEFAULT_BLOCK.text` in App.tsx. */
export const STARTER_TEXT = "حرف";

export const startingText = (typed: string): string => typed.trim() || STARTER_TEXT;

/** The start screen shows only on a truly fresh load: a quick-save means the user has work to come back to. */
export const shouldShowStartScreen = (
  storage: { getItem(k: string): string | null },
  storageKey: string
): boolean => storage.getItem(storageKey) === null;
```

`src/components/StartScreen.tsx`:
```tsx
import { useState } from "react";
import { FontGallery } from "./FontGallery";
import { startingText, STARTER_TEXT } from "../lib/startScreen";
import { visibleFonts, type FontChoice } from "../lib/fontCatalog";

export type StartScreenProps = {
  fonts: FontChoice[];
  onPick: (text: string, fontFamily: string) => void;
  onSkip: () => void;
};

/**
 * The front door: type a word, see it in every face, pick one, start editing.
 * A fixed overlay above the mounted editor rather than a replacement for it,
 * so App.tsx's hydration and fit-to-view effects run exactly as before.
 */
export const StartScreen: React.FC<StartScreenProps> = ({ fonts, onPick, onSkip }) => {
  const [text, setText] = useState(STARTER_TEXT);
  return (
    <div className="startScreen" data-testid="start-screen" role="dialog" aria-modal="true" aria-label="Choose a font to begin">
      <header className="startScreenHeader">
        <div>
          <h1 className="startScreenTitle">HarfCanvas</h1>
          <p className="startScreenSubtitle">Type a word. Choose how it should be written.</p>
        </div>
        <input
          className="startScreenInput"
          aria-label="Your text"
          dir="rtl"
          lang="ar"
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" className="startScreenSkip" onClick={onSkip}>Skip</button>
      </header>
      <FontGallery
        text={startingText(text)}
        fonts={visibleFonts(fonts)}
        onPick={(font) => onPick(startingText(text), font)}
        autoFocus={false}
        testId="start-gallery"
      />
    </div>
  );
};
```

CSS appended to `index.css`:
```css
.startScreen { position: fixed; inset: 0; z-index: 3000; display: flex; flex-direction: column; gap: 12px; padding: 28px clamp(16px, 6vw, 96px); background: var(--bg-page); color: var(--text-primary); overflow: hidden; }
.startScreenHeader { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.startScreenHeader > * { min-width: 0; }
.startScreenTitle { margin: 0; font-size: 22px; letter-spacing: 0.02em; }
.startScreenSubtitle { margin: 2px 0 0; font-size: 13px; color: var(--text-muted); }
.startScreenInput { flex: 1 1 320px; font-size: 28px; padding: 10px 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-input); color: var(--text-primary); }
.startScreenSkip { flex: 0 0 auto; padding: 8px 14px; border: 1px solid var(--border-soft); border-radius: 8px; background: transparent; color: var(--text-muted); cursor: pointer; }
.startScreen .fontPickerBody { flex: 1; }
.startScreen .fontPickerSample { font-size: 40px; line-height: 1.7; }
```

- [ ] **Step 4: Verify**

`npx vitest run src/lib/startScreen.test.ts && npx tsc --noEmit -p tsconfig.app.json && npm run lint` — green.

- [ ] **Step 5: Commit**

```bash
git add src/components/StartScreen.tsx src/lib/startScreen.ts src/lib/startScreen.test.ts src/index.css
git commit -m "Start screen component: a word in every face, pick one to begin"
```

---

### Task 10: Mount the start screen in App and keep e2e running

**Files:**
- Modify: `src/App.tsx` (state near 548; JSX at 3516), `e2e/harf.ts:40-47`, `e2e/demos/record.spec.ts` (uses `gotoApp`, nothing else)
- Create: `e2e/start-screen.spec.ts`

- [ ] **Step 1: Write the e2e spec first**

`e2e/start-screen.spec.ts`:
```ts
import { test, expect, type Page } from "@playwright/test";
import { getBlocks, inkPixels } from "./harf";

const STAGE_CANVAS = ".konvajs-content canvas";

/** Loads the app without dismissing the start screen (gotoApp does dismiss it). */
async function gotoFresh(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("start-screen")).toBeVisible();
}

test("a fresh load shows the start screen and typing updates every card", async ({ page }) => {
  await gotoFresh(page);
  const gallery = page.getByTestId("start-gallery");
  expect(await gallery.locator(".fontPickerCard").count()).toBeGreaterThan(10);
  await page.getByLabel("Your text").fill("محمد");
  await expect(gallery.locator('[data-font-key="Amiri"] .fontPickerSample')).toHaveText("محمد");
  await expect(gallery.getByRole("heading", { name: "Naskh", exact: true })).toBeVisible();
});

test("picking a card lands in the editor with that text and font", async ({ page }) => {
  await gotoFresh(page);
  await page.getByLabel("Your text").fill("محمد");
  await page.getByTestId("start-gallery").locator('[data-font-key="Thuluth"]').click();
  await expect(page.getByTestId("start-screen")).toHaveCount(0);
  await page.locator(STAGE_CANVAS).first().waitFor();
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(0);
  const blocks = await getBlocks(page);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].text).toBe("محمد");
  expect(blocks[0].fontFamily).toBe("Thuluth");
});

test("an empty field falls back to the starter word", async ({ page }) => {
  await gotoFresh(page);
  await page.getByLabel("Your text").fill("");
  await page.getByTestId("start-gallery").locator('[data-font-key="Amiri"]').click();
  await expect.poll(async () => (await getBlocks(page))[0]?.text).toBe("حرف");
});

test("Skip opens the editor with the default block", async ({ page }) => {
  await gotoFresh(page);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByTestId("start-screen")).toHaveCount(0);
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(0);
  expect((await getBlocks(page))[0].text).toBe("حرف");
});

test("a quick-save bypasses the start screen", async ({ page }) => {
  await gotoFresh(page);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Quick save", exact: true }).click(); // aria-label at Sidebar.tsx:1352
  await page.reload();
  await page.locator(STAGE_CANVAS).first().waitFor();
  await expect(page.getByTestId("start-screen")).toHaveCount(0);
});
```

- [ ] **Step 2: Run, expect failure**

`npx playwright test e2e/start-screen.spec.ts` — FAIL, no start screen.

- [ ] **Step 3: Mount it**

In `App.tsx`:
- Import `StartScreen`, `shouldShowStartScreen`, `fontChoicesWith`.
- Near the other `useState`s (≈548): `const [showStart, setShowStart] = useState(() => isBrowser && shouldShowStartScreen(localStorage, STORAGE_KEY));`
- Below `customFonts` state: `const startFonts = useMemo(() => fontChoicesWith(customFonts), [customFonts]);`
- Handler (place above the JSX, after `fitInitialView` is defined):
  ```ts
  const beginFromStart = (text: string, fontFamily: string) => {
    const next: Block[] = [{ ...DEFAULT_BLOCK, id: 1, text, fontFamily }];
    setBlocks(next);
    setSelectedIds([]);
    setSelectedId(1);
    setShowStart(false);
    fitInitialView(next);
  };
  ```
  No `pushHistory`: the start screen precedes the first edit, and undo should not reopen it.
- In the JSX, as the last child of the root `<div>`: `{showStart && <StartScreen fonts={startFonts} onPick={beginFromStart} onSkip={() => setShowStart(false)} />}`.

- [ ] **Step 4: Teach gotoApp to dismiss it**

`e2e/harf.ts:40-47`:
```ts
export async function gotoApp(page: Page): Promise<void> {
  await page.goto("/");
  // A fresh browser context has no quick-save, so the start screen is up.
  // Every spec here wants the editor; start-screen.spec.ts loads its own way.
  const skip = page.getByRole("button", { name: "Skip", exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.locator(STAGE_CANVAS).first().waitFor();
  await page.waitForFunction(() => !!window.__HARF__?.getStage());
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(0);
}
```
If the overlay renders a frame after `goto` resolves, change the check to `await page.getByTestId("start-screen").waitFor({ timeout: 2000 }).catch(() => null)` before looking for Skip.

- [ ] **Step 5: Verify the whole e2e suite**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p e2e/tsconfig.json && npm run lint && npm test && npm run build && npm run e2e`
Expected: everything green. If a spec other than start-screen fails on the overlay, it bypassed `gotoApp`; route it through `gotoApp`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Start screen: the font gallery is the front door"
```

---

### Task 11: Split the remaining sidebar panels into files

**Files:**
- Create: `src/components/sidebar/ShapeFillPanel.tsx`, `CurvePanel.tsx`, `MirrorPanel.tsx`, `TypographyPanel.tsx`, `EffectsPanel.tsx`, `BlockControlsPanel.tsx`
- Modify: `src/components/Sidebar.tsx`

Pure moves. Each new file receives exactly the JSX between its `<div className="sidebarPanel">` and `</div>` plus the props it reads, following `VersePanel.tsx` / `StackPanel.tsx` as the template. No prop renamed, no accessible name changed.

- [ ] **Step 1: Move one panel at a time, smallest first (Mirror, Curve, Shape Fill, Block Controls, Effects, Typography)**

For each: create the file with a `Props` type listing only what the JSX references; cut the JSX; render `<XPanel {...} />` in place. After each move run `npx tsc --noEmit -p tsconfig.app.json`.

- [ ] **Step 2: Fix the Add grid**

In `BlockControlsPanel.tsx` the Add grid is now five buttons (text, shape fill, curved text, guide, mirror). Change its CSS grid to five columns (`gridTemplateColumns: "repeat(5, minmax(0, 1fr))"`) and delete the "Add medallion" button and its demo entry (`BLOCK_DEMOS.medallion`, `public/demos/add-medallion.gif`, the recorder test). `e2e/mirror.spec.ts:15,153` clicks "Add medallion" (`ADD_RADIAL`) to create a radial mirror; rewrite that test to create the radial mirror through the Compositions dialog's medallion layout instead (see `e2e/composition.spec.ts` for how that dialog is driven), keeping the test's assertions about the resulting mirror block. `App.tsx`'s `addMirrorBlock("radial")` handler stays, since the composition builder calls it.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build && npm run e2e`
Expected: green. `wc -l src/components/Sidebar.tsx` well under 2000.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Sidebar: type, Typography and Effects panels in their own files; five Add buttons"
```

---

### Task 12: Documentation

**Files:**
- Modify: `CLAUDE.md`, `.claude/rules/sidebar.md`, `.claude/rules/removed-subsystems.md`, `.claude/rules/detached-marks.md`, `.claude/rules/compositions.md`, `.claude/rules/deferred-features.md`, `README.md`, `PROGRESS.md`, `src/components/guide/sections/typography.tsx`, `getting-started.tsx`
- Create: `.claude/rules/font-first.md`

- [ ] **Step 1: removed-subsystems.md**

Update the intro ("Two removals so far" → the count, and the stripper now lives in `src/lib/legacySaves.ts`). Add four sections, each with **What went** (the file list from Tasks 3-5), **Why — in the user's words:** *"It has become too bulky and some features are redundant. I want the app to be clean, and showcase the thing it excels at; the fonts."* and the user's explicit list *"cut Square Kufi, Horizontal and vertical warp and image blocks"*, with ornaments following because a frame is an image block. **Recovery:** tag `pre-font-first-redesign`. Update the `paths:` frontmatter to include `src/lib/legacySaves*.ts`.

- [ ] **Step 2: CLAUDE.md**

- Line 7: "compose text, SVG-shape, and image blocks" → "compose text and shape blocks".
- Line 88: Block union sentence → `TextBlock | ShapeFillBlock | TextPathBlock` plus `MirrorBlock`, `GuideBlock`, `StackBlock`; drop the `ImageBlock` example (use `GuideBlock` carrying unused font fields instead).
- Lines 92, 98, 100, 102, 108: remove `image`, `ImageBlockView`, the warp sentence, and `image` from the corner-handle exception.
- Line 161: "Marks, then cuts, then warp." → "Marks, then cuts."
- Delete index lines 164 (Square kufi), 174 (Ornament & frame library). Line 175: "composes mirrors and image frames" → "composes mirrors". Line 183: drop "dots/tashkeel and spirals in square kufi, image trace".
- Add an index line: `- **Font-first start screen & Font panel** — [.claude/rules/font-first.md](.claude/rules/font-first.md). Catalogue in `lib/fontCatalog.ts`; one `FontGallery` for dialog, strip and start screen; start screen is an overlay gated on the quick-save key; e2e `gotoApp` dismisses it.`
- "Removed subsystems" line: add the 2026-10-14 four.

- [ ] **Step 3: font-first.md**

Create with `paths: ["src/lib/fontCatalog*.ts", "src/lib/startScreen*.ts", "src/components/StartScreen.tsx", "src/components/FontGallery.tsx", "src/components/sidebar/FontPanel.tsx", "e2e/start-screen.spec.ts"]`. Cover: why the overlay (hydration effect at App.tsx runs on mount against `window.innerWidth`, so replacing the editor would leave `fitInitialView` with no stage); why no `pushHistory` on pick; `shouldShowStartScreen` reads only the quick-save key; `gotoApp` clicks Skip; the strip hides retired fonts via `visibleFonts`; CSS previews not canvas.

- [ ] **Step 4: sidebar.md**

Rewrite the tier table to Task 11's result; replace the nine-button Add paragraph with five; move the "font family row is a button" paragraph under a new "Font panel" heading describing the strip and that the panel starts open; drop the Square Kufi and Image panel mentions; note Transform is gone and rotation is in Typography (and Mirror/Guide panels).

- [ ] **Step 5: README and PROGRESS**

README: block types line → "Five block types: plain text, text on a curve, text poured into an SVG silhouette, mirror blocks, and guides"; delete the Square kufi bullet (53) and "or a decorative frame" (61); fix "17 bundled faces" to the real count from `FONT_OPTIONS` (22 active); add one bullet under Typesetting: "Start by typing a word and seeing it in every face; switch fonts from a one-click strip in the editor."
PROGRESS: under Shipped add a 2026-10-14 entry "Font-first redesign" listing the four removals (link removed-subsystems.md), the start screen and the Font panel; remove the Square Kufi and ornament items from Known limitations / Verification debt.

- [ ] **Step 6: Guide sections**

`typography.tsx`: describe the Font panel and strip; drop warp. `getting-started.tsx`: describe the start screen as the first thing a new user sees. Run `npx vitest run src/components/guide/registry.test.ts`.

- [ ] **Step 7: Verify and commit**

Run: `npm run lint && npm test && npm run build`
```bash
git add -A
git commit -m "Docs: font-first redesign — removals recorded, sidebar and CLAUDE.md updated"
```

---

## Self-review notes

- Spec §1 start screen → Tasks 9, 10. §2 strip and catalogue → Tasks 1, 8. §3 removals and protocol → Tasks 3-6, 12. §4 sidebar → Tasks 7, 11. §5 testing → each task's verify step, plus `npm run e2e` in Tasks 10 and 11.
- The spec said `chooseFont` is unchanged; it changes one line (opens the Font panel instead of Typography). The spec's claim that `styles.spec.ts` has a Square Kufi case was wrong: its "Kufi" is the Janna font key, and it stays.
- Review Focus items: 1 and 2 → Task 6 tests; 3 → Task 9 unit + Task 10 e2e; 4 → Task 8 second e2e; 5 → Task 5 `normalizeCompositionLayout` test.
