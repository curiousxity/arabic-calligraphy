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

export type Block = {
  id: number;
  name?: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontStyle?: FontStyle;
  align?: TextAlign;
  lineHeight?: number;

  type: BlockType;
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

  warpX?: number;
  warpY?: number;

  shapeSvgPath?: string;
  shapeWidth?: number;
  shapeHeight?: number;
  shapeScale?: number;
  shapeFillSpacing?: number;
  shapeFillScaleX?: number;
  shapeFillScaleY?: number;
  shapeFillTextRotation?: number;

  warpShapeWidth?: number;
  warpShapeHeight?: number;
  warpShapePadding?: number;
  warpShapeStrength?: number;
  warpShapeMode?: ShapeWarpMode;

  glyphEditMode?: boolean;
  selectedGlyphIndex?: number | null;
  glyphWarps?: GlyphWarp[];
};