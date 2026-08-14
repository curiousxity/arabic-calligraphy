// @vitest-environment jsdom
/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "../harfbuzz";
import { computeClusterSpans, useGlyphSchemaCatalog } from "./glyphLookup";
import { getLigatureSchema } from "./registry";
import { loadSpineTable } from "../strokeSpines/registry";
import { normalizeGlyphs } from "../normalizeGlyphs";

// harfbuzzjs's package entrypoint (`index.js`) is CommonJS whose
// `module.exports` is itself `new Promise(...)` — Node's ESM/CJS interop
// treats a thenable default export as "auto-awaitable" during static
// `import`, which throws before any of this file's own code runs. Loading
// it via `require` sidesteps that entirely. Copied from diacritics.test.ts
// rather than inventing a second loading mechanism, per CLAUDE.md.
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");

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

/** Shapes `text` with a real font via real harfbuzzjs — see diacritics.test.ts's shapeReal for the full rationale. */
async function shapeReal(
  text: string,
  fontFile: string
): Promise<{ glyphs: HarfBuzzGlyph[]; font: opentype.Font }> {
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

    return { glyphs: normalizeGlyphs(raw as never), font: parsedFont };
  } finally {
    buffer.destroy?.();
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

describe("computeClusterSpans", () => {
  it("gives every cluster a span of 1 when each glyph maps to exactly one character", () => {
    // "بسم" (3 glyphs, one per character) — clusters happen to come out in
    // reverse (RTL glyph-array) order, exactly like real HarfBuzz output.
    const spans = computeClusterSpans([2, 1, 0], 3);
    expect(spans.get(0)).toBe(1);
    expect(spans.get(1)).toBe(1);
    expect(spans.get(2)).toBe(1);
  });

  it("detects a ligature span when multiple characters collapse onto one cluster", () => {
    // "الله" (4 characters) where the 3 middle characters (ل ل ه, indices 1-3)
    // fuse into a single glyph sharing cluster 1; the leading alef (index 0)
    // stays its own glyph. Clusters given in reverse (RTL) order: 1, 0.
    const spans = computeClusterSpans([1, 0], 4);
    expect(spans.get(0)).toBe(1);
    expect(spans.get(1)).toBe(3);
  });

  it("is agnostic to the glyph array's own order — sorts by cluster value, not array position", () => {
    const forward = computeClusterSpans([0, 1], 4);
    const reversed = computeClusterSpans([1, 0], 4);
    expect(forward).toEqual(reversed);
  });

  it("extends the last cluster's span to the end of the text", () => {
    const spans = computeClusterSpans([0], 5);
    expect(spans.get(0)).toBe(5);
  });
});

describe("getLigatureSchema", () => {
  it("returns undefined for a letter sequence with no authored ligature schema", () => {
    expect(getLigatureSchema(["0628", "0645"])).toBeUndefined();
  });

  it("loads the seeded الله ligature (alif+lam+lam+heh, the plain sequence Wessam.ttf actually fuses)", () => {
    const schema = getLigatureSchema(["0627", "0644", "0644", "0647"]);
    expect(schema).toBeDefined();
    expect(schema!.glyph.id).toBe("ALLAH_LIGATURE_ISOLATED");
    expect(schema!.glyph.role).toBe("ligature");
    expect(schema!.glyph.components.map((c) => c.id)).toEqual(["ALIF_1", "LAM_1", "LAM_2", "HEH_1"]);
  });

  it("is case-insensitive on the codepoint sequence", () => {
    expect(getLigatureSchema(["0627", "0644", "0644", "0647"])).toBe(
      getLigatureSchema(["627", "644", "644", "647"].map((h) => h.padStart(4, "0")))
    );
  });
});

describe("useGlyphSchemaCatalog spine attachment (real HarfBuzz shaping)", () => {
  beforeAll(async () => {
    const hb = await hbPromise;
    expect(typeof hb.shape).toBe("function");
  });

  it("attaches the real spine to the real shaped ra-final glyph in حرف", async () => {
    const { glyphs, font } = await shapeReal("حرف", "TahaNaskhRegular.ttf");
    const table = await loadSpineTable("TahaNaskhRegular");
    expect(table).not.toBeNull();

    // "حرف" is ح ر ف (source indices 0, 1, 2). Locate the shaped glyph for
    // ر (cluster 1) rather than assuming array position — HarfBuzz emits
    // glyphs for RTL text in visual (reverse-of-typed) order.
    const raIndex = glyphs.findIndex((g) => g.cl === 1);
    expect(raIndex).toBeGreaterThanOrEqual(0);
    const raGlyphId = glyphs[raIndex].g;
    const tableEntry = table!.glyphs[String(raGlyphId)];
    expect(tableEntry).toBeDefined();
    expect(tableEntry.schemaGlyph).toBe("RA_FINAL");
    const expectedSpine = tableEntry.spines[0];

    const { result } = renderHook(() =>
      useGlyphSchemaCatalog("حرف", glyphs, font, "TahaNaskhRegular")
    );

    await waitFor(() => {
      const defs = result.current[raIndex] ?? [];
      expect(defs.length).toBeGreaterThan(0);
      // The schema lookup (character + joining form) independently resolved
      // this glyph's letterform name; asserting it matches the spine
      // table's own recorded schemaGlyph is what makes the id-based pairing
      // meaningful rather than a coincidental stroke-id match.
      expect(defs[0].glyphName).toBe(tableEntry.schemaGlyph);
      const withSpine = defs.find(
        (d) => d.strokeId === expectedSpine.strokeId && d.zoneIndex === expectedSpine.zoneIndex
      );
      expect(withSpine?.spine?.points).toEqual(expectedSpine.points);
    });
  });

  it("leaves every definition's spine undefined for a font with no spine table", async () => {
    const { glyphs, font } = await shapeReal("حرف", "Ruqaa.ttf");
    expect(await loadSpineTable("Ruqaa")).toBeNull();

    const { result } = renderHook(() =>
      useGlyphSchemaCatalog("حرف", glyphs, font, "Ruqaa")
    );

    await waitFor(() => {
      const allDefs = Object.values(result.current).flat();
      // Assert non-emptiness explicitly first — a catalog that happened to
      // be empty would make the loop below vacuously true and prove nothing.
      expect(allDefs.length).toBeGreaterThan(0);
      for (const def of allDefs) expect(def.spine).toBeUndefined();
    });
  });
});
