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

// ─── SVG path parser ──────────────────────────────────────────────────────────

type SvgCmd =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "Z" };

/** Parse an SVG path `d` string into an array of absolute commands. */
function parseSvgPath(d: string): SvgCmd[] {
  const cmds: SvgCmd[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) tokens.push(m[0]);

  let i = 0;
  let cx = 0, cy = 0, sx = 0, sy = 0; // current pos, subpath start
  const num = () => parseFloat(tokens[i++]);

  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case "M": { const x = num(), y = num(); cmds.push({ type: "M", x, y }); cx = sx = x; cy = sy = y; break; }
      case "m": { const x = cx + num(), y = cy + num(); cmds.push({ type: "M", x, y }); cx = sx = x; cy = sy = y; break; }
      case "L": { const x = num(), y = num(); cmds.push({ type: "L", x, y }); cx = x; cy = y; break; }
      case "l": { const x = cx + num(), y = cy + num(); cmds.push({ type: "L", x, y }); cx = x; cy = y; break; }
      case "H": { const x = num(); cmds.push({ type: "L", x, y: cy }); cx = x; break; }
      case "h": { const x = cx + num(); cmds.push({ type: "L", x, y: cy }); cx = x; break; }
      case "V": { const y = num(); cmds.push({ type: "L", x: cx, y }); cy = y; break; }
      case "v": { const y = cy + num(); cmds.push({ type: "L", x: cx, y }); cy = y; break; }
      case "C": { const x1=num(),y1=num(),x2=num(),y2=num(),x=num(),y=num(); cmds.push({type:"C",x1,y1,x2,y2,x,y}); cx=x; cy=y; break; }
      case "c": { const x1=cx+num(),y1=cy+num(),x2=cx+num(),y2=cy+num(),x=cx+num(),y=cy+num(); cmds.push({type:"C",x1,y1,x2,y2,x,y}); cx=x; cy=y; break; }
      case "Q": { const x1=num(),y1=num(),x=num(),y=num(); cmds.push({type:"Q",x1,y1,x,y}); cx=x; cy=y; break; }
      case "q": { const x1=cx+num(),y1=cy+num(),x=cx+num(),y=cy+num(); cmds.push({type:"Q",x1,y1,x,y}); cx=x; cy=y; break; }
      case "S": { const x2=num(),y2=num(),x=num(),y=num(); cmds.push({type:"C",x1:cx,y1:cy,x2,y2,x,y}); cx=x; cy=y; break; }
      case "s": { const x2=cx+num(),y2=cy+num(),x=cx+num(),y=cy+num(); cmds.push({type:"C",x1:cx,y1:cy,x2,y2,x,y}); cx=x; cy=y; break; }
      case "Z": case "z": { cmds.push({ type: "Z" }); cx = sx; cy = sy; break; }
      // A (arc) — approximate as a line to endpoint for simplicity
      case "A": { num();num();num();num();num(); const x=num(),y=num(); cmds.push({type:"L",x,y}); cx=x; cy=y; break; }
      case "a": { num();num();num();num();num(); const x=cx+num(),y=cy+num(); cmds.push({type:"L",x,y}); cx=x; cy=y; break; }
      default: break;
    }
  }
  return cmds;
}

