import React, { useEffect, useMemo, useRef, useState } from "react";
import { Group, Shape, Rect, Arc } from "react-konva";
import type Konva from "konva";
import type { PathCommand } from "opentype.js";
import {
  shapeText,
  type HarfBuzzGlyph,
  type ShapedTextResult,
} from "../lib/harfbuzz";
import { warpPoint, type GlyphBounds } from "../lib/warp";

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
  warpX?: number;
  warpY?: number;
  locked?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  debugBounds?: boolean;
};

type LoadedShape = {
  glyphs: HarfBuzzGlyph[];
  font: ShapedTextResult["font"] | null;
  unitsPerEm: number;
  isLoading: boolean;
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

const DEBUG_LOG = import.meta.env.DEV;

const fallbackWidth = (text: string, fs: number) =>
  Math.max(text.length * fs * 0.55, 20);

function tracePath(ctx: CanvasRenderingContext2D, commands: PathCommand[]) {
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

/**
 * Draws each glyph in its own local transform, then warps points
 * in that local frame using warpX / warpY. This is the same
 * block-level warp you’ve been using.
 */
function drawWarpedGlyphRun(
  ctx: CanvasRenderingContext2D,
  glyphs: HarfBuzzGlyph[],
  font: NonNullable<ShapedTextResult["font"]>,
  fontSize: number,
  unitsPerEm: number,
  bounds: GlyphBounds,
  warpX: number,
  warpY: number,
  drawStroke: boolean,
  strokeColor: string,
  strokeWidth: number,
  fauxBoldWidth = 0
) {
  let penX = 0;
  const upm = Math.max(unitsPerEm || 1000, 1);
  const scale = fontSize / upm;
  const width = Math.max(bounds.rawWidth, 1);
  const height = Math.max(bounds.rawHeight, fontSize);

  for (const g of glyphs) {
    const glyphObj = font.glyphs.get(g.g);
    const advance = g.ax ?? 0;

    if (!glyphObj) {
      penX += advance;
      continue;
    }

    const gx = (penX + (g.dx ?? 0)) * scale;
    const gy = -(g.dy ?? 0) * scale;

    ctx.save();
    ctx.translate(gx, gy);

    const opPath = glyphObj.getPath(0, 0, fontSize);
    const cmds: PathCommand[] = opPath.commands.map((cmd) => {
      type MutableCmd = {
        type: PathCommand["type"];
        x?: number;
        y?: number;
        x1?: number;
        y1?: number;
        x2?: number;
        y2?: number;
      };
      const c = cmd as MutableCmd;
      const out: MutableCmd = { ...c };

      if (typeof c.x === "number" && typeof c.y === "number") {
        const p = warpPoint(
          c.x + gx,
          c.y + gy,
          bounds,
          width,
          height,
          warpX,
          warpY
        );
        out.x = p.x - gx;
        out.y = p.y - gy;
      }

      if (typeof c.x1 === "number" && typeof c.y1 === "number") {
        const p1 = warpPoint(
          c.x1 + gx,
          c.y1 + gy,
          bounds,
          width,
          height,
          warpX,
          warpY
        );
        out.x1 = p1.x - gx;
        out.y1 = p1.y - gy;
      }

      if (typeof c.x2 === "number" && typeof c.y2 === "number") {
        const p2 = warpPoint(
          c.x2 + gx,
          c.y2 + gy,
          bounds,
          width,
          height,
          warpX,
          warpY
        );
        out.x2 = p2.x - gx;
        out.y2 = p2.y - gy;
      }

      return out as PathCommand;
    });

    tracePath(ctx, cmds);
    ctx.fill();
    if (fauxBoldWidth > 0 && !drawStroke) {
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.lineWidth = fauxBoldWidth;
      ctx.stroke();
    }
    if (drawStroke && strokeWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }

    ctx.restore();
    penX += advance;
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
  warpX = 0,
  warpY = 0,
  locked,
  draggable = true,
  onClick,
  onTap,
  onDblClick,
  onDragMove,
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

  const [spinnerAngle, setSpinnerAngle] = useState(0);
  const spinnerFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!shapeData.isLoading) return;

    const tick = () => {
      setSpinnerAngle((a) => (a + 8) % 360);
      spinnerFrameRef.current = requestAnimationFrame(tick);
    };
    spinnerFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (spinnerFrameRef.current != null) {
        cancelAnimationFrame(spinnerFrameRef.current);
      }
    };
  }, [shapeData.isLoading]);

  const fontUrl = FONT_URLS[fontFamily] ?? FONT_URLS.NotoSans;

  useEffect(() => {
    let alive = true;

    // Mark loading before kicking off the async shapeText() fetch below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHbLoaded(false);
    setShapeData((prev) => ({ ...prev, isLoading: true }));

    shapeText(text || "", fontUrl)
      .then((r: ShapedTextResult) => {
        if (!alive) return;

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
      .catch((err) => {
        if (DEBUG_LOG) {
          console.error("ShapedText shapeText failed", {
            text,
            fontFamily,
            fontUrl,
            err,
          });
        }

        if (!alive) return;

        setShapeData({
          glyphs: [],
          font: null,
          unitsPerEm: 1000,
          isLoading: false,
        });

        setHbLoaded(false);
      });

    return () => {
      alive = false;
    };
  }, [text, fontUrl, fontFamily]);

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

    if (
      !isFinite(minX) ||
      !isFinite(minY) ||
      !isFinite(maxX) ||
      !isFinite(maxY)
    ) {
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

  const isBold = fontStyle === "bold" || fontStyle === "bold italic";
  const isItalic = fontStyle === "italic" || fontStyle === "bold italic";
  const fauxBoldWidth = isBold ? Math.max(fontSize * 0.035, 0.6) : 0;

  const bw = Math.max(glyphBounds.rawWidth, 20);
  const bh = Math.max(fontSize * lineHeight, glyphBounds.rawHeight, 24);
  const bx = align === "left" ? 0 : align === "right" ? -bw : -bw / 2;
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
      onDblClick={onDblClick}
      onDblTap={onDblClick}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      listening
    >
      {/* Transparent hit rect for selection/dragging */}
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

      {shapeData.isLoading && (
        <Arc
          x={bx + bw / 2}
          y={by + bh / 2}
          innerRadius={Math.max(Math.min(bw, bh) * 0.12, 6)}
          outerRadius={Math.max(Math.min(bw, bh) * 0.12, 6) + 3}
          angle={270}
          rotation={spinnerAngle}
          fill="#6b7280"
          opacity={0.6}
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
          if (!hbLoaded) return;

          const hasGlyphs =
            shapeData.glyphs.length > 0 && shapeData.font != null;
          if (!hasGlyphs) return;

          const font = shapeData.font!;
          const localDrawX =
            -glyphBounds.minX + (bw - glyphBounds.rawWidth) / 2;
          const localDrawY =
            -glyphBounds.minY + (bh - glyphBounds.rawHeight) / 2;

          ctx.save();
          ctx.translate(localDrawX, localDrawY);
          if (isItalic) ctx.transform(1, 0, -0.25, 1, 0, 0);

          ctx.fillStyle = color;
          drawWarpedGlyphRun(
            ctx as unknown as CanvasRenderingContext2D,
            shapeData.glyphs,
            font,
            fontSize,
            shapeData.unitsPerEm,
            glyphBounds,
            warpX,
            warpY,
            false,
            stroke,
            strokeWidth,
            fauxBoldWidth
          );

          if (strokeWidth > 0) {
            drawWarpedGlyphRun(
              ctx as unknown as CanvasRenderingContext2D,
              shapeData.glyphs,
              font,
              fontSize,
              shapeData.unitsPerEm,
              glyphBounds,
              warpX,
              warpY,
              true,
              stroke,
              strokeWidth
            );
          }

          ctx.restore();
        }}
      />
    </Group>
  );
};

export default ShapedText;