# Next Shape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click a letter on a text block to step through the alternate shapes its OpenType font already contains, with a labelled thumbnail strip in the sidebar.

**Architecture:** Alternates are stored per block as `{ letter, char, feature, value }`, keyed by a *letter ordinal* that skips tatweel and combining marks, so kashida and Fit to width never move them. Shaping turns them into ranged HarfBuzz features (`ss01[5:6]=1`). Options are discovered by reshaping the run once per optional feature tag and keeping the results that change the letter's glyph. The probing algorithm is pure, with shaping injected, so Vitest can drive it with real harfbuzzjs.

**Tech Stack:** React 19, TypeScript, react-konva, harfbuzzjs (WASM), opentype.js, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-next-shape-design.md`

## Global Constraints

- Text blocks only: `supportsGlyphAlternates(b)` is `b.type === "text"`.
- Absent `glyphAlternates` means default shapes; old saves render byte-identically, and there is no payload version bump.
- A letter carries at most one alternate.
- Optional tags considered: `salt`, `aalt`, `jalt`, `swsh`, `ss01`–`ss20`, `cv01`–`cv99`. Multi-value tags (`salt`, `aalt`, `jalt`, `swsh`) are probed with values 1–4; every other tag with value 1.
- Pure modules (`glyphAlternates.ts`, `fontFeatureNames.ts`) must not import `./harfbuzz`, because its static harfbuzzjs import throws under Vitest.
- Real-shaping tests use real harfbuzzjs loaded via `createRequire` and real fonts from `public/fonts/`, copying `diacritics.test.ts`'s `shapeReal` pattern. No hand-written `{ g, cl }` fixtures for anything that needs shaping.
- UI copy: the checkbox is "Alternate letter shapes", the reset button is "Reset letter shapes", the font-has-none message is "No alternate shapes in this font", the letter-has-none message is "This letter has no alternates".
- Verification loop after each task: `npx tsc --noEmit -p tsconfig.app.json`, then `npm run lint`, then `npm test`; also `npm run build` and `npm run e2e` at the last two tasks.
- A pre-commit hook bumps `package.json`'s patch version on every commit. Expect `package.json` and `package-lock.json` in every commit; don't edit the version by hand.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Typed edit before an altered letter.** The alternate must drop (its `char` no longer matches) rather than land on a different character. Pinned in Task 2 (`featureStringFor` char-mismatch test).
2. **Hand-edited or corrupted save with a malformed feature tag** (e.g. `"ss01]=1,liga"`). It must be ignored, never spliced into the HarfBuzz feature string. Pinned in Task 2.
3. **Target letter carrying a mark** (`هَ`). The ordinal skips the mark, so the alternate still applies to the letter. Pinned in Task 3.
4. **Letter swallowed into a ligature** (the alef of lam-alef). It gets no options and nothing throws. Pinned in Task 3.
5. **Long text.** Probing stops at `MAX_PROBE_LETTERS` (40) so a paragraph can't freeze the tab. Pinned in Task 3.

---

### Task 1: ZWJ is join-causing in `arabicJoining.ts`

**Files:**
- Modify: `src/lib/arabicJoining.ts`
- Test: `src/lib/arabicJoining.test.ts`

**Interfaces:** Produces no new exports. `classifyJoiningForms` now treats U+200D as join-causing.

- [ ] **Step 1: Write the failing tests.** Append inside the existing `describe("classifyJoiningForms", …)` block:

```ts
  it("treats ZWJ as join-causing: a letter before it takes its initial form", () => {
    const [beh, zwj] = classifyJoiningForms("ب‍");
    expect(beh.form).toBe("initial");
    expect(zwj.form).toBeNull();
  });

  it("treats ZWJ as join-causing: a letter after it takes its final form", () => {
    const [, beh] = classifyJoiningForms("‍ب");
    expect(beh.form).toBe("final");
  });

  it("ZWNJ still breaks the join", () => {
    const [beh, , teh] = classifyJoiningForms("ب‌ت");
    expect(beh.form).toBe("isolated");
    expect(teh.form).toBe("isolated");
  });
```

- [ ] **Step 2: Run them and confirm the two ZWJ tests fail.**
Run: `npx vitest run src/lib/arabicJoining.test.ts`
Expected: the two ZWJ tests FAIL (`beh.form` is `"isolated"`); the ZWNJ test passes.

- [ ] **Step 3: Implement.** In `src/lib/arabicJoining.ts`:

```ts
type JoiningType = "C" | "D" | "R" | "T" | "U";
```

Add above `function joiningType`:

```ts
// Join-causing (Unicode joining type C): ZERO WIDTH JOINER. It joins on both
// sides without itself having a form, so a letter beside it connects to it.
const ZWJ = 0x200d;
```

In `joiningType`, before the `DUAL_JOINING` check:

```ts
  if (cp === ZWJ) return "C";
```

In the `map` at the bottom, replace:

```ts
      const prevJoinsIntoMe = prevParticipant(i) === "D";
```

with:

```ts
      const prev = prevParticipant(i);
      const prevJoinsIntoMe = prev === "D" || prev === "C";
```

(`nextJoinsFromMe` already counts any non-null participant, so `C` works there unchanged. `C` itself is neither `D` nor `R`, so its `form` stays `null`.)

- [ ] **Step 4: Run the file and the joining consumers.**
Run: `npx vitest run src/lib/arabicJoining.test.ts src/lib/tatweel.test.ts src/lib/squareKufi.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/arabicJoining.ts src/lib/arabicJoining.test.ts
git commit -m "arabicJoining: classify ZWJ as join-causing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure alternates model: `glyphAlternates.ts` and the block field

**Files:**
- Create: `src/lib/glyphAlternates.ts`
- Create: `src/lib/glyphAlternates.test.ts`
- Modify: `src/types.ts` (add the type and two `BlockCommon` fields beside `strokeCuts`)

**Interfaces:**
- Produces, in `src/types.ts`:

```ts
export type GlyphAlternate = {
  /** Index among the text's characters, skipping tatweel (U+0640) and combining marks. */
  letter: number;
  /** The character at that letter when the choice was made — a checksum. */
  char: string;
  /** OpenType feature tag, e.g. "ss01", "salt", "jalt". */
  feature: string;
  /** 1 for on/off features; the alternate's index for salt/aalt/jalt/swsh. */
  value: number;
};
```

  and on `BlockCommon`:

```ts
  /**
   * Per-letter OpenType alternates ("Next Shape"). Absent means default
   * shapes, so an older save renders byte-identically. Plain text blocks
   * only — see `supportsGlyphAlternates`.
   */
  glyphAlternates?: GlyphAlternate[];
  /** Arms the on-canvas Next Shape tool. */
  glyphAlternateMode?: boolean;
```

- Produces, from `src/lib/glyphAlternates.ts`:
  - `type AlternateChoice = { feature: string; value: number }`
  - `type AlternateOption = { choice: AlternateChoice | null; glyphId: number; label: string }`. A `null` choice is the default shape and is always `options[0]`.
  - `type LetterAlternates = { letter: number; offset: number; options: AlternateOption[] }`
  - `MULTI_VALUE_FEATURES`, `MAX_ALTERNATE_VALUE = 4`, `MAX_PROBE_LETTERS = 40`
  - `isOptionalFeature(tag: string): boolean`
  - `letterOffsets(text: string): number[]`
  - `letterAtOffset(text: string, offset: number): number` (returns -1 for a skipped or out-of-range offset)
  - `charAtLetter(text: string, letter: number): string | null`
  - `activeAlternates(text: string, alternates: readonly GlyphAlternate[] | undefined): GlyphAlternate[]`
  - `featureStringFor(text: string, alternates: readonly GlyphAlternate[] | undefined, exceptLetter?: number): string`
  - `alternatesKey(alternates: readonly GlyphAlternate[] | undefined): string`
  - `sameChoice(a: AlternateChoice | null, b: AlternateChoice | null): boolean`
  - `currentChoice(alternates: readonly GlyphAlternate[] | undefined, letter: number): AlternateChoice | null`
  - `cycleAlternate(options: readonly AlternateOption[], current: AlternateChoice | null, direction: 1 | -1): AlternateChoice | null`
  - `setAlternate(list: readonly GlyphAlternate[] | undefined, letter: number, char: string, choice: AlternateChoice | null): GlyphAlternate[]`
  - `fallbackFeatureLabel(choice: AlternateChoice): string`

- [ ] **Step 1: Add the type and fields to `src/types.ts`** exactly as shown under Interfaces. Put `GlyphAlternate` just above the `// ---- STREAM-F` comment, and the two fields immediately after `strokeCutEditMode?: boolean;`.

