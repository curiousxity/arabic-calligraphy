/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";

// harfbuzzjs's package entrypoint (`index.js`) is CommonJS whose
// `module.exports` is itself `new Promise(...)` — Node's ESM/CJS interop
// treats a thenable default export as "auto-awaitable" during static
// `import`, which throws ("Method Promise.prototype.then called on
// incompatible receiver [object Module]") before any of this file's own
// code runs. Loading it via `require` (as harfbuzzjs's own README/tests
// do in Node) sidesteps that interop entirely — this is a Node-in-Vitest
// loading quirk specific to this package shape, unrelated to how the
// app itself loads it (the app is bundled by Vite/Rolldown, which
// doesn't have this issue).
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");
import { normalizeGlyphs } from "./normalizeGlyphs";

// harfbuzzjs's own module shape varies across bundlers/loaders (its main
// export can itself be the init promise, or wrapped in one or two levels
// of `{ default }` depending on how ESM/CJS interop resolves it) — this
// mirrors the resolution `harfbuzz.ts`'s own (private) `resolveHbLoader`
// performs, so the real WASM module loads the same way here as it does
// in the app.
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

type HbModule = {
  createBlob: (data: ArrayBuffer | Uint8Array) => { destroy?: () => void };
  createFace: (blob: unknown, index: number) => { destroy?: () => void };
  createFont: (face: unknown) => {
    setScale?: (x: number, y: number) => void;
    destroy?: () => void;
  };
  createBuffer: () => {
    addText: (text: string) => void;
    guessSegmentProperties?: () => void;
    setDirection?: (direction: string) => void;
    setScript?: (script: string) => void;
    setLanguage?: (language: string) => void;
    json?: (font?: unknown) => unknown[];
    destroy?: () => void;
  };
  shape: (font: unknown, buffer: unknown, features?: string) => void;
};

const hbPromise = resolveHbLoader(hbjsModule);

/**
 * Shapes `text` with a real font via real harfbuzzjs, mirroring
 * `shapeText` in `harfbuzz.ts` (RTL direction, `arab` script, `ar`
 * language). Doesn't reuse `shapeText` itself because that function
 * fetches the font over the network (`fetch(fontUrl)`) — here the font
 * bytes come straight from `public/fonts/` via `fs`, which is the only
 * difference from the app's own shaping path.
 *
 * This is the fix for the bug this suite exists to catch (C1): the
 * previous version of this file hand-wrote `{ g, cl }` glyph objects
 * encoding an assumption about HarfBuzz's clustering that HarfBuzz does
 * not satisfy (one cluster per character) — the tests passed while the
 * feature was completely inert against real shaped text. Every glyph
 * used below comes from actually shaping real text with a real font.
 */
async function shapeReal(
  text: string,
  fontFile: string
): Promise<{ glyphs: HarfBuzzGlyph[]; font: opentype.Font }> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const fontPath = path.resolve(dir, "../../public/fonts", fontFile);
  const fontData = fs.readFileSync(fontPath);
  const arrayBuffer = fontData.buffer.slice(
    fontData.byteOffset,
    fontData.byteOffset + fontData.byteLength
  );
  const parsedFont = opentype.parse(arrayBuffer);
  const upm = parsedFont.unitsPerEm || 1000;

  const hb = await hbPromise;
  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();

  try {
    if (typeof font.setScale === "function") font.setScale(upm, upm);
    buffer.addText(text);
    if (typeof buffer.guessSegmentProperties === "function") {
      buffer.guessSegmentProperties();
    }
    if (typeof buffer.setDirection === "function") buffer.setDirection("rtl");
    if (typeof buffer.setScript === "function") buffer.setScript("arab");
    if (typeof buffer.setLanguage === "function") buffer.setLanguage("ar");

    hb.shape(font, buffer);

    let raw: unknown[] = [];
    if (typeof buffer.json === "function") {
      try {
        raw = buffer.json(font);
      } catch {
        raw = buffer.json();
      }
    }

    return { glyphs: normalizeGlyphs(raw as never), font: parsedFont };
  } finally {
    buffer.destroy?.();
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

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
    ({
      type: "text",
      fontSize: 30,
      letterSpacing: 0.4,
      wordSpacing: 0.1,
      verse: {
        id: 1, index: 0, layout: "stacked", lineGap: 1.6, columnGap: 1,
        baseFontSize: 40, fittedFontSize: 30,
        baseLetterSpacing: 0.1, baseWordSpacing: 0.05,
        fittedLetterSpacing: 0.4, fittedWordSpacing: 0.1,
      },
      ...over,
    }) as TextBlock;

  it("returns the stored base exactly while the spacing is what Justify wrote", () => {
    expect(baseSpacingForLine(line({}))).toEqual({ letter: 0.1, word: 0.05 });
  });

  it("adopts spacing the user reset or set absolutely after Justify", () => {
    // The slider's reset writes 0; a saved style writes its own value. Either
    // is the user's new base, never "that minus what Justify had added".
    expect(baseSpacingForLine(line({ letterSpacing: 0 }))).toEqual({ letter: 0, word: 0.05 });
    expect(baseSpacingForLine(line({ wordSpacing: 0.3 }))).toEqual({ letter: 0.1, word: 0.3 });
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

  it("round-trips through the tag: a second Justify starts from the same base", async () => {
    const user = { letter: 0.1, word: 0 };
    const r = await justifyLine({ text: "بب دد", baseFontSize: 10, userSpacing: user, target: 45, measure: fake });
    expect(r.addedLetter).toBeGreaterThan(0);
    const written = line({
      fontSize: r.fontSize,
      letterSpacing: user.letter + r.addedLetter,
      wordSpacing: user.word + r.addedWord,
      verse: {
        id: 1, index: 0, layout: "stacked", lineGap: 1.6, columnGap: 1,
        baseFontSize: 10, fittedFontSize: r.fontSize,
        baseLetterSpacing: user.letter, baseWordSpacing: user.word,
        fittedLetterSpacing: user.letter + r.addedLetter, fittedWordSpacing: user.word + r.addedWord,
      },
    });
    expect(baseSpacingForLine(written)).toEqual(user);
    expect(baseFontSizeForLine(written)).toBe(10);
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
