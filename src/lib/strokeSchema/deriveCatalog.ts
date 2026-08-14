import type { ComponentType, GlyphDescription, Stroke } from "./types";
import { computeNodeBoundingBox, normalizePoint, type Point } from "./schemaGeometry";
import type { StrokeSpine } from "../strokeSpines/types";

export type StretchDefinition = {
  strokeId: string;
  /** Index into this stroke's own `editBehavior.stretchZones` array — identifies which named axis this definition represents when a stroke has more than one (e.g. "Height" vs "Length" on the same stroke). */
  zoneIndex: number;
  componentType: ComponentType;
  /** Identity of the schema glyph this definition came from (schema's own id, e.g. "KAF_MEDIAL") — lets the Morph panel label per-glyph slider groups without re-looking-up the schema. */
  glyphName: string;
  /** The Arabic base letter (or fused letter sequence, for ligatures) this glyph renders — shown as the group heading in the Morph panel. */
  baseLetter: string;
  joiningForm: string;
  /** Cluster (source-character index into shapableText) of the glyph occurrence this catalog entry was derived for — set by useGlyphSchemaCatalog, not by deriveStretchCatalog itself. Orders panel rows in typed order regardless of the shaped glyph array's visual order. */
  cluster?: number;
  label: { ar?: string; en?: string };
  minFactor: number;
  maxFactor: number;
  kashidaEligible: boolean;
  elongationStrategy: Stroke["editBehavior"]["elongationStrategy"];
  priority: number;
  /**
   * The stroke's natural length in nuqta, straight from the schema
   * (`Stroke.lengthDots`). Optional because a schema file may omit it. This
   * is what makes a half-nuqta stretch increment computable:
   * `step = 0.5 / lengthDots` in factor space (see lib/strokeSchema/quantize.ts).
   */
  lengthDots?: number;
  protectedReasons: string[];
  /**
   * The zone's fromNode/toNode, as a 0-1 proportion of the whole glyph's own
   * node bounding box (schema coordinate convention, not yet Y-flipped) —
   * lets a handle's real on-canvas position be auto-derived from wherever
   * this stroke sits within the letterform, with no manual dragging. See
   * lib/strokeSchema/schemaGeometry.ts's mapNormToRealBox for the real-box
   * (Y-flipped) conversion, done at handle-creation time in App.tsx.
   */
  anchorNorm: Point;
  dragNorm: Point;
  /**
   * The stroke's spine on this specific font's real glyph, from the generated
   * tables in src/data/strokeSpines/ — attached by useGlyphSchemaCatalog, not
   * by deriveStretchCatalog, since it is the only place that knows the font.
   *
   * Present = the axis is measured against real ink. Absent = the offline
   * matcher could not verify a match for this stroke on this font, and the
   * stroke offers no handle at all. `anchorNorm`/`dragNorm` remain only as the
   * offline matcher's seed; nothing at runtime maps them any more.
   */
  spine?: StrokeSpine;
};

/**
 * Flattens a schema entry's components/strokes/stretchZones into one entry
 * per zone — this is what the editor offers as labeled, bounded "add handle"
 * buttons in place of today's single generic one. A stroke with several
 * zones (e.g. an independent Height and Length on the same stroke) yields
 * one definition per zone, each independently addable; a stroke with exactly
 * one zone (every schema file authored so far) yields exactly one
 * definition, identical to before this supported multiple zones.
 */
export function deriveStretchCatalog(desc: GlyphDescription): StretchDefinition[] {
  const defs: StretchDefinition[] = [];
  const glyphBBox = computeNodeBoundingBox(desc);

  for (const component of desc.glyph.components) {
    for (const stroke of component.strokes) {
      const zones = stroke.editBehavior.stretchZones;
      const fallbackLabel = stroke.labels ?? component.semanticLabel ?? {};
      const nodes = stroke.path.nodes;

      zones.forEach((zone, zoneIndex) => {
        // Only disambiguate the fallback label when there's more than one
        // zone AND the zone didn't author its own — a single-zone stroke
        // (every file so far) keeps today's exact label, unchanged.
        const label =
          zone.label ??
          (zones.length > 1
            ? { ar: fallbackLabel.ar, en: `${fallbackLabel.en ?? component.type} ${zoneIndex + 1}` }
            : fallbackLabel);

        const fromNode = nodes[zone.fromNode] ?? nodes[0] ?? { x: 0, y: 0 };
        const toNode = nodes[zone.toNode] ?? nodes[nodes.length - 1] ?? fromNode;

        defs.push({
          strokeId: stroke.id,
          zoneIndex,
          componentType: component.type,
          glyphName: desc.glyph.id,
          baseLetter: desc.glyph.baseLetter,
          joiningForm: desc.glyph.joiningForm,
          label,
          minFactor: zone.minFactor,
          maxFactor: zone.maxFactor,
          kashidaEligible: stroke.editBehavior.kashidaEligible ?? false,
          elongationStrategy: stroke.editBehavior.elongationStrategy,
          priority: stroke.editBehavior.priority,
          lengthDots: stroke.lengthDots,
          protectedReasons: stroke.editBehavior.protectedZones.map((p) => p.reason),
          anchorNorm: normalizePoint(fromNode, glyphBBox),
          dragNorm: normalizePoint(toNode, glyphBBox),
        });
      });
    }
  }

  return defs;
}
