/**
 * ShapedText — single line of HarfBuzz-shaped Arabic text on Konva.
 *
 * Emboss v3: true inner-bevel using canvas compositing.
 *  1. Draw the glyphs normally (fill).
 *  2. Set composite "source-atop" so subsequent drawing only touches
 *     pixels that are already filled (inside the glyph).
 *  3. Draw a white gradient shadow offset top-left (highlight).
 *  4. Draw a dark gradient shadow offset bottom-right (shadow edge).
 *  This keeps all emboss pixels strictly inside the letterforms.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Group, Shape, Rect } from "react-konva";
import type Konva from "konva";
import { shapeText, type HarfBuzzGlyph, type ShapedTextResult } from "../lib/harfbuzz";

type Props = {
  id?: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  align?: "left" | "center" | "right";
  lineHeight?: number;
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
  debugBounds?: boolean;
  embossStrength?: number;
};

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

type LoadedShape = {
  glyphs: HarfBuzzGlyph[];
  font: ShapedTextResult["font"] | null;
  unitsPerEm: number;
};

type GlyphBounds = {
  scale: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  rawWidth: number;
  rawHeight: number;
};

const fallbackWidth = (text: string, fs: number) => Math.max(text.length * fs * 0.55, 20);

/** Draw all glyphs as a single compound path onto ctx, starting at the current pen */
function drawGlyphs(
  ctx: any,
  glyphs: HarfBuzzGlyph[],
  font: ShapedTextResult["font"],
  scale: number,
  fontSize: number
) {
  let penX = 0;
  for (const glyph of glyphs) {
    const obj = font.glyphs.get(glyph.g);
    if (!obj) {
      penX += (glyph.ax ?? 0) * scale;
      continue;
    }
    const gx = penX + (glyph.dx ?? 0) * scale;
    const gy = -(glyph.dy ?? 0) * scale;
    const path = obj.getPath(gx, gy, fontSize);
    ctx.beginPath();
    for (const cmd of (path as any).commands) {
      switch (cmd.type) {
        case "M":
          ctx.moveTo(cmd.x, cmd.y);
          break;
        case "L":
          ctx.lineTo(cmd.x, cmd.y);
          break;
        case "C":
          ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
          break;
        case "Q":
          ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
          break;
        case "Z":
          ctx.closePath();
          break;
      }
    }
    ctx.fill();
    penX += (glyph.ax ?? 0) * scale;
  }
}

export const ShapedText: React.FC<Props> = ({
  id,
  text,
  x,
  y,
  fontSize,
  color,
  fontFamily,
  fontStyle = "normal",
  align = "center",
  lineHeight = 1.2,
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
  onClick,
  onTap,
  onDragEnd,
  debugBounds = false,
  embossStrength = 0,
}) => {
  const [shapeData, setShapeData] = useState<LoadedShape>({
    glyphs: [],
    font: null,
    unitsPerEm: 1000,
  });
  const fontUrl = FONT_URLS[fontFamily] ?? FONT_URLS.NotoSans;

  useEffect(() => {
    let alive = true;
    shapeText(text || "", fontUrl)
      .then((r: ShapedTextResult) => {
        if (!alive) return;
        setShapeData({ glyphs: r.glyphs, font: r.font, unitsPerEm: r.unitsPerEm || 1000 });
      })
      .catch(() => {
        if (alive) setShapeData({ glyphs: [], font: null, unitsPerEm: 1000 });
      });
    return () => {
      alive = false;
    };
  }, [text, fontUrl]);

  const glyphBounds = useMemo<GlyphBounds>(() => {
    const upm = shapeData.unitsPerEm || 1000;
    const scale = fontSize / upm;
    const { font, glyphs } = shapeData;
    if (!font || glyphs.length === 0) {
      const rw = fallbackWidth(text, fontSize);
      const rh = Math.max(fontSize, 24);
      return { scale, minX: 0, minY: 0, maxX: rw, maxY: rh, rawWidth: rw, rawHeight: rh };
    }
    let penX = 0,
      minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const g of glyphs) {
      const obj = font.glyphs.get(g.g);
      const dx = (g.dx ?? 0) * scale;
      const dy = (g.dy ?? 0) * scale;
      if (obj) {
        const box = obj.getPath(penX + dx, -dy, fontSize).getBoundingBox();
        if (isFinite(box.x1)) {
          minX = Math.min(minX, box.x1);
          maxX = Math.max(maxX, box.x2);
        }
        if (isFinite(box.y1)) {
          minY = Math.min(minY, box.y1);
          maxY = Math.max(maxY, box.y2);
        }
      }
      penX += (g.ax ?? 0) * scale;
    }
    if (!isFinite(minX)) {
      const rw = fallbackWidth(text, fontSize);
      const rh = Math.max(fontSize, 24);
      return { scale, minX: 0, minY: 0, maxX: rw, maxY: rh, rawWidth: rw, rawHeight: rh };
    }
    return {
      scale,
      minX,
      minY,
      maxX,
      maxY,
      rawWidth: Math.max(maxX - minX, 1),
      rawHeight: Math.max(maxY - minY, 1),
    };
  }, [shapeData, text, fontSize]);

  const bw = Math.max(glyphBounds.rawWidth, 20);
  const bh = Math.max(fontSize * lineHeight, glyphBounds.rawHeight, 24);
  const bx = align === "left" ? 0 : align === "right" ? -bw : -bw / 2;
  const by = -bh / 2;

  const hasEmboss = (embossStrength ?? 0) > 0;

  return (
    <Group
      id={id}
      x={x}
      y={y}
      rotation={rotation}
      opacity={opacity}
      draggable={draggable && !locked}
      onClick={onClick}
      onTap={onTap}
      onDragEnd={onDragEnd}
      listening
    >
      <Rect
        x={bx}
        y={by}
        width={bw}
        height={bh}
        fill="transparent"
        strokeEnabled={false}
        listening
      />
      {debugBounds && (
        <Rect
          x={bx}
          y={by}
          width={bw}
          height={bh}
          stroke="red"
          strokeWidth={1}
          dash={[6, 4]}
          listening={false}
        />
      )}

      <Shape
        x={bx}
        y={by}
        width={bw}
        height={bh}
        listening={false}
        shadowColor={!hasEmboss && shadowBlur > 0 ? shadowColor : undefined}
        shadowBlur={!hasEmboss ? shadowBlur : 0}
        shadowOffsetX={!hasEmboss ? shadowOffsetX : 0}
        shadowOffsetY={!hasEmboss ? shadowOffsetY : 0}
        shadowOpacity={!hasEmboss ? shadowOpacity : 0}
        sceneFunc={(ctx) => {
          if (!shapeData.font || shapeData.glyphs.length === 0) {
            ctx.save();
            ctx.fillStyle = color;

            const fw = fallbackWidth(text, fontSize);
            const fx = align === "left" ? 0 : align === "right" ? fw : fw / 2;

            const weight =
              fontStyle === "bold" || fontStyle === "bold italic"
                ? "bold"
                : "normal";
            const italic =
              fontStyle === "italic" || fontStyle === "bold italic"
                ? "italic"
                : "normal";

            ctx.font = `${italic} ${weight} ${fontSize}px ${fontFamily}`;
            ctx.direction = "rtl";
            ctx.textBaseline = "top";
            ctx.textAlign =
              align === "left" ? "left" : align === "right" ? "right" : "center";

            ctx.fillText(text, fx, 0);

            if (strokeWidth > 0) {
              ctx.strokeStyle = stroke;
              ctx.lineWidth = strokeWidth;
              ctx.strokeText(text, fx, 0);
            }

            ctx.restore();
            return;
          }

          const drawX = -glyphBounds.minX + (bw - glyphBounds.rawWidth) / 2;
          const drawY = -glyphBounds.minY + (bh - glyphBounds.rawHeight) / 2;

          ctx.save();
          ctx.translate(drawX, drawY);

          // 1. Base fill
          ctx.fillStyle = color;
          drawGlyphs(ctx, shapeData.glyphs, shapeData.font, glyphBounds.scale, fontSize);

          // Optional stroke
          if (strokeWidth > 0) {
            let penX = 0;
            for (const glyph of shapeData.glyphs) {
              const obj = shapeData.font.glyphs.get(glyph.g);
              if (obj) {
                const path = obj.getPath(
                  penX + (glyph.dx ?? 0) * glyphBounds.scale,
                  -(glyph.dy ?? 0) * glyphBounds.scale,
                  fontSize
                );
                ctx.beginPath();
                for (const cmd of (path as any).commands) {
                  switch (cmd.type) {
                    case "M":
                      ctx.moveTo(cmd.x, cmd.y);
                      break;
                    case "L":
                      ctx.lineTo(cmd.x, cmd.y);
                      break;
                    case "C":
                      ctx.bezierCurveTo(
                        cmd.x1,
                        cmd.y1,
                        cmd.x2,
                        cmd.y2,
                        cmd.x,
                        cmd.y
                      );
                      break;
                    case "Q":
                      ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
                      break;
                    case "Z":
                      ctx.closePath();
                      break;
                  }
                }
                ctx.strokeStyle = stroke;
                ctx.lineWidth = strokeWidth;
                ctx.stroke();
              }
              penX += (glyph.ax ?? 0) * glyphBounds.scale;
            }
          }

          // 2. Inner emboss using source-atop
          // Must stay inside the ctx.translate(drawX, drawY) block so the
          // composite operations paint over the same pixels as the base fill.
          if (hasEmboss && shapeData.font) {
            const s = embossStrength!;

            // Highlight pass (top-left)
            ctx.save();
            ctx.globalCompositeOperation = "source-atop";
            ctx.shadowColor = "rgba(255,255,255,0.9)";
            ctx.shadowBlur = s * 1.2;
            ctx.shadowOffsetX = -s * 0.8;
            ctx.shadowOffsetY = -s * 0.8;
            ctx.fillStyle = "rgba(255,255,255,0)";
            drawGlyphs(ctx, shapeData.glyphs, shapeData.font, glyphBounds.scale, fontSize);
            ctx.restore();

            // Shadow pass (bottom-right)
            ctx.save();
            ctx.globalCompositeOperation = "source-atop";
            ctx.shadowColor = "rgba(0,0,0,0.65)";
            ctx.shadowBlur = s * 1.2;
            ctx.shadowOffsetX = s * 0.8;
            ctx.shadowOffsetY = s * 0.8;
            ctx.fillStyle = "rgba(0,0,0,0)";
            drawGlyphs(ctx, shapeData.glyphs, shapeData.font, glyphBounds.scale, fontSize);
            ctx.restore();
          }

          ctx.restore(); // pop translate(drawX, drawY)
        }}
      />
    </Group>
  );
};

export default ShapedText;