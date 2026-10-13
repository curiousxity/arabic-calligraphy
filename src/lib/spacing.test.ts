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

import { applySpacing, countSpacingBoundaries, spacingForBlock } from "./spacing";
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
    const before = sumAx(glyphs);
    const out = applySpacing(glyphs, "محمد رسول", { letter: 0.2, word: 0.3 }, upm);
    expect(out).toHaveLength(glyphs.length);
    out.forEach((g, i) => {
      expect(g.g).toBe(glyphs[i].g);
      expect(g.cl).toBe(glyphs[i].cl);
      expect(g.dx).toBe(glyphs[i].dx);
      expect(g.dy).toBe(glyphs[i].dy);
    });
    // Does not mutate its input.
    expect(sumAx(glyphs)).toBe(before);
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

describe("applySpacing: letters beyond the core Arabic block", () => {
  it("treats Urdu ہ as a letter: وہ has one break after و", async () => {
    const { glyphs, upm } = await shaped("وہ", "Urdu.ttf");
    const out = applySpacing(glyphs, "وہ", { letter: 0.2 }, upm);
    expect(sumAx(out) - sumAx(glyphs)).toBeCloseTo(0.2 * upm, 6);
  });

  it("treats alef wasla as a right-joiner: ٱب has one break after ٱ", async () => {
    const { glyphs, upm } = await shaped("ٱب");
    const out = applySpacing(glyphs, "ٱب", { letter: 0.2 }, upm);
    expect(sumAx(out) - sumAx(glyphs)).toBeCloseTo(0.2 * upm, 6);
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

describe("countSpacingBoundaries", () => {
  it("counts piece breaks and word gaps on plain text", () => {
    // د and ر and و do not join forward: محمد ends before a space (not a
    // break); inside رسول the breaks fall after ر and after و.
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
