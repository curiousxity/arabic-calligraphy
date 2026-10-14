/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll } from "vitest";
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

import { convertRunToStack, runOutline, splitPieceAtCut } from "./stackConvert";
import { assembleStackOutline } from "./stackOutline";
import { flattenContours } from "./strokeCuts";
import type { SvgCmd } from "./svgPath";

const area = (cmds: SvgCmd[]) =>
  flattenContours(cmds).reduce((sum, c) => {
    let a = 0;
    for (let i = 0; i + 1 < c.length; i++) a += c[i][0] * c[i + 1][1] - c[i + 1][0] * c[i][1];
    return sum + Math.abs(a) / 2;
  }, 0);

async function convert(text: string, fontFile: string) {
  const { glyphs, font } = await shapeReal(text, fontFile);
  const unitsPerEm = font.unitsPerEm || 1000;
  const input = { glyphs, font, unitsPerEm, shapableText: text, cutPlan: null, diacriticOverrides: [], fontSize: unitsPerEm };
  return { input, result: convertRunToStack(input) };
}

describe("convertRunToStack", () => {
  beforeAll(async () => {
    const hb = await hbPromise;
    expect(typeof hb.shape).toBe("function");
  });

  for (const fontFile of ["UKIJDiwani.ttf", "Amiri.ttf", "NotoSans.ttf"]) {
    it(`${fontFile}: one letter piece per base letter of مصبح, a join per adjacent pair or an unjoined report`, async () => {
      const { result } = await convert("مصبح", fontFile);
      const letters = result.pieces.filter((p) => p.role === "letter");
      expect(letters).toHaveLength(4);
      expect(result.joins.length + result.unjoined.length).toBe(3);
      for (const m of result.pieces.filter((p) => p.role === "mark")) {
        expect(letters.some((l) => l.id === m.parentId)).toBe(true);
      }
      // Reading order is text order.
      expect(letters.map((l) => l.order).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    });

    it(`${fontFile}: converting and touching nothing reproduces the run's outline`, async () => {
      const { input, result } = await convert("محمد", fontFile);
      const original = runOutline(input);
      const baked = assembleStackOutline(result.pieces, result.joins, { width: 100, minFraction: 0.15 });
      expect(flattenContours(baked)).toHaveLength(flattenContours(original).length);
      expect(Math.abs(area(baked) - area(original)) / area(original)).toBeLessThan(0.005);
    });
  }

  it("UKIJDiwani joins every adjacent pair of مصبح by a cut (the coverage sweep's 100%)", async () => {
    const { result } = await convert("مصبح", "UKIJDiwani.ttf");
    expect(result.unjoined).toHaveLength(0);
    expect(result.joins).toHaveLength(3);
  });

  it("a word with no joins converts to rigid pieces and an empty join list", async () => {
    const { input, result } = await convert("ادر", "Amiri.ttf");
    expect(result.joins).toHaveLength(0);
    expect(result.unjoined).toHaveLength(0);
    expect(area(assembleStackOutline(result.pieces, [], { width: 100, minFraction: 0.15 })))
      .toBeCloseTo(area(runOutline(input)), 0);
  });

  it("carries an existing tatweel into the earlier letter's piece", async () => {
    const { result } = await convert("مـصبح", "Amiri.ttf");
    const letters = result.pieces.filter((p) => p.role === "letter");
    expect(letters).toHaveLength(4);
  });

  it("a hidden mark is dropped and a lifted mark is lifted, in font units", async () => {
    const { glyphs, font } = await shapeReal("بَ", "Amiri.ttf");
    const upm = font.unitsPerEm || 1000;
    const base = { glyphs, font, unitsPerEm: upm, shapableText: "بَ", cutPlan: null, fontSize: 100 };
    const markIdx = glyphs.findIndex((g) => (g.ax ?? 0) === 0);
    expect(markIdx).toBeGreaterThanOrEqual(0);
    const plain = convertRunToStack({ ...base, diacriticOverrides: [] });
    const hidden = convertRunToStack({ ...base, diacriticOverrides: [{ glyphIndex: markIdx, hidden: true }] });
    const lifted = convertRunToStack({ ...base, diacriticOverrides: [{ glyphIndex: markIdx, offsetY: -10 }] });
    expect(hidden.pieces.filter((p) => p.role === "mark")).toHaveLength(plain.pieces.filter((p) => p.role === "mark").length - 1);
    // Conversion re-centres on the ink, and the mark is the topmost ink, so
    // compare the mark to its parent rather than to the block origin.
    const rel = (r: typeof plain) => {
      const m = r.pieces.find((p) => p.role === "mark")!;
      const parent = r.pieces.find((p) => p.id === m.parentId)!;
      return m.y - parent.y;
    };
    expect(rel(lifted) - rel(plain)).toBeCloseTo((-10 * upm) / 100, 6);
  });

  it("splitPieceAtCut turns one piece into two joined pieces with the same outline", async () => {
    const { result } = await convert("مصبح", "UKIJDiwani.ttf");
    const nib = { width: 100, minFraction: 0.15 };
    const before = area(assembleStackOutline(result.pieces, result.joins, nib));
    const target = result.pieces.find((p) => p.role === "letter")!;
    // Any legal zone on the piece works; take the first the detector offers.
    const { findCutZonesSwept, DEFAULT_DETECT_OPTS } = await import("./strokeCuts");
    const zones = findCutZonesSwept(flattenContours(target.cmds), { glyphIndex: 0, cluster: 0 },
      { ...DEFAULT_DETECT_OPTS, step: 10, minZoneWidth: 25 });
    expect(zones.length).toBeGreaterThan(0);
    const z = zones[0];
    const split = splitPieceAtCut(result.pieces, result.joins, target.id, { cutX: (z.fromX + z.toX) / 2, angle: z.angle });
    expect(split).not.toBeNull();
    expect(split!.pieces.length).toBe(result.pieces.length + 1);
    expect(split!.joins.length).toBe(result.joins.length + 1);
    expect(area(assembleStackOutline(split!.pieces, split!.joins, nib))).toBeCloseTo(before, 0);
  });
});
