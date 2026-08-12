export type BlockType = "text" | "shapeFill" | "shapeWarp" | "image" | "textPath";
export type FontStyle = "normal" | "bold" | "italic" | "bold italic";
export type TextAlign = "left" | "center" | "right";
export type ShapeWarpMode = "envelope" | "topBottom" | "stretch" | "radial";

/**
 * Restricts a stretch handle to a subset of a glyph's outline points, for
 * letter pairs a font's ligature table has fused into one glyph/contour
 * (band-falloff alone can't tell "the haa's tail" from "the ra" apart in
 * that case). Absent = today's whole-glyph band falloff, unchanged.
 *  - "contours": only points in these closed sub-paths of the glyph outline
 *    (0-indexed in path-command order) are eligible for displacement.
 *  - "lasso": only points inside this freehand polygon (same coordinate
 *    space as anchorX/dragX above) are eligible.
 */
export type GlyphStretchMask =
  | { mode: "contours"; contourIndices: number[] }
  | { mode: "lasso"; points: { x: number; y: number }[] };

export type GlyphStretchHandle = {
  id: string;
  anchorX: number;
  anchorY: number;
  /** Captured once at creation — the reference axis length/direction the drag delta is measured against. */
  dragOriginX: number;
  dragOriginY: number;
  /** Live, draggable position. */
  dragX: number;
  dragY: number;
  bandWidth: number;
  mask?: GlyphStretchMask;
  /** True while `mask` is auto-derived from the anchor/drag points' current position on the real glyph outline (see lib/glyphContours.ts) — recomputed on every drag. Set to false the moment the user manually authors a mask via By-stroke/Lasso, so their choice is never overwritten. Absent (pre-existing handles) = leave alone. */
  maskAuto?: boolean;

  // Stroke-schema linkage (lib/strokeSchema) — set only when this handle was
  // created from a schema-driven catalog entry (see MorphGlyphEditor's "add
  // named stretch" buttons). Absent = a plain freehand handle, behaving
  // exactly as before this feature existed.
  /** The schema Stroke.id this handle represents, for display/bookkeeping only. */
  schemaStrokeId?: string;
  /** Which of that stroke's stretchZones (see strokeSchema/deriveCatalog.ts's StretchDefinition.zoneIndex) this handle represents — a stroke can have more than one independently named zone (e.g. Height vs Length). Absent = zone 0 (every pre-existing handle, from single-zone strokes). */
  schemaZoneIndex?: number;
  /** Multiplier applied on top of the anchor->drag axis (same role as a rig axis's [-1,1] value), driven by the "Kashida amount" slider. Absent/1 = today's un-scaled behavior. */
  factor?: number;
  minFactor?: number;
  maxFactor?: number;
  kashidaEligible?: boolean;
  priority?: number;
};

export type GlyphEdit = {
  glyphIndex: number;
  stretches: GlyphStretchHandle[];
};

/**
 * A named, reusable deformation axis for one specific letterform in one
 * specific font (keyed by fontFamily + HarfBuzz glyph id elsewhere) — the
 * "rig" a user authors once and reuses across every occurrence of that
 * letterform, in any block, forever. Geometry is em-relative (raw pixel
 * value divided by the authoring block's fontSize) so the same axis
 * reapplies at the correct visual proportion on a block using a different
 * fontSize.
 */
export type GlyphRigAxis = {
  id: string;
  name: string;
  anchorX: number;
  anchorY: number;
  dragOriginX: number;
  dragOriginY: number;
  dragX: number;
  dragY: number;
  bandWidth: number;
  /** Same meaning as GlyphStretchHandle.mask; "lasso" points are em-relative like the rest of this axis's geometry. */
  mask?: GlyphStretchMask;
};

export type GlyphRig = {
  fontFamily: string;
  glyphId: number;
  axes: GlyphRigAxis[];
};

/** Per-block live control value for one rig axis, in [-1, 1]. */
export type GlyphRigValue = {
  axisId: string;
  value: number;
};

/**
 * A per-instance manual adjustment to one shaped diacritic glyph — keyed
 * by glyphIndex, the same scheme GlyphStretchHandle already uses (and
 * shares its known fragility: a text edit before this glyph in the string
 * can shift which glyph index the override lands on after re-shaping).
 */
export type DiacriticOverride = {
  glyphIndex: number;
  /** Multiplier on the diacritic's natural size. Default 1. */
  scale?: number;
  /** Extra vertical shift in local (unscaled) units. Default 0. */
  offsetY?: number;
  /** When true, this instance is skipped entirely during drawing. */
  hidden?: boolean;
};

type BlockCommon = {
  id: number;
  name?: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontStyle?: FontStyle;
  opacity?: number;
  stroke: string;
  strokeWidth?: number;
  shadowColor: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  locked?: boolean;
  rotation?: number;
  ornamental?: boolean;
  groupId?: number;

  // Per-glyph editing (Stretch Line tool) — shared across text, shapeFill,
  // and shapeWarp blocks; not meaningful on image blocks.
  glyphEditTool?: "stretch" | null;
  selectedGlyphIndex?: number | null;
  glyphEdits?: GlyphEdit[];
  glyphRigValues?: GlyphRigValue[];
  /** Which stretch handle (if any) is currently having its point mask authored, and how — text blocks only for now. */
  glyphMaskEdit?: { handleId: string; mode: "contours" | "lasso" } | null;
  /** Block-level "Kashida" slider (0-100) — proportionally scales every kashida-eligible, schema-backed stretch handle's `factor` toward its `maxFactor`, weighted by each handle's `priority`. */
  kashidaAmount?: number;
  /**
   * Per-instance diacritic adjustments. Lives on BlockCommon rather than
   * TextBlock because plain text, shapeFill, and shapeWarp blocks all
   * support the on-canvas diacritic handles; image and textPath blocks
   * inherit it unused, the same intentional simplification glyphEdits
   * already makes.
   */
  diacriticOverrides?: DiacriticOverride[];

  // Shared shape-import fields. shapeFill and shapeWarp blocks both carry an
  // uploaded SVG path, and shapeWarp falls back to shapeWidth/shapeHeight
  // when warpShapeWidth/warpShapeHeight aren't set, so these stay common
  // rather than being duplicated per type.
  shapeSvgPath?: string;
  shapeWidth?: number;
  shapeHeight?: number;
};

export type TextBlock = BlockCommon & {
  type: "text";
  align?: TextAlign;
  lineHeight?: number;
  warpX?: number;
  warpY?: number;
  kashidaEditMode?: boolean;
};

export type ShapeFillBlock = BlockCommon & {
  type: "shapeFill";
  shapeScale?: number;
  shapeFillSpacing?: number;
  shapeFillScaleX?: number;
  shapeFillScaleY?: number;
  shapeFillTextRotation?: number;
  /** Arms the on-canvas diacritic hover handles. Opt-in on shapeFill only: a fill tiles its glyph run across the whole silhouette, so the handles' scanline layout pass and their per-instance hit rects are real cost. */
  diacriticEditMode?: boolean;
};

export type ShapeWarpBlock = BlockCommon & {
  type: "shapeWarp";
  warpShapeWidth?: number;
  warpShapeHeight?: number;
  warpShapePadding?: number;
  warpShapeStrength?: number;
  warpShapeMode?: ShapeWarpMode;
};

export type ImageBlock = BlockCommon & {
  type: "image";
  imageDataUrl: string;
  imageScale?: number;
};

export type TextPathBlock = BlockCommon & {
  type: "textPath";
  /** SVG path `d` string defining the curve the text follows. */
  textPathD: string;
  /** Manual override for which end of the curve the text starts from. */
  textPathReversed?: boolean;
  /** Perpendicular offset of the text baseline from the curve; 0 = on the curve. */
  textPathBaselineOffset?: number;
  /** True while the on-canvas pen-tool curve editor is active for this block. */
  textPathEditMode?: boolean;
};

export type Block = TextBlock | ShapeFillBlock | ShapeWarpBlock | ImageBlock | TextPathBlock;
