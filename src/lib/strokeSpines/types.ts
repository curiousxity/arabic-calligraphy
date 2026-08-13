/**
 * A stroke's spine on one real glyph of one real font: a polyline lying on
 * that glyph's medial axis, in font units, y-up, relative to the glyph's own
 * origin.
 *
 * This replaces the proportional bounding-box mapping in
 * strokeSchema/schemaGeometry.ts, which Phase C measured at median 0.37 nuqta
 * / p90 1.43 from real ink. See
 * docs/superpowers/specs/2026-08-13-stroke-spine-reanchoring-design.md.
 */
export type SpinePoint = {
  x: number;
  y: number;
  /** Distance to the outline at this point — half the local stroke width. Sizes the displacement band. */
  radius: number;
};

export type StrokeSpine = {
  /** Schema Stroke.id this spine was matched to. */
  strokeId: string;
  /** Which of that stroke's stretchZones — see deriveCatalog.ts's StretchDefinition.zoneIndex. */
  zoneIndex: number;
  /** At least two points, ordered from the zone's fromNode end to its toNode end. */
  points: SpinePoint[];
};

export type GlyphSpines = {
  /** The schema GlyphDescription.glyph.id this glyph was matched against, for traceability. */
  schemaGlyph: string;
  spines: StrokeSpine[];
};

export type SpineTable = {
  font: string;
  unitsPerEm: number;
  /** SHA-256 of the font file this was generated from. spineTable.test.ts re-hashes and compares, so a regenerated font with a stale table fails loudly. */
  fontSha256: string;
  /** Keyed by font glyph id, as a decimal string (JSON object keys are strings). */
  glyphs: Record<string, GlyphSpines>;
};