- [ ] **Step 2: Write the failing tests** in `src/lib/glyphAlternates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  activeAlternates,
  alternatesKey,
  charAtLetter,
  currentChoice,
  cycleAlternate,
  fallbackFeatureLabel,
  featureStringFor,
  isOptionalFeature,
  letterAtOffset,
  letterOffsets,
  setAlternate,
  type AlternateOption,
} from "./glyphAlternates";
import type { GlyphAlternate } from "../types";

const TATWEEL = "ـ";
const FATHA = "َ";

describe("letterOffsets", () => {
  it("skips tatweel and combining marks", () => {
    // ه + fatha + tatweel + ه
    expect(letterOffsets(`ه${FATHA}${TATWEEL}ه`)).toEqual([0, 3]);
  });

  it("is unchanged in letter count by inserting kashida", () => {
    expect(letterOffsets("سلام").length).toBe(letterOffsets(`سـلـام`).length);
  });

  it("maps offsets back to letters, -1 for skipped characters", () => {
    const text = `ه${TATWEEL}ه`;
    expect(letterAtOffset(text, 0)).toBe(0);
    expect(letterAtOffset(text, 1)).toBe(-1);
    expect(letterAtOffset(text, 2)).toBe(1);
    expect(letterAtOffset(text, 9)).toBe(-1);
    expect(charAtLetter(text, 1)).toBe("ه");
    expect(charAtLetter(text, 5)).toBeNull();
  });
});

describe("isOptionalFeature", () => {
  it("accepts the optional alternate tags and rejects default Arabic features", () => {
    for (const t of ["salt", "aalt", "jalt", "swsh", "ss01", "ss20", "cv01", "cv99"]) {
      expect(isOptionalFeature(t)).toBe(true);
    }
    for (const t of ["init", "medi", "fina", "isol", "rlig", "calt", "liga", "ss00", "ss21", "cv00", "ss01]"]) {
      expect(isOptionalFeature(t)).toBe(false);
    }
  });
});

describe("featureStringFor", () => {
  const alt = (letter: number, char: string, feature = "ss01", value = 1): GlyphAlternate => ({
    letter,
    char,
    feature,
    value,
  });

  it("emits one ranged feature per alternate, at the letter's offset", () => {
    expect(featureStringFor("هههه", [alt(1, "ه"), alt(3, "ه", "jalt", 2)])).toBe(
      "ss01[1:2]=1,jalt[3:4]=2"
    );
  });

  it("lands on the same letter after kashida is inserted before it", () => {
    expect(featureStringFor(`ه${TATWEEL}${TATWEEL}ه`, [alt(1, "ه")])).toBe("ss01[3:4]=1");
  });

  it("drops an alternate whose character no longer matches (a typed edit shifted it)", () => {
    expect(featureStringFor("بهه", [alt(0, "ه")])).toBe("");
  });

  it("ignores a malformed tag from a hand-edited save rather than splicing it in", () => {
    expect(featureStringFor("هه", [alt(0, "ه", "ss01]=1,liga")])).toBe("");
    expect(featureStringFor("هه", [alt(0, "ه", "liga")])).toBe("");
  });

  it("ignores non-positive or non-integer values", () => {
    expect(featureStringFor("هه", [alt(0, "ه", "salt", 0)])).toBe("");
    expect(featureStringFor("هه", [alt(0, "ه", "salt", 1.5)])).toBe("");
  });

  it("can leave one letter out, for probing that letter", () => {
    expect(featureStringFor("هههه", [alt(1, "ه"), alt(2, "ه")], 1)).toBe("ss01[2:3]=1");
  });

  it("activeAlternates keeps only the valid entries", () => {
    expect(activeAlternates("هه", [alt(0, "ه"), alt(1, "ب"), alt(7, "ه")])).toEqual([alt(0, "ه")]);
  });
});

describe("alternatesKey", () => {
  it("is empty for none and differs for different choices", () => {
    expect(alternatesKey(undefined)).toBe("");
    expect(alternatesKey([])).toBe("");
    const a = alternatesKey([{ letter: 0, char: "ه", feature: "ss01", value: 1 }]);
    const b = alternatesKey([{ letter: 0, char: "ه", feature: "ss02", value: 1 }]);
    expect(a).not.toBe(b);
  });
});

describe("cycleAlternate", () => {
  const options: AlternateOption[] = [
    { choice: null, glyphId: 1, label: "Default" },
    { choice: { feature: "ss01", value: 1 }, glyphId: 2, label: "Looped Haa" },
    { choice: { feature: "jalt", value: 1 }, glyphId: 3, label: "Justification" },
  ];

  it("steps forward and wraps to the default", () => {
    expect(cycleAlternate(options, null, 1)).toEqual({ feature: "ss01", value: 1 });
    expect(cycleAlternate(options, { feature: "jalt", value: 1 }, 1)).toBeNull();
  });

  it("steps backward and wraps to the last option", () => {
    expect(cycleAlternate(options, null, -1)).toEqual({ feature: "jalt", value: 1 });
  });

  it("treats a choice the list no longer offers as the default", () => {
    expect(cycleAlternate(options, { feature: "ss09", value: 1 }, 1)).toEqual({
      feature: "ss01",
      value: 1,
    });
  });
});

describe("setAlternate / currentChoice", () => {
  it("adds, replaces and removes the one entry for a letter, sorted by letter", () => {
    let list = setAlternate(undefined, 2, "ه", { feature: "ss01", value: 1 });
    list = setAlternate(list, 0, "ه", { feature: "jalt", value: 2 });
    expect(list.map((a) => a.letter)).toEqual([0, 2]);
    list = setAlternate(list, 2, "ه", { feature: "ss02", value: 1 });
    expect(currentChoice(list, 2)).toEqual({ feature: "ss02", value: 1 });
    list = setAlternate(list, 2, "ه", null);
    expect(currentChoice(list, 2)).toBeNull();
    expect(list).toHaveLength(1);
  });
});

describe("fallbackFeatureLabel", () => {
  it("names each family of tag plainly", () => {
    expect(fallbackFeatureLabel({ feature: "ss03", value: 1 })).toBe("Style set 3");
    expect(fallbackFeatureLabel({ feature: "cv12", value: 1 })).toBe("Variant 12");
    expect(fallbackFeatureLabel({ feature: "salt", value: 2 })).toBe("Alternate 2");
    expect(fallbackFeatureLabel({ feature: "jalt", value: 1 })).toBe("Justification");
    expect(fallbackFeatureLabel({ feature: "jalt", value: 3 })).toBe("Justification 3");
    expect(fallbackFeatureLabel({ feature: "swsh", value: 1 })).toBe("Swash");
  });
});
```

- [ ] **Step 3: Run them and confirm they fail.**
Run: `npx vitest run src/lib/glyphAlternates.test.ts`
Expected: FAIL, "Failed to resolve import ./glyphAlternates".

- [ ] **Step 4: Implement** `src/lib/glyphAlternates.ts` (the probing function is added in Task 3):

```ts
import type { GlyphAlternate } from "../types";
import { ARABIC_DIACRITIC_RE } from "./diacritics";

/**
 * Next Shape: per-letter OpenType alternates. Pure — no `./harfbuzz` import,
 * whose static harfbuzzjs import throws under Vitest; shaping is injected
 * where it is needed (`probeAlternates`).
 *
 * Alternates are keyed by a **letter ordinal**: the index among the text's
 * characters skipping tatweel and combining marks. Kashida and Fit to width
 * only insert tatweel, and shaping only strips marks, so none of the three
 * moves an ordinal — no remap is owed anywhere, unlike stroke cuts. The
 * recorded `char` turns the remaining fragility (a typed edit before the
 * letter) into a drop rather than an alternate on the wrong character.
 */

export type AlternateChoice = { feature: string; value: number };

/** One shape a letter can take. `choice: null` is the default, always first. */
export type AlternateOption = {
  choice: AlternateChoice | null;
  /** The glyph drawn for the letter with this choice, for the thumbnail. */
  glyphId: number;
  label: string;
};

export type LetterAlternates = {
  letter: number;
  /** The letter's UTF-16 offset in the shaped text (its HarfBuzz cluster). */
  offset: number;
  options: AlternateOption[];
};

const TATWEEL = "ـ";

/** Tags whose lookups can hold several alternates, probed at values 1..MAX_ALTERNATE_VALUE. */
export const MULTI_VALUE_FEATURES: ReadonlySet<string> = new Set(["salt", "aalt", "jalt", "swsh"]);
export const MAX_ALTERNATE_VALUE = 4;
/** Probing reshapes the run per tag per letter; past this many letters it stops. */
export const MAX_PROBE_LETTERS = 40;

const OPTIONAL_FEATURE_RE = /^(salt|aalt|jalt|swsh|ss(0[1-9]|1[0-9]|20)|cv(0[1-9]|[1-9][0-9]))$/;

export function isOptionalFeature(tag: string): boolean {
  return OPTIONAL_FEATURE_RE.test(tag);
}

function isSkipped(text: string, i: number): boolean {
  const code = text.charCodeAt(i);
  if (code >= 0xdc00 && code <= 0xdfff) return true; // low surrogate: counted with its high half
  const ch = text[i];
  return ch === TATWEEL || ARABIC_DIACRITIC_RE.test(ch);
}

export function letterOffsets(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) if (!isSkipped(text, i)) out.push(i);
  return out;
}

export function letterAtOffset(text: string, offset: number): number {
  if (offset < 0 || offset >= text.length || isSkipped(text, offset)) return -1;
  let letter = 0;
  for (let i = 0; i < offset; i++) if (!isSkipped(text, i)) letter++;
  return letter;
}

export function charAtLetter(text: string, letter: number): string | null {
  const offset = letterOffsets(text)[letter];
  return offset === undefined ? null : text[offset];
}

const isValidValue = (v: number) => Number.isInteger(v) && v >= 1 && v <= 99;

export function activeAlternates(
  text: string,
  alternates: readonly GlyphAlternate[] | undefined
): GlyphAlternate[] {
  if (!alternates?.length) return [];
  const offsets = letterOffsets(text);
  return alternates.filter((a) => {
    const offset = offsets[a.letter];
    return (
      offset !== undefined &&
      text[offset] === a.char &&
      isOptionalFeature(a.feature) &&
      isValidValue(a.value)
    );
  });
}

export function featureStringFor(
  text: string,
  alternates: readonly GlyphAlternate[] | undefined,
  exceptLetter?: number
): string {
  const offsets = letterOffsets(text);
  return activeAlternates(text, alternates)
    .filter((a) => a.letter !== exceptLetter)
    .map((a) => {
      const o = offsets[a.letter];
      return `${a.feature}[${o}:${o + 1}]=${a.value}`;
    })
    .join(",");
}

/** A stable identity for a block's alternates, for cache keys and effect deps. */
export function alternatesKey(alternates: readonly GlyphAlternate[] | undefined): string {
  if (!alternates?.length) return "";
  return alternates.map((a) => `${a.letter}:${a.char}:${a.feature}=${a.value}`).join(",");
}

export function sameChoice(a: AlternateChoice | null, b: AlternateChoice | null): boolean {
  if (a === null || b === null) return a === b;
  return a.feature === b.feature && a.value === b.value;
}

export function currentChoice(
  alternates: readonly GlyphAlternate[] | undefined,
  letter: number
): AlternateChoice | null {
  const a = alternates?.find((x) => x.letter === letter);
  return a ? { feature: a.feature, value: a.value } : null;
}

export function cycleAlternate(
  options: readonly AlternateOption[],
  current: AlternateChoice | null,
  direction: 1 | -1
): AlternateChoice | null {
  if (options.length === 0) return null;
  const found = options.findIndex((o) => sameChoice(o.choice, current));
  const from = found < 0 ? 0 : found;
  const next = (from + direction + options.length) % options.length;
  return options[next].choice;
}

export function setAlternate(
  list: readonly GlyphAlternate[] | undefined,
  letter: number,
  char: string,
  choice: AlternateChoice | null
): GlyphAlternate[] {
  const rest = (list ?? []).filter((a) => a.letter !== letter);
  const next = choice ? [...rest, { letter, char, feature: choice.feature, value: choice.value }] : rest;
  return next.sort((a, b) => a.letter - b.letter);
}

export function fallbackFeatureLabel(choice: AlternateChoice): string {
  const { feature, value } = choice;
  if (feature.startsWith("ss")) return `Style set ${Number(feature.slice(2))}`;
  if (feature.startsWith("cv")) return `Variant ${Number(feature.slice(2))}`;
  if (feature === "jalt") return value > 1 ? `Justification ${value}` : "Justification";
  if (feature === "swsh") return value > 1 ? `Swash ${value}` : "Swash";
  return `Alternate ${value}`;
}
```

