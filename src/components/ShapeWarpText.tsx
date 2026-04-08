import React, { useEffect, useMemo, useRef, useState } from "react";
import { Group, Shape, Rect } from "react-konva";
import type Konva from "konva";
import {
  shapeText,
  type HarfBuzzGlyph,
  type ShapedTextResult,
} from "../lib/harfbuzz";

type ShapeWarpMode = "envelope" | "topBottom" | "stretch" | "radial";

export type ShapeWarpTextProps = {
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

  shapeSvgPath: string;
  warpShapeWidth: number;
  warpShapeHeight: number;
  warpShapeMode?: ShapeWarpMode;
  warpShapePadding?: number;
  warpShapeStrength?: number;

  locked?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  debugBounds?: boolean;
};

type LoadedShape = {
  glyphs: HarfBuzzGlyph[];
  font: ShapedTextResult["font"] | null;
  unitsPerEm: number;
  isLoading: boolean;
};

type GlyphBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  rawWidth: number;
  rawHeight: number;
};

type SvgCmd =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "Z" };

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

const fallbackWidth = (text: string, fs: number) =>
  Math.max(text.length * fs * 0.55, 20);

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function clampUnit(v: number) {
  return Math.max(-1, Math.min(1, v));
}

function parseSvgPath(d: string): SvgCmd[] {
  const cmds: SvgCmd[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) tokens.push(m[0]);

  let i = 0;
  let cx = 0,
    cy = 0,
    sx = 0,
    sy = 0;
  const num = () => parseFloat(tokens[i++]);

  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case "M": {
        const x = num(),
          y = num();
        cmds.push({ type: "M", x, y });
        cx = sx = x;
        cy = sy = y;
        break;
      }
      case "m": {
        const x = cx + num(),
          y = cy + num();
        cmds.push({ type: "M", x, y });
        cx = sx = x;
        cy = sy = y;
        break;
      }
      case "L": {
        const x = num(),
          y = num();
        cmds.push({ type: "L", x, y });
        cx = x;
        cy = y;
        break;
      }
      case "l": {
        const x = cx + num(),
          y = cy + num();
        cmds.push({ type: "L", x, y });
        cx = x;
        cy = y;
        break;
      }
      case "H": {
        const x = num();
        cmds.push({ type: "L", x, y: cy });
        cx = x;
        break;
      }
      case "h": {
        const x = cx + num();
        cmds.push({ type: "L", x, y: cy });
        cx = x;
        break;
      }
      case "V": {
        const y = num();
        cmds.push({ type: "L", x: cx, y });
        cy = y;
        break;
      }
      case "v": {
        const y = cy + num();
        cmds.push({ type: "L", x: cx, y });
        cy = y;
        break;
      }
      case "C": {
        const x1 = num(),
          y1 = num(),
          x2 = num(),
          y2 = num(),
          x = num(),
          y = num();
        cmds.push({ type: "C", x1, y1, x2, y2, x, y });
        cx = x;
        cy = y;
        break;
      }
      case "c": {
        const x1 = cx + num(),
          y1 = cy + num(),
          x2 = cx + num(),
          y2 = cy + num(),
          x = cx + num(),
          y = cy + num();
        cmds.push({ type: "C", x1, y1, x2, y2, x, y });
        cx = x;
        cy = y;
        break;
      }
      case "Q": {
        const x1 = num(),
          y1 = num(),
          x = num(),
          y = num();
        cmds.push({ type: "Q", x1, y1, x, y });
        cx = x;
        cy = y;
        break;
      }
      case "q": {
        const x1 = cx + num(),
          y1 = cy + num(),
          x = cx + num(),
          y = cy + num();
        cmds.push({ type: "Q", x1, y1, x, y });
        cx = x;
        cy = y;
        break;
      }
      case "S": {
        const x2 = num(),
          y2 = num(),
          x = num(),
          y = num();
        cmds.push({ type: "C", x1: cx, y1: cy, x2, y2, x, y });
        cx = x;
        cy = y;
        break;
      }
      case "s": {
        const x2 = cx + num(),
          y2 = cy + num(),
          x = cx + num(),
          y = cy + num();
        cmds.push({ type: "C", x1: cx, y1: cy, x2, y2, x, y });
        cx = x;
        cy = y;
        break;
      }
      case "A": {
        num(); num(); num(); num(); num();
        const x = num(), y = num();
        cmds.push({ type: "L", x, y });
        cx = x;
        cy = y;
        break;
      }
      case "a": {
        num(); num(); num(); num(); num();
        const x = cx + num(), y = cy + num();
        cmds.push({ type: "L", x, y });
        cx = x;
        cy = y;
        break;
      }
      case "Z":
      case "z": {
        cmds.push({ type: "Z" });
        cx = sx;
        cy = sy;
        break;
      }
      default:
        break;
    }
  }

  return cmds;
}

