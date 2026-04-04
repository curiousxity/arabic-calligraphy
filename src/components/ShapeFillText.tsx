/**
 * ShapeFillText v4
 *
 * Key changes:
 *  - `shapeScale` prop: uniformly scales the entire shape + fill (0.1–5).
 *    The SVG path is drawn at (shapeWidth * shapeScale) × (shapeHeight * shapeScale).
 *    ctx.scale(shapeScale, shapeScale) is applied before clipping so the path
 *    and all glyph placement coordinates scale together.
 *  - Text genuinely FORMS the shape: glyphs are clipped inside the SVG path,
 *    and the shape outline is NOT drawn — the text itself reveals the shape.
 *  - Inner emboss via source-atop compositing (same approach as ShapedText).
 *  - No checkbox for emboss — just strength slider (0 = off).
 */

import React, { useEffect, useMemo, useState } from "react";
import { Group, Shape, Rect } from "react-konva";
import type Konva from "konva";
import type opentype from "opentype.js";
import { shapeText, type HarfBuzzGlyph } from "../lib/harfbuzz";

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
  font: opentype.Font;
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
  shapeSvgPath: string;
  shapeWidth: number;
  shapeHeight: number;
  /** Uniform scale for the whole shape+fill. 1 = original SVG size. */
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
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  embossStrength?: number;
};

function drawCommandsToCtx(ctx: any, commands: any[]) {
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
  onClick, onTap, onDragEnd,
  embossStrength = 0,
}) => {
  const [shapeData, setShapeData] = useState<ShapeData | null>(null);
  const fontUrl = FONT_URLS[fontFamily] ?? FONT_URLS.NotoSans;

  useEffect(() => {
    let alive = true;
    shapeText(text || "بسم", fontUrl)
      .then((r) => {
        if (alive) setShapeData({ glyphs: r.glyphs, font: r.font, unitsPerEm: r.unitsPerEm || 1000 });
      })
      .catch(() => { if (alive) setShapeData(null); });
    return () => { alive = false; };
  }, [text, fontUrl]);

  // Pre-compute glyph path commands + advances (synchronous in sceneFunc)
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
      const commands = obj ? (obj.getPath(0, 0, fontSize) as any).commands : [];
      const result = { obj, penX, dx, dy, advance, commands };
      penX += advance;
      return result;
    });
  }, [shapeData, fontSize]);

  const totalAdvance = glyphCache.reduce((s, g) => s + g.advance, 0);

  // Actual rendered dimensions after scale
  const scaledW = shapeWidth * shapeScale;
  const scaledH = shapeHeight * shapeScale;

  const hasEmboss = (embossStrength ?? 0) > 0;

  return (
    <Group
      id={id}
      x={x} y={y}
      rotation={rotation}
      opacity={opacity}
      draggable={draggable && !locked}
      onClick={onClick} onTap={onTap} onDragEnd={onDragEnd}
      listening
    >
      {/* Hit area matches scaled dimensions */}
      <Rect x={0} y={0} width={scaledW} height={scaledH} fill="transparent" strokeEnabled={false} listening />

      <Shape
        listening={false}
        shadowColor={!hasEmboss && shadowBlur > 0 ? shadowColor : undefined}
        shadowBlur={!hasEmboss ? shadowBlur : 0}
        shadowOffsetX={!hasEmboss ? shadowOffsetX : 0}
        shadowOffsetY={!hasEmboss ? shadowOffsetY : 0}
        shadowOpacity={!hasEmboss ? shadowOpacity : 0}
        sceneFunc={(ctx) => {
          if (!shapeSvgPath || !shapeData || glyphCache.length === 0 || totalAdvance <= 0) return;

          const { font } = shapeData;
          const lineH = fontSize * shapeFillSpacing;
          const rotRad = (shapeFillTextRotation * Math.PI) / 180;

          // ── Apply uniform shape scale ──────────────────────────────────────
          ctx.save();
          ctx.scale(shapeScale, shapeScale);

          const path2d = new Path2D(shapeSvgPath);

          // Clip to SVG shape — text will FORM the shape silhouette
          ctx.clip(path2d);

          // ── Draw text rows to fill the shape ──────────────────────────────
          ctx.fillStyle = color;

          /**
           * Helper: draw all cached glyphs at a given pen offset.
           * Returns total x-advance consumed.
           */
          const drawGlyphRow = (startPenX: number, sy: number, scX: number, scY: number) => {
            for (const g of glyphCache) {
              if (!g.obj || g.commands.length === 0) continue;
              const gx = startPenX + g.penX * scX + g.dx * scX;
              const gy = sy + g.dy * scY;

              ctx.save();
              ctx.translate(gx, gy);
              if (shapeFillTextRotation !== 0) ctx.rotate(rotRad);
              ctx.scale(scX, scY);
              drawCommandsToCtx(ctx, g.commands);
              ctx.fill();
              if (strokeWidth > 0) {
                ctx.strokeStyle = stroke;
                ctx.lineWidth = strokeWidth / scX;
                ctx.stroke();
              }
              ctx.restore();
            }
          };

          // Scanline: find x-extents at each lineY using coarse sampling
          const sampleStep = Math.max(2, Math.round(fontSize / 8));
          let lineY = fontSize * 0.85;

          while (lineY < shapeHeight) {
            let lx = -1, rx = -1;
            for (let sx = 0; sx <= shapeWidth; sx += sampleStep) {
              if (ctx.isPointInPath(path2d, sx, lineY)) {
                if (lx < 0) lx = sx;
                rx = sx;
              }
            }
            // Refine endpoints
            if (lx > 0) {
              for (let sx = lx - sampleStep; sx <= lx; sx++) {
                if (ctx.isPointInPath(path2d, sx, lineY)) { lx = sx; break; }
              }
            }
            if (rx > 0) {
              for (let sx = rx; sx <= rx + sampleStep; sx++) {
                if (ctx.isPointInPath(path2d, sx, lineY)) { rx = sx; } else { break; }
              }
            }

            if (lx >= 0 && rx > lx + 2) {
              const lineWidth = rx - lx;
              const effectiveAdvance = totalAdvance * shapeFillScaleX;

              // Fit as many whole repetitions as possible; scale to fill remainder
              const reps = Math.max(1, Math.floor(lineWidth / effectiveAdvance));
              const fitScaleX = lineWidth / (reps * effectiveAdvance);
              const scX = shapeFillScaleX * fitScaleX;
              const scY = shapeFillScaleY;

              for (let r = 0; r < reps; r++) {
                const penStart = lx + r * effectiveAdvance * fitScaleX;
                drawGlyphRow(penStart, lineY, scX, scY);
              }
            }

            lineY += lineH;
          }

          // ── Inner emboss (source-atop, strictly inside glyphs) ─────────────
          if (hasEmboss) {
            const s = embossStrength!;
            lineY = fontSize * 0.85;
            while (lineY < shapeHeight) {
              let lx = -1, rx = -1;
              for (let sx = 0; sx <= shapeWidth; sx += sampleStep) {
                if (ctx.isPointInPath(path2d, sx, lineY)) { if (lx < 0) lx = sx; rx = sx; }
              }
              if (lx >= 0 && rx > lx + 2) {
                const lineWidth = rx - lx;
                const effectiveAdvance = totalAdvance * shapeFillScaleX;
                const reps = Math.max(1, Math.floor(lineWidth / effectiveAdvance));
                const fitScaleX = lineWidth / (reps * effectiveAdvance);
                const scX = shapeFillScaleX * fitScaleX;

                // Highlight
                ctx.save();
                ctx.globalCompositeOperation = "source-atop";
                ctx.shadowColor = "rgba(255,255,255,0.9)";
                ctx.shadowBlur = s * 1.2;
                ctx.shadowOffsetX = -s * 0.8;
                ctx.shadowOffsetY = -s * 0.8;
                ctx.fillStyle = "rgba(255,255,255,0)";
                for (let r = 0; r < reps; r++) drawGlyphRow(lx + r * effectiveAdvance * fitScaleX, lineY, scX, shapeFillScaleY);
                ctx.restore();

                // Dark edge
                ctx.save();
                ctx.globalCompositeOperation = "source-atop";
                ctx.shadowColor = "rgba(0,0,0,0.65)";
                ctx.shadowBlur = s * 1.2;
                ctx.shadowOffsetX = s * 0.8;
                ctx.shadowOffsetY = s * 0.8;
                ctx.fillStyle = "rgba(0,0,0,0)";
                for (let r = 0; r < reps; r++) drawGlyphRow(lx + r * effectiveAdvance * fitScaleX, lineY, scX, shapeFillScaleY);
                ctx.restore();
              }
              lineY += lineH;
            }
          }

          ctx.restore(); // remove shapeScale transform
        }}
      />
    </Group>
  );
};

export default ShapeFillText;
