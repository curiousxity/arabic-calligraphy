export type BlockType = "text" | "shapeFill" | "shapeWarp";
export type FontStyle = "normal" | "bold" | "italic" | "bold italic";
export type TextAlign = "left" | "center" | "right";
export type ShapeWarpMode = "envelope" | "topBottom" | "stretch" | "radial";
export type GlyphHandleMode = "pinch" | "move" | "scaleX" | "scaleY";

export type GlyphHandle = {
  id: string;
  x: number;
  y: number;
  radius: number;
  strength: number;
  mode: GlyphHandleMode;
};

export type GlyphWarp = {
  glyphIndex: number;
  handles: GlyphHandle[];
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
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  locked?: boolean;
  rotation?: number;
  ornamental?: boolean;
  groupId?: number;

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
  glyphEditMode?: boolean;
  selectedGlyphIndex?: number | null;
  glyphWarps?: GlyphWarp[];
};

export type Block = TextBlock | ShapeFillBlock | ShapeWarpBlock;
