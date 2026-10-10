/**
 * Draws a `PracticeSheetLayout` into a jsPDF document as vector paths: the
 * grid and baselines, the glyph rows, and the footer.
 *
 * Harfbuzz-free on purpose, like `practiceSheetPaths.ts`: shaping happens in
 * `practiceSheetPdf.ts`, which hands the shaped glyphs and the opentype font
 * in here. That keeps the writer Vitest-importable, so a Node test can paint
 * a real sheet with real Amiri into a real jsPDF and inspect the operators.
 * Must not import `./harfbuzz` or `../hooks/useShapedGlyphs`.
 */
import type { jsPDF } from "jspdf";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import type { PracticeSheetLayout, PracticeSheetRow } from "./practiceSheet";
import { glyphPathToPdfOps, type PdfPathOp } from "./practiceSheetPaths";

/**
 * Trace rows are stroked at twice the visible outline width and then filled
 * white over the stroke, so only the outer half survives: 0.15 mm of grey
 * silhouette with no seams where glyphs join or overlap. See the rules note.
 */
export const TRACE_STROKE_MM = 0.3;
export const TRACE_GREY = 0xb4;
const GRID_LIGHT_MM = 0.08;
const GRID_HEAVY_MM = 0.2;
const GRID_GREY = 0xd0;
const BASELINE_MM = 0.25;
const FOOTER_FONT_PT = 8;

/** The minimal opentype surface the writer reads. */
export type DrawFont = {
  glyphs: { get(index: number): { path: { commands: Parameters<typeof glyphPathToPdfOps>[0] } } };
};

function drawRules(pdf: jsPDF, layout: PracticeSheetLayout): void {
  const { grid, marginMm, pageMm } = layout;
  const right = pageMm.width - marginMm;
  const top = grid.y[0] ?? marginMm;
  const bottom = grid.y[grid.y.length - 1] ?? top;

  pdf.setDrawColor(GRID_GREY, GRID_GREY, GRID_GREY);
  grid.x.forEach((x, i) => {
    pdf.setLineWidth(i % grid.heavyEvery === 0 ? GRID_HEAVY_MM : GRID_LIGHT_MM);
    pdf.line(x, top, x, bottom);
  });
  grid.y.forEach((y, i) => {
    pdf.setLineWidth(i % grid.heavyEvery === 0 ? GRID_HEAVY_MM : GRID_LIGHT_MM);
    pdf.line(marginMm, y, right, y);
  });

  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(BASELINE_MM);
  for (const row of layout.rows) {
    pdf.line(marginMm, row.baselineY, right, row.baselineY);
  }
}

/** One row's glyph outlines in PDF space, empty glyphs (spaces) skipped. */
function rowPaths(
  row: PracticeSheetRow,
  glyphs: HarfBuzzGlyph[],
  font: DrawFont,
  scale: number
): PdfPathOp[][] {
  const out: PdfPathOp[][] = [];
  let penX = 0;
  for (const g of glyphs) {
    const glyph = font.glyphs.get(g.g);
    const ox = row.leftX + (penX + (g.dx ?? 0)) * scale;
    const oy = row.baselineY - (g.dy ?? 0) * scale;
    const ops = glyph ? glyphPathToPdfOps(glyph.path.commands, scale, ox, oy) : [];
    if (ops.length > 0) out.push(ops);
    penX += g.ax ?? 0;
  }
  return out;
}

function drawFooter(pdf: jsPDF, layout: PracticeSheetLayout): void {
  pdf.setFontSize(FOOTER_FONT_PT);
  pdf.setTextColor(90, 90, 90);
  pdf.text(layout.footer, layout.marginMm, layout.footerY);
}

/**
 * Paints the whole sheet. `glyphs` are the shaped run (HarfBuzz order, walked
 * left to right from each row's `leftX`), `font` the opentype font they index
 * into, `upm` its units per em.
 */
export function drawPracticeSheet(
  pdf: jsPDF,
  layout: PracticeSheetLayout,
  glyphs: HarfBuzzGlyph[],
  font: DrawFont,
  upm: number
): void {
  drawRules(pdf, layout);

  const scale = layout.emHeightMm / Math.max(upm || 1000, 1);
  for (const row of layout.rows) {
    if (row.kind === "blank") continue;
    const paths = rowPaths(row, glyphs, font, scale);
    if (row.kind === "model") {
      pdf.setFillColor(0, 0, 0);
      for (const ops of paths) {
        pdf.path(ops);
        pdf.fill();
      }
      continue;
    }
    // Trace: every stroke first, then every white fill, so each fill hides the
    // inner half of every stroke and every seam between joined or stacked glyphs.
    pdf.setDrawColor(TRACE_GREY, TRACE_GREY, TRACE_GREY);
    pdf.setLineWidth(TRACE_STROKE_MM);
    for (const ops of paths) {
      pdf.path(ops);
      pdf.stroke();
    }
    pdf.setFillColor(255, 255, 255);
    for (const ops of paths) {
      pdf.path(ops);
      pdf.fill();
    }
  }

  drawFooter(pdf, layout);
}
