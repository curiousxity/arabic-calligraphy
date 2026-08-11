/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll } from "vitest";
import * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./harfbuzz";

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
import { findDiacriticGlyphIndices } from "./diacritics";
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

describe("findDiacriticGlyphIndices (real HarfBuzz shaping)", () => {
  // Sanity check that the real shaping helper above actually loads
  // harfbuzzjs's WASM in this Vitest/Node environment before trusting any
  // assertions built on top of it.
  beforeAll(async () => {
    const hb = await hbPromise;
    expect(typeof hb.shape).toBe("function");
  });

  it("identifies the fatha as a diacritic and the beh as a base letter (Amiri)", async () => {
    // "بَ" — beh (U+0628) + fatha (U+064E). Real shaping merges both into
    // one HarfBuzz cluster (cl=0 for both glyphs), which is exactly the
    // case that broke the old cluster-lookup implementation: it must be
    // resolved by glyph identity, not by `glyph.cl`.
    const { glyphs, font } = await shapeReal("بَ", "Amiri.ttf");
    expect(glyphs.length).toBe(2);

    const indices = findDiacriticGlyphIndices(glyphs, font);

    const fathaIndex = glyphs.findIndex((g) => {
      const unicodes = font.glyphs.get(g.g)?.unicodes ?? [];
      return unicodes.includes(0x064e);
    });
    expect(fathaIndex).toBeGreaterThanOrEqual(0);
    expect(indices.has(fathaIndex)).toBe(true);

    // Every other glyph in the run (the beh base letter) must NOT be
    // flagged — this is the regression the naive "non-first glyph in a
    // shared cluster is a mark" fallback introduces: it flags the base
    // letter too, because the fatha glyph happens to be emitted before
    // the beh glyph in this font's shaped output.
    for (let i = 0; i < glyphs.length; i++) {
      if (i === fathaIndex) continue;
      expect(indices.has(i)).toBe(false);
    }
    expect(indices.size).toBe(1);
  });

  it("identifies the fatha as a diacritic and the beh as a base letter (FatemiMaqala)", async () => {
    const { glyphs, font } = await shapeReal("بَ", "FatemiMaqala.ttf");
    const indices = findDiacriticGlyphIndices(glyphs, font);

    const fathaIndex = glyphs.findIndex((g) => {
      const unicodes = font.glyphs.get(g.g)?.unicodes ?? [];
      return unicodes.includes(0x064e);
    });
    expect(fathaIndex).toBeGreaterThanOrEqual(0);

    expect(indices.size).toBe(1);
    expect(indices.has(fathaIndex)).toBe(true);
  });

  it("identifies every mark glyph — including a mark with no cmap entry — across multiple clusters (مَحَّمَد, Amiri)", async () => {
    // "مَحَّمَد" — meem+fatha, hah+shadda+fatha, meem+fatha, dal. Four
    // HarfBuzz clusters, one of which (the hah+shadda+fatha cluster) has
    // three glyphs sharing one cluster value, and one mark glyph in this
    // word (Amiri's contextual meem+fatha attachment glyph) carries no
    // direct cmap entry, exercising the dx/dy-attachment-offset fallback
    // rather than the direct-unicode primary signal.
    const { glyphs, font } = await shapeReal("مَحَّمَد", "Amiri.ttf");
    expect(glyphs.length).toBe(8);

    const indices = findDiacriticGlyphIndices(glyphs, font);

    // Exactly 4 base letters (meem, hah, meem, dal) and 4 marks
    // (fatha, shadda, fatha, fatha) — verified against real shaping
    // output (see this task's throwaway verification script).
    expect(indices.size).toBe(4);

    // No base letter is ever flagged: every glyph directly identifiable
    // via cmap as a plain Arabic letter (not a combining mark) must be
    // absent from the result.
    for (let i = 0; i < glyphs.length; i++) {
      const unicodes = font.glyphs.get(glyphs[i].g)?.unicodes ?? [];
      const isKnownBaseLetter = unicodes.some(
        (u) => u === 0x0645 || u === 0x062d || u === 0x062f // meem, hah, dal
      );
      if (isKnownBaseLetter) {
        expect(indices.has(i)).toBe(false);
      }
    }

    // Every glyph directly identifiable via cmap as a combining mark
    // (fatha/shadda) must be present in the result.
    for (let i = 0; i < glyphs.length; i++) {
      const unicodes = font.glyphs.get(glyphs[i].g)?.unicodes ?? [];
      const isKnownMark = unicodes.some((u) => u === 0x064e || u === 0x0651);
      if (isKnownMark) {
        expect(indices.has(i)).toBe(true);
      }
    }
  });

  it("returns an empty set for plain text with no diacritics", async () => {
    const { glyphs, font } = await shapeReal("بت", "Amiri.ttf");
    expect(findDiacriticGlyphIndices(glyphs, font).size).toBe(0);
  });

  it("returns an empty set for an empty glyph array", async () => {
    const { font } = await shapeReal("ب", "Amiri.ttf");
    expect(findDiacriticGlyphIndices([], font).size).toBe(0);
  });

  it("returns an empty set when no font is available", () => {
    expect(findDiacriticGlyphIndices([{ g: 1, cl: 0 }], null).size).toBe(0);
    expect(findDiacriticGlyphIndices([{ g: 1, cl: 0 }], undefined).size).toBe(0);
  });
});
