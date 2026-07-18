import React, { useEffect, useMemo, useRef, useState } from "react";
import { Group, Shape, Rect, Circle, Arc } from "react-konva";
import type Konva from "konva";
import {
  shapeText,
  type HarfBuzzGlyph,
  type ShapedTextResult,
} from "../lib/harfbuzz";
import type { GlyphWarp, GlyphHandle } from "../types";

type ShapeWarpMode = "envelope" | "topBottom" | "stretch" | "radial";

export type GlyphHitBox = {
  glyphIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
};

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
  onDblClick?: () => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  debugBounds?: boolean;

  glyphEditMode?: boolean;
  selectedGlyphIndex?: number | null;
  glyphWarps?: GlyphWarp[];
  onGlyphSelect?: (glyphIndex: number | null) => void;
  onGlyphBoxesChange?: (boxes: GlyphHitBox[]) => void;
  onUpdateGlyphHandle?: (
    glyphIndex: number,
    handleId: string,
    patch: Partial<GlyphHandle>
  ) => void;
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

type GlyphLayout = {
  glyphIndex: number;
  bounds: GlyphBounds;
  gx: number;
  gy: number;
  advance: number;
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
  const re =
    /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;

  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) tokens.push(m[0]);

  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  const num = () => parseFloat(tokens[i++]);

  while (i < tokens.length) {
    const cmd = tokens[i++];

    switch (cmd) {
      case "M": {
        const x = num();
        const y = num();
        cmds.push({ type: "M", x, y });
        cx = sx = x;
        cy = sy = y;
        break;
      }
      case "m": {
        const x = cx + num();
        const y = cy + num();
        cmds.push({ type: "M", x, y });
        cx = sx = x;
        cy = sy = y;
        break;
      }
      case "L": {
        const x = num();
        const y = num();
        cmds.push({ type: "L", x, y });
        cx = x;
        cy = y;
        break;
      }
      case "l": {
        const x = cx + num();
        const y = cy + num();
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
        const x1 = num();
        const y1 = num();
        const x2 = num();
        const y2 = num();
        const x = num();
        const y = num();
        cmds.push({ type: "C", x1, y1, x2, y2, x, y });
        cx = x;
        cy = y;
        break;
      }
      case "c": {
        const x1 = cx + num();
        const y1 = cy + num();
        const x2 = cx + num();
        const y2 = cy + num();
        const x = cx + num();
        const y = cy + num();
        cmds.push({ type: "C", x1, y1, x2, y2, x, y });
        cx = x;
        cy = y;
        break;
      }
      case "Q": {
        const x1 = num();
        const y1 = num();
        const x = num();
        const y = num();
        cmds.push({ type: "Q", x1, y1, x, y });
        cx = x;
        cy = y;
        break;
      }
      case "q": {
        const x1 = cx + num();
        const y1 = cy + num();
        const x = cx + num();
        const y = cy + num();
        cmds.push({ type: "Q", x1, y1, x, y });
        cx = x;
        cy = y;
        break;
      }
      case "S": {
        const x2 = num();
        const y2 = num();
        const x = num();
        const y = num();
        cmds.push({ type: "C", x1: cx, y1: cy, x2, y2, x, y });
        cx = x;
        cy = y;
        break;
      }
      case "s": {
        const x2 = cx + num();
        const y2 = cy + num();
        const x = cx + num();
        const y = cy + num();
        cmds.push({ type: "C", x1: cx, y1: cy, x2, y2, x, y });
        cx = x;
        cy = y;
        break;
      }
      case "A": {
        num();
        num();
        num();
        num();
        num();
        const x = num();
        const y = num();
        cmds.push({ type: "L", x, y });
        cx = x;
        cy = y;
        break;
      }
      case "a": {
        num();
        num();
        num();
        num();
        num();
        const x = cx + num();
        const y = cy + num();
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

function replayPath(ctx: CanvasRenderingContext2D, cmds: SvgCmd[]) {
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

function tracePath(ctx: CanvasRenderingContext2D, commands: SvgCmd[]) {
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

function applyGlyphHandles(x: number, y: number, handles?: GlyphHandle[]) {
  if (!handles || handles.length === 0) return { x, y };

  let px = x;
  let py = y;

  for (const h of handles) {
    const dx = px - h.x;
    const dy = py - h.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const radius = Math.max(h.radius ?? 1, 1);
    const strength = h.strength ?? 0.5;

    if (dist >= radius) continue;

    const t = 1 - dist / radius;
    const k = strength * t * t;

    if (h.mode === "pinch") {
      px = h.x + dx * (1 - k);
      py = h.y + dy * (1 - k);
    } else if (h.mode === "scaleX") {
      px = h.x + dx * (1 - k);
    } else if (h.mode === "scaleY") {
      py = h.y + dy * (1 - k);
    } else if (h.mode === "move") {
      px = px + dx * 0.15 * k;
      py = py + dy * 0.15 * k;
    }
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
  onDblClick,
  onDragEnd,
  debugBounds = false,
  glyphEditMode = false,
  selectedGlyphIndex = null,
  glyphWarps = [],
  onGlyphSelect,
  onGlyphBoxesChange,
  onUpdateGlyphHandle,
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

  useEffect(() => {
    aliveRef.current = true;
    // Mark loading before kicking off the async shapeText() fetch below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHbLoaded(false);
    setShapeData((prev) => ({ ...prev, isLoading: true }));

    shapeText(text || "", fontUrl)
      .then((r: ShapedTextResult) => {
        if (!aliveRef.current) return;

        const glyphs = r.glyphs ?? [];
        const font = r.font ?? null;

        setShapeData({
          glyphs,
          font,
          unitsPerEm: r.unitsPerEm || 1000,
          isLoading: false,
        });

        setHbLoaded(!!font && glyphs.length > 0);
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

  const glyphLayouts = useMemo<GlyphLayout[]>(() => {
    const { font, glyphs, unitsPerEm } = shapeData;
    if (!font || glyphs.length === 0) return [];

    const upm = Math.max(unitsPerEm || 1000, 1);
    const scale = fontSize / upm;
    let penX = 0;
    const layouts: GlyphLayout[] = [];

    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      const glyphObj = font.glyphs.get(g.g);
      const advance = g.ax ?? 0;
      const gx = (penX + (g.dx ?? 0)) * scale;
      const gy = -(g.dy ?? 0) * scale;

      let bounds: GlyphBounds;

      if (glyphObj) {
        const box = glyphObj.getPath(gx, gy, fontSize).getBoundingBox();
        bounds = {
          minX: isFinite(box.x1) ? box.x1 : gx,
          minY: isFinite(box.y1) ? box.y1 : gy - fontSize,
          maxX: isFinite(box.x2) ? box.x2 : gx + fontSize * 0.5,
          maxY: isFinite(box.y2) ? box.y2 : gy,
          rawWidth: Math.max((isFinite(box.x2) ? box.x2 : gx + fontSize * 0.5) - (isFinite(box.x1) ? box.x1 : gx), 1),
          rawHeight: Math.max((isFinite(box.y2) ? box.y2 : gy) - (isFinite(box.y1) ? box.y1 : gy - fontSize), 1),
        };
      } else {
        const w = Math.max(advance * scale, fontSize * 0.4);
        const h = fontSize;
        bounds = {
          minX: gx,
          minY: gy - h,
          maxX: gx + w,
          maxY: gy,
          rawWidth: w,
          rawHeight: h,
        };
      }

      layouts.push({ glyphIndex: i, bounds, gx, gy, advance });
      penX += advance;
    }

    return layouts;
  }, [shapeData, fontSize]);

  const hitBoxes = useMemo<GlyphHitBox[]>(() => {
    return glyphLayouts.map(({ glyphIndex, bounds }) => ({
      glyphIndex,
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.rawWidth,
      height: bounds.rawHeight,
      cx: bounds.minX + bounds.rawWidth / 2,
      cy: bounds.minY + bounds.rawHeight / 2,
    }));
  }, [glyphLayouts]);

  useEffect(() => {
    onGlyphBoxesChange?.(hitBoxes);
  }, [hitBoxes, onGlyphBoxesChange]);

  const selectedWarp =
    glyphEditMode && selectedGlyphIndex != null
      ? glyphWarps.find((w) => w.glyphIndex === selectedGlyphIndex)
      : undefined;

  const selectedHandles = selectedWarp?.handles ?? [];
  const bw = Math.max(warpShapeWidth, 20);
  const bh = Math.max(warpShapeHeight, 20);
  const bx = -bw / 2;
  const by = -bh / 2;

  const localDrawOffsetX = -glyphBounds.minX + (bw - glyphBounds.rawWidth) / 2;
  const localDrawOffsetY = -glyphBounds.minY + (bh - glyphBounds.rawHeight) / 2;

  return (
    <Group
      id={id}
      x={x}
      y={y}
      rotation={rotation}
      opacity={opacity}
      draggable={draggable && !locked && !glyphEditMode}
      onClick={(e) => {
        onClick?.();

        if (!glyphEditMode) return;

        const group = e.currentTarget;
        const pos = group.getRelativePointerPosition();
        if (!pos) return;

        const textSpaceX = pos.x - bx - localDrawOffsetX;
        const textSpaceY = pos.y - by - localDrawOffsetY;

        const hit = hitBoxes.find(
          (b) =>
            textSpaceX >= b.x &&
            textSpaceX <= b.x + b.width &&
            textSpaceY >= b.y &&
            textSpaceY <= b.y + b.height
        );

        onGlyphSelect?.(hit?.glyphIndex ?? null);
      }}
      onTap={onTap}
      onDblClick={onDblClick}
      onDblTap={onDblClick}
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
          if (!shapeSvgPath || parsedCmds.length === 0) return;

          ctx.save();
          replayPath(ctx as unknown as CanvasRenderingContext2D, parsedCmds);
          ctx.clip();

          if (!hbLoaded || !shapeData.font || shapeData.glyphs.length === 0) {
            ctx.fillStyle = `${color}22`;
            replayPath(ctx as unknown as CanvasRenderingContext2D, parsedCmds);
            ctx.fill();
            ctx.restore();
            return;
          }

          const font = shapeData.font;
          let penX = 0;
          ctx.fillStyle = color;

          const scale = fontSize / Math.max(shapeData.unitsPerEm || 1000, 1);

          for (const [glyphIndex, g] of shapeData.glyphs.entries()) {
            const glyphObj = font.glyphs.get(g.g);
            const advance = g.ax ?? 0;

            if (!glyphObj) {
              penX += advance;
              continue;
            }

            const glyphWarp = glyphWarps.find((w) => w.glyphIndex === glyphIndex);
            const handles = glyphWarp?.handles ?? [];

            const gx = (penX + (g.dx ?? 0)) * scale;
            const gy = -(g.dy ?? 0) * scale;

            const warpPoint = (cx: number, cy: number) => {
              const baseX = cx + gx;
              const baseY = cy + gy;
              const pGlyph = applyGlyphHandles(baseX, baseY, handles);

              return applyShapeWarpPoint(
                pGlyph.x,
                pGlyph.y,
                glyphBounds,
                bw,
                bh,
                warpShapePadding,
                warpShapeMode,
                warpShapeStrength
              );
            };

            const opPath = glyphObj.getPath(0, 0, fontSize);
            const cmds = (opPath as any).commands.map((cmd: any) => {
              const out = { ...cmd };

              if (typeof cmd.x === "number" && typeof cmd.y === "number") {
                const p = warpPoint(cmd.x, cmd.y);
                out.x = p.x;
                out.y = p.y;
              }

              if (typeof cmd.x1 === "number" && typeof cmd.y1 === "number") {
                const p1 = warpPoint(cmd.x1, cmd.y1);
                out.x1 = p1.x;
                out.y1 = p1.y;
              }

              if (typeof cmd.x2 === "number" && typeof cmd.y2 === "number") {
                const p2 = warpPoint(cmd.x2, cmd.y2);
                out.x2 = p2.x;
                out.y2 = p2.y;
              }

              return out;
            });

            tracePath(ctx as unknown as CanvasRenderingContext2D, cmds);
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

      {glyphEditMode &&
        selectedGlyphIndex != null &&
        selectedHandles.map((h) => (
          <Circle
            key={h.id}
            x={bx + localDrawOffsetX + h.x}
            y={by + localDrawOffsetY + h.y}
            radius={7}
            fill="#ff4d4f"
            stroke="#ffffff"
            strokeWidth={2}
            draggable
            onMouseDown={(e) => e.cancelBubble = true}
            onTouchStart={(e) => e.cancelBubble = true}
            onDragMove={(e) => {
              e.cancelBubble = true;

              const group = e.currentTarget.getParent() as Konva.Group;
              const pos = group.getRelativePointerPosition();
              if (!pos || selectedGlyphIndex == null || !onUpdateGlyphHandle) return;

              const nextX = pos.x - bx - localDrawOffsetX;
              const nextY = pos.y - by - localDrawOffsetY;

              onUpdateGlyphHandle(selectedGlyphIndex, h.id, {
                x: nextX,
                y: nextY,
              });
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
            }}
          />
        ))}
    </Group>
  );
};

export default ShapeWarpText;