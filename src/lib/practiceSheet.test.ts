/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import { normalizeGlyphs } from "./normalizeGlyphs";
import { nuqtaUnits } from "./nuqta";
import {
  DEFAULT_PRACTICE_SHEET_OPTIONS,
  FOOTER_RESERVE_MM,
  MIN_NIB_MM,
  PAGE_SIZES_MM,
  emHeightFromScale,
  layoutPracticeSheet,
  measuredRunFromGlyphs,
  type MeasuredRun,
  type PracticeSheetOptions,
} from "./practiceSheet";

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

/** A synthetic run with round numbers so the arithmetic is checkable by hand. */
const syntheticRun = (advanceUnits: number): MeasuredRun => ({
  advanceUnits,
  inkTopUnits: 800,
  inkBottomUnits: -200,
  // Ink spans exactly the advance, so the ink arithmetic equals the advance arithmetic.
  inkLeftUnits: 0,
  inkRightUnits: advanceUnits,
  unitsPerEm: 1000,
});

const opts = (over: Partial<PracticeSheetOptions> = {}): PracticeSheetOptions => ({
  ...DEFAULT_PRACTICE_SHEET_OPTIONS,
  fontFamily: "Thuluth",
  ...over,
});

describe("emHeightFromScale", () => {
  it("derives the em from nib width through the font's nuqta ratio", () => {
    const ratio = nuqtaUnits("Thuluth", 1); // 0.0918
    expect(emHeightFromScale({ nibWidthMm: 4 }, "Thuluth")).toBeCloseTo(4 / ratio, 6);
  });

  it("uses a direct em height unchanged", () => {
    expect(emHeightFromScale({ emHeightMm: 30 }, "Thuluth")).toBe(30);
  });

  it("clamps a non-positive nib width", () => {
    const ratio = nuqtaUnits("Thuluth", 1);
    expect(emHeightFromScale({ nibWidthMm: 0 }, "Thuluth")).toBeCloseTo(MIN_NIB_MM / ratio, 6);
    expect(emHeightFromScale({ nibWidthMm: Number.NaN }, "Thuluth")).toBeCloseTo(MIN_NIB_MM / ratio, 6);
  });
});

describe("layoutPracticeSheet", () => {
  it("reports the page size and a nuqta equal to the nib when nothing shrinks", () => {
    const layout = layoutPracticeSheet(opts({ scale: { nibWidthMm: 4 } }), syntheticRun(2000));
    expect(layout.pageMm).toEqual(PAGE_SIZES_MM.a4);
    expect(layout.fitScale).toBe(1);
    expect(layout.nuqtaMm).toBeCloseTo(4, 6);
    expect(layout.emHeightMm).toBeCloseTo(emHeightFromScale({ nibWidthMm: 4 }, "Thuluth"), 6);
  });

  it("lays rows out model, trace, blank in order with real row heights", () => {
    const layout = layoutPracticeSheet(
      opts({ scale: { emHeightMm: 20 }, rows: { model: 1, trace: 2, blank: 1 } }),
      syntheticRun(1000)
    );
    expect(layout.rows.map((r) => r.kind)).toEqual(["model", "trace", "trace", "blank"]);
    // Row height = (800 - -200)/1000 * 20 + one nuqta of air.
    const rowHeight = 20 + layout.nuqtaMm;
    const first = layout.rows[0].baselineY;
    expect(first).toBeCloseTo(layout.marginMm + layout.nuqtaMm / 2 + (800 / 1000) * 20, 6);
    expect(layout.rows[1].baselineY - first).toBeCloseTo(rowHeight, 6);
    expect(layout.rows[3].baselineY - layout.rows[2].baselineY).toBeCloseTo(rowHeight, 6);
  });

  it("right-aligns the run to the printable area", () => {
    const layout = layoutPracticeSheet(opts({ scale: { emHeightMm: 20 } }), syntheticRun(1500));
    // 1500 units at a 20 mm em is 30 mm wide.
    expect(layout.runWidthMm).toBeCloseTo(30, 6);
    for (const row of layout.rows) {
      expect(row.leftX).toBeCloseTo(PAGE_SIZES_MM.a4.width - layout.marginMm - 30, 6);
    }
  });

  it("shrinks an over-wide run to the printable width and reports fitScale", () => {
    const o = opts({ scale: { nibWidthMm: 4 }, marginMm: 15 });
    const layout = layoutPracticeSheet(o, syntheticRun(20000)); // far wider than A4
    expect(layout.fitScale).toBeLessThan(1);
    expect(layout.runWidthMm).toBeCloseTo(PAGE_SIZES_MM.a4.width - 2 * 15, 6);
    expect(layout.nuqtaMm).toBeCloseTo(4 * layout.fitScale, 6);
    expect(layout.footer).toContain("nuqta");
  });

  it("drops rows that do not fit and says how many", () => {
    const layout = layoutPracticeSheet(
      opts({ scale: { emHeightMm: 60 }, rows: { model: 1, trace: 10, blank: 10 } }),
      syntheticRun(1000)
    );
    expect(layout.rows.length).toBeLessThan(21);
    expect(layout.droppedRows).toBe(21 - layout.rows.length);
    const last = layout.rows[layout.rows.length - 1];
    expect(last.baselineY).toBeLessThan(PAGE_SIZES_MM.a4.height - layout.marginMm);
  });

  it("returns no rows for an empty run", () => {
    const layout = layoutPracticeSheet(opts(), syntheticRun(0));
    expect(layout.rows).toEqual([]);
    expect(layout.droppedRows).toBe(0);
  });

  it("spaces grid lines one nuqta apart across the printable area", () => {
    const layout = layoutPracticeSheet(opts({ scale: { nibWidthMm: 5 } }), syntheticRun(1000));
    expect(layout.grid.heavyEvery).toBe(5);
    expect(layout.grid.x[0]).toBeCloseTo(layout.marginMm, 6);
    expect(layout.grid.x[1] - layout.grid.x[0]).toBeCloseTo(5, 6);
    const lastX = layout.grid.x[layout.grid.x.length - 1];
    expect(lastX).toBeLessThanOrEqual(PAGE_SIZES_MM.a4.width - layout.marginMm + 1e-9);
    expect(layout.grid.y[0]).toBeCloseTo(layout.marginMm, 6);
  });

  it("floors the grid pitch at 2 mm by stepping whole nuqta", () => {
    const tiny = layoutPracticeSheet(opts({ scale: { nibWidthMm: 0.5 } }), syntheticRun(1000));
    expect(tiny.gridEveryNuqta).toBe(Math.ceil(2 / tiny.nuqtaMm));
    expect(tiny.gridPitchMm).toBeCloseTo(tiny.nuqtaMm * tiny.gridEveryNuqta, 9);
    expect(tiny.gridPitchMm).toBeGreaterThanOrEqual(2);
    expect(tiny.grid.x[1] - tiny.grid.x[0]).toBeCloseTo(tiny.gridPitchMm, 9);
    expect(tiny.footer).toContain(` \u00b7 grid every ${tiny.gridEveryNuqta} nuqta`);
    const normal = layoutPracticeSheet(opts({ scale: { nibWidthMm: 4 } }), syntheticRun(1000));
    expect(normal.gridEveryNuqta).toBe(1);
    expect(normal.gridPitchMm).toBeCloseTo(4, 9);
    expect(normal.footer).not.toContain("grid every");
  });

  it("falls back to a 15 mm margin when marginMm is NaN", () => {
    const layout = layoutPracticeSheet(opts({ marginMm: Number.NaN }), syntheticRun(1000));
    expect(layout.marginMm).toBe(15);
    expect(Number.isFinite(layout.rows[0].baselineY)).toBe(true);
  });

  it("draws the footer inside its reserve, below the last grid line and above the margin", () => {
    const layout = layoutPracticeSheet(opts(), syntheticRun(1000));
    const bottomMargin = layout.pageMm.height - layout.marginMm;
    expect(layout.footerY).toBeLessThan(bottomMargin);
    expect(layout.footerY).toBeGreaterThan(bottomMargin - FOOTER_RESERVE_MM);
    const lastGridY = layout.grid.y[layout.grid.y.length - 1];
    expect(layout.footerY).toBeGreaterThan(lastGridY);
  });

  it("states an em-mode shrink in the footer with the requested em", () => {
    const shrunk = layoutPracticeSheet(opts({ scale: { emHeightMm: 40 } }), syntheticRun(20000));
    expect(shrunk.fitScale).toBeLessThan(1);
    expect(shrunk.footer).toContain(" (shrunk to fit from 40.0 mm)");
    const fits = layoutPracticeSheet(opts({ scale: { emHeightMm: 40 } }), syntheticRun(1000));
    expect(fits.fitScale).toBe(1);
    expect(fits.footer).not.toContain("shrunk");
  });

  it("fits and right-aligns on the ink, not the advance", () => {
    // Ink starts 500 units left of the pen origin and overhangs the advance by 100.
    const run: MeasuredRun = { ...syntheticRun(1000), inkLeftUnits: -500, inkRightUnits: 1100 };
    const layout = layoutPracticeSheet(opts({ scale: { emHeightMm: 20 } }), run);
    expect(layout.runWidthMm).toBeCloseTo((1600 / 1000) * 20, 6);
    const right = PAGE_SIZES_MM.a4.width - layout.marginMm;
    expect(layout.rows[0].leftX + (1100 / 1000) * 20).toBeCloseTo(right, 6);
  });

  it("uses Letter dimensions when asked", () => {
    const layout = layoutPracticeSheet(opts({ page: "letter" }), syntheticRun(1000));
    expect(layout.pageMm).toEqual(PAGE_SIZES_MM.letter);
  });
});

describe("measuredRunFromGlyphs (real font)", () => {
  it("sums real advances and measures the run's ink extent", async () => {
    const { glyphs, font, unitsPerEm } = await shapeReal("محمد", "Amiri.ttf");
    const run = measuredRunFromGlyphs(glyphs, font, unitsPerEm);
    const expected = glyphs.reduce((s, g) => s + (g.ax ?? 0), 0);
    expect(run.advanceUnits).toBe(expected);
    expect(run.advanceUnits).toBeGreaterThan(0);
    expect(run.inkTopUnits).toBeGreaterThan(0);
    expect(run.inkBottomUnits).toBeLessThanOrEqual(0);
    expect(run.inkTopUnits).toBeLessThan(font.ascender);
    expect(run.unitsPerEm).toBe(unitsPerEm);
  });

  it("keeps a real Amiri run inside the margin at a 3 mm nib", async () => {
    const { glyphs, font, unitsPerEm } = await shapeReal("بسم الله", "Amiri.ttf");
    const run = measuredRunFromGlyphs(glyphs, font, unitsPerEm);
    const layout = layoutPracticeSheet(
      opts({ fontFamily: "Amiri", scale: { nibWidthMm: 3 } }),
      run
    );
    expect(layout.rows.length).toBeGreaterThan(0);
    const scale = layout.emHeightMm / run.unitsPerEm;
    const inkRight = layout.rows[0].leftX + run.inkRightUnits * scale;
    const inkLeft = layout.rows[0].leftX + run.inkLeftUnits * scale;
    expect(inkRight).toBeCloseTo(layout.pageMm.width - layout.marginMm, 6);
    expect(inkLeft).toBeGreaterThanOrEqual(layout.marginMm - 1e-6);
    expect(inkRight - inkLeft).toBeCloseTo(layout.runWidthMm, 6);
  });

  it("measures ink left and right from pen position, dx and the glyph box", async () => {
    const { glyphs, font, unitsPerEm } = await shapeReal("بسم الله الرحمن الرحيم", "Thuluth.ttf");
    const run = measuredRunFromGlyphs(glyphs, font, unitsPerEm);
    let pen = 0;
    let left = Infinity;
    let right = -Infinity;
    for (const g of glyphs) {
      const glyph = font.glyphs.get(g.g);
      if (glyph.path.commands.length > 0) {
        const box = glyph.getBoundingBox();
        left = Math.min(left, pen + (g.dx ?? 0) + box.x1);
        right = Math.max(right, pen + (g.dx ?? 0) + box.x2);
      }
      pen += g.ax ?? 0;
    }
    expect(run.inkLeftUnits).toBe(left);
    expect(run.inkRightUnits).toBe(right);
    // The reason the fit is on ink: this run's swash starts left of the pen origin.
    expect(run.inkLeftUnits).toBeLessThan(0);
  });

  it("keeps a shrunk Thuluth basmala's ink inside both margins at a 4 mm nib on A4", async () => {
    const { glyphs, font, unitsPerEm } = await shapeReal("بسم الله الرحمن الرحيم", "Thuluth.ttf");
    const run = measuredRunFromGlyphs(glyphs, font, unitsPerEm);
    const layout = layoutPracticeSheet(
      opts({ fontFamily: "Thuluth", page: "a4", scale: { nibWidthMm: 4 } }),
      run
    );
    expect(layout.fitScale).toBeLessThan(1);
    const scale = layout.emHeightMm / run.unitsPerEm;
    for (const row of layout.rows) {
      expect(row.leftX + run.inkLeftUnits * scale).toBeGreaterThanOrEqual(layout.marginMm - 1e-6);
      expect(row.leftX + run.inkRightUnits * scale).toBeCloseTo(
        layout.pageMm.width - layout.marginMm,
        6
      );
    }
  });
});