- [ ] **Step 5: Run the tests and confirm they pass.**
Run: `npx vitest run src/lib/glyphAlternates.test.ts`
Expected: all PASS.

- [ ] **Step 6: Typecheck, lint, commit.**
Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint`

```bash
git add src/types.ts src/lib/glyphAlternates.ts src/lib/glyphAlternates.test.ts
git commit -m "Next Shape: letter-ordinal alternates model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `probeAlternates`, the discovery algorithm tested against real HarfBuzz

**Files:**
- Modify: `src/lib/glyphAlternates.ts` (append)
- Create: `src/lib/glyphAlternates.probe.test.ts`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces:

```ts
export type ShapeFn = (features: string) => HarfBuzzGlyph[];
export function probeAlternates(args: {
  text: string;                       // the *shapable* text (after diacritic stripping)
  alternates: readonly GlyphAlternate[] | undefined;
  tags: readonly string[];            // the face's GSUB feature tags, duplicates allowed
  shape: ShapeFn;
  labelFor: (choice: AlternateChoice) => string;
  maxLetters?: number;                // default MAX_PROBE_LETTERS
}): LetterAlternates[];               // only letters with at least one alternate
```

- [ ] **Step 1: Write the failing tests** in `src/lib/glyphAlternates.probe.test.ts`. The harfbuzzjs loading is copied from `diacritics.test.ts`; the only difference is that `shapeWith` passes a feature string:

```ts
/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { normalizeGlyphs, type HarfBuzzGlyph } from "./normalizeGlyphs";
import {
  fallbackFeatureLabel,
  probeAlternates,
  MAX_PROBE_LETTERS,
  type LetterAlternates,
} from "./glyphAlternates";

// Loaded via `require`, not a static import — see the long note in
// diacritics.test.ts: harfbuzzjs's thenable CJS export throws under
// Vitest's ESM loader before any test code runs.
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");

type HbFace = { getTableFeatureTags: (t: string) => string[]; destroy?: () => void };
type HbModule = {
  createBlob: (data: Uint8Array) => { destroy?: () => void };
  createFace: (blob: unknown, index: number) => HbFace;
  createFont: (face: unknown) => { setScale?: (x: number, y: number) => void; destroy?: () => void };
  createBuffer: () => {
    addText: (text: string) => void;
    guessSegmentProperties?: () => void;
    setDirection?: (d: string) => void;
    setScript?: (s: string) => void;
    setLanguage?: (l: string) => void;
    json: (font?: unknown) => unknown[];
    destroy?: () => void;
  };
  shape: (font: unknown, buffer: unknown, features?: string) => void;
};

function resolveHbLoader(mod: unknown): Promise<HbModule> {
  let m: unknown = mod;
  let rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;
  if (typeof m === "function") return (m as () => Promise<HbModule>)();
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec && typeof rec.then === "function") return m as Promise<HbModule>;
  throw new Error("Unable to resolve harfbuzzjs loader in test");
}

const hbPromise = resolveHbLoader(hbjsModule);

/** A real font opened once: its GSUB tags and a shape-with-features function. */
async function openFont(fontFile: string): Promise<{ tags: string[]; shape: (text: string) => (f: string) => HarfBuzzGlyph[] }> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const bytes = fs.readFileSync(path.resolve(dir, "../../public/fonts", fontFile));
  const hb = await hbPromise;
  const face = hb.createFace(hb.createBlob(new Uint8Array(bytes)), 0);
  const font = hb.createFont(face);
  return {
    tags: face.getTableFeatureTags("GSUB"),
    shape: (text) => (features) => {
      const buffer = hb.createBuffer();
      try {
        buffer.addText(text);
        buffer.guessSegmentProperties?.();
        buffer.setDirection?.("rtl");
        buffer.setScript?.("arab");
        buffer.setLanguage?.("ar");
        hb.shape(font, buffer, features || undefined);
        return normalizeGlyphs(buffer.json(font) as never);
      } finally {
        buffer.destroy?.();
      }
    },
  };
}

async function probe(fontFile: string, text: string, maxLetters?: number): Promise<LetterAlternates[]> {
  const { tags, shape } = await openFont(fontFile);
  return probeAlternates({
    text,
    alternates: [],
    tags,
    shape: shape(text),
    labelFor: fallbackFeatureLabel,
    maxLetters,
  });
}

const featuresOf = (l: LetterAlternates | undefined) =>
  (l?.options ?? []).flatMap((o) => (o.choice ? [o.choice.feature] : []));

describe("probeAlternates (real HarfBuzz)", () => {
  it("finds Ruqaa's Looped Haa (ss01) on a medial heh, default first", async () => {
    const letters = await probe("Ruqaa.ttf", "هههه");
    const second = letters.find((l) => l.letter === 1);
    expect(second?.options[0].choice).toBeNull();
    expect(featuresOf(second)).toContain("ss01");
  });

  it("finds Ruqaa's justification alternate (jalt) on seen", async () => {
    const letters = await probe("Ruqaa.ttf", "سسس");
    expect(letters.some((l) => featuresOf(l).includes("jalt"))).toBe(true);
  });

  it("de-duplicates values that produce the same glyph (Ruqaa jalt=1 and jalt=2)", async () => {
    const letters = await probe("Ruqaa.ttf", "سسس");
    for (const l of letters) {
      const ids = l.options.map((o) => o.glyphId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("offers nothing in a font with no optional features (Thuluth)", async () => {
    expect(await probe("Thuluth.ttf", "هههه")).toEqual([]);
  });

  it("an option changes only its own letter", async () => {
    const text = "هههه";
    const { tags, shape } = await openFont("Ruqaa.ttf");
    const run = shape(text);
    const letters = probeAlternates({ text, alternates: [], tags, shape: run, labelFor: fallbackFeatureLabel });
    const target = letters.find((l) => l.letter === 1)!;
    const choice = target.options[1].choice!;
    const base = run("");
    const altered = run(`${choice.feature}[1:2]=${choice.value}`);
    for (let i = 0; i < base.length; i++) {
      if (base[i].cl === 1) continue;
      expect(altered[i].g).toBe(base[i].g);
    }
  });

  it("still finds a letter's alternates when it carries a mark", async () => {
    // Ruqaa has fatha, so it survives into the shaped text; the ordinal skips it.
    const letters = await probe("Ruqaa.ttf", "هَههه");
    expect(featuresOf(letters.find((l) => l.letter === 1))).toContain("ss01");
  });

  it("gives a letter swallowed into a ligature no options, without throwing", async () => {
    // Verified: Scheherazade shapes بلا as 931@1 311@0 — lam and alef merge
    // into one glyph at cluster 1, so the alef (letter 2, offset 2) has no
    // glyph of its own. (Amiri and Ruqaa keep two clusters; don't use them here.)
    const letters = await probe("Scheherazade.ttf", "بلا");
    const alef = letters.find((l) => l.letter === 2);
    expect(alef).toBeUndefined();
  });

  it("stops probing at the letter cap", async () => {
    const long = "ه".repeat(MAX_PROBE_LETTERS + 10);
    const letters = await probe("Ruqaa.ttf", long);
    expect(Math.max(...letters.map((l) => l.letter))).toBeLessThan(MAX_PROBE_LETTERS);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run src/lib/glyphAlternates.probe.test.ts`
Expected: FAIL, "probeAlternates is not exported".

- [ ] **Step 3: Implement.** Append to `src/lib/glyphAlternates.ts`, and add `import type { HarfBuzzGlyph } from "./normalizeGlyphs";` at the top (type-only; `normalizeGlyphs` imports nothing):

```ts
export type ShapeFn = (features: string) => HarfBuzzGlyph[];

/** The glyphs HarfBuzz emitted for one cluster, as a comparable signature. */
function clusterSignature(glyphs: HarfBuzzGlyph[], offset: number): string {
  return glyphs
    .filter((g) => (g.cl ?? -1) === offset)
    .map((g) => g.g)
    .join(",");
}

/** The cluster's widest glyph — the letter itself rather than a mark on it. */
function mainGlyph(glyphs: HarfBuzzGlyph[], offset: number): number {
  let best: HarfBuzzGlyph | null = null;
  for (const g of glyphs) {
    if ((g.cl ?? -1) !== offset) continue;
    if (!best || (g.ax ?? 0) > (best.ax ?? 0)) best = g;
  }
  return best?.g ?? 0;
}

/**
 * For each letter, reshape the run with every optional feature switched on
 * for that letter alone, and keep the results that change its glyph. Each
 * letter is probed with the *other* letters' alternates applied, so a
 * contextual alternate sees its real neighbours. Features that never touch
 * the letter fall out on their own.
 */
export function probeAlternates(args: {
  text: string;
  alternates: readonly GlyphAlternate[] | undefined;
  tags: readonly string[];
  shape: ShapeFn;
  labelFor: (choice: AlternateChoice) => string;
  maxLetters?: number;
}): LetterAlternates[] {
  const { text, alternates, shape, labelFor } = args;
  const tags = [...new Set(args.tags)].filter(isOptionalFeature);
  if (tags.length === 0) return [];

  const memo = new Map<string, HarfBuzzGlyph[]>();
  const shapeOnce = (features: string) => {
    let hit = memo.get(features);
    if (!hit) {
      hit = shape(features);
      memo.set(features, hit);
    }
    return hit;
  };

  const offsets = letterOffsets(text).slice(0, args.maxLetters ?? MAX_PROBE_LETTERS);
  const out: LetterAlternates[] = [];

  offsets.forEach((offset, letter) => {
    const base = featureStringFor(text, alternates, letter);
    const baseGlyphs = shapeOnce(base);
    const baseSig = clusterSignature(baseGlyphs, offset);
    if (baseSig === "") return; // consumed into another letter's ligature

    const options: AlternateOption[] = [
      { choice: null, glyphId: mainGlyph(baseGlyphs, offset), label: "Default" },
    ];
    const seen = new Set([baseSig]);

    for (const feature of tags) {
      const maxValue = MULTI_VALUE_FEATURES.has(feature) ? MAX_ALTERNATE_VALUE : 1;
      for (let value = 1; value <= maxValue; value++) {
        const probe = `${feature}[${offset}:${offset + 1}]=${value}`;
        const glyphs = shapeOnce(base ? `${base},${probe}` : probe);
        const sig = clusterSignature(glyphs, offset);
        if (sig === "" || seen.has(sig)) continue;
        seen.add(sig);
        const choice = { feature, value };
        options.push({ choice, glyphId: mainGlyph(glyphs, offset), label: labelFor(choice) });
      }
    }

    if (options.length > 1) out.push({ letter, offset, options });
  });

  return out;
}
```

- [ ] **Step 4: Run the tests and confirm they pass.**
Run: `npx vitest run src/lib/glyphAlternates.probe.test.ts src/lib/glyphAlternates.test.ts`
Expected: all PASS. If "an option changes only its own letter" fails because the glyph count differs, the chosen option is a ligature-forming alternate. Pick `target.options.find(o => o.choice?.feature === "ss01")` instead of `options[1]`; Ruqaa `ss01` on `هههه` was verified to change only cluster 1.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/glyphAlternates.ts src/lib/glyphAlternates.probe.test.ts
git commit -m "Next Shape: discover alternates by probing HarfBuzz

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Read the fonts' own names for stylistic sets: `fontFeatureNames.ts`

**Files:**
- Create: `src/lib/fontFeatureNames.ts`
- Create: `src/lib/fontFeatureNames.test.ts`

**Interfaces:**
- Produces: `readFeatureNames(bytes: ArrayBuffer): Map<string, string>`, mapping tag → UI name for `ssNN`/`cvNN` features whose FeatureParams carry a name ID. It never throws; bad input gives an empty map.

- [ ] **Step 1: Write the failing tests:**

```ts
/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { readFeatureNames } from "./fontFeatureNames";

function fontBytes(file: string): ArrayBuffer {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const b = fs.readFileSync(path.resolve(dir, "../../public/fonts", file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

describe("readFeatureNames", () => {
  it("reads Ruqaa's stylistic-set names", () => {
    const names = readFeatureNames(fontBytes("Ruqaa.ttf"));
    expect(names.get("ss01")).toBe("Looped Haa");
    expect(names.get("ss03")).toBe("Tailed Noon");
    expect(names.get("ss08")).toBe("Alternate Sukun");
  });

  it("reads Amiri's", () => {
    expect(readFeatureNames(fontBytes("Amiri.ttf")).get("ss04")).toBe(
      "Alternate, more naskh-like, Gaf form"
    );
  });

  it("is empty for a font without named sets", () => {
    expect(readFeatureNames(fontBytes("Thuluth.ttf")).size).toBe(0);
  });

  it("never throws on garbage", () => {
    expect(readFeatureNames(new ArrayBuffer(3)).size).toBe(0);
    expect(readFeatureNames(new Uint8Array(64).fill(255).buffer).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run src/lib/fontFeatureNames.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Implement** `src/lib/fontFeatureNames.ts`:

```ts
/**
 * The names a font gives its stylistic sets and character variants
 * ("Looped Haa"), read straight from the binary. opentype.js exposes
 * `featureParams` only as a bare offset and resolves no name IDs for it, so
 * this walks GSUB → FeatureList → Feature → FeatureParams (whose second
 * uint16 is the UI name ID for both `ssNN` and `cvNN`) and looks the ID up in
 * `name`. Pure and defensive: any out-of-range read yields an empty map.
 */
export function readFeatureNames(bytes: ArrayBuffer): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const v = new DataView(bytes);
    const tag = (o: number) =>
      String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

    const numTables = v.getUint16(4);
    const tables = new Map<string, number>();
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      tables.set(tag(rec), v.getUint32(rec + 8));
    }
    const gsub = tables.get("GSUB");
    const name = tables.get("name");
    if (gsub === undefined || name === undefined) return out;

    const nameIds = new Map<string, number>();
    const featureList = gsub + v.getUint16(gsub + 6);
    const featureCount = v.getUint16(featureList);
    for (let i = 0; i < featureCount; i++) {
      const rec = featureList + 2 + i * 6;
      const t = tag(rec);
      if (!/^(ss|cv)\d\d$/.test(t) || nameIds.has(t)) continue;
      const feature = featureList + v.getUint16(rec + 4);
      const paramsOffset = v.getUint16(feature);
      if (paramsOffset === 0) continue;
      const id = v.getUint16(feature + paramsOffset + 2);
      if (id >= 256) nameIds.set(t, id);
    }
    if (nameIds.size === 0) return out;

    const strings = readNameStrings(v, name);
    for (const [t, id] of nameIds) {
      const s = strings.get(id);
      if (s) out.set(t, s);
    }
  } catch {
    return new Map();
  }
  return out;
}

/** name ID → string, preferring Windows English, then any Windows, then Mac Roman. */
function readNameStrings(v: DataView, table: number): Map<number, string> {
  const count = v.getUint16(table + 2);
  const storage = table + v.getUint16(table + 4);
  const best = new Map<number, { rank: number; text: string }>();

  for (let i = 0; i < count; i++) {
    const rec = table + 6 + i * 12;
    const platform = v.getUint16(rec);
    const language = v.getUint16(rec + 4);
    const nameId = v.getUint16(rec + 6);
    const length = v.getUint16(rec + 8);
    const start = storage + v.getUint16(rec + 10);

    let text = "";
    let rank: number;
    if (platform === 3 || platform === 0) {
      for (let j = 0; j + 1 < length; j += 2) text += String.fromCharCode(v.getUint16(start + j));
      rank = platform === 3 && language === 0x0409 ? 0 : 1;
    } else if (platform === 1) {
      for (let j = 0; j < length; j++) text += String.fromCharCode(v.getUint8(start + j));
      rank = 2;
    } else {
      continue;
    }
    const held = best.get(nameId);
    if (!held || rank < held.rank) best.set(nameId, { rank, text });
  }

  return new Map([...best].map(([id, { text }]) => [id, text]));
}
```

- [ ] **Step 4: Run the tests and confirm they pass.**
Run: `npx vitest run src/lib/fontFeatureNames.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/fontFeatureNames.ts src/lib/fontFeatureNames.test.ts
git commit -m "Next Shape: read stylistic-set names from the font

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Alternates reach shaping, rendering, mirrors and Fit to width

**Files:**
- Modify: `src/lib/harfbuzz.ts`
- Modify: `src/hooks/useShapedGlyphs.ts`
- Modify: `src/lib/measureShapedText.ts`
- Create: `src/hooks/useGlyphAlternates.ts`
- Modify: `src/lib/blockCapabilities.ts`, `src/lib/blockRenderProps.ts`
- Modify: `src/components/ShapedText.tsx` (prop plus `useShapedGlyphs` argument only; the overlay is Task 6)
- Modify: `src/App.tsx` (Fit to width measure call only)

**Interfaces:**
- Consumes: `featureStringFor`, `alternatesKey`, `probeAlternates`, `fallbackFeatureLabel`, `LetterAlternates` (Tasks 2–3); `readFeatureNames` (Task 4).
- Produces:
  - `shapeText(text: string, fontUrl: string, alternates?: readonly GlyphAlternate[]): Promise<ShapedTextResult>`
  - `findAlternates(text: string, fontUrl: string, alternates?: readonly GlyphAlternate[]): Promise<AlternatesResult>`, where `AlternatesResult = { letters: LetterAlternates[]; fontHasAlternates: boolean; font: opentype.Font; unitsPerEm: number }`
  - `useShapedGlyphs(text, fontFamily, alternates?)`
  - `measureShapedWidth(text, fontUrl, fontSize, style?, alternates?)` and `measureShapedRun(text, fontUrl, fontSize, style?, alternates?)`
  - `useGlyphAlternates(text: string, fontFamily: string, alternates: GlyphAlternate[] | undefined, armed: boolean): GlyphAlternatesState`, where `GlyphAlternatesState = { letters: LetterAlternates[]; fontHasAlternates: boolean; font: opentype.Font | null; unitsPerEm: number; loading: boolean }`
  - `supportsGlyphAlternates(b: Block): b is Extract<Block, { type: "text" }>`
  - `ShapedText` prop `glyphAlternates?: GlyphAlternate[]`; `shapedTextProps` now includes `glyphAlternates`.

- [ ] **Step 1: Restructure the shape cache per font in `harfbuzz.ts`.** A suffix-matched string key can't carry an alternates component without breaking `clearShapeCache(fontUrl)`. Replace `const shapeCache = new Map<string, ShapedTextResult>();` with:

```ts
/** fontUrl → (text|alternatesKey → result). Per-font so a font swap clears exactly its own entries. */
const shapeCache = new Map<string, Map<string, ShapedTextResult>>();
const alternatesCache = new Map<string, Map<string, AlternatesResult>>();

function cacheFor<T>(root: Map<string, Map<string, T>>, fontUrl: string): Map<string, T> {
  let inner = root.get(fontUrl);
  if (!inner) {
    inner = new Map();
    root.set(fontUrl, inner);
  }
  return inner;
}
```

and in `clearShapeCache`, replace the `for (const key of shapeCache.keys())` loop with `shapeCache.delete(fontUrl); alternatesCache.delete(fontUrl);`, and the `else` branch's `shapeCache.clear();` with `shapeCache.clear(); alternatesCache.clear();`.

- [ ] **Step 2: Extract buffer shaping and add features.** Add to `HbFace`: `getTableFeatureTags?: (table: string) => string[];`. Add the imports:

```ts
import type { GlyphAlternate } from "../types";
import {
  alternatesKey,
  fallbackFeatureLabel,
  featureStringFor,
  probeAlternates,
  type LetterAlternates,
} from "./glyphAlternates";
import { readFeatureNames } from "./fontFeatureNames";

export type AlternatesResult = {
  letters: LetterAlternates[];
  /** Whether the font has any optional alternate feature at all. */
  fontHasAlternates: boolean;
  font: opentype.Font;
  unitsPerEm: number;
};
```

Add this helper above `shapeText`, then use it in `shapeText` in place of the inline `buffer.addText` … `hb.shape(font, buffer)` … `buffer.json` sequence. Keep the `DEBUG_HB` logging; pass `usingFeatures: features !== ""` and `features`.

```ts
/** One shaping pass on an already-open font; owns and frees its buffer. */
function shapeOnFont(hb: HbModule, font: HbFont, text: string, features: string): HarfBuzzGlyph[] {
  const buffer = hb.createBuffer();
  try {
    buffer.addText(text);
    buffer.guessSegmentProperties?.();
    buffer.setDirection?.("rtl");
    buffer.setScript?.("arab");
    buffer.setLanguage?.("ar");
    hb.shape(font, buffer, features || undefined);
    let raw: HbRawGlyph[] = [];
    if (typeof buffer.json === "function") {
      try {
        raw = buffer.json(font);
      } catch {
        raw = buffer.json();
      }
    }
    return normalizeGlyphs(raw);
  } finally {
    buffer.destroy?.();
  }
}
```

Change the `shapeText` signature and cache lookups:

```ts
export async function shapeText(
  text: string,
  fontUrl: string,
  alternates?: readonly GlyphAlternate[]
): Promise<ShapedTextResult> {
  const cache = cacheFor(shapeCache, fontUrl);
  const cacheKey = `${text}|${alternatesKey(alternates)}`;
  // … existing body, with `shapeCache.get/has/set(cacheKey…)` → `cache.get/has/set(cacheKey…)`
```

Build the feature string after `shapableText` is known. Clusters index the shapable text, and the ordinal skips marks, so stripping can't shift a letter:

```ts
  const features = featureStringFor(shapableText, alternates);
```

The `try` block then becomes `if (typeof font.setScale === "function") font.setScale(upm, upm); const glyphs = shapeOnFont(hb, font, shapableText, features);`. The existing `buffer` variable and its `destroy` in `finally` go away. Leave the debug `raw` argument as the string `"(raw unavailable)"`.

- [ ] **Step 3: Add `findAlternates` to `harfbuzz.ts`:**

```ts
/**
 * Next Shape's discovery: every letter's alternate shapes in this font, with
 * the other letters' current alternates applied. Opens the font once for the
 * whole probe (dozens to hundreds of shaping passes on a short run).
 */
export async function findAlternates(
  text: string,
  fontUrl: string,
  alternates?: readonly GlyphAlternate[]
): Promise<AlternatesResult> {
  const cache = cacheFor(alternatesCache, fontUrl);
  const cacheKey = `${text}|${alternatesKey(alternates)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const [hb, fontData, parsedFont] = await Promise.all([
    initHarfBuzz(),
    loadFontData(fontUrl),
    loadParsedFont(fontUrl),
  ]);
  const upm = parsedFont.unitsPerEm || 1000;
  const shapableText = stripUnsupportedDiacritics(text, parsedFont);

  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  try {
    font.setScale?.(upm, upm);
    const tags = face.getTableFeatureTags?.("GSUB") ?? [];
    const names = readFeatureNames(fontData);
    const letters =
      shapableText.length === 0
        ? []
        : probeAlternates({
            text: shapableText,
            alternates,
            tags,
            shape: (features) => shapeOnFont(hb, font, shapableText, features),
            labelFor: (c) => names.get(c.feature) ?? fallbackFeatureLabel(c),
          });
    const result: AlternatesResult = {
      letters,
      fontHasAlternates: tags.some(isOptionalFeature),
      font: parsedFont,
      unitsPerEm: upm,
    };
    cache.set(cacheKey, result);
    return result;
  } finally {
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}
```

(Add `isOptionalFeature` to the `./glyphAlternates` import.)

- [ ] **Step 4: Thread alternates through `useShapedGlyphs` and measurement.** In `src/hooks/useShapedGlyphs.ts`, change the signature to `useShapedGlyphs(text: string, fontFamily: string, alternates?: readonly GlyphAlternate[])`. Compute `const altKey = alternatesKey(alternates);`, call `shapeText(text || "", fontUrl, alternates)`, and add `altKey` to that effect's dependency array. If the lint rule objects to `alternates` being absent from the deps, keep a `useRef` of the latest `alternates` and read it inside the effect, since `altKey` is its identity. In `src/lib/measureShapedText.ts`, add a trailing `alternates?: readonly GlyphAlternate[]` parameter to both functions and pass it to `shapeText`.

- [ ] **Step 5: Capability, render props, renderer.** In `src/lib/blockCapabilities.ts`, after `supportsStrokeCuts`:

```ts
/**
 * Plain text blocks only: only `ShapedText` shapes with a block's
 * `glyphAlternates` and mounts the Next Shape overlay. Shape Fill and
 * text-on-path are deferred (see the Next Shape spec).
 */
export const supportsGlyphAlternates = (
  b: Block
): b is Extract<Block, { type: "text" }> => b.type === "text";
```

In `shapedTextProps` (`src/lib/blockRenderProps.ts`), add `glyphAlternates: b.glyphAlternates,` after `strokeCuts`. In `ShapedText.tsx`, add the prop `glyphAlternates?: GlyphAlternate[];` (import the type from `../types`), destructure it with a stable default `const NO_GLYPH_ALTERNATES: GlyphAlternate[] = [];` next to `NO_STROKE_CUTS`, and change the shaping call to `useShapedGlyphs(text, fontFamily, glyphAlternates)`. `MirrorBlockView` spreads `shapedTextProps(source)`, so mirrors pick this up with no edit.

- [ ] **Step 6: Fit to width measures the alternates.** In `src/App.tsx`'s `fitSelectedBlockToWidth`, change the measure call to:

```ts
            measureShapedWidth(candidate, fontUrl, fontSize, runStyle, selectedBlock.glyphAlternates),
```

(Candidates only insert tatweel, which doesn't move letter ordinals, so the block's alternates apply to every candidate unchanged.) Leave the name-design `measureShapedRun` call alone: it measures the text restyled in a *different* font, where these alternates don't apply.

- [ ] **Step 7: The discovery hook.** Create `src/hooks/useGlyphAlternates.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import type * as opentype from "opentype.js";
import { findAlternates } from "../lib/harfbuzz";
import { alternatesKey, type LetterAlternates } from "../lib/glyphAlternates";
import type { GlyphAlternate } from "../types";
import { resolveFontUrl } from "./useShapedGlyphs";

export type GlyphAlternatesState = {
  letters: LetterAlternates[];
  fontHasAlternates: boolean;
  font: opentype.Font | null;
  unitsPerEm: number;
  loading: boolean;
};

const IDLE: GlyphAlternatesState = {
  letters: [],
  fontHasAlternates: false,
  font: null,
  unitsPerEm: 1000,
  loading: false,
};

/**
 * Every letter's alternate shapes for the block being edited. Runs only while
 * the tool is armed — probing reshapes the run per feature per letter. State
 * is set only from the resolved promise; "loading" is derived by comparing
 * the settled key with the current one, so no synchronous setState runs in
 * the effect.
 */
export function useGlyphAlternates(
  text: string,
  fontFamily: string,
  alternates: GlyphAlternate[] | undefined,
  armed: boolean
): GlyphAlternatesState {
  const fontUrl = resolveFontUrl(fontFamily);
  const key = `${fontUrl}|${text}|${alternatesKey(alternates)}`;
  const latest = useRef(alternates);
  latest.current = alternates;
  const [settled, setSettled] = useState<{ key: string; value: GlyphAlternatesState } | null>(null);

  useEffect(() => {
    if (!armed) return;
    let alive = true;
    findAlternates(text, fontUrl, latest.current)
      .then((r) => {
        if (!alive) return;
        setSettled({
          key,
          value: {
            letters: r.letters,
            fontHasAlternates: r.fontHasAlternates,
            font: r.font,
            unitsPerEm: r.unitsPerEm,
            loading: false,
          },
        });
      })
      .catch(() => {
        if (alive) setSettled({ key, value: IDLE });
      });
    return () => {
      alive = false;
    };
  }, [armed, key, text, fontUrl]);

  if (!armed) return IDLE;
  if (settled?.key !== key) return { ...(settled?.value ?? IDLE), loading: true };
  return settled.value;
}
```

- [ ] **Step 8: Verify.**
Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: clean, all tests pass (nothing writes `glyphAlternates` yet, so rendering is unchanged).

- [ ] **Step 9: Commit.**

```bash
git add src/lib/harfbuzz.ts src/hooks/useShapedGlyphs.ts src/hooks/useGlyphAlternates.ts src/lib/measureShapedText.ts src/lib/blockCapabilities.ts src/lib/blockRenderProps.ts src/components/ShapedText.tsx src/App.tsx
git commit -m "Next Shape: shape and measure with per-letter alternates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Canvas tool, App handlers and the overlay

**Files:**
- Create: `src/components/AlternateHoverHandles.tsx`
- Modify: `src/components/ShapedText.tsx`, `src/components/CanvasStage.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `useGlyphAlternates`, `supportsGlyphAlternates` (Task 5); `cycleAlternate`, `currentChoice`, `setAlternate`, `charAtLetter`, `letterAtOffset`, `alternatesKey`, `AlternateChoice`, `LetterAlternates` (Task 2).
- Produces:
  - App: `pickGlyphAlternate(blockId: number, letter: number, choice: AlternateChoice | null): void`, `toggleGlyphAlternateMode(blockId: number): void`, `resetGlyphAlternates(blockId: number): void`, state `alternateTarget: { blockId: number; letter: number } | null`, and `glyphAlternatesState: GlyphAlternatesState`.
  - CanvasStage props: `alternateLetters: LetterAlternates[]` and `onPickGlyphAlternate: (blockId: number, letter: number, choice: AlternateChoice | null) => void`.
  - ShapedText props: `glyphAlternateMode?: boolean`, `alternateLetters?: LetterAlternates[]`, `onPickAlternate?: (letter: number, choice: AlternateChoice | null) => void`.
  - Konva node names: `alternate-hit` (one per letter with options) and `alternate-outline` (drawn while hovered). The e2e spec relies on both.

- [ ] **Step 1: The overlay.** Create `src/components/AlternateHoverHandles.tsx`:

```tsx
import React, { useState } from "react";
import { Group, Rect } from "react-konva";
import type { GlyphAlternate } from "../types";
import {
  currentChoice,
  cycleAlternate,
  type AlternateChoice,
  type AlternateOption,
} from "../lib/glyphAlternates";

export type AlternateTarget = {
  key: string;
  letter: number;
  /** The letter's ink box in the run's local space. */
  box: { x: number; y: number; width: number; height: number };
  options: AlternateOption[];
};

type Props = {
  isSelected: boolean;
  enabled: boolean;
  targets: AlternateTarget[];
  alternates: GlyphAlternate[];
  offsetX: number;
  offsetY: number;
  onPick?: (letter: number, choice: AlternateChoice | null) => void;
};

const OUTLINE_COLOR = "#a855f7";
const PAD = 3;

/**
 * Next Shape on the canvas: a letter that has alternate shapes outlines on
 * hover; click steps to the next shape, Shift-click to the previous.
 *
 * Mounted before the stroke-stretch and diacritic overlays: these rects are
 * letter-sized and Konva routes to the topmost listening shape, so the
 * smaller targets must sit above them. Hover handlers live on the per-letter
 * `Group`, never on the `Rect` — the sibling-hover race recorded in
 * e2e-tests.md.
 */
export const AlternateHoverHandles: React.FC<Props> = ({
  isSelected,
  enabled,
  targets,
  alternates,
  offsetX,
  offsetY,
  onPick,
}) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  if (!isSelected || !enabled) return null;

  return (
    <Group>
      {targets.map((t) => {
        const x = t.box.x + offsetX - PAD;
        const y = t.box.y + offsetY - PAD;
        const width = t.box.width + PAD * 2;
        const height = t.box.height + PAD * 2;
        const pick = (shift: boolean) =>
          onPick?.(
            t.letter,
            cycleAlternate(t.options, currentChoice(alternates, t.letter), shift ? -1 : 1)
          );
        return (
          <Group
            key={t.key}
            onMouseEnter={() => setHoveredKey(t.key)}
            onMouseLeave={() => setHoveredKey((v) => (v === t.key ? null : v))}
          >
            <Rect
              name="alternate-hit"
              x={x}
              y={y}
              width={width}
              height={height}
              fill="transparent"
              onClick={(e) => {
                e.cancelBubble = true;
                pick(e.evt.shiftKey);
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                pick(false);
              }}
            />
            {hoveredKey === t.key && (
              <Rect
                name="alternate-outline"
                x={x}
                y={y}
                width={width}
                height={height}
                stroke={OUTLINE_COLOR}
                strokeWidth={1.5}
                dash={[4, 3]}
                cornerRadius={3}
                listening={false}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
};
```

- [ ] **Step 2: Mount it in `ShapedText.tsx`.** Add the props from Interfaces, with defaults `glyphAlternateMode = false`, `alternateLetters = NO_ALTERNATE_LETTERS` (a module-level `const NO_ALTERNATE_LETTERS: LetterAlternates[] = [];`) and `onPickAlternate`. Build the targets after `diacriticPlacements`:

```tsx
  // One target per letter that has alternates, its box the union of every
  // glyph in that letter's cluster (a letter and the marks on it).
  const alternateTargets = useMemo<AlternateTarget[]>(() => {
    if (!glyphAlternateMode || alternateLetters.length === 0) return [];
    const byLetter = new Map(alternateLetters.map((l) => [l.letter, l]));
    const boxes = new Map<number, { x1: number; y1: number; x2: number; y2: number }>();
    for (const b of glyphHitBoxes) {
      const g = shapeData.glyphs[b.glyphIndex];
      const letter = letterAtOffset(shapeData.shapableText, g?.cl ?? -1);
      if (!byLetter.has(letter)) continue;
      const held = boxes.get(letter);
      boxes.set(letter, {
        x1: Math.min(held?.x1 ?? Infinity, b.x),
        y1: Math.min(held?.y1 ?? Infinity, b.y),
        x2: Math.max(held?.x2 ?? -Infinity, b.x + b.width),
        y2: Math.max(held?.y2 ?? -Infinity, b.y + b.height),
      });
    }
    return [...boxes].map(([letter, r]) => ({
      key: String(letter),
      letter,
      box: { x: r.x1, y: r.y1, width: r.x2 - r.x1, height: r.y2 - r.y1 },
      options: byLetter.get(letter)!.options,
    }));
  }, [glyphAlternateMode, alternateLetters, glyphHitBoxes, shapeData.glyphs, shapeData.shapableText]);
```

Mount it immediately **before** `<StrokeCutHoverHandles`, and update the comment above `StrokeCutHoverHandles` so the order reads alternates → stroke rail → mark:

```tsx
      <AlternateHoverHandles
        isSelected={isSelected}
        enabled={glyphAlternateMode}
        targets={alternateTargets}
        alternates={glyphAlternates}
        offsetX={bx + localDrawX}
        offsetY={by + localDrawY}
        onPick={onPickAlternate}
      />
```

Imports: `AlternateHoverHandles` and `type AlternateTarget` from `./AlternateHoverHandles`; `letterAtOffset`, `type AlternateChoice` and `type LetterAlternates` from `../lib/glyphAlternates`.

- [ ] **Step 3: CanvasStage wiring.** Add to `CanvasStageProps`:

```ts
  /** Next Shape: the selected text block's letters that have alternates. */
  alternateLetters: LetterAlternates[];
  onPickGlyphAlternate: (blockId: number, letter: number, choice: AlternateChoice | null) => void;
```

Destructure both. In the text branch's `<ShapedText …>`, add:

```tsx
                    glyphAlternateMode={block.glyphAlternateMode ?? false}
                    alternateLetters={block.id === selectedId ? alternateLetters : NO_ALTERNATE_LETTERS}
                    onPickAlternate={(letter, choice) => onPickGlyphAlternate(block.id, letter, choice)}
```

with a module-level `const NO_ALTERNATE_LETTERS: LetterAlternates[] = [];` (a stable identity, so unselected blocks' memos don't re-run).

- [ ] **Step 4: App handlers and state.** In `src/App.tsx`, import `supportsGlyphAlternates`, `useGlyphAlternates`, and `{ alternatesKey, charAtLetter, setAlternate, type AlternateChoice }` from `./lib/glyphAlternates`. Right after the `selectedBlock` `useMemo` (line ~522):

```ts
  // Next Shape: discovery runs only for the selected text block, and only
  // while its tool is armed. The last letter clicked is UI state, not
  // document state — it is neither saved nor undoable.
  const alternateBlock =
    selectedBlock && supportsGlyphAlternates(selectedBlock) && selectedBlock.glyphAlternateMode
      ? selectedBlock
      : null;
  const glyphAlternatesState = useGlyphAlternates(
    alternateBlock?.text ?? "",
    alternateBlock?.fontFamily ?? "",
    alternateBlock?.glyphAlternates,
    alternateBlock !== null
  );
  const [alternateTarget, setAlternateTarget] = useState<{ blockId: number; letter: number } | null>(null);
```

After `clearStrokeCuts` (so after `pushHistory` exists):

```ts
  /** One discrete undo step per pick — no debounce, it is not a drag. */
  const pickGlyphAlternate = useCallback(
    (blockId: number, letter: number, choice: AlternateChoice | null) => {
      setAlternateTarget({ blockId, letter });
      const block = blocks.find((b) => b.id === blockId);
      if (!block || !supportsGlyphAlternates(block)) return;
      const char = charAtLetter(block.text, letter);
      if (char === null) return;
      const next = setAlternate(block.glyphAlternates, letter, char, choice);
      if (alternatesKey(next) === alternatesKey(block.glyphAlternates)) return;
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsGlyphAlternates(b) ? { ...b, glyphAlternates: next } : b
        )
      );
    },
    [blocks, pushHistory]
  );

  const toggleGlyphAlternateMode = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsGlyphAlternates(b)
            ? { ...b, glyphAlternateMode: !b.glyphAlternateMode }
            : b
        )
      );
    },
    [pushHistory]
  );

  const resetGlyphAlternates = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsGlyphAlternates(b) ? { ...b, glyphAlternates: [] } : b
        )
      );
    },
    [pushHistory]
  );
