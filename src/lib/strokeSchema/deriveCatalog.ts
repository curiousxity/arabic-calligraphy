import type { ComponentType, GlyphDescription, Stroke } from "./types";

export type StretchDefinition = {
  strokeId: string;
  /** Index into this stroke's own `editBehavior.stretchZones` array — identifies which named axis this definition represents when a stroke has more than one (e.g. "Height" vs "Length" on the same stroke). */
  zoneIndex: number;
  componentType: ComponentType;
  label: { ar?: string; en?: string };
  minFactor: number;
  maxFactor: number;
  kashidaEligible: boolean;
  elongationStrategy: Stroke["editBehavior"]["elongationStrategy"];
  priority: number;
  protectedReasons: string[];
};

/**
 * Flattens a schema entry's components/strokes/stretchZones into one entry
 * per zone — this is what the editor offers as labeled, bounded "add handle"
 * buttons in place of today's single generic one. A stroke with several
 * zones (e.g. an independent Height and Length on the same stroke) yields
 * one definition per zone, each independently addable/draggable; a stroke
 * with exactly one zone (every schema file authored so far) yields exactly
 * one definition, identical to before this supported multiple zones.
 */
export function deriveStretchCatalog(desc: GlyphDescription): StretchDefinition[] {
  const defs: StretchDefinition[] = [];

  for (const component of desc.glyph.components) {
    for (const stroke of component.strokes) {
      const zones = stroke.editBehavior.stretchZones;
      const fallbackLabel = stroke.labels ?? component.semanticLabel ?? {};

      zones.forEach((zone, zoneIndex) => {
        // Only disambiguate the fallback label when there's more than one
        // zone AND the zone didn't author its own — a single-zone stroke
        // (every file so far) keeps today's exact label, unchanged.
        const label =
          zone.label ??
          (zones.length > 1
            ? { ar: fallbackLabel.ar, en: `${fallbackLabel.en ?? component.type} ${zoneIndex + 1}` }
            : fallbackLabel);

        defs.push({
          strokeId: stroke.id,
          zoneIndex,
          componentType: component.type,
          label,
          minFactor: zone.minFactor,
          maxFactor: zone.maxFactor,
          kashidaEligible: stroke.editBehavior.kashidaEligible ?? false,
          elongationStrategy: stroke.editBehavior.elongationStrategy,
          priority: stroke.editBehavior.priority,
          protectedReasons: stroke.editBehavior.protectedZones.map((p) => p.reason),
        });
      });
    }
  }

  return defs;
}
