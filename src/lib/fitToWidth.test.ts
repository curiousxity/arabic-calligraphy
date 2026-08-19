/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./harfbuzz";

// See the identical note in tatweel.test.ts and diacritics.test.ts:
// harfbuzzjs's CommonJS entrypoint exports a Promise, which Node's ESM
// interop tries to await during a static `import` and throws on. `require`
// sidesteps it.
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");
import { normalizeGlyphs } from "./normalizeGlyphs";
import { findKashidaSlots, TATWEEL } from "./tatweel";
import {
  distributeKashida,
  applyDistribution,
  inkExtentWidth,
  solveFitToWidth,
} from "./fitToWidth";

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

/**
 * Shapes `text` with a real font via real harfbuzzjs, mirroring `shapeText`
 * in `harfbuzz.ts` (RTL, `arab`, `ar`) — copied from `tatweel.test.ts`
 * rather than reinvented, per CLAUDE.md's test conventions.
 */
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

  // Mirrors the guard in `shapeText`: an empty buffer has no shaping result
  // to serialize, so `buffer.json()` parses an empty string and throws
  // "Unexpected end of JSON input". Empty text has no glyphs by definition.
  if (text.length === 0) {
    return { glyphs: [], font: parsedFont, unitsPerEm: upm };
  }

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

    return {
      glyphs: normalizeGlyphs(raw as never),
      font: parsedFont,
      unitsPerEm: upm,
    };
  } finally {
    buffer.destroy?.();
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

/** A real-font `measure` for the solver: the ink extent the canvas would draw. */
const realMeasure =
  (fontFile: string, fontSize: number) =>
  async (text: string): Promise<number> => {
    const { glyphs, font, unitsPerEm } = await shapeReal(text, fontFile);
    return inkExtentWidth(glyphs, font, fontSize, unitsPerEm);
  };

const countTatweels = (t: string) => [...t].filter((c) => c === TATWEEL).length;

/**
 * A synthetic measure: a fixed base plus a fixed amount per tatweel. Exact
 * and instant, so the solver's own arithmetic can be asserted without real
 * shaping in the loop. The real-font suite at the bottom is what proves the
 * solver works against actual glyph geometry.
 */
const linearMeasure =
  (base: number, perTatweel: number) =>
  async (text: string): Promise<number> =>
    base + perTatweel * countTatweels(text);

describe("distributeKashida", () => {
  it("returns nothing to place when the total is zero", () => {
    expect(distributeKashida(3, 0)).toEqual([0, 0, 0]);
  });

  it("splits evenly when the total divides the slot count", () => {
    expect(distributeKashida(3, 6)).toEqual([2, 2, 2]);
  });

  it("gives the remainder to the earliest slots, one each", () => {
    // 7 across 3 slots is 2 each with 1 left over — never 3/2/2 by
    // dumping the remainder in one place.
    expect(distributeKashida(3, 7)).toEqual([3, 2, 2]);
    expect(distributeKashida(3, 8)).toEqual([3, 3, 2]);
  });

  it("never exceeds the per-slot cap", () => {
    expect(distributeKashida(2, 100, 4)).toEqual([4, 4]);
  });

  it("spreads to the cap before overflowing any single slot", () => {
    const counts = distributeKashida(3, 9, 4);
    expect(counts).toEqual([3, 3, 3]);
    expect(Math.max(...counts)).toBeLessThanOrEqual(4);
  });

  it("handles a degenerate slot list", () => {
    expect(distributeKashida(0, 5)).toEqual([]);
  });
});

describe("applyDistribution", () => {
  it("inserts the requested count at each slot", () => {
    const text = "بسم";
    const slots = findKashidaSlots(text);
    expect(slots).toHaveLength(2);

    const out = applyDistribution(text, slots, [2, 1]);
    expect(countTatweels(out)).toBe(3);
    // The letters themselves survive in order.
    expect([...out].filter((c) => c !== TATWEEL).join("")).toBe(text);
  });

  it("is absolute, so re-applying replaces rather than accumulates", () => {
    const text = "بسم";
    const slots = findKashidaSlots(text);
    const once = applyDistribution(text, slots, [2, 2]);
    const twice = applyDistribution(once, findKashidaSlots(once), [2, 2]);
    expect(twice).toBe(once);
  });

  it("clears every slot when asked for zero", () => {
    const text = "بسم";
    const stretched = applyDistribution(text, findKashidaSlots(text), [3, 3]);
    const cleared = applyDistribution(
      stretched,
      findKashidaSlots(stretched),
      [0, 0]
    );
    expect(cleared).toBe(text);
  });

  it("applies later slots without corrupting earlier ones", () => {
    // Applying left-to-right would shift every later slot's offset as soon
    // as the first insertion lands. Four slots makes that failure visible.
    const text = "بسمل";
    const slots = findKashidaSlots(text);
    const out = applyDistribution(text, slots, slots.map((_, i) => i + 1));
    const expected = slots.reduce((sum, _, i) => sum + i + 1, 0);
    expect(countTatweels(out)).toBe(expected);
    expect([...out].filter((c) => c !== TATWEEL).join("")).toBe(text);
  });
});

describe("solveFitToWidth", () => {
  it("reports when the text has no stretchable join", async () => {
    const result = await solveFitToWidth({
      text: "دد",
      target: 500,
      measure: linearMeasure(100, 10),
    });
    expect(result.reason).toBe("no-slots");
    expect(result.text).toBe("دد");
    expect(result.total).toBe(0);
  });

  it("reaches the target exactly when the arithmetic allows", async () => {
    // base 100, +10 per tatweel, target 170 -> exactly 7 tatweels.
    const result = await solveFitToWidth({
      text: "بسم",
      target: 170,
      measure: linearMeasure(100, 10),
    });
    expect(result.total).toBe(7);
    expect(result.width).toBe(170);
    expect(result.reason).toBe("fitted");
  });

  it("never overshoots the target", async () => {
    // target 165 sits between 6 tatweels (160) and 7 (170).
    const result = await solveFitToWidth({
      text: "بسم",
      target: 165,
      measure: linearMeasure(100, 10),
    });
    expect(result.total).toBe(6);
    expect(result.width).toBeLessThanOrEqual(165);
  });

  it("strips existing kashida and reports when the text is already too wide", async () => {
    const result = await solveFitToWidth({
      text: "بــســم",
      target: 50,
      measure: linearMeasure(100, 10),
    });
    expect(result.reason).toBe("already-wider");
    expect(countTatweels(result.text)).toBe(0);
  });

  it("caps at the per-slot maximum when the target is out of reach", async () => {
    const result = await solveFitToWidth({
      text: "بسم",
      target: 100000,
      measure: linearMeasure(100, 10),
      maxPerSlot: 4,
    });
    expect(result.reason).toBe("capped");
    // Two slots, four each.
    expect(result.total).toBe(8);
  });

  it("is idempotent — fitting an already-fitted run changes nothing", async () => {
    const opts = { target: 170, measure: linearMeasure(100, 10) };
    const first = await solveFitToWidth({ text: "بسم", ...opts });
    const second = await solveFitToWidth({ text: first.text, ...opts });
    expect(second.text).toBe(first.text);
    expect(second.total).toBe(first.total);
  });

  it("does not disturb text that carries no legal join", async () => {
    const result = await solveFitToWidth({
      text: "دد",
      target: 5,
      measure: linearMeasure(100, 10),
    });
    expect(result.text).toBe("دد");
  });
});

// Real harfbuzzjs, real fonts from public/fonts/. Per CLAUDE.md this is not
// optional: a fabricated-fixture version of these assertions would restate
// the assumption instead of testing it, which is exactly what let the
// cluster-lookup bug ship once.
describe("inkExtentWidth (real fonts)", () => {
  const FONTS = ["Amiri.ttf", "Scheherazade.ttf", "Lateef.ttf"];

  for (const fontFile of FONTS) {
    it(`grows with tatweel count in ${fontFile}`, async () => {
      const measure = realMeasure(fontFile, 100);
      const text = "بسم";
      const slots = findKashidaSlots(text);

      const w0 = await measure(text);
      const w3 = await measure(applyDistribution(text, slots, [3, 3]));

      expect(w0).toBeGreaterThan(0);
      expect(w3).toBeGreaterThan(w0);
    });
  }

  it("is zero for an empty run", async () => {
    const measure = realMeasure("Amiri.ttf", 100);
    expect(await measure("")).toBe(0);
  });
});

describe("solveFitToWidth (real fonts)", () => {
  const FONTS = ["Amiri.ttf", "Scheherazade.ttf", "Lateef.ttf"];

  for (const fontFile of FONTS) {
    it(`fits without overshooting in ${fontFile}`, async () => {
      const measure = realMeasure(fontFile, 100);
      const text = "بسم الله";
      const natural = await measure(text);
      const target = natural * 1.5;

      const result = await solveFitToWidth({ text, target, measure });

      expect(result.width).toBeLessThanOrEqual(target);
      expect(result.total).toBeGreaterThan(0);
      // The result must actually be a real improvement on doing nothing,
      // not a technically-compliant zero.
      expect(result.width).toBeGreaterThan(natural);
    });

    it(`lands within one tatweel of the target in ${fontFile}`, async () => {
      const measure = realMeasure(fontFile, 100);
      const text = "بسم الله";
      const slots = findKashidaSlots(text);
      const natural = await measure(text);
      const target = natural * 1.4;

      const result = await solveFitToWidth({ text, target, measure });
      if (result.reason !== "fitted") return;

      // One more tatweel anywhere would have crossed the target — i.e. the
      // solver stopped at the last count that still fits, not early.
      const oneMore = await measure(
        applyDistribution(
          text,
          slots,
          distributeKashida(slots.length, result.total + 1)
        )
      );
      expect(oneMore).toBeGreaterThan(target);
    });
  }
});
