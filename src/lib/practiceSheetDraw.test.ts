/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import * as opentype from "opentype.js";
import { jsPDF } from "jspdf";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import { normalizeGlyphs } from "./normalizeGlyphs";
import {
  DEFAULT_PRACTICE_SHEET_OPTIONS,
  layoutPracticeSheet,
  measuredRunFromGlyphs,
} from "./practiceSheet";
import { drawPracticeSheet } from "./practiceSheetDraw";

// harfbuzzjs's CommonJS entrypoint exports a Promise, which Node's ESM
// interop tries to await during a static `import` and throws on. `require`
// sidesteps it. Copied from fitToWidth.test.ts per CLAUDE.md.
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");

type HbModule = {
  createBlob: (data: Uint8Array) => { destroy?: () => void };
  createFace: (blob: unknown, index: number) => { destroy?: () => void };
  createFont: (face: unknown) => {
    setScale?: (x: number, y: number) => void;
    destroy?: () => void;
  };
  createBuffer: () => {
    addText: (t: string) => void;
    guessSegmentProperties?: () => void;
    setDirection?: (d: string) => void;
    setScript?: (s: string) => void;
    setLanguage?: (l: string) => void;
    json: (font?: unknown) => unknown[];
    destroy?: () => void;
  };
  shape: (font: unknown, buffer: unknown) => void;
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
  if (text.length === 0) return { glyphs: [], font: parsedFont, unitsPerEm: upm };

  const hb = await hbPromise;
  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();
  try {
    if (typeof font.setScale === "function") font.setScale(upm, upm);
    buffer.addText(text);
    buffer.guessSegmentProperties?.();
    buffer.setDirection?.("rtl");
    buffer.setScript?.("arab");
    buffer.setLanguage?.("ar");
    hb.shape(font, buffer);
    let raw: unknown[] = [];
    try {
      raw = buffer.json(font);
    } catch {
      raw = buffer.json();
    }
    return { glyphs: normalizeGlyphs(raw as never), font: parsedFont, unitsPerEm: upm };
  } finally {
    buffer.destroy?.();
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

/** Content-stream lines that are exactly the given operator (e.g. `f`, `S`). */
function opLines(raw: string, op: string): number[] {
  const out: number[] = [];
  raw.split("\n").forEach((line, i) => {
    if (line.trim() === op) out.push(i);
  });
  return out;
}

async function paint(rows: { model: number; trace: number; blank: number }) {
  const { glyphs, font, unitsPerEm } = await shapeReal("محمد", "Amiri.ttf");
  const run = measuredRunFromGlyphs(glyphs, font, unitsPerEm);
  const layout = layoutPracticeSheet(
    { ...DEFAULT_PRACTICE_SHEET_OPTIONS, rows, fontFamily: "Amiri" },
    run
  );
  const pdf = new jsPDF({ unit: "mm", format: [210, 297], compress: false });
  drawPracticeSheet(pdf, layout, glyphs, font, unitsPerEm);
  const inked = glyphs.filter((g) => font.glyphs.get(g.g).path.commands.length > 0).length;
  return { pdf, layout, raw: pdf.output(), inked };
}

describe("drawPracticeSheet (real Amiri, real jsPDF)", () => {
  it("paints one page with fills and strokes", async () => {
    const { pdf, layout, raw, inked } = await paint({ model: 1, trace: 3, blank: 3 });
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(layout.rows.length).toBe(7);
    expect(inked).toBeGreaterThan(0);
    // Every inked glyph fills once per model row and once per trace row.
    expect(opLines(raw, "f").length).toBe(inked * (1 + 3));
    // Strokes: every grid line, every baseline, every glyph once per trace row.
    const ruleStrokes = layout.grid.x.length + layout.grid.y.length + layout.rows.length;
    expect(opLines(raw, "S").length).toBe(ruleStrokes + inked * 3);
  });

  it("strokes a trace row's glyphs before filling them white", async () => {
    const { raw, inked } = await paint({ model: 0, trace: 1, blank: 0 });
    const strokes = opLines(raw, "S");
    const fills = opLines(raw, "f");
    expect(fills.length).toBe(inked);
    // The last `inked` strokes are the glyph outlines; all come before the first fill.
    const glyphStrokes = strokes.slice(-inked);
    expect(Math.max(...glyphStrokes)).toBeLessThan(Math.min(...fills));
    // The trace fill is white (jsPDF writes "1. g"), the trace stroke grey ("0.71 G").
    const lines = raw.split("\n");
    expect(lines.slice(0, fills[0]).some((l) => /^1\.?0* g$/.test(l.trim()))).toBe(true);
    expect(lines.slice(0, glyphStrokes[0]).some((l) => /^0\.7\d* G$/.test(l.trim()))).toBe(true);
  });

  it("fills model rows black and never strokes them", async () => {
    const { raw, layout, inked } = await paint({ model: 1, trace: 0, blank: 0 });
    expect(opLines(raw, "f").length).toBe(inked);
    const ruleStrokes = layout.grid.x.length + layout.grid.y.length + layout.rows.length;
    expect(opLines(raw, "S").length).toBe(ruleStrokes);
  });

  it("puts glyph outlines upright inside the row's ink band (catches a y-flip)", async () => {
    const { raw, layout } = await paint({ model: 1, trace: 0, blank: 0 });
    const { glyphs, font, unitsPerEm } = await shapeReal("محمد", "Amiri.ttf");
    const run = measuredRunFromGlyphs(glyphs, font, unitsPerEm);
    const scale = layout.emHeightMm / unitsPerEm;
    const row = layout.rows[0];
    // jsPDF writes y in pt from the page bottom.
    const k = 72 / 25.4;
    const toPt = (mm: number) => (297 - mm) * k;
    const lowPt = toPt(row.baselineY - run.inkBottomUnits * scale) - 1;
    const highPt = toPt(row.baselineY - run.inkTopUnits * scale) + 1;
    // Rules come first; every moveto after the last rule stroke is a glyph's.
    const lines = raw.split("\n");
    const lastRule = opLines(raw, "S").at(-1)!;
    const ys = lines
      .slice(lastRule + 1)
      .map((l) => l.trim().split(/\s+/))
      .filter((t) => t.length === 3 && t[2] === "m")
      .map((t) => Number(t[1]));
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(lowPt);
      expect(y).toBeLessThanOrEqual(highPt);
    }
  });
});
