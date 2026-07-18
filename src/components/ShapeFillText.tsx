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

import React, { useEffect, useMemo, useState } from "react";
import { Group, Shape, Rect } from "react-konva";
import type Konva from "konva";
import { shapeText, type HarfBuzzGlyph, type ShapedTextResult } from "../lib/harfbuzz";
import {
  parseSvgPath,
  pathToPolygon,
  pointInPolygon,
  type SvgCmd,
} from "../lib/svgPath";

const FONT_URLS: Record<string, string> = {
  TahaNaskhRegular: "/fonts/TahaNaskhRegular.ttf",
  Kufi: "/fonts/Kufi.ttf",
  Kufi2: "/fonts/Kufi2.ttf",
  Thuluth: "/fonts/Thuluth.ttf",
  ThuluthDeco: "/fonts/ThuluthDeco.ttf",
  Wessam: "/fonts/Wessam.ttf",
  Yekan: "/fonts/Yekan.ttf",
  NotoSans: "/fonts/NotoSans.ttf",
  Lateef: "/fonts/Lateef.ttf",
  Amiri: "/fonts/Amiri.ttf",
  Ruqaa: "/fonts/Ruqaa.ttf",
  Qahiri: "/fonts/Qahiri.ttf",
  Urdu: "/fonts/Urdu.ttf",
  AlFatemi: "/fonts/AlFatemi.otf",
  FatemiMaqala: "/fonts/FatemiMaqala.ttf",
};

type ShapeData = {
  glyphs: HarfBuzzGlyph[];
  font: ShapedTextResult["font"];
  unitsPerEm: number;
};

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
  rotation?: number;
  locked?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
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
  rotation = 0,
  locked,
  draggable = true,
  onClick, onTap, onDblClick, onDragMove, onDragEnd,
}) => {
  const [shapeData, setShapeData] = useState<ShapeData | null>(null);
  const fontUrl = FONT_URLS[fontFamily] ?? FONT_URLS.NotoSans;

  useEffect(() => {
    let alive = true;
    shapeText(text || "", fontUrl)
      .then((r) => {
        if (alive) setShapeData({ glyphs: r.glyphs, font: r.font, unitsPerEm: r.unitsPerEm || 1000 });
      })
      .catch(() => { if (alive) setShapeData(null); });
    return () => { alive = false; };
  }, [text, fontUrl]);

  // Parse SVG path once
  const parsedCmds = useMemo(() => parseSvgPath(shapeSvgPath || ""), [shapeSvgPath]);

  // Build polygon for hit-testing once
  const polygon = useMemo(() => pathToPolygon(parsedCmds, 12), [parsedCmds]);

  // Pre-compute glyph path commands + advances
  const glyphCache = useMemo(() => {
    if (!shapeData) return [];
    const { glyphs, font, unitsPerEm } = shapeData;
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

          // ── Apply uniform shape scale ──────────────────────────────────────
          ctx.save();
          ctx.scale(shapeScale, shapeScale);

          // Clip to shape using replayed path commands (Konva-safe, no Path2D)
          replayPath(ctx as unknown as CanvasRenderingContext2D, parsedCmds);
          ctx.clip();

          // If no text data yet, draw a semi-transparent placeholder fill
          if (!shapeData || glyphCache.length === 0 || totalAdvance <= 0) {
            ctx.fillStyle = color + "33"; // 20% opacity hint
            replayPath(ctx as unknown as CanvasRenderingContext2D, parsedCmds);
            ctx.fill();
            ctx.restore();
            return;
          }

          ctx.fillStyle = color;

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
              if (fauxBoldWidth > 0) {
                ctx.strokeStyle = color;
                ctx.lineWidth = fauxBoldWidth / scX;
                ctx.stroke();
              }
              if (strokeWidth > 0) {
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


          ctx.restore(); // remove shapeScale transform
        }}
      />
    </Group>
  );
};

export default ShapeFillText;
