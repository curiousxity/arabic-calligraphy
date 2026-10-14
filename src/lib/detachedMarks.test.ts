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
import {
  findDetachedContours, splitContours, translateContours, MAX_MARK_FRACTION, findDetachedMarks,
  buildDetachedMarkPlan, remapMarksForEdits, applyMarkPlanToGlyph,
} from "./detachedMarks";
import { findDiacriticGlyphIndices } from "./diacritics";
import { toSvgCmds, outlineBounds } from "./strokeCuts";
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

async function isolated(letter: string, fontFile: string) {
  const { glyphs, font } = await shapeReal(letter, fontFile);
  const obj = font.glyphs.get(glyphs[0].g)!;
  const upm = font.unitsPerEm || 1000;
  return { cmds: toSvgCmds(obj.getPath(0, 0, upm).commands), upm };
}
const detect = async (letter: string, fontFile: string) => {
  const { cmds, upm } = await isolated(letter, fontFile);
  return findDetachedContours(cmds, upm);
};

describe("findDetachedContours (real fonts)", () => {
  beforeAll(async () => {
    const hb = await hbPromise;
    expect(typeof hb.shape).toBe("function");
  });

  it("finds three dots on ث and none on the body (FatemiMaqala)", async () => {
    const { cmds, upm } = await isolated("ث", "FatemiMaqala.ttf");
    const marks = findDetachedContours(cmds, upm);
    expect(marks).toHaveLength(3);
    const body = outlineBounds(cmds);
    for (const m of marks) {
      const area = (m.bounds.x2 - m.bounds.x1) * (m.bounds.y2 - m.bounds.y1);
      expect(area).toBeLessThan(MAX_MARK_FRACTION * (body.x2 - body.x1) * (body.y2 - body.y1));
    }
  });

  it("a merged dot pair is one mark: Amiri's ث yields two (a pair and a single)", async () => {
    expect(await detect("ث", "Amiri.ttf")).toHaveLength(2);
  });

  it("a counter is not a mark: و م ه ص yield none (Amiri, Scheherazade, Kufi)", async () => {
    for (const f of ["Amiri.ttf", "Scheherazade.ttf", "Kufi.ttf"]) {
      for (const letter of ["و", "م", "ه", "ص"]) {
        expect(await detect(letter, f), `${letter} ${f}`).toHaveLength(0);
      }
    }
  });

  it("the hamza on أ is a mark even against a thin alif (Amiri, FatemiMaqala)", async () => {
    expect(await detect("أ", "Amiri.ttf")).toHaveLength(1);
    expect(await detect("أ", "FatemiMaqala.ttf")).toHaveLength(1);
  });

  it("a letter whose dots are a separate glyph yields nothing on the contour route (Qahiri)", async () => {
    // HarfBuzz substitutes the isolated form, so the outline is not empty;
    // it has no detached contour because Qahiri draws the dot as its own
    // zero-advance glyph, which the separate-glyph route handles.
    expect(await detect("ب", "Qahiri.ttf")).toHaveLength(0);
  });

  it("mark indices are raw contour indices", async () => {
    const { cmds, upm } = await isolated("ت", "Amiri.ttf");
    const parts = splitContours(cmds);
    for (const m of findDetachedContours(cmds, upm)) {
      expect(outlineBounds(parts[m.mark])).toEqual(m.bounds);
    }
  });

  it("translateContours moves only the named contour", async () => {
    const { cmds, upm } = await isolated("ب", "Amiri.ttf");
    const [dot] = findDetachedContours(cmds, upm);
    const moved = translateContours(cmds, new Map([[dot.mark, [50, -70] as const]]));
    const after = splitContours(moved);
    const b = outlineBounds(after[dot.mark]);
    expect(b.x1).toBeCloseTo(dot.bounds.x1 + 50, 6);
    expect(b.y1).toBeCloseTo(dot.bounds.y1 - 70, 6);
    const before = splitContours(cmds);
    before.forEach((c, i) => { if (i !== dot.mark) expect(outlineBounds(after[i])).toEqual(outlineBounds(c)); });
  });
});

