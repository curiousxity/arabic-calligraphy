/**
 * Shapes the practice-sheet text and builds the PDF.
 *
 * This file imports `./harfbuzz`, so Vitest cannot load it. It only shapes
 * and measures; the painting is `drawPracticeSheet` in the harfbuzz-free
 * `practiceSheetDraw.ts`, which is unit-tested with real fonts. jsPDF is
 * imported lazily, as `useExport.ts` does, so it stays out of the main bundle.
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
import { drawPracticeSheet } from "./practiceSheetDraw";

export { glyphPathToPdfOps, practiceSheetFilename, type PdfPathOp } from "./practiceSheetPaths";

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

  drawPracticeSheet(pdf, layout, shaped.glyphs, shaped.font, upm);
  return { pdf, layout };
}