/** Replay parsed SVG commands onto a canvas context (no Path2D needed). */
function replayPath(ctx: any, cmds: SvgCmd[]) {
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

/**
 * Build a flat polygon approximation from path commands (for hit testing).
 * Curves are subdivided at a fixed step count.
 */
function pathToPolygon(cmds: SvgCmd[], steps = 8): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  let cx = 0, cy = 0;
  for (const c of cmds) {
    switch (c.type) {
      case "M": cx = c.x; cy = c.y; pts.push([cx, cy]); break;
      case "L": cx = c.x; cy = c.y; pts.push([cx, cy]); break;
      case "Z": break;
      case "C": {
        const ox = cx, oy = cy;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const mt = 1 - t;
          const x = mt*mt*mt*ox + 3*mt*mt*t*c.x1 + 3*mt*t*t*c.x2 + t*t*t*c.x;
          const y = mt*mt*mt*oy + 3*mt*mt*t*c.y1 + 3*mt*t*t*c.y2 + t*t*t*c.y;
          pts.push([x, y]);
        }
        cx = c.x; cy = c.y; break;
      }
      case "Q": {
        const ox = cx, oy = cy;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const mt = 1 - t;
          const x = mt*mt*ox + 2*mt*t*c.x1 + t*t*c.x;
          const y = mt*mt*oy + 2*mt*t*c.y1 + t*t*c.y;
          pts.push([x, y]);
        }
        cx = c.x; cy = c.y; break;
      }
    }
  }
  return pts;
}

/** Ray-casting point-in-polygon test. */
function pointInPolygon(px: number, py: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

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
      const commands = obj ? (obj.getPath(0, 0, fontSize) as any).commands : [];
      const result = { obj, penX, dx, dy, advance, commands };
      penX += advance;
      return result;
    });
  }, [shapeData, fontSize]);

  const totalAdvance = glyphCache.reduce((s, g) => s + g.advance, 0);

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
      <Rect x={0} y={0} width={scaledW} height={scaledH} fill="transparent" strokeEnabled={false} listening />

      <Shape
        listening={false}
        shadowColor={!hasEmboss && shadowBlur > 0 ? shadowColor : undefined}
        shadowBlur={!hasEmboss ? shadowBlur : 0}
        shadowOffsetX={!hasEmboss ? shadowOffsetX : 0}
        shadowOffsetY={!hasEmboss ? shadowOffsetY : 0}
        shadowOpacity={!hasEmboss ? shadowOpacity : 0}
        sceneFunc={(ctx) => {
          if (!shapeSvgPath || parsedCmds.length === 0) return;

          const lineH = fontSize * shapeFillSpacing;
          const rotRad = (shapeFillTextRotation * Math.PI) / 180;

          // ── Apply uniform shape scale ──────────────────────────────────────
          ctx.save();
          ctx.scale(shapeScale, shapeScale);

          // Clip to shape using replayed path commands (Konva-safe, no Path2D)
          replayPath(ctx, parsedCmds);
          ctx.clip();

          // If no text data yet, draw a semi-transparent placeholder fill
          if (!shapeData || glyphCache.length === 0 || totalAdvance <= 0) {
            ctx.fillStyle = color + "33"; // 20% opacity hint
            replayPath(ctx, parsedCmds);
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

          // ── Inner emboss ─────────────────────────────────────────────────
          if (hasEmboss) {
            const s = embossStrength!;
            lineY = fontSize * 0.85;
            while (lineY < shapeHeight) {
              let lx = -1, rx = -1;
              for (let sx = 0; sx <= shapeWidth; sx += sampleStep) {
                if (inShape(sx, lineY)) { if (lx < 0) lx = sx; rx = sx; }
              }
              if (lx >= 0 && rx > lx + 2) {
                const lineWidth = rx - lx;
                const effectiveAdvance = totalAdvance * shapeFillScaleX;
                const reps = Math.max(1, Math.floor(lineWidth / effectiveAdvance));
                const fitScaleX = lineWidth / (reps * effectiveAdvance);
                const scX = shapeFillScaleX * fitScaleX;

                ctx.save();
                ctx.globalCompositeOperation = "source-atop";
                ctx.shadowColor = "rgba(255,255,255,0.9)";
                ctx.shadowBlur = s * 1.2;
                ctx.shadowOffsetX = -s * 0.8;
                ctx.shadowOffsetY = -s * 0.8;
                ctx.fillStyle = "rgba(255,255,255,0)";
                for (let r = 0; r < reps; r++) drawGlyphRow(lx + r * effectiveAdvance * fitScaleX, lineY, scX, shapeFillScaleY);
                ctx.restore();

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
