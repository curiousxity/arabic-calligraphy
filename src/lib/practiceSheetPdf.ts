/**
 * Draws a `PracticeSheetLayout` into a jsPDF document as vector paths.
 *
 * Model rows fill black; trace rows stroke a hairline grey; blank rows get
 * only the rules. Glyph outlines come from opentype.js (font y up) and are
 * flipped into PDF space (y down) by `glyphPathToPdfOps`. jsPDF is imported
 * lazily, as `useExport.ts` does, so it stays out of the main bundle.
 *
 * The pure pieces live in `practiceSheetPaths.ts` (Vitest-importable); this
 * file imports `./harfbuzz` and is verified in the browser.
 */
import type { jsPDF } from "jspdf";
import { shapeText } from "./harfbuzz";
import { resolveFontUrl } from "../hooks/useShapedGlyphs";
import {
  layoutPracticeSheet,
  measuredRunFromGlyphs,
  type MeasuredRun,
  type PracticeSheetLayout,
  type PracticeSheetOptions,
} from "./practiceSheet";
import { glyphPathToPdfOps } from "./practiceSheetPaths";

export { glyphPathToPdfOps, practiceSheetFilename, type PdfPathOp } from "./practiceSheetPaths";

const TRACE_STROKE_MM = 0.15;
const TRACE_GREY = 0xb4;
const GRID_LIGHT_MM = 0.08;
const GRID_HEAVY_MM = 0.2;
const GRID_GREY = 0xd0;
const BASELINE_MM = 0.25;

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

function drawFooter(pdf: jsPDF, layout: PracticeSheetLayout): void {
  pdf.setFontSize(8);
  pdf.setTextColor(90, 90, 90);
  pdf.text(layout.footer, layout.marginMm, layout.pageMm.height - layout.marginMm + 4);
}

async function shapeRun(text: string, fontFamily: string) {
  const shaped = await shapeText(text, resolveFontUrl(fontFamily));
  const upm = Math.max(shaped.unitsPerEm || 1000, 1);
  return { shaped, upm, run: measuredRunFromGlyphs(shaped.glyphs, shaped.font, upm) };
}

/** Shapes and measures the text; the dialog calls this to lay the sheet out live. */
export async function measurePracticeRun(text: string, fontFamily: string): Promise<MeasuredRun> {
  return (await shapeRun(text, fontFamily)).run;
}

export async function buildPracticeSheetPdf(
  text: string,
  options: PracticeSheetOptions
): Promise<{ pdf: jsPDF; layout: PracticeSheetLayout }> {
  const { shaped, upm, run } = await shapeRun(text, options.fontFamily);
  const layout = layoutPracticeSheet(options, run);

  const { default: JsPDF } = await import("jspdf");
  const pdf = new JsPDF({
    orientation: "portrait",
    compress: true,
    unit: "mm",
    format: [layout.pageMm.width, layout.pageMm.height],
  });

  drawRules(pdf, layout);

  const scale = layout.emHeightMm / upm;
  for (const row of layout.rows) {
    if (row.kind === "blank") continue;
    if (row.kind === "model") {
      pdf.setFillColor(0, 0, 0);
    } else {
      pdf.setDrawColor(TRACE_GREY, TRACE_GREY, TRACE_GREY);
      pdf.setLineWidth(TRACE_STROKE_MM);
    }
    let penX = 0;
    for (const g of shaped.glyphs) {
      const glyph = shaped.font.glyphs.get(g.g);
      const ox = row.leftX + (penX + (g.dx ?? 0)) * scale;
      const oy = row.baselineY - (g.dy ?? 0) * scale;
      const ops = glyphPathToPdfOps(glyph.path.commands, scale, ox, oy);
      if (ops.length > 0) {
        pdf.path(ops);
        if (row.kind === "model") pdf.fill();
        else pdf.stroke();
      }
      penX += g.ax ?? 0;
    }
  }

  drawFooter(pdf, layout);
  return { pdf, layout };
}
