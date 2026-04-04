export type BlockType = "text" | "shapeFill";

export type FontStyle = "normal" | "bold" | "italic" | "bold italic";

export type TextAlign = "left" | "center" | "right";

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

  embossStrength?: number;

  shapeSvgPath?: string;
  shapeWidth?: number;
  shapeHeight?: number;
  shapeScale?: number;
  shapeFillSpacing?: number;
  shapeFillScaleX?: number;
  shapeFillScaleY?: number;
  shapeFillTextRotation?: number;
};