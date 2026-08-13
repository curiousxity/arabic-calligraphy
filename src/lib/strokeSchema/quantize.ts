import { nuqtaEmRatio } from "../nuqta";

/**
 * Half a nuqta, expressed as a step in *factor* space.
 *
 * A stroke `lengthDots` nuqta long, stretched by `factor`, becomes
 * `lengthDots * factor` nuqta long — so a half-nuqta increment of length is a
 * `0.5 / lengthDots` increment of factor. Note this needs no per-font
 * measurement at all: it is pure schema arithmetic. The font's measured
 * nuqta (lib/nuqta.ts) is used only to decide whether the font is *in scope*
 * for this feature, and to size the join-pin radius in lib/joinPins.ts.
 */
export function halfNuqtaFactorStep(lengthDots: number | undefined): number | null {
  if (lengthDots == null || !(lengthDots > 0)) return null;
  return 0.5 / lengthDots;
}

/**
 * Snaps a stretch factor to the nearest half-nuqta of **added** length.
 *
 * Snapping the *added* length rather than the absolute length is the whole
 * point: a stroke's natural `lengthDots` is generally not itself a
 * half-nuqta multiple (beh's body is 4.2), so snapping `lengthDots * factor`
 * to a half-nuqta grid would move `factor = 1` off the font's own natural
 * rendering — silently violating the rule that factor 1 renders exactly as
 * it does today. `1 + round((factor - 1) / step) * step` maps 1 to itself
 * exactly, at every step size.
 */
export function quantizeFactor(
  factor: number,
  step: number | null,
  minFactor: number,
  maxFactor: number
): number {
  if (step == null || !(step > 0)) return factor;
  const snapped = 1 + Math.round((factor - 1) / step) * step;
  return Math.max(minFactor, Math.min(maxFactor, snapped));
}

/** How much length this factor adds, in nuqta — the number a calligrapher would name. Null when the stroke authored no length. */
export function addedNuqta(factor: number, lengthDots: number | undefined): number | null {
  if (lengthDots == null || !(lengthDots > 0)) return null;
  return lengthDots * (factor - 1);
}

/** Renders `addedNuqta`'s figure the way a calligrapher writes it: "+1½ nuqta", "−½ nuqta", "natural". */
export function formatNuqtaDelta(added: number | null): string {
  if (added == null) return "";
  const halves = Math.round(added * 2);
  if (halves === 0) return "natural";

  const sign = halves < 0 ? "−" : "+";
  const abs = Math.abs(halves);
  const whole = Math.floor(abs / 2);
  const half = abs % 2 === 1;
  const magnitude = `${whole > 0 ? whole : ""}${half ? "½" : ""}`;
  return `${sign}${magnitude} nuqta`;
}

/**
 * The one entry point the app uses: snap this factor if — and only if —
 * snapping is switched on, the font is one whose nuqta has actually been
 * measured, and the stroke authored a length to measure against. Any of
 * those missing returns the factor untouched, which is what gives the
 * out-of-scope fonts (Ruq'ah, Diwani) their correct behaviour for free.
 *
 * Snapping is deliberately applied at *edit* time only, never on load and
 * never in a renderer, so a deliberately off-grid value saved by a user
 * round-trips through save/load unchanged.
 */
export function snapStretchFactor(args: {
  factor: number;
  lengthDots?: number;
  fontFamily: string;
  minFactor: number;
  maxFactor: number;
  enabled: boolean;
}): number {
  if (!args.enabled) return args.factor;
  if (nuqtaEmRatio(args.fontFamily) == null) return args.factor;
  return quantizeFactor(
    args.factor,
    halfNuqtaFactorStep(args.lengthDots),
    args.minFactor,
    args.maxFactor
  );
}