```

On `<CanvasStage …>`, add `alternateLetters={glyphAlternatesState.letters}` and `onPickGlyphAlternate={pickGlyphAlternate}`. (The Sidebar props come in Task 7; if lint flags `toggleGlyphAlternateMode`/`resetGlyphAlternates`/`alternateTarget` as unused, do Task 7's Step 1 Sidebar prop wiring in this task.)

- [ ] **Step 5: Verify.**
Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: clean, all pass.

- [ ] **Step 6: Commit.**

```bash
git add src/components/AlternateHoverHandles.tsx src/components/ShapedText.tsx src/components/CanvasStage.tsx src/App.tsx
git commit -m "Next Shape: click a letter to cycle its shapes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Sidebar section and thumbnail strip, plus the e2e spec

**Files:**
- Create: `src/components/sidebar/AlternateStrip.tsx`
- Modify: `src/components/Sidebar.tsx`, `src/App.tsx`
- Create: `e2e/glyph-alternates.spec.ts`

**Interfaces:**
- Consumes: `GlyphAlternatesState` (Task 5); the App handlers and `alternateTarget` (Task 6); node names `alternate-hit` and `alternate-outline` (Task 6).
- Produces: Sidebar props `glyphAlternatesState?: GlyphAlternatesState`, `alternateTarget?: { blockId: number; letter: number } | null`, `onToggleGlyphAlternateMode?: (blockId: number) => void`, `onResetGlyphAlternates?: (blockId: number) => void`, `onPickGlyphAlternate?: (blockId: number, letter: number, choice: AlternateChoice | null) => void`. Accessible names: checkbox "Alternate letter shapes", button "Reset letter shapes", and strip buttons named by their option label.

- [ ] **Step 1: Write the failing e2e spec** `e2e/glyph-alternates.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import {
  centerOf,
  chooseFont,
  getBlocks,
  gotoApp,
  inkPixels,
  namedNodeCount,
  nodeClientBox,
  setBlockText,
  settleFrames,
} from "./harf";

/** Arms Next Shape on the starter block and waits for a clickable letter. */
async function armAlternates(page: Page, font: string, text: string) {
  await setBlockText(page, text);
  await chooseFont(page, font);
  await page.getByLabel("Alternate letter shapes").check();
}

test("clicking a letter steps to an alternate shape, and undo restores it", async ({ page }) => {
  await gotoApp(page);
  await armAlternates(page, "Ruqaa", "هههه");

  await expect.poll(() => namedNodeCount(page, "alternate-hit")).toBeGreaterThan(0);
  await settleFrames(page);
  const box = (await nodeClientBox(page, ".alternate-hit"))!;
  const inkBefore = await inkPixels(page, box);

  const at = centerOf(box);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);

  await expect.poll(async () => ((await getBlocks(page))[0].glyphAlternates ?? []).length).toBe(1);
  await expect.poll(() => inkPixels(page, box)).not.toBe(inkBefore);

  // The sidebar strip now shows that letter's options, the current one pressed.
  await expect(page.locator('[data-alternate-strip] button[aria-pressed="true"]')).toHaveCount(1);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => ((await getBlocks(page))[0].glyphAlternates ?? []).length).toBe(0);
});

test("a font with no alternates says so", async ({ page }) => {
  await gotoApp(page);
  await armAlternates(page, "Thuluth", "هههه");
  await expect(page.getByText("No alternate shapes in this font")).toBeVisible();
  expect(await namedNodeCount(page, "alternate-hit")).toBe(0);
});

test("the hover outline stays mounted while the pointer sits on a letter", async ({ page }) => {
  await gotoApp(page);
  await armAlternates(page, "Ruqaa", "هههه");
  await expect.poll(() => namedNodeCount(page, "alternate-hit")).toBeGreaterThan(0);
  await settleFrames(page);
  const at = centerOf((await nodeClientBox(page, ".alternate-hit"))!);

  for (let i = 0; i < 8; i++) {
    await page.mouse.move(at.x + (i % 2 === 0 ? 0.5 : -0.5), at.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "alternate-outline"), `outline vanished on move ${i}`).toBe(1);
  }
});
```

Before relying on them, check that `nodeClientBox(page, ".alternate-hit")` and `namedNodeCount(page, "alternate-hit")` take a Konva selector and a bare name respectively (`e2e/harf.ts` lines ~69 and ~294); adjust the argument shapes to match.

- [ ] **Step 2: Run it and confirm it fails.**
Run: `npx playwright test e2e/glyph-alternates.spec.ts`
Expected: FAIL, no "Alternate letter shapes" checkbox.

- [ ] **Step 3: The strip.** Create `src/components/sidebar/AlternateStrip.tsx`:

