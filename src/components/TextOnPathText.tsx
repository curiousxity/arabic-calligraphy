import React, { useMemo } from "react";
import { Group, Shape, Rect } from "react-konva";
import type Konva from "konva";
import { parseSvgPath, replayPath } from "../lib/svgPath";
import { pathLength, pathBoundingBox, buildArcTable, pointAtArcLengthFromTable } from "../lib/textPath";
import { useShapedGlyphs } from "../hooks/useShapedGlyphs";

export type TextOnPathTextProps = {
  id?: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  rotation?: number;

  textPathD: string;
  textPathReversed?: boolean;
  textPathBaselineOffset?: number;

  locked?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
};

/**
 * Renders shaped text flowing along an arbitrary curve. Each glyph is drawn
 * as a rigid unit (translate to its curve position, rotate to the local
 * tangent), modeled on ShapedText.tsx's glyph loop — not ShapeWarpText.tsx's
 * per-point remap, since text-on-path doesn't distort individual glyph
 * outlines, it just repositions whole glyphs.
 */
export const TextOnPathText: React.FC<TextOnPathTextProps> = ({
  id,
  text,
  x,
  y,
  fontSize,
  color,
  fontFamily,
  fontStyle = "normal",
  opacity = 1,
  stroke = "#000000",
  strokeWidth = 0,
  shadowColor = "#000000",
  shadowBlur = 0,
  shadowOffsetX = 0,
  shadowOffsetY = 0,
  shadowOpacity = 0.35,
  rotation = 0,
  textPathD,
  textPathReversed = false,
  textPathBaselineOffset = 0,
  locked,
  draggable = true,
  onClick,
  onTap,
  onDblClick,
  onDragMove,
  onDragEnd,
}) => {
  const { glyphs, font, unitsPerEm, hbLoaded } = useShapedGlyphs(text, fontFamily);
  const isItalic = fontStyle === "italic" || fontStyle === "bold italic";

  const parsedCmds = useMemo(() => parseSvgPath(textPathD || ""), [textPathD]);
  const curveLen = useMemo(() => pathLength(parsedCmds), [parsedCmds]);
  // RTL text anchors to the curve's end point by default (walking the
  // reversed flattened point list); textPathReversed flips that per block.
  const walkReversed = !textPathReversed;
  // Built once per curve (not once per glyph, per render) — the arc-length
  // lookup used inside the glyph loop below just does a table scan instead
  // of re-flattening the whole path from scratch every time.
  const arcTable = useMemo(
    () => buildArcTable(parsedCmds, walkReversed),
    [parsedCmds, walkReversed]
  );

  // Bounding box of the curve itself, padded generously since glyphs can
  // extend above/below the baseline (mirrors ShapedText.tsx's hit-rect
  // padding logic, keyed off fontSize instead of measured glyph extents).
  const curveBox = useMemo(() => pathBoundingBox(parsedCmds), [parsedCmds]);
  const pad = Math.max(fontSize, 24);
  const hitX = curveBox.x - pad;
  const hitY = curveBox.y - pad;
  const hitWidth = curveBox.width + pad * 2;
  const hitHeight = curveBox.height + pad * 2;

  return (
    <Group
      id={id}
      x={x}
      y={y}
      rotation={rotation}
      draggable={draggable && !locked}
      onClick={onClick}
      onTap={onTap}
      onDblClick={onDblClick}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      opacity={opacity}
    >
      {/* Transparent hit rect for selection/dragging */}
      <Rect
        x={hitX}
        y={hitY}
        width={hitWidth}
        height={hitHeight}
        fill="transparent"
        strokeEnabled={false}
        listening
      />

      <Shape
        x={hitX}
        y={hitY}
        width={hitWidth}
        height={hitHeight}
        listening={false}
        shadowColor={shadowBlur > 0 ? shadowColor : undefined}
        shadowBlur={shadowBlur}
        shadowOffsetX={shadowOffsetX}
        shadowOffsetY={shadowOffsetY}
        shadowOpacity={shadowOpacity}
        sceneFunc={(ctx) => {
          if (!hbLoaded || !font || parsedCmds.length < 2 || curveLen <= 0) return;

          const scale = fontSize / Math.max(unitsPerEm || 1000, 1);
          let naturalAdvance = 0;
          for (const g of glyphs) naturalAdvance += (g.ax ?? 0) * scale;
          if (naturalAdvance <= 0) return;

          // Auto-fit: the effective size always spans the curve exactly,
          // same idea ShapeFillText already applies per-row to shape width.
          const fitScale = curveLen / naturalAdvance;
          const c2d = ctx as unknown as CanvasRenderingContext2D;

          let cursor = 0;
          for (const g of glyphs) {
            const glyphObj = font.glyphs.get(g.g);
            const advance = (g.ax ?? 0) * scale * fitScale;
            if (!glyphObj) {
              cursor += advance;
              continue;
            }

            const { x: px, y: py, angle } = pointAtArcLengthFromTable(arcTable, cursor);
            const opPath = glyphObj.getPath(0, 0, fontSize * fitScale);

            c2d.save();
            // Shape is positioned at (hitX, hitY), which Konva already
            // applies as a canvas translation before sceneFunc runs — so
            // glyph positions (in the curve's own, un-offset coordinate
            // space) need that same offset subtracted back out here.
            c2d.translate(px - hitX, py - hitY);
            c2d.rotate(angle);
            c2d.translate(0, textPathBaselineOffset);
            if (isItalic) c2d.transform(1, 0, -0.25, 1, 0, 0);

            c2d.fillStyle = color;
            replayPath(c2d, opPath.commands);
            c2d.fill();

            if (strokeWidth > 0) {
              c2d.strokeStyle = stroke;
              c2d.lineWidth = strokeWidth;
              c2d.stroke();
            }

            c2d.restore();
            cursor += advance;
          }
        }}
      />
    </Group>
  );
};

export default TextOnPathText;
