/**
 * Practice-sheet page layout, in millimetres.
 *
 * Pure: no React, no Konva, no HarfBuzz. Shaping is injected as a
 * `MeasuredRun` the way `fitToWidth` takes a measurement, so this module is
 * Vitest-importable and the page arithmetic is testable with round numbers.
 *
 * The one idea: **one nuqta on paper equals the nib width.** `nuqta.ts`
 * holds a measured nuqta-to-font-size ratio per face, so the em height in mm
 * is nib ÷ ratio, and the grid is drawn in that unit. See
 * `docs/superpowers/specs/2026-10-09-practice-sheet-design.md`.
 */
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import { nuqtaUnits } from "./nuqta";

export type PracticeSheetPage = "a4" | "letter";
export type PracticeSheetScale = { nibWidthMm: number } | { emHeightMm: number };
export type PracticeSheetRowKind = "model" | "trace" | "blank";

export type PracticeSheetOptions = {
  page: PracticeSheetPage;
  marginMm: number;
  scale: PracticeSheetScale;
  rows: { model: number; trace: number; blank: number };
  fontFamily: string;
};

export type MeasuredRun = {
  /** Sum of glyph advances, font units. */
  advanceUnits: number;
  /** `font.ascender`, font units. */
  ascenderUnits: number;
  /** `font.descender`, font units (negative). */
  descenderUnits: number;
  unitsPerEm: number;
};

export type PracticeSheetRow = {
  kind: PracticeSheetRowKind;
  /** Baseline y from the page top, mm. */
  baselineY: number;
  /** x of the run's left edge, mm. Glyphs walk rightward from here. */
  leftX: number;
};

export type PracticeSheetLayout = {
  pageMm: { width: number; height: number };
  marginMm: number;
  /** Effective em height after any fit shrink, mm. */
  emHeightMm: number;
  /** Effective nuqta after any fit shrink, mm. Also the grid pitch. */
  nuqtaMm: number;
  /** 1 unless the run was wider than the printable area. */
  fitScale: number;
  runWidthMm: number;
  rows: PracticeSheetRow[];
  droppedRows: number;
  grid: { x: number[]; y: number[]; heavyEvery: number };
  footer: string;
};

export const PAGE_SIZES_MM: Record<PracticeSheetPage, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

export const DEFAULT_PRACTICE_SHEET_OPTIONS: Omit<PracticeSheetOptions, "fontFamily"> = {
  page: "a4",
  marginMm: 15,
  scale: { nibWidthMm: 4 },
  rows: { model: 1, trace: 3, blank: 3 },
};

/** Below this a nib makes no sense and the em would explode. */
export const MIN_NIB_MM = 0.5;
/** Space reserved at the page foot for the footer line, mm. */
const FOOTER_RESERVE_MM = 8;
const GRID_HEAVY_EVERY = 5;

function clampNib(nib: number): number {
  return Number.isFinite(nib) && nib >= MIN_NIB_MM ? nib : MIN_NIB_MM;
}

export function emHeightFromScale(scale: PracticeSheetScale, fontFamily: string): number {
  const ratio = nuqtaUnits(fontFamily, 1);
  if ("nibWidthMm" in scale) return clampNib(scale.nibWidthMm) / ratio;
  const em = scale.emHeightMm;
  return Number.isFinite(em) && em > 0 ? em : MIN_NIB_MM / ratio;
}

export function measuredRunFromGlyphs(
  glyphs: HarfBuzzGlyph[],
  font: { ascender: number; descender: number },
  unitsPerEm: number
): MeasuredRun {
  let advanceUnits = 0;
  for (const g of glyphs) advanceUnits += g.ax ?? 0;
  return {
    advanceUnits,
    ascenderUnits: font.ascender,
    descenderUnits: font.descender,
    unitsPerEm: Math.max(unitsPerEm || 1000, 1),
  };
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  if (step <= 0) return out;
  for (let v = from; v <= to + 1e-9; v += step) out.push(v);
  return out;
}

export function layoutPracticeSheet(
  options: PracticeSheetOptions,
  run: MeasuredRun
): PracticeSheetLayout {
  const pageMm = PAGE_SIZES_MM[options.page];
  const marginMm = Math.max(0, Math.min(options.marginMm, Math.min(pageMm.width, pageMm.height) * 0.45));
  const printableW = pageMm.width - 2 * marginMm;
  const printableBottom = pageMm.height - marginMm - FOOTER_RESERVE_MM;

  const ratio = nuqtaUnits(options.fontFamily, 1);
  const upm = Math.max(run.unitsPerEm || 1000, 1);
  const requestedEm = emHeightFromScale(options.scale, options.fontFamily);
  const requestedWidth = (run.advanceUnits / upm) * requestedEm;

  const fitScale = requestedWidth > printableW ? printableW / requestedWidth : 1;
  const emHeightMm = requestedEm * fitScale;
  const nuqtaMm = emHeightMm * ratio;
  const runWidthMm = requestedWidth * fitScale;

  const ascMm = (run.ascenderUnits / upm) * emHeightMm;
  const descMm = (-run.descenderUnits / upm) * emHeightMm;
  const rowHeight = ascMm + descMm + nuqtaMm;
  const leftX = pageMm.width - marginMm - runWidthMm;

  const wanted: PracticeSheetRowKind[] = [];
  if (run.advanceUnits > 0) {
    for (let i = 0; i < options.rows.model; i++) wanted.push("model");
    for (let i = 0; i < options.rows.trace; i++) wanted.push("trace");
    for (let i = 0; i < options.rows.blank; i++) wanted.push("blank");
  }

  const rows: PracticeSheetRow[] = [];
  let top = marginMm;
  for (const kind of wanted) {
    if (top + rowHeight > printableBottom) break;
    rows.push({ kind, baselineY: top + ascMm, leftX });
    top += rowHeight;
  }
  const droppedRows = wanted.length - rows.length;

  const grid = {
    x: range(marginMm, pageMm.width - marginMm, nuqtaMm),
    y: range(marginMm, printableBottom, nuqtaMm),
    heavyEvery: GRID_HEAVY_EVERY,
  };

  const nibNote =
    "nibWidthMm" in options.scale && fitScale < 1
      ? ` (shrunk to fit; your ${clampNib(options.scale.nibWidthMm).toFixed(1)} mm nib is wider)`
      : "";
  const footer = `${options.fontFamily} · em ${emHeightMm.toFixed(1)} mm · nuqta ${nuqtaMm.toFixed(2)} mm${nibNote}`;

  return {
    pageMm,
    marginMm,
    emHeightMm,
    nuqtaMm,
    fitScale,
    runWidthMm,
    rows,
    droppedRows,
    grid,
    footer,
  };
}