```tsx
import type * as opentype from "opentype.js";
import { sameChoice, type AlternateChoice, type AlternateOption } from "../../lib/glyphAlternates";

type Props = {
  font: opentype.Font;
  unitsPerEm: number;
  options: AlternateOption[];
  current: AlternateChoice | null;
  onPick: (choice: AlternateChoice | null) => void;
};

/** One thumbnail per shape the selected letter can take, default first. */
export function AlternateStrip({ font, unitsPerEm, options, current, onPick }: Props) {
  return (
    <div
      data-alternate-strip
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))", gap: 6, marginTop: 8 }}
    >
      {options.map((o) => {
        const path = font.glyphs.get(o.glyphId)?.getPath(0, 0, unitsPerEm);
        const bb = path?.getBoundingBox();
        const pad = unitsPerEm * 0.08;
        const viewBox =
          bb && isFinite(bb.x1)
            ? `${bb.x1 - pad} ${bb.y1 - pad} ${bb.x2 - bb.x1 + pad * 2} ${bb.y2 - bb.y1 + pad * 2}`
            : `0 0 ${unitsPerEm} ${unitsPerEm}`;
        const pressed = sameChoice(o.choice, current);
        return (
          <button
            key={o.choice ? `${o.choice.feature}=${o.choice.value}` : "default"}
            type="button"
            aria-label={o.label}
            aria-pressed={pressed}
            title={o.label}
            onClick={() => onPick(o.choice)}
            className="sidebarSmallAction"
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              padding: 4,
              background: pressed ? "var(--accent-soft, var(--bg-input))" : "var(--bg-input)",
              outline: pressed ? "2px solid var(--accent)" : undefined,
            }}
          >
            <svg viewBox={viewBox} width="100%" height={36} aria-hidden="true">
              <path d={path?.toPathData(2) ?? ""} fill="currentColor" />
            </svg>
            <span style={{ fontSize: 10, lineHeight: 1.1, textAlign: "center", overflowWrap: "anywhere" }}>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: The Sidebar section.** Add the props listed under Interfaces to Sidebar's props type and destructuring. Import `supportsGlyphAlternates`, `currentChoice`, `type AlternateChoice`, `type GlyphAlternatesState` and `AlternateStrip`. Insert this immediately **before** the `Stretch strokes` section's `{/* Plain text only: …` comment:

```tsx
                {supportsGlyphAlternates(selectedBlock) && (
                  <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
                    <div className="sidebarSectionTitle">Letter shapes</div>

                    <CheckboxRow
                      id={makeId("glyph-alternate-mode", selectedId)}
                      label="Alternate letter shapes"
                      checked={!!selectedBlock.glyphAlternateMode}
                      onChange={() => onToggleGlyphAlternateMode?.(selectedBlock.id)}
                    />

                    {selectedBlock.glyphAlternateMode && (() => {
                      const state = glyphAlternatesState;
                      const letter =
                        alternateTarget?.blockId === selectedBlock.id ? alternateTarget.letter : null;
                      const target = state?.letters.find((l) => l.letter === letter);
                      const note = (text: string) => (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{text}</div>
                      );
                      if (!state || state.loading) return note("Looking for alternate shapes…");
                      if (!state.fontHasAlternates) return note("No alternate shapes in this font");
                      if (letter === null)
                        return note(
                          "Click an outlined letter to step through its shapes; Shift-click goes back."
                        );
                      if (!target || !state.font) return note("This letter has no alternates");
                      return (
                        <>
                          <AlternateStrip
                            font={state.font}
                            unitsPerEm={state.unitsPerEm}
                            options={target.options}
                            current={currentChoice(selectedBlock.glyphAlternates, target.letter)}
                            onPick={(choice: AlternateChoice | null) =>
                              onPickGlyphAlternate?.(selectedBlock.id, target.letter, choice)
                            }
                          />
                          {note("Changing a letter's shape removes any stroke stretch on it.")}
                        </>
                      );
                    })()}

                    {(selectedBlock.glyphAlternates?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => onResetGlyphAlternates?.(selectedBlock.id)}
                        className="sidebarSmallAction"
                        style={{ background: "var(--bg-input)", marginTop: 8 }}
                      >
                        Reset letter shapes
                      </button>
                    )}
                  </div>
                )}
```

In `App.tsx`'s `<Sidebar …>`, pass `glyphAlternatesState={glyphAlternatesState}`, `alternateTarget={alternateTarget}`, `onToggleGlyphAlternateMode={toggleGlyphAlternateMode}`, `onResetGlyphAlternates={resetGlyphAlternates}` and `onPickGlyphAlternate={pickGlyphAlternate}`.

- [ ] **Step 5: Run the e2e spec and the whole loop.**
Run: `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p e2e/tsconfig.json && npm run lint && npm test && npx playwright test e2e/glyph-alternates.spec.ts --repeat-each=3`
Expected: all PASS, 9/9 e2e. If the click test's ink assertion fails because the first `.alternate-hit` is a letter whose alternate draws the same ink count, assert on `glyphAlternates` plus a pixel-*difference* instead: sample `inkPixels` on the left and right halves of the box and require at least one to change.

- [ ] **Step 6: Commit.**

```bash
git add src/components/sidebar/AlternateStrip.tsx src/components/Sidebar.tsx src/App.tsx e2e/glyph-alternates.spec.ts
git commit -m "Next Shape: sidebar thumbnails and e2e coverage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, guide, and the full verification pass

**Files:**
- Create: `.claude/rules/glyph-alternates.md`
- Create: `src/components/guide/sections/letter-shapes.tsx`
- Modify: `CLAUDE.md`, `PROGRESS.md`, `README.md`, `.claude/rules/sidebar.md`, `.claude/rules/kashida.md`

- [ ] **Step 1: The subsystem note.** Create `.claude/rules/glyph-alternates.md`:

```markdown
---
paths:
  - "src/lib/glyphAlternates*.ts"
  - "src/lib/fontFeatureNames*.ts"
  - "src/hooks/useGlyphAlternates.ts"
  - "src/components/AlternateHoverHandles.tsx"
  - "src/components/sidebar/AlternateStrip.tsx"
  - "e2e/glyph-alternates.spec.ts"
---

# Next Shape — per-letter alternate glyphs

Click a letter on a text block to step through the alternate shapes its
OpenType font already contains (Kelk's "Next Shape", on OpenType instead of
a proprietary variant library). Spec:
`docs/superpowers/specs/2026-10-10-next-shape-design.md`.

- **Keyed by letter ordinal, not text offset.** `GlyphAlternate.letter`
  counts characters skipping tatweel and combining marks
  (`letterOffsets`). Kashida and Fit to width only insert tatweel and
  shaping only strips marks, so **nothing remaps alternates** —
  `kashidaTextPatch` deliberately does not touch them. `char` is a
  checksum: a typed edit that shifts a letter drops its alternate rather
  than moving it onto another character.
- **Shaping:** `featureStringFor` turns the list into ranged HarfBuzz
  features (`ss01[5:6]=1`) against the *shapable* text. Tags are validated
  (`isOptionalFeature`) before splicing, so a hand-edited save cannot
  inject into the feature string. The shape cache is per font
  (`fontUrl → text|alternatesKey`), which is what lets
  `clearShapeCache(fontUrl)` still drop exactly one font.
- **Discovery** is `probeAlternates` (pure, shaping injected so Vitest
  can run it on real harfbuzzjs): per letter, reshape once per optional
  tag (values 1–4 for `salt`/`aalt`/`jalt`/`swsh`), keep results whose
  cluster glyphs differ, de-duplicate. Capped at `MAX_PROBE_LETTERS`.
  Runs only while the tool is armed (`useGlyphAlternates`, called once in
  App for the selected block).
- **Names** come from the font's own FeatureParams via
  `readFeatureNames` — opentype.js does not resolve them.
- **Overlay** mounts first in `ShapedText` (letter-sized rects below the
  stroke rail and mark handles); hover handlers on the `Group`.
- **Interactions:** a shape change drops stroke cuts on that letter
  (their `glyphId` checksum), which is correct. A ligature-forming
  alternate can shift diacritic-override indices after it; those are
  re-validated and drop.
- **Scope:** text blocks only (`supportsGlyphAlternates`). Shape Fill and
  text-on-path are deferred; the practice sheet and name designs ignore
  alternates.
```

- [ ] **Step 2: CLAUDE.md index line.** In "Subsystem notes", after the Kashida line, add:

```markdown
- **Next Shape (letter alternates)** — [`.claude/rules/glyph-alternates.md`](.claude/rules/glyph-alternates.md). Keyed by letter ordinal (skips tatweel and marks), so kashida needs no remap; tags validated before reaching HarfBuzz; discovery probes HarfBuzz per optional feature, armed only.
```

- [ ] **Step 3: Cross-references.** In `.claude/rules/kashida.md`, after the paragraph about `kashidaTextPatch` / text-offset-keyed data, add: "`glyphAlternates` is the exception by design: keyed by letter ordinal, which tatweel never moves — see [glyph-alternates.md](glyph-alternates.md)." In `.claude/rules/sidebar.md`, change "plus the text-only Warp and Stretch strokes sections" to "plus the text-only Letter shapes, Stretch strokes and Warp sections".

- [ ] **Step 4: Guide section.** Create `src/components/guide/sections/letter-shapes.tsx`, written for calligraphers. Check `glyph-editing.tsx`'s `order` (70) and pick 65 so it sits just before it:

```tsx
import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "letter-shapes",
  title: "Choosing a letter's shape",
  order: 65,
  keywords: ["alternate", "shape", "next shape", "swash", "stylistic set", "letterform", "variant"],
  Body: () => (
    <>
      <p>
        Many fonts draw more than one version of some letters — a looped haa,
        a tailed noon, a longer seen for justifying a line. On a text block,
        open <strong>Typography</strong> and tick{" "}
        <strong>Alternate letter shapes</strong>. Letters that have other
        shapes outline when you hover them: click to step to the next shape,
        Shift-click to go back. The sidebar shows every shape for the letter
        you clicked, so you can also pick one directly.
      </p>
      <p>
        What you get depends on the font. Ruqaa, Amiri, Qahiri, Scheherazade,
        Lateef and others have alternates; Thuluth and Diwani do not, and the
        sidebar will say so. <strong>Reset letter shapes</strong> puts every
        letter back.
      </p>
      <p>
        Kashida and <strong>Fit to width</strong> keep your choices on the same
        letters. Editing the wording before a letter you changed can drop its
        shape back to the default, and changing a letter's shape removes any
        stroke stretch on it — so settle the wording, then the shapes, then the
        stretches.
      </p>
    </>
  ),
};
```

- [ ] **Step 5: PROGRESS and README.** Add a dated `### 2026-10-10 — Next Shape: per-letter alternate glyphs` entry at the top of `## Shipped` (three or four sentences: what it does, which fonts have alternates, text blocks only, link to the rule file). In `README.md`'s feature list, after the stroke-stretch bullet, add:

```markdown
- **Next Shape.** Click a letter to step through the alternate shapes its
  font contains — looped, tailed, swash and justification forms — with
  labelled thumbnails in the sidebar.
```

- [ ] **Step 6: Full verification.**
Run: `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p e2e/tsconfig.json && npm run lint && npm test && npm run build && npm run e2e`
Expected: everything passes, with the e2e count at the previous 75 plus 3.

- [ ] **Step 7: Commit.**

```bash
git add .claude/rules/glyph-alternates.md .claude/rules/kashida.md .claude/rules/sidebar.md CLAUDE.md PROGRESS.md README.md src/components/guide/sections/letter-shapes.tsx
git commit -m "Next Shape: docs and user guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
