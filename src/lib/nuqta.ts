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
  Blaka: 0.167,
  FatemiMaqala: 0.1138,
  Gulzar: 0.189,
  HarfCanvasDiwani: 0.0586,
  Kufi: 0.121,
  Kufi2: 0.116,
  Lateef: 0.1016,
  NotoSans: 0.099,
  Qahiri: 0.1067,
  Rabat: 0.092,
  Scheherazade: 0.1118,
  TahaNaskhRegular: 0.1157,
  Thuluth: 0.0918,
  ThuluthDeco: 0.0918,
  UKIJDiwani: 0.1172,
  Urdu: 0.1538,
  Wessam: 0.0762,
  Yekan: 0.1348,
};

/** Thickness of a vertical stem over a horizontal connector — the floor a
 *  stack join thins to on a climb, which is what the pen's slant does.
 *  Measured by scripts/measureNibFloor.mjs. */
const NIB_FLOOR_RATIO: Record<string, number> = {
  // Qahiri, Rabat and Raqq measured above 1 (raw 1.14, 1.27, 1.19) and are
  // clamped to 1 ("never thin"). AlFatemi, FatemiMaqala, Gulzar, Lateef,
  // Scheherazade, Urdu and Wessam yielded no alef stem zone: they fall back.
  Amiri: 0.61,
  Blaka: 0.59,
  HarfCanvasDiwani: 0.4,
  Kufi: 0.97,
  Kufi2: 0.78,
  NotoSans: 0.98,
  Qahiri: 1,
  Rabat: 1,
  RanaKufi: 1,
  Raqq: 1,
  Ruqaa: 0.67,
  TahaNaskhRegular: 0.6,
  Thuluth: 0.5,
  ThuluthDeco: 0.5,
  UKIJDiwani: 0.44,
  Yekan: 0.82,
};
export const FALLBACK_NIB_FLOOR = 0.5;
/** Fonts with a measured entry, for tests. */
export function nibFloorFonts(): string[] {
  return Object.keys(NIB_FLOOR_RATIO);
}
export function nibFloorFraction(fontFamily: string): number {
  return NIB_FLOOR_RATIO[fontFamily] ?? FALLBACK_NIB_FLOOR;
}

/**
 * For the bundled faces whose two measurements disagree or look wrong
 * (Ruqaa, RanaKufi, Raqq — see the 2026-10-14 run in the archive; they need
 * a look by eye) and for every uploaded font, which can never have a
 * measured entry. The library's own median.
 */
export const FALLBACK_RATIO = 0.11;

/** One nuqta, in the same units as a glyph path drawn at `fontSize`. */
export function nuqtaUnits(fontFamily: string, fontSize: number): number {
  return (NUQTA_RATIO[fontFamily] ?? FALLBACK_RATIO) * fontSize;
}