function replayPath(ctx: any, cmds: SvgCmd[]) {
  ctx.beginPath();
  for (const c of cmds) {
    switch (c.type) {
      case "M":
        ctx.moveTo(c.x, c.y);
        break;
      case "L":
        ctx.lineTo(c.x, c.y);
        break;
      case "C":
        ctx.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
        break;
      case "Q":
        ctx.quadraticCurveTo(c.x1, c.y1, c.x, c.y);
        break;
      case "Z":
        ctx.closePath();
        break;
    }
  }
}

function tracePath(ctx: CanvasRenderingContext2D, commands: any[]) {
  ctx.beginPath();
  for (const cmd of commands) {
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
}

function applyShapeWarpPoint(
  x: number,
  y: number,
  bounds: GlyphBounds,
  shapeW: number,
  shapeH: number,
  padding: number,
  mode: ShapeWarpMode,
  strength: number
) {
  const innerLeft = padding;
  const innerTop = padding;
  const innerW = Math.max(1, shapeW - padding * 2);
  const innerH = Math.max(1, shapeH - padding * 2);

  const nx = clamp01((x - bounds.minX) / Math.max(bounds.rawWidth, 1));
  const ny = clamp01((y - bounds.minY) / Math.max(bounds.rawHeight, 1));
  const ux = clampUnit(nx * 2 - 1);
  const uy = clampUnit(ny * 2 - 1);

  let px = innerLeft + nx * innerW;
  let py = innerTop + ny * innerH;

  if (mode === "stretch") {
    const yScale = 1 + strength * 0.35 * (1 - ux * ux);
    py = innerTop + ((ny - 0.5) * yScale + 0.5) * innerH;
  } else if (mode === "topBottom") {
    const bend = strength * 0.18 * (1 - ux * ux);
    const topPull = bend * innerH;
    const bottomPush = bend * innerH;
    py = innerTop + ny * innerH;
    py += (ny < 0.5 ? -topPull : bottomPush) * (1 - Math.abs(uy));
  } else if (mode === "radial") {
    const dx = ux;
    const dy = uy;
    const r = Math.sqrt(dx * dx + dy * dy) || 1;
    const bulge = 1 + strength * 0.22 * (1 - Math.min(1, r));
    const bx = dx * bulge;
    const by = dy * bulge;
    px = innerLeft + ((bx + 1) / 2) * innerW;
    py = innerTop + ((by + 1) / 2) * innerH;
  } else {
    const topArch = -strength * 0.18 * (1 - ux * ux) * innerH;
    const bottomArch = strength * 0.18 * (1 - ux * ux) * innerH;
    py = innerTop + ny * innerH + topArch * (1 - ny) + bottomArch * ny;
  }

  return { x: px, y: py };
}

export const ShapeWarpText: React.FC<ShapeWarpTextProps> = ({
  id,
  text,
  x,
  y,
  fontSize,
  color,
  fontFamily,
  opacity = 1,
  stroke = "#000000",
  strokeWidth = 0,
  shadowColor = "#000000",
  shadowBlur = 0,
  shadowOffsetX = 0,
  shadowOffsetY = 0,
  shadowOpacity = 0.35,
  rotation = 0,
  shapeSvgPath,
  warpShapeWidth,
  warpShapeHeight,
  warpShapeMode = "envelope",
  warpShapePadding = 24,
  warpShapeStrength = 1,
  locked,
  draggable = true,
  onClick,
  onTap,
  onDragEnd,
  debugBounds = false,
}) => {
  const [hbLoaded, setHbLoaded] = useState(false);
  const [shapeData, setShapeData] = useState<LoadedShape>({
    glyphs: [],
    font: null,
    unitsPerEm: 1000,
    isLoading: true,
  });

  const aliveRef = useRef(true);
  const fontUrl = FONT_URLS[fontFamily] ?? FONT_URLS.NotoSans;

  useEffect(() => {
    aliveRef.current = true;
    setHbLoaded(false);
    setShapeData((prev) => ({ ...prev, isLoading: true }));

    shapeText(text || "", fontUrl)
      .then((r: ShapedTextResult) => {
        if (!aliveRef.current) return;
        const glyphs = r.glyphs ?? [];
        const font = r.font ?? null;
        const hasGlyphs = !!font && glyphs.length > 0;

        setShapeData({
          glyphs,
          font,
          unitsPerEm: r.unitsPerEm || 1000,
          isLoading: false,
        });

        setHbLoaded(hasGlyphs);
      })
      .catch(() => {
        if (!aliveRef.current) return;
        setShapeData({
          glyphs: [],
          font: null,
          unitsPerEm: 1000,
          isLoading: false,
        });
        setHbLoaded(false);
      });

    return () => {
      aliveRef.current = false;
    };
  }, [text, fontUrl]);

  const parsedCmds = useMemo(() => parseSvgPath(shapeSvgPath || ""), [shapeSvgPath]);

  const glyphBounds = useMemo<GlyphBounds>(() => {
    const { font, glyphs, unitsPerEm } = shapeData;

    if (!font || glyphs.length === 0) {
      const rw = fallbackWidth(text, fontSize);
      const rh = Math.max(fontSize, 24);
      return {
        minX: 0,
        minY: 0,
        maxX: rw,
        maxY: rh,
        rawWidth: rw,
        rawHeight: rh,
      };
    }

    const upm = Math.max(unitsPerEm || 1000, 1);
    const scale = fontSize / upm;

    let penX = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const g of glyphs) {
      const glyphObj = font.glyphs.get(g.g);
      const advance = g.ax ?? 0;

      if (glyphObj) {
        const gx = (penX + (g.dx ?? 0)) * scale;
        const gy = -(g.dy ?? 0) * scale;
        const box = glyphObj.getPath(gx, gy, fontSize).getBoundingBox();

        if (isFinite(box.x1) && isFinite(box.x2)) {
          minX = Math.min(minX, box.x1);
          maxX = Math.max(maxX, box.x2);
        }
        if (isFinite(box.y1) && isFinite(box.y2)) {
          minY = Math.min(minY, box.y1);
          maxY = Math.max(maxY, box.y2);
        }
      }

      penX += advance;
    }

    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      const rw = fallbackWidth(text, fontSize);
      const rh = Math.max(fontSize, 24);
      return {
        minX: 0,
        minY: 0,
        maxX: rw,
        maxY: rh,
        rawWidth: rw,
        rawHeight: rh,
      };
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      rawWidth: Math.max(maxX - minX, 1),
      rawHeight: Math.max(maxY - minY, 1),
    };
  }, [shapeData, text, fontSize]);

  const bw = Math.max(warpShapeWidth, 20);
  const bh = Math.max(warpShapeHeight, 20);
  const bx = -bw / 2;
  const by = -bh / 2;

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
        shadowColor={shadowBlur > 0 ? shadowColor : undefined}
        shadowBlur={shadowBlur}
        shadowOffsetX={shadowOffsetX}
        shadowOffsetY={shadowOffsetY}
        shadowOpacity={shadowOpacity}
        sceneFunc={(ctx) => {
          if (!shapeSvgPath || parsedCmds.length === 0) return;

          ctx.save();

          replayPath(ctx, parsedCmds);
          ctx.clip();

          if (!hbLoaded || !shapeData.font || shapeData.glyphs.length === 0) {
            ctx.fillStyle = color + "22";
            replayPath(ctx, parsedCmds);
            ctx.fill();
            ctx.restore();
            return;
          }

          const font = shapeData.font;
          let penX = 0;

          ctx.fillStyle = color;

          for (const g of shapeData.glyphs) {
            const glyphObj = font.glyphs.get(g.g);
            const advance = g.ax ?? 0;

            if (!glyphObj) {
              penX += advance;
              continue;
            }

            const scale = fontSize / Math.max(shapeData.unitsPerEm || 1000, 1);
            const gx = (penX + (g.dx ?? 0)) * scale;
            const gy = -(g.dy ?? 0) * scale;

            const opPath = glyphObj.getPath(0, 0, fontSize);
            const cmds = (opPath as any).commands.map((cmd: any) => {
              const out = { ...cmd };

              if (typeof cmd.x === "number" && typeof cmd.y === "number") {
                const p = applyShapeWarpPoint(
                  cmd.x + gx,
                  cmd.y + gy,
                  glyphBounds,
                  bw,
                  bh,
                  warpShapePadding,
                  warpShapeMode,
                  warpShapeStrength
                );
                out.x = p.x;
                out.y = p.y;
              }

              if (typeof cmd.x1 === "number" && typeof cmd.y1 === "number") {
                const p1 = applyShapeWarpPoint(
                  cmd.x1 + gx,
                  cmd.y1 + gy,
                  glyphBounds,
                  bw,
                  bh,
                  warpShapePadding,
                  warpShapeMode,
                  warpShapeStrength
                );
                out.x1 = p1.x;
                out.y1 = p1.y;
              }

              if (typeof cmd.x2 === "number" && typeof cmd.y2 === "number") {
                const p2 = applyShapeWarpPoint(
                  cmd.x2 + gx,
                  cmd.y2 + gy,
                  glyphBounds,
                  bw,
                  bh,
                  warpShapePadding,
                  warpShapeMode,
                  warpShapeStrength
                );
                out.x2 = p2.x;
                out.y2 = p2.y;
              }

              return out;
            });

            tracePath(ctx as CanvasRenderingContext2D, cmds);
            ctx.fill();

            if (strokeWidth > 0) {
              ctx.strokeStyle = stroke;
              ctx.lineWidth = strokeWidth;
              ctx.stroke();
            }

            penX += advance;
          }

          ctx.restore();
        }}
      />
    </Group>
  );
};

export default ShapeWarpText;