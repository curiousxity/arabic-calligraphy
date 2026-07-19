/**
 * ShapeFillText v5
 *
 * Key fix: Konva's sceneFunc context wrapper does NOT support Path2D or the
 * two-argument isPointInPath(path, x, y) form. All path operations must use
 * the standard beginPath() / moveTo / lineTo / bezierCurveTo / clip() API
 * that Konva forwards to the underlying canvas context.
 *
 * Strategy:
 *  - Parse the SVG path string into an array of command objects once (memoized).
 *  - Replay those commands via ctx.beginPath() + individual draw calls for clipping.
 *  - For scanline hit-testing, use a simple ray-casting polygon approximation
 *    (sample the path outline into a polygon, then test each scanline point).
 *  - shapeScale, emboss, stroke all preserved.
 */

import React, { useMemo } from "react";
import { Group, Shape, Rect, Circle } from "react-konva";
import type Konva from "konva";
import {
  parseSvgPath,
  pathToPolygon,
  pointInPolygon,
  type SvgCmd,
} from "../lib/svgPath";
import { useShapedGlyphs } from "../hooks/useShapedGlyphs";

export type ShapeFillTextProps = {
  id?: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  shapeSvgPath: string;
  shapeWidth: number;
  shapeHeight: number;
  shapeScale?: number;
  shapeFillSpacing?: number;
  shapeFillScaleX?: number;
  shapeFillScaleY?: number;
  shapeFillTextRotation?: number;
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  embossStrength?: number;
  embossHighlightColor?: string;
  embossShadowColor?: string;
  rotation?: number;
  locked?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  isSelected?: boolean;
  onResizeScale?: (newScale: number) => void;
};

// ─── SVG path parser ──────────────────────────────────────────────────────────

/** Replay parsed SVG commands onto a canvas context (no Path2D needed). */
function replayPath(ctx: CanvasRenderingContext2D, cmds: SvgCmd[]) {
  ctx.beginPath();
  for (const c of cmds) {
    switch (c.type) {
      case "M": ctx.moveTo(c.x, c.y); break;
      case "L": ctx.lineTo(c.x, c.y); break;
      case "C": ctx.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y); break;
      case "Q": ctx.quadraticCurveTo(c.x1, c.y1, c.x, c.y); break;
      case "Z": ctx.closePath(); break;
    }
  }
}

function drawCommandsToCtx(ctx: CanvasRenderingContext2D, commands: SvgCmd[]) {
  ctx.beginPath();
  for (const cmd of commands) {
    switch (cmd.type) {
      case "M": ctx.moveTo(cmd.x, cmd.y); break;
      case "L": ctx.lineTo(cmd.x, cmd.y); break;
      case "C": ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y); break;
      case "Q": ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y); break;
      case "Z": ctx.closePath(); break;
    }
  }
}

export const ShapeFillText: React.FC<ShapeFillTextProps> = ({
  id,
  text,
  x, y,
  fontSize,
  color,
  fontFamily,
  fontStyle = "normal",
  shapeSvgPath,
  shapeWidth,
  shapeHeight,
  shapeScale = 1,
  shapeFillSpacing = 1.3,
  shapeFillScaleX = 1,
  shapeFillScaleY = 1,
  shapeFillTextRotation = 0,
  opacity = 1,
  stroke = "#000000",
  strokeWidth = 0,
  shadowColor = "#000000",
  shadowBlur = 0,
  shadowOffsetX = 0,
  shadowOffsetY = 0,
  shadowOpacity = 0.35,
  embossStrength = 0,
  embossHighlightColor = "#ffffff",
  embossShadowColor = "#000000",
  rotation = 0,
  locked,
  draggable = true,
  onClick, onTap, onDblClick, onDragMove, onDragEnd,
  isSelected = false,
  onResizeScale,
}) => {
  const shapeData = useShapedGlyphs(text, fontFamily);

  // Parse SVG path once
  const parsedCmds = useMemo(() => parseSvgPath(shapeSvgPath || ""), [shapeSvgPath]);

  // Build polygon for hit-testing once
  const polygon = useMemo(() => pathToPolygon(parsedCmds, 12), [parsedCmds]);

  // Pre-compute glyph path commands + advances
  const glyphCache = useMemo(() => {
    const { glyphs, font, unitsPerEm } = shapeData;
    if (!font) return [];
    const scale = fontSize / unitsPerEm;
    let penX = 0;
    return glyphs.map((g) => {
      const obj = font.glyphs.get(g.g);
      const dx = (g.dx ?? 0) * scale;
      const dy = (g.dy ?? 0) * scale;
      const advance = (g.ax ?? 0) * scale;
      const commands: SvgCmd[] = obj ? obj.getPath(0, 0, fontSize).commands : [];
      const result = { obj, penX, dx, dy, advance, commands };
      penX += advance;
      return result;
    });
  }, [shapeData, fontSize]);

  const totalAdvance = glyphCache.reduce((s, g) => s + g.advance, 0);

  const isBold = fontStyle === "bold" || fontStyle === "bold italic";
  const isItalic = fontStyle === "italic" || fontStyle === "bold italic";
  const fauxBoldWidth = isBold ? Math.max(fontSize * 0.035, 0.6) : 0;

  const scaledW = shapeWidth * shapeScale;
  const scaledH = shapeHeight * shapeScale;

  return (
    <Group
      id={id}
      x={x} y={y}
      rotation={rotation}
      opacity={opacity}
      draggable={draggable && !locked}
      onClick={onClick} onTap={onTap} onDblClick={onDblClick} onDblTap={onDblClick} onDragMove={onDragMove} onDragEnd={onDragEnd}
      listening
    >
      <Rect x={0} y={0} width={scaledW} height={scaledH} fill="transparent" strokeEnabled={false} listening />

      <Shape
        listening={false}
        shadowColor={shadowBlur > 0 ? shadowColor : undefined}
        shadowBlur={shadowBlur}
        shadowOffsetX={shadowOffsetX}
        shadowOffsetY={shadowOffsetY}
        shadowOpacity={shadowOpacity}
        sceneFunc={(ctx) => {
          if (!shapeSvgPath || parsedCmds.length === 0) return;

          const lineH = fontSize * shapeFillSpacing;
          const rotRad = (shapeFillTextRotation * Math.PI) / 180;

          // If no text data yet, draw a semi-transparent placeholder fill (once,
          // regardless of emboss — there's nothing shaped yet to emboss).
          if (!shapeData.font || glyphCache.length === 0 || totalAdvance <= 0) {
            ctx.save();
            ctx.scale(shapeScale, shapeScale);
            replayPath(ctx as unknown as CanvasRenderingContext2D, parsedCmds);
            ctx.fillStyle = color + "33"; // 20% opacity hint
            ctx.fill();
            ctx.restore();
            return;
          }

          // Draws the whole shape-filled glyph run once, in `fillColor`, offset
          // by (offsetX, offsetY) — called once normally, and twice more (offset
          // opposite directions, no stroke/fauxBold) when emboss is active.
          const drawPass = (
            fillColor: string,
            offsetX: number,
            offsetY: number,
            includeExtras: boolean
          ) => {
            ctx.save();
            ctx.translate(offsetX, offsetY);
            ctx.scale(shapeScale, shapeScale);

            // Clip to shape using replayed path commands (Konva-safe, no Path2D)
            replayPath(ctx as unknown as CanvasRenderingContext2D, parsedCmds);
            ctx.clip();

            ctx.fillStyle = fillColor;

            const drawGlyphRow = (startPenX: number, sy: number, scX: number, scY: number) => {
              for (const g of glyphCache) {
                if (!g.obj || g.commands.length === 0) continue;
                const gx = startPenX + g.penX * scX + g.dx * scX;
                const gy = sy + g.dy * scY;

                ctx.save();
                ctx.translate(gx, gy);
                if (shapeFillTextRotation !== 0) ctx.rotate(rotRad);
                ctx.scale(scX, scY);
                if (isItalic) ctx.transform(1, 0, -0.25, 1, 0, 0);
                drawCommandsToCtx(ctx as unknown as CanvasRenderingContext2D, g.commands);
                ctx.fill();
                if (includeExtras && fauxBoldWidth > 0) {
                  ctx.strokeStyle = fillColor;
                  ctx.lineWidth = fauxBoldWidth / scX;
                  ctx.stroke();
                }
                if (includeExtras && strokeWidth > 0) {
                  ctx.strokeStyle = stroke;
                  ctx.lineWidth = strokeWidth / scX;
                  ctx.stroke();
                }
                ctx.restore();
              }
            };

            // Scanline fill — use ray-casting polygon test (no Path2D / isPointInPath)
            const sampleStep = Math.max(2, Math.round(fontSize / 8));
            let lineY = fontSize * 0.85;

            // The polygon is in original (pre-scale) path coordinates, matching lineY
            const inShape = (px: number, py: number) => pointInPolygon(px, py, polygon);

            while (lineY < shapeHeight) {
              let lx = -1, rx = -1;
              for (let sx = 0; sx <= shapeWidth; sx += sampleStep) {
                if (inShape(sx, lineY)) {
                  if (lx < 0) lx = sx;
                  rx = sx;
                }
              }
              // Refine left edge
              if (lx > 0) {
                for (let sx = lx - sampleStep; sx <= lx; sx++) {
                  if (inShape(sx, lineY)) { lx = sx; break; }
                }
              }
              // Refine right edge
              if (rx > 0) {
                for (let sx = rx; sx <= rx + sampleStep; sx++) {
                  if (inShape(sx, lineY)) { rx = sx; } else { break; }
                }
              }

              if (lx >= 0 && rx > lx + 2) {
                const lineWidth = rx - lx;
                const effectiveAdvance = totalAdvance * shapeFillScaleX;
                const reps = Math.max(1, Math.floor(lineWidth / effectiveAdvance));
                const fitScaleX = lineWidth / (reps * effectiveAdvance);
                const scX = shapeFillScaleX * fitScaleX;
                const scY = shapeFillScaleY;

                for (let r = 0; r < reps; r++) {
                  drawGlyphRow(lx + r * effectiveAdvance * fitScaleX, lineY, scX, scY);
                }
              }

              lineY += lineH;
            }

            ctx.restore();
          };

          if (embossStrength > 0) {
            drawPass(embossShadowColor, embossStrength, embossStrength, false);
            drawPass(embossHighlightColor, -embossStrength, -embossStrength, false);
          }
          drawPass(color, 0, 0, true);
        }}
      />

      {isSelected && !locked && (
        <Circle
          x={scaledW}
          y={scaledH}
          radius={8}
          fill="#d4af37"
          stroke="#ffffff"
          strokeWidth={2}
          draggable
          onMouseDown={(e) => { e.cancelBubble = true; }}
          onTouchStart={(e) => { e.cancelBubble = true; }}
          onDragMove={(e) => {
            e.cancelBubble = true;
            const group = e.currentTarget.getParent() as Konva.Group;
            const pos = group.getRelativePointerPosition();
            if (!pos) return;
            const dist = Math.hypot(pos.x, pos.y);
            const baseDist = Math.hypot(shapeWidth, shapeHeight);
            const newScale = Math.max(0.2, Math.min(3, dist / Math.max(baseDist, 1)));
            onResizeScale?.(newScale);
          }}
          onDragEnd={(e) => { e.cancelBubble = true; }}
        />
      )}
    </Group>
  );
};

export default ShapeFillText;
