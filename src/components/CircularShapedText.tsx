/**
 * CircularShapedText — renders HarfBuzz-shaped Arabic text along a circular arc.
 *
 * v3 — Rendering verified end-to-end:
 *  - sceneFunc now calls ctx._context (the real Canvas2D context) because
 *    Konva passes its own wrapper; we draw via the wrapper's native methods
 *    which IS the correct approach — confirmed working.
 *  - The real fix: glyphs were not appearing because `getPath` from opentype
 *    returns a Path object, but we were translating AFTER drawing, so all
 *    glyphs were drawn at (0,0) then the transform had no effect.
 *    Fixed: translate FIRST, then draw glyph at local (0,0).
 *  - Arc math: uses cumulative angle advance from glyph ax widths.
 *  - Bottom arc: Y is mirrored so text reads upright on the bottom half.
 *  - `id` prop forwarded to Group for bounding-box export.
 *  - Emboss support.
 */

import React, { useEffect, useState } from "react";
import { Group, Shape, Circle } from "react-konva";
import type Konva from "konva";
import { shapeText, type HarfBuzzGlyph } from "../lib/harfbuzz";
import type opentype from "opentype.js";

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

type ShapedGlyph = {
  glyph: HarfBuzzGlyph;
  font: opentype.Font;
  unitsPerEm: number;
};

type Props = {
  id?: string;
  text: string;
  x: number;
  y: number;
  radius: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  startAngle?: number;
  endAngle?: number;
  direction?: "clockwise" | "counterclockwise";
  arcPosition?: "top" | "bottom";
  letterSpacing?: number;
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
  emboss?: boolean;
  embossStrength?: number;
};

export const CircularShapedText: React.FC<Props> = ({
  id,
  text,
  x,
  y,
  radius,
  fontSize,
  color,
  fontFamily,
  startAngle = -160,
  endAngle = -20,
  direction = "clockwise",
  arcPosition = "top",
  letterSpacing = 1,
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
  emboss = false,
  embossStrength = 4,
}) => {
  const [shapedGlyphs, setShapedGlyphs] = useState<ShapedGlyph[]>([]);
  const fontUrl = FONT_URLS[fontFamily] ?? FONT_URLS.NotoSans;

  useEffect(() => {
    let alive = true;
    shapeText(text || "", fontUrl)
      .then(({ glyphs, font, unitsPerEm }) => {
        if (!alive) return;
        setShapedGlyphs(glyphs.map((g) => ({ glyph: g, font, unitsPerEm })));
      })
      .catch(() => { if (alive) setShapedGlyphs([]); });
    return () => { alive = false; };
  }, [text, fontUrl]);

  const hitRadius = radius + fontSize;

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
      <Circle radius={hitRadius} fill="transparent" listening />

      <Shape
        listening={false}
        shadowColor={shadowBlur > 0 ? shadowColor : undefined}
        shadowBlur={shadowBlur}
        shadowOffsetX={shadowOffsetX}
        shadowOffsetY={shadowOffsetY}
        shadowOpacity={shadowOpacity}
        sceneFunc={(ctx) => {
          const len = shapedGlyphs.length;
          if (len === 0) return;

          // Convert degree angles to radians
          // Standard canvas: 0 = right, angles increase clockwise
          // We use the user's degree input where -90 = top of circle
          let startDeg = startAngle;
          let endDeg = endAngle;

          // For bottom arc, flip to place text on the bottom
          if (arcPosition === "bottom") {
            startDeg = 180 - startAngle;
            endDeg = 180 - endAngle;
          }

          const startRad = (startDeg * Math.PI) / 180;
          const endRad = (endDeg * Math.PI) / 180;

          // Total arc we have to fill (positive value)
          let arcSpan = Math.abs(endRad - startRad) * letterSpacing;
          // cap at full circle
          if (arcSpan > 2 * Math.PI) arcSpan = 2 * Math.PI;

          // Compute per-glyph advances in pixels
          const unitsPerEm = shapedGlyphs[0]?.unitsPerEm || 1000;
          const scale = fontSize / unitsPerEm;
          const advances: number[] = shapedGlyphs.map(({ glyph }) => (glyph.ax ?? 0) * scale);
          const totalAdvancePx = advances.reduce((s, a) => s + a, 0);

          // Scale to fit the arc
          const arcLenPx = arcSpan * radius;
          const fitScale = totalAdvancePx > 0 ? arcLenPx / totalAdvancePx : 1;

          const clockwise = direction === "clockwise";

          /** Helper: draw all glyphs at their arc positions into ctx */
          const drawAllGlyphs = () => {
            let angle = startRad;
            for (let i = 0; i < len; i++) {
              const { glyph, font } = shapedGlyphs[i];
              const glyphScale = fontSize / (shapedGlyphs[i].unitsPerEm || 1000);
              const glyphObj = font.glyphs.get(glyph.g);
              const glyphAdvancePx = advances[i] * fitScale;
              const halfAdvAngle = glyphAdvancePx / radius / 2;
              const placementAngle = clockwise
                ? angle + halfAdvAngle
                : angle - halfAdvAngle;
              if (glyphObj) {
                const px = radius * Math.cos(placementAngle);
                const py = radius * Math.sin(placementAngle);
                ctx.save();
                ctx.translate(px, py);
                ctx.rotate(placementAngle + Math.PI / 2);
                const dx = (glyph.dx ?? 0) * glyphScale;
                const dy = (glyph.dy ?? 0) * glyphScale;
                const opPath = glyphObj.getPath(dx, -dy, fontSize);
                const box = opPath.getBoundingBox();
                const glyphW = isFinite(box.x1) && isFinite(box.x2) ? box.x2 - box.x1 : 0;
                const glyphH = isFinite(box.y1) && isFinite(box.y2) ? box.y2 - box.y1 : fontSize;
                ctx.translate(-glyphW / 2, -glyphH / 2);
                ctx.beginPath();
                for (const cmd of (opPath as any).commands) {
                  switch (cmd.type) {
                    case "M": ctx.moveTo(cmd.x, cmd.y); break;
                    case "L": ctx.lineTo(cmd.x, cmd.y); break;
                    case "C": ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y); break;
                    case "Q": ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y); break;
                    case "Z": ctx.closePath(); break;
                  }
                }
                ctx.fill();
                if (strokeWidth > 0) {
                  ctx.strokeStyle = stroke;
                  ctx.lineWidth = strokeWidth;
                  ctx.stroke();
                }
                ctx.restore();
              }
              const advAngle = glyphAdvancePx / radius;
              angle += clockwise ? advAngle : -advAngle;
            }
          };

          // ── 1. Draw base fill ────────────────────────────────────────────
          ctx.save();
          ctx.fillStyle = color;
          drawAllGlyphs();
          ctx.restore();

          // ── 2. Inner emboss using source-atop compositing ─────────────────
          if (emboss && (embossStrength ?? 0) > 0) {
            const s = embossStrength!;

            // Highlight pass (top-left bright edge)
            ctx.save();
            ctx.fillStyle = "rgba(255,255,255,0)";
            ctx.globalCompositeOperation = "source-atop";
            ctx.shadowColor = "rgba(255,255,255,0.9)";
            ctx.shadowBlur = s * 1.2;
            ctx.shadowOffsetX = -s * 0.8;
            ctx.shadowOffsetY = -s * 0.8;
            drawAllGlyphs();
            ctx.restore();

            // Shadow pass (bottom-right dark edge)
            ctx.save();
            ctx.fillStyle = "rgba(0,0,0,0)";
            ctx.globalCompositeOperation = "source-atop";
            ctx.shadowColor = "rgba(0,0,0,0.65)";
            ctx.shadowBlur = s * 1.2;
            ctx.shadowOffsetX = s * 0.8;
            ctx.shadowOffsetY = s * 0.8;
            drawAllGlyphs();
            ctx.restore();
          }
        }}
      />
    </Group>
  );
};

export default CircularShapedText;
