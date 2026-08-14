/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll } from "vitest";
import * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./harfbuzz";

// See the identical note in diacritics.test.ts: harfbuzzjs's CommonJS
// entrypoint exports a Promise, which Node's ESM interop tries to await
// during a static `import` and throws on. `require` sidesteps it.
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");
import { normalizeGlyphs } from "./normalizeGlyphs";
import { findKashidaSlots, applyKashida, readKashida, TATWEEL } from "./tatweel";

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
 * Shapes `text` with a real font via real harfbuzzjs, mirroring `shapeText`
 * in `harfbuzz.ts` (RTL, `arab`, `ar`) — copied from `diacritics.test.ts`
 * rather than reinvented, per CLAUDE.md's test conventions. The font bytes
 * come from `public/fonts/` via `fs` instead of over the network; that is
 * the only difference from the app's own shaping path.
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

/** Total shaped advance of a run, in font units — what "the run widened" means. */
async function shapedWidth(text: string, fontFile: string): Promise<number> {
  const { glyphs } = await shapeReal(text, fontFile);
  return glyphs.reduce((sum, g) => sum + (g.ax ?? 0), 0);
}

describe("findKashidaSlots", () => {
  it("offers the join between two dual-joining letters", () => {
    // "بس" — beh (dual) followed by seen (dual). The connecting stroke sits
    // between them, so the tatweel is inserted before the seen.
    const slots = findKashidaSlots("بس");
    expect(slots).toEqual([{ index: 1, before: "ب", after: "س" }]);
  });

  it("offers no slot where the preceding letter cannot join forward", () => {
    // dal (U+062F) is right-joining: it accepts a join from its predecessor
    // but never extends one forward, so nothing may be inserted after it.
    expect(findKashidaSlots("دب")).toEqual([]);
  });

  it("offers no slot after a final letter with no successor", () => {
    expect(findKashidaSlots("ب")).toEqual([]);
  });

  it("treats combining marks between the pair as transparent", () => {
    // "بَس" — the fatha must stay on the beh, so the insertion point is
    // after the mark, immediately before the seen.
    const slots = findKashidaSlots("بَس");
    expect(slots).toEqual([{ index: 2, before: "ب", after: "س" }]);
  });

  it("never offers a slot inside a lam-alef pair", () => {
    expect(findKashidaSlots("لا")).toEqual([]);
    expect(findKashidaSlots("لأ")).toEqual([]);
    expect(findKashidaSlots("لآ")).toEqual([]);
    expect(findKashidaSlots("لإ")).toEqual([]);

    // ...while the join *into* the lam is still offered.
    expect(findKashidaSlots("بلا")).toEqual([{ index: 1, before: "ب", after: "ل" }]);
  });

  it("does not offer a slot across a space", () => {
    expect(findKashidaSlots("ب س")).toEqual([]);
  });

  it("reports one slot per letter pair, not one per existing tatweel", () => {
    // "بــس" already carries a two-tatweel run; that whole run is one slot,
    // described by the letters on either side of it.
    const slots = findKashidaSlots(`ب${TATWEEL}${TATWEEL}س`);
    expect(slots).toEqual([{ index: 1, before: "ب", after: "س" }]);
  });

  it("finds every slot in a multi-letter word", () => {
    // "بسمل": beh-seen, seen-meem, meem-lam are all dual/dual joins.
    expect(findKashidaSlots("بسمل")).toEqual([
      { index: 1, before: "ب", after: "س" },
      { index: 2, before: "س", after: "م" },
      { index: 3, before: "م", after: "ل" },
    ]);
  });
});

describe("applyKashida", () => {
  it("inserts the requested number of tatweels at the slot", () => {
    const [slot] = findKashidaSlots("بس");
    expect(applyKashida("بس", slot, 3)).toBe(`ب${TATWEEL.repeat(3)}س`);
  });

  it("is absolute rather than additive — re-applying replaces the run", () => {
    const text = "بس";
    const [slot] = findKashidaSlots(text);
    const widened = applyKashida(text, slot, 4);

    const [slotAgain] = findKashidaSlots(widened);
    expect(applyKashida(widened, slotAgain, 1)).toBe(`ب${TATWEEL}س`);
    expect(applyKashida(widened, slotAgain, 0)).toBe("بس");
  });

  it("leaves the rest of the text alone", () => {
    const slots = findKashidaSlots("بسمل");
    expect(applyKashida("بسمل", slots[1], 2)).toBe(`بس${TATWEEL.repeat(2)}مل`);
  });

  it("keeps a mark that sits between the pair attached to its base letter", () => {
    const [slot] = findKashidaSlots("بَس");
    expect(applyKashida("بَس", slot, 2)).toBe(`بَ${TATWEEL.repeat(2)}س`);
  });

  it("clamps a negative count to zero", () => {
    const [slot] = findKashidaSlots(`ب${TATWEEL}س`);
    expect(applyKashida(`ب${TATWEEL}س`, slot, -3)).toBe("بس");
  });
});

describe("readKashida", () => {
  it("reports zero for every untouched slot", () => {
    const slots = findKashidaSlots("بسمل");
    expect(readKashida("بسمل", slots)).toEqual(new Map([[1, 0], [2, 0], [3, 0]]));
  });

  it("reports the existing run length at each slot", () => {
    const text = `ب${TATWEEL.repeat(3)}سم`;
    const slots = findKashidaSlots(text);
    // ب at 0, the run at 1-3, س at 4, م at 5 — so the seen-meem slot is 5.
    expect(readKashida(text, slots)).toEqual(new Map([[1, 3], [5, 0]]));
  });
});

describe("real HarfBuzz shaping", () => {
  beforeAll(async () => {
    const hb = await hbPromise;
    expect(typeof hb.shape).toBe("function");
  });

  // The whole point of the feature, and the reason this suite shapes for
  // real: the removed stroke-stretch kashida never widened the run at all.
  // A tatweel must make the shaped advance strictly grow, in every font.
  for (const fontFile of ["Amiri.ttf", "Scheherazade.ttf", "Lateef.ttf"]) {
    it(`widens the shaped run monotonically with the count (${fontFile})`, async () => {
      const text = "بسمل";
      const [slot] = findKashidaSlots(text);

      const widths: number[] = [];
      for (let count = 0; count <= 4; count++) {
        widths.push(await shapedWidth(applyKashida(text, slot, count), fontFile));
      }

      for (let i = 1; i < widths.length; i++) {
        expect(widths[i]).toBeGreaterThan(widths[i - 1]);
      }
    });
  }
});
