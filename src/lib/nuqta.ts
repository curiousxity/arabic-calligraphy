/**
 * The nuqta (dot) is the classical unit of Arabic calligraphic proportion —
 * a letter's dimensions are given in dots of the pen that wrote it. Stroke
 * extension is expressed in nuqta so a stretch means the same thing at any
 * size and in any face.
 *
 * **These ratios are measured, not derived.** Source:
 * `docs/archive/nuqta-measurements.md`, where each was measured two
 * independent ways and cross-checked by eye — that file exists precisely so
 * this work is never redone. The intuitive "the alif's stem is one nuqta"
 * rule fails across this library by up to 3.2x, which is why the table is
 * per-font. Copy from the archive; never re-derive.
 *
 * The table survived the 2026-08-14 removal of the stroke subsystem in that
 * archive file rather than in code; this module restores it.
 */
const NUQTA_RATIO: Record<string, number> = {
  AlFatemi: 0.0973,
  Amiri: 0.135,
  FatemiMaqala: 0.1138,
  Kufi: 0.121,
  Kufi2: 0.116,
  Lateef: 0.1016,
  NotoSans: 0.099,
  Qahiri: 0.1067,
  Scheherazade: 0.1118,
  TahaNaskhRegular: 0.1157,
  Thuluth: 0.0918,
  ThuluthDeco: 0.0918,
  Urdu: 0.1538,
  Wessam: 0.0762,
  Yekan: 0.1348,
};

/** Thickness of a vertical stem over a horizontal connector — the floor a
 *  stack join thins to on a climb, which is what the pen's slant does.
 *  Measured by scripts/measureNibFloor.mjs. */
const NIB_FLOOR_RATIO: Record<string, number> = {
  AlFatemi: 0.65,
  FatemiMaqala: 0.6,
  HarfCanvasDiwani: 0.39,
  Kufi: 0.97,
  Kufi2: 1,
  Lateef: 0.58,
  NotoSans: 0.99,
  Qahiri: 1,
  Rabat: 0.58,
  RanaKufi: 1,
  Raqq: 0.87,
  Scheherazade: 0.58,
  TahaNaskhRegular: 0.61,
  Thuluth: 0.56,
  ThuluthDeco: 0.56,
  UKIJDiwani: 1,
  Wessam: 0.95,
  Yekan: 0.83,
};
export const FALLBACK_NIB_FLOOR = 0.15;
export function nibFloorFraction(fontFamily: string): number {
  return NIB_FLOOR_RATIO[fontFamily] ?? FALLBACK_NIB_FLOOR;
}

/**
 * For the bundled faces the archive does not cover (HarfCanvasDiwani and
 * UKIJDiwani, which postdate it, and Ruqaa) and for every uploaded font, which can
 * never have a measured entry. The library's own median.
 */
export const FALLBACK_RATIO = 0.11;

/** One nuqta, in the same units as a glyph path drawn at `fontSize`. */
export function nuqtaUnits(fontFamily: string, fontSize: number): number {
  return (NUQTA_RATIO[fontFamily] ?? FALLBACK_RATIO) * fontSize;
}
