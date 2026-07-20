export type BlockType = "text" | "shapeFill" | "shapeWarp" | "image";
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
  embossStrength?: number;
  embossHighlightColor: string;
  embossShadowColor: string;
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

export type Block = TextBlock | ShapeFillBlock | ShapeWarpBlock | ImageBlock;
