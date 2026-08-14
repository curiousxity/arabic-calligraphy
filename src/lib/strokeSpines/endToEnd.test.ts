/// <reference types="node" />
/**
 * The whole re-anchoring path, on real fonts and real shaping.
 *
 * This is the suite that would have caught the failure re-anchoring exists to
 * fix: a fabricated-fixture version of it would pass while every anchor landed
 * in empty space. Same precedent as diacritics.test.ts and joinPins.fonts.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "../normalizeGlyphs";
import { normalizeGlyphs } from "../normalizeGlyphs";
import { loadSpineTable, getSpine } from "./registry";
import { spineToBlockSpace } from "./anchorFromSpine";
import { deriveStretchCatalog } from "../strokeSchema/deriveCatalog";
import { getStrokeSchema } from "../strokeSchema/registry";
import { classifyJoiningForms } from "../arabicJoining";
import { contoursToPolygons, splitContours } from "../glyphContours";
import { pointInPolygon } from "../svgPath";
import { applyGlyphEdit } from "../glyphEdits";
import { computeJoinPins, PIN_RADIUS_NUQTA } from "../joinPins";
import { nuqtaPx } from "../nuqta";

// See diacritics.test.ts for the full explanation: harfbuzzjs's package
// entrypoint is CommonJS whose `module.exports` is itself a Promise, which
// Node's ESM/CJS interop throws on during a static `import`. Loading it via
// `require` (as harfbuzzjs's own tests do) sidesteps that entirely.
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");

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
 * in `harfbuzz.ts` (RTL, `arab` script, `ar` language) — the font bytes come
 * from `public/fonts/` via `fs` instead of `fetch`, which is the only
 * difference from the app's own shaping path.
 *
 * Copied from justify.test.ts rather than shared, per that file's own note:
 * harfbuzzjs has to be pulled in with `createRequire` from the module that
 * uses it, and a second loading mechanism is exactly what this convention
 * exists to prevent.
 */
async function shapeReal(
  text: string,
  fontFile: string
): Promise<{ glyphs: HarfBuzzGlyph[]; font: opentype.Font; unitsPerEm: number }> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const fontPath = path.resolve(dir, "../../../public/fonts", fontFile);
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

    return { glyphs: normalizeGlyphs(raw as never), font: parsedFont, unitsPerEm: upm };
  } finally {
    buffer.destroy?.();
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

const FONT_SIZE = 120;
const CASES = [
  { family: "TahaNaskhRegular", file: "TahaNaskhRegular.ttf", word: "بسم" },
  { family: "Amiri", file: "Amiri.ttf", word: "حرف" },
  { family: "Kufi", file: "Kufi.ttf", word: "سلام" },
];

describe.each(CASES)("$family / $word", ({ family, file, word }) => {
  it("places every anchor it creates on real ink", async () => {
    const table = await loadSpineTable(family);
    expect(table).not.toBeNull();
    const { glyphs, font, unitsPerEm } = await shapeReal(word, file);
    const classified = classifyJoiningForms(word);

    let checked = 0;
    let penX = 0;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      const scale = FONT_SIZE / unitsPerEm;
      const gx = (penX + (g.dx ?? 0)) * scale;
      const gy = -(g.dy ?? 0) * scale;
      penX += g.ax ?? 0;

      const entry = classified[g.cl ?? 0];
      if (!entry?.form) continue;
      const schema = getStrokeSchema(
        entry.codepoint.toString(16).toUpperCase().padStart(4, "0"),
        entry.form
      );
      if (!schema) continue;

      const glyphObj = font.glyphs.get(g.g);
      if (!glyphObj) continue;
      const polygons = contoursToPolygons(
        splitContours(glyphObj.getPath(gx, gy, FONT_SIZE).commands)
      );

      for (const def of deriveStretchCatalog(schema)) {
        const spine = getSpine(table, g.g, def.strokeId, def.zoneIndex);
        if (!spine) continue;
        const placed = spineToBlockSpace(spine, {
          gx,
          gy,
          fontSize: FONT_SIZE,
          unitsPerEm,
        });
        if (!placed) continue;
        checked++;
        const inside = polygons.some((p) =>
          pointInPolygon(placed.anchor.x, placed.anchor.y, p)
        );
        expect(inside, `${family} ${def.strokeId} anchor off ink`).toBe(true);
      }
    }
    // A run that silently checked nothing would pass vacuously.
    expect(checked, "no spine-backed handles were exercised").toBeGreaterThan(0);
  });

  it("still moves a pinned join by 0px at every factor", async () => {
    const { glyphs, font, unitsPerEm } = await shapeReal(word, file);
    const nuqta = nuqtaPx(family, FONT_SIZE);
    expect(nuqta).not.toBeNull();
    const pins = computeJoinPins({
      glyphs,
      font,
      fontSize: FONT_SIZE,
      unitsPerEm,
      pinRadius: nuqta! * PIN_RADIUS_NUQTA,
    });

    for (const [glyphIndex, glyphPins] of pins) {
      for (const pin of glyphPins) {
        for (const factor of [1, 1.25, 1.5, 2]) {
          const handle = {
            id: "h",
            anchorX: pin.x - 50,
            anchorY: pin.y,
            dragOriginX: pin.x + 50,
            dragOriginY: pin.y,
            dragX: pin.x + 100,
            dragY: pin.y,
            bandWidth: 60,
            factor,
            minFactor: 1,
            maxFactor: 2,
          };
          const moved = applyGlyphEdit(
            pin.x,
            pin.y,
            { glyphIndex, stretches: [handle] },
            0,
            glyphPins
          );
          expect(Math.hypot(moved.x - pin.x, moved.y - pin.y)).toBeLessThan(1e-6);
        }
      }
    }
  });
});
