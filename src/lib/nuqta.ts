/**
 * The nuqta — the rhombic dot a calligrapher's nib makes — is the unit
 * traditional Arabic calligraphy measures stroke length in, and the unit
 * every stroke schema's `lengthDots` is authored in.
 *
 * **It is measured per font, never derived.** The intuitive rule that the
 * alif's stem is one nuqta wide fails badly across this library: `alif/dot`
 * ranges 0.53 (Urdu) to 1.68 (Kufi2), a 3.2x spread where the rule predicts
 * 1.00. `dot/em` itself varies ~2x (0.0762 Wessam to 0.1538 Urdu), so no
 * global constant serves either. The figures below were measured two
 * independent ways — the beh (U+0628) dot contour, and a modal-contour sweep
 * over every glyph in the font — which agree within ~2% on every entry
 * except Yekan, where the beh-dot figure was reviewed and accepted by the
 * user (the ~6% spread is sub-pixel at normal sizes). Full derivation and
 * the per-font confidence column live in
 * docs/superpowers/specs/2026-08-12-per-stroke-editing-design.md.
 *
 * Stored as a dot/em **ratio**, not raw font units, so nuqta-in-pixels is
 * just `ratio * fontSize` with no unitsPerEm plumbing at the call site.
 *
 * `Ruqaa` and `HarfCanvasDiwani` are absent **deliberately**. They were
 * scoped out of per-stroke editing (every stroke schema declares
 * `calligraphicModel: "naskh"`, which fits Diwani's sloped letterforms worst,
 * and Ruq'ah merges dot pairs into strokes, making its measured nuqta the
 * least reliable figure available). An absent font returns `null`, which is
 * what disables nuqta snapping and join pins for it — that null is the
 * out-of-scope mechanism, not an oversight. Do not fill these in with a
 * guess.
 */
export const NUQTA_EM_RATIO: Readonly<Record<string, number>> = {
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

/** The font's nuqta as a proportion of its em, or `null` when the font is out of scope / unknown. */
export function nuqtaEmRatio(fontFamily: string): number | null {
  return NUQTA_EM_RATIO[fontFamily] ?? null;
}

/** The font's nuqta in the same pixel space a block of this `fontSize` renders in, or `null` when out of scope. */
export function nuqtaPx(fontFamily: string, fontSize: number): number | null {
  const ratio = nuqtaEmRatio(fontFamily);
  if (ratio == null) return null;
  return ratio * fontSize;
}