describe("findDetachedMarks (shaped runs)", () => {
  it("NotoSans: ف's separate dot glyph is a mark here and not a diacritic", async () => {
    const { glyphs, font } = await shapeReal("حرف", "NotoSans.ttf");
    const upm = font.unitsPerEm || 1000;
    const dia = findDiacriticGlyphIndices(glyphs, font, "حرف");
    const marks = findDetachedMarks(glyphs, font, upm, dia, "NotoSans");
    const dotIdx = glyphs.findIndex((g, i) => (g.ax ?? 0) === 0 && !dia.has(i));
    expect(dotIdx).toBeGreaterThanOrEqual(0);
    expect(marks.get(dotIdx)?.[0].mark).toBe(-1);
    expect(marks.get(dotIdx)?.[0].glyphId).toBe(glyphs[dotIdx].g);
  });

  it("FatemiMaqala: contour-route marks are keyed to their letter's cluster and glyph id", async () => {
    const { glyphs, font } = await shapeReal("ثبت", "FatemiMaqala.ttf");
    const upm = font.unitsPerEm || 1000;
    const marks = findDetachedMarks(glyphs, font, upm, new Set(), "FatemiMaqala");
    let total = 0;
    for (const [gi, list] of marks) {
      for (const m of list) {
        expect(m.glyphIndex).toBe(gi);
        expect(m.cluster).toBe(glyphs[gi].cl ?? 0);
        expect(m.glyphId).toBe(glyphs[gi].g);
        expect(m.mark).toBeGreaterThanOrEqual(0);
        total++;
      }
    }
    expect(total).toBe(6);
  });

  it("a tashkeel glyph is never a detached mark", async () => {
    const { glyphs, font } = await shapeReal("بَ", "Amiri.ttf");
    const dia = findDiacriticGlyphIndices(glyphs, font, "بَ");
    const marks = findDetachedMarks(glyphs, font, font.unitsPerEm || 1000, dia, "Amiri");
    for (const i of dia) expect(marks.has(i)).toBe(false);
  });

  it("`only` restricts the walk", async () => {
    const { glyphs, font } = await shapeReal("ثبت", "FatemiMaqala.ttf");
    const marks = findDetachedMarks(glyphs, font, font.unitsPerEm || 1000, new Set(), "FatemiMaqala", new Set([0]));
    expect([...marks.keys()]).toEqual([0]);
  });
});

describe("UNSUPPORTED_FONTS", () => {
  it("a font that failed the gate's undotted half yields nothing (Wessam ط has a floating stem)", async () => {
    const { glyphs, font } = await shapeReal("ط", "Wessam.ttf");
    const upm = font.unitsPerEm || 1000;
    expect(findDetachedMarks(glyphs, font, upm, new Set(), "Wessam").size).toBe(0);
    // The same outline under another family name shows why: the stem is
    // detached from the bowl by more than a touch, so the detector cannot
    // tell it from a dot.
    expect(findDetachedMarks(glyphs, font, upm, new Set(), "NotWessam").size).toBeGreaterThan(0);
  });
});

describe("buildDetachedMarkPlan", () => {
  it("resolves a contour override by cluster + glyph id + mark, and drops a stale glyph id or mark", async () => {
    const { glyphs, font } = await shapeReal("ثبت", "FatemiMaqala.ttf");
    const detected = findDetachedMarks(glyphs, font, font.unitsPerEm || 1000, new Set(), "FatemiMaqala");
    const [gi, list] = [...detected.entries()][0];
    const m = list[0];
    const plan = buildDetachedMarkPlan(
      [
        { cluster: m.cluster, glyphId: m.glyphId, mark: m.mark, dx: 30, dy: -40 },
        { cluster: m.cluster, glyphId: m.glyphId + 9999, mark: m.mark, dx: 1, dy: 1 },
        { cluster: m.cluster, glyphId: m.glyphId, mark: 999, dx: 1, dy: 1 },
      ],
      glyphs, detected
    );
    expect(plan.contours.get(gi)?.get(m.mark)).toEqual([30, -40]);
    expect(plan.contours.get(gi)?.size).toBe(1);
    expect(plan.glyphs.size).toBe(0);
  });

  it("resolves a whole-glyph override (NotoSans dot)", async () => {
    const { glyphs, font } = await shapeReal("حرف", "NotoSans.ttf");
    const dia = findDiacriticGlyphIndices(glyphs, font, "حرف");
    const detected = findDetachedMarks(glyphs, font, font.unitsPerEm || 1000, dia, "NotoSans");
    const [gi, [m]] = [...detected.entries()][0];
    const plan = buildDetachedMarkPlan([{ cluster: m.cluster, glyphId: m.glyphId, mark: m.mark, dx: 5, dy: 6 }], glyphs, detected);
    expect(plan.glyphs.get(gi)).toEqual([5, 6]);
  });
});

describe("remapMarksForEdits", () => {
  it("shifts clusters after an insertion and leaves the one at the slot", () => {
    const marks = [
      { cluster: 0, glyphId: 1, mark: 0, dx: 1, dy: 1 },
      { cluster: 2, glyphId: 1, mark: 0, dx: 1, dy: 1 },
      { cluster: 3, glyphId: 1, mark: 0, dx: 1, dy: 1 },
    ];
    expect(remapMarksForEdits(marks, [{ index: 2, delta: 1 }]).map((m) => m.cluster)).toEqual([0, 2, 4]);
  });
});

describe("applyMarkPlanToGlyph", () => {
  it("translates the contour at the given px scale and leaves other glyphs alone", async () => {
    const { cmds, upm } = await isolated("ب", "Amiri.ttf");
    const [dot] = findDetachedContours(cmds, upm);
    const plan = { contours: new Map([[3, new Map([[dot.mark, [100, 0] as [number, number]]])]]), glyphs: new Map() };
    const same = applyMarkPlanToGlyph(cmds, plan, 0, 0.1);
    expect(same).toBe(cmds);
    const moved = applyMarkPlanToGlyph(cmds, plan, 3, 0.1);
    expect(outlineBounds(splitContours(moved)[dot.mark]).x1).toBeCloseTo(dot.bounds.x1 + 10, 6);
  });
});
