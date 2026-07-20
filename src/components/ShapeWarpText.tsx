import React, { useEffect, useMemo, useRef, useState } from "react";
import { Group, Shape, Rect, Circle, Arc } from "react-konva";
import type Konva from "konva";
import type { PathCommand } from "opentype.js";
import { parseSvgPath, replayPath } from "../lib/svgPath";
import { drawInsetBevel, EMBOSS_STRENGTH_SCALE } from "../lib/emboss";
import { useShapedGlyphs } from "../hooks/useShapedGlyphs";
import {
  applyGlyphEdit,
  applyGlyphRig,
  MOVE_HANDLE_COLOR,
  STRETCH_ANCHOR_COLOR,
  STRETCH_DRAG_COLOR,
} from "../lib/glyphEdits";
import type { GlyphEdit, GlyphStretchHandle, GlyphRig, GlyphRigValue } from "../types";

type ShapeWarpMode = "envelope" | "topBottom" | "stretch" | "radial";

export type GlyphHitBox = {
  glyphIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
  glyphId: number;
  gx: number;
  gy: number;
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
  embossStrength?: number;
  embossHighlightColor?: string;
  embossShadowColor?: string;
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
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  debugBounds?: boolean;

  glyphEditTool?: "move" | "stretch" | null;
  selectedGlyphIndex?: number | null;
  glyphEdits?: GlyphEdit[];
  glyphRigs?: GlyphRig[];
  glyphRigValues?: GlyphRigValue[];
  onGlyphSelect?: (glyphIndex: number | null) => void;
  onGlyphBoxesChange?: (boxes: GlyphHitBox[]) => void;
  onUpdateStretchHandle?: (
    glyphIndex: number,
    handleId: string,
    patch: Partial<GlyphStretchHandle>
  ) => void;
  onSetGlyphMoveOffset?: (
    glyphIndex: number,
    offsetX: number,
    offsetY: number
  ) => void;
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
  glyphId: number;
};

type MutablePathCmd = {
  type: PathCommand["type"];
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
};

const fallbackWidth = (text: string, fs: number) =>
  Math.max(text.length * fs * 0.55, 20);

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function clampUnit(v: number) {
  return Math.max(-1, Math.min(1, v));
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

/**
 * Inverse of applyShapeWarpPoint. None of the warp modes have a clean
 * closed-form inverse (stretch/topBottom/radial/envelope all fold the x-axis
 * position into the y-axis formula), so this solves numerically via Newton's
 * method with a finite-difference Jacobian — a few iterations converge well
 * within a pixel since the forward map is smooth and roughly linear locally.
 */
function invertShapeWarpPoint(
  targetX: number,
  targetY: number,
  bounds: GlyphBounds,
  shapeW: number,
  shapeH: number,
  padding: number,
  mode: ShapeWarpMode,
  strength: number
) {
  let x = targetX;
  let y = targetY;
  const eps = 1;

  for (let iter = 0; iter < 12; iter++) {
    const p = applyShapeWarpPoint(x, y, bounds, shapeW, shapeH, padding, mode, strength);
    const dx = targetX - p.x;
    const dy = targetY - p.y;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) break;

    const px = applyShapeWarpPoint(x + eps, y, bounds, shapeW, shapeH, padding, mode, strength);
    const py = applyShapeWarpPoint(x, y + eps, bounds, shapeW, shapeH, padding, mode, strength);

    const j11 = (px.x - p.x) / eps;
    const j21 = (px.y - p.y) / eps;
    const j12 = (py.x - p.x) / eps;
    const j22 = (py.y - p.y) / eps;

    const det = j11 * j22 - j12 * j21;
    if (Math.abs(det) < 1e-6) break;

    x += (dx * j22 - dy * j12) / det;
    y += (dy * j11 - dx * j21) / det;
  }

  return { x, y };
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
  embossStrength = 0,
  embossHighlightColor = "#ffffff",
  embossShadowColor = "#000000",
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
  onDragMove,
  onDragEnd,
  debugBounds = false,
  glyphEditTool = null,
  selectedGlyphIndex = null,
  glyphEdits = [],
  glyphRigs = [],
  glyphRigValues = [],
  onGlyphSelect,
  onGlyphBoxesChange,
  onUpdateStretchHandle,
  onSetGlyphMoveOffset,
}) => {
  const shapeData = useShapedGlyphs(text, fontFamily);
  const { hbLoaded } = shapeData;
  const moveDragOriginRef = useRef<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

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

      layouts.push({ glyphIndex: i, bounds, gx, gy, advance, glyphId: g.g });
      penX += advance;
    }

    return layouts;
  }, [shapeData, fontSize]);

  const hitBoxes = useMemo<GlyphHitBox[]>(() => {
    return glyphLayouts.map(({ glyphIndex, bounds, gx, gy, glyphId }) => ({
      glyphIndex,
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.rawWidth,
      height: bounds.rawHeight,
      cx: bounds.minX + bounds.rawWidth / 2,
      cy: bounds.minY + bounds.rawHeight / 2,
      glyphId,
      gx,
      gy,
    }));
  }, [glyphLayouts]);

  useEffect(() => {
    onGlyphBoxesChange?.(hitBoxes);
  }, [hitBoxes, onGlyphBoxesChange]);

  const selectedEdit =
    glyphEditTool != null && selectedGlyphIndex != null
      ? glyphEdits.find((w) => w.glyphIndex === selectedGlyphIndex)
      : undefined;
  const selectedStretches = selectedEdit?.stretches ?? [];
  const selectedMoveOffset = selectedEdit?.move ?? { offsetX: 0, offsetY: 0 };
  const selectedGlyphBox =
    selectedGlyphIndex != null
      ? hitBoxes.find((b) => b.glyphIndex === selectedGlyphIndex)
      : undefined;
  const bw = Math.max(warpShapeWidth, 20);
  const bh = Math.max(warpShapeHeight, 20);
  const bx = -bw / 2;
  const by = -bh / 2;

  // Maps a raw (pre-warp) glyph-space point to the same on-screen position
  // the sceneFunc's own warpPoint() puts the actual glyph pixels at, so
  // overlay handles track the rendered glyphs instead of the unwarped run.
  const warpHandlePoint = (rawX: number, rawY: number) => {
    const p = applyShapeWarpPoint(
      rawX,
      rawY,
      glyphBounds,
      bw,
      bh,
      warpShapePadding,
      warpShapeMode,
      warpShapeStrength
    );
    return { x: bx + p.x, y: by + p.y };
  };

  const invertToRawPoint = (screenX: number, screenY: number) =>
    invertShapeWarpPoint(
      screenX - bx,
      screenY - by,
      glyphBounds,
      bw,
      bh,
      warpShapePadding,
      warpShapeMode,
      warpShapeStrength
    );

  const moveHandleRect = selectedGlyphBox
    ? (() => {
        const rawX = selectedGlyphBox.x + selectedMoveOffset.offsetX;
        const rawY = selectedGlyphBox.y + selectedMoveOffset.offsetY;
        const topLeft = warpHandlePoint(rawX, rawY);
        const bottomRight = warpHandlePoint(
          rawX + selectedGlyphBox.width,
          rawY + selectedGlyphBox.height
        );
        return {
          x: topLeft.x,
          y: topLeft.y,
          width: bottomRight.x - topLeft.x,
          height: bottomRight.y - topLeft.y,
        };
      })()
    : null;

  return (
    <Group
      id={id}
      x={x}
      y={y}
      rotation={rotation}
      opacity={opacity}
      draggable={draggable && !locked}
      dragBoundFunc={glyphEditTool != null ? () => ({ x, y }) : undefined}
      onClick={(e) => {
        onClick?.();

        if (glyphEditTool == null) return;

        const group = e.currentTarget;
        const pos = group.getRelativePointerPosition();
        if (!pos) return;

        const raw = invertToRawPoint(pos.x, pos.y);
        const textSpaceX = raw.x;
        const textSpaceY = raw.y;

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
      onDragMove={glyphEditTool == null ? onDragMove : undefined}
      onDragEnd={glyphEditTool == null ? onDragEnd : undefined}
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
        sceneFunc={(ctx, shape) => {
          if (!shapeSvgPath || parsedCmds.length === 0) return;

          if (!hbLoaded || !shapeData.font || shapeData.glyphs.length === 0) {
            ctx.save();
            replayPath(ctx as unknown as CanvasRenderingContext2D, parsedCmds);
            ctx.clip();
            ctx.fillStyle = `${color}22`;
            replayPath(ctx as unknown as CanvasRenderingContext2D, parsedCmds);
            ctx.fill();
            ctx.restore();
            return;
          }

          const font = shapeData.font;
          const scale = fontSize / Math.max(shapeData.unitsPerEm || 1000, 1);

          // Draws the whole warped glyph run once, in `fillColor`, offset by
          // (offsetX, offsetY) — called once normally against the real
          // context for the main fill, and against a scratch context by
          // drawInsetBevel when emboss is active.
          const drawPass = (
            targetCtx: CanvasRenderingContext2D,
            fillColor: string,
            offsetX: number,
            offsetY: number,
            includeStroke: boolean
          ) => {
            targetCtx.save();
            targetCtx.translate(offsetX, offsetY);
            replayPath(targetCtx, parsedCmds);
            targetCtx.clip();

            let penX = 0;
            targetCtx.fillStyle = fillColor;

            for (const [glyphIndex, g] of shapeData.glyphs.entries()) {
              const glyphObj = font.glyphs.get(g.g);
              const advance = g.ax ?? 0;

              if (!glyphObj) {
                penX += advance;
                continue;
              }

              const edit = glyphEdits.find((w) => w.glyphIndex === glyphIndex);

              const gx = (penX + (g.dx ?? 0)) * scale;
              const gy = -(g.dy ?? 0) * scale;

              const warpPoint = (cx: number, cy: number) => {
                const baseX = cx + gx;
                const baseY = cy + gy;
                const pGlyph = applyGlyphEdit(baseX, baseY, edit);
                const pRigged = applyGlyphRig(
                  pGlyph.x,
                  pGlyph.y,
                  fontFamily,
                  g.g,
                  fontSize,
                  glyphRigs,
                  glyphRigValues,
                  -1,
                  gx,
                  gy
                );

                return applyShapeWarpPoint(
                  pRigged.x,
                  pRigged.y,
                  glyphBounds,
                  bw,
                  bh,
                  warpShapePadding,
                  warpShapeMode,
                  warpShapeStrength
                );
              };

              const opPath = glyphObj.getPath(0, 0, fontSize);
              const cmds: PathCommand[] = opPath.commands.map((cmd) => {
                const c = cmd as MutablePathCmd;
                const out: MutablePathCmd = { ...c };

                if (typeof c.x === "number" && typeof c.y === "number") {
                  const p = warpPoint(c.x, c.y);
                  out.x = p.x;
                  out.y = p.y;
                }

                if (typeof c.x1 === "number" && typeof c.y1 === "number") {
                  const p1 = warpPoint(c.x1, c.y1);
                  out.x1 = p1.x;
                  out.y1 = p1.y;
                }

                if (typeof c.x2 === "number" && typeof c.y2 === "number") {
                  const p2 = warpPoint(c.x2, c.y2);
                  out.x2 = p2.x;
                  out.y2 = p2.y;
                }

                return out as PathCommand;
              });

              replayPath(targetCtx, cmds);
              targetCtx.fill();

              if (includeStroke && strokeWidth > 0) {
                targetCtx.strokeStyle = stroke;
                targetCtx.lineWidth = strokeWidth;
                targetCtx.stroke();
              }

              penX += advance;
            }

            targetCtx.restore();
          };

          drawPass(ctx as unknown as CanvasRenderingContext2D, color, 0, 0, true);

          if (embossStrength > 0) {
            const absScale = shape.getAbsoluteScale();
            const resolutionScale =
              ctx.getCanvas().getPixelRatio() *
              Math.max(Math.abs(absScale.x), Math.abs(absScale.y));
            drawInsetBevel(
              ctx as unknown as CanvasRenderingContext2D,
              bw,
              bh,
              embossStrength * EMBOSS_STRENGTH_SCALE,
              embossHighlightColor,
              embossShadowColor,
              (scratchCtx, offsetX, offsetY, fillColor) =>
                drawPass(scratchCtx, fillColor, offsetX, offsetY, false),
              resolutionScale
            );
          }
        }}
      />

      {glyphEditTool === "stretch" &&
        selectedGlyphIndex != null &&
        selectedStretches.map((h) => (
          <React.Fragment key={h.id}>
            <Circle
              x={warpHandlePoint(h.anchorX, h.anchorY).x}
              y={warpHandlePoint(h.anchorX, h.anchorY).y}
              radius={7}
              fill={STRETCH_ANCHOR_COLOR}
              stroke="#ffffff"
              strokeWidth={2}
              draggable
              onMouseDown={(e) => (e.cancelBubble = true)}
              onTouchStart={(e) => (e.cancelBubble = true)}
              onDragMove={(e) => {
                e.cancelBubble = true;

                const group = e.currentTarget.getParent() as Konva.Group;
                const pos = group.getRelativePointerPosition();
                if (!pos || !onUpdateStretchHandle) return;

                const raw = invertToRawPoint(pos.x, pos.y);
                onUpdateStretchHandle(selectedGlyphIndex, h.id, {
                  anchorX: raw.x,
                  anchorY: raw.y,
                });
              }}
              onDragEnd={(e) => {
                e.cancelBubble = true;
              }}
            />
            <Circle
              x={warpHandlePoint(h.dragX, h.dragY).x}
              y={warpHandlePoint(h.dragX, h.dragY).y}
              radius={7}
              fill={STRETCH_DRAG_COLOR}
              stroke="#ffffff"
              strokeWidth={2}
              draggable
              onMouseDown={(e) => (e.cancelBubble = true)}
              onTouchStart={(e) => (e.cancelBubble = true)}
              onDragMove={(e) => {
                e.cancelBubble = true;

                const group = e.currentTarget.getParent() as Konva.Group;
                const pos = group.getRelativePointerPosition();
                if (!pos || !onUpdateStretchHandle) return;

                const raw = invertToRawPoint(pos.x, pos.y);
                onUpdateStretchHandle(selectedGlyphIndex, h.id, {
                  dragX: raw.x,
                  dragY: raw.y,
                });
              }}
              onDragEnd={(e) => {
                e.cancelBubble = true;
              }}
            />
          </React.Fragment>
        ))}

      {glyphEditTool === "move" &&
        selectedGlyphIndex != null &&
        selectedGlyphBox &&
        moveHandleRect && (
          <Rect
            x={moveHandleRect.x}
            y={moveHandleRect.y}
            width={moveHandleRect.width}
            height={moveHandleRect.height}
            fill="transparent"
            stroke={MOVE_HANDLE_COLOR}
            strokeWidth={2}
            dash={[6, 4]}
            draggable
            onMouseDown={(e) => (e.cancelBubble = true)}
            onTouchStart={(e) => (e.cancelBubble = true)}
            onDragStart={(e) => {
              e.cancelBubble = true;

              const group = e.currentTarget.getParent() as Konva.Group;
              const pos = group.getRelativePointerPosition();
              if (!pos) return;

              const raw = invertToRawPoint(pos.x, pos.y);
              moveDragOriginRef.current = {
                x: raw.x,
                y: raw.y,
                offsetX: selectedMoveOffset.offsetX,
                offsetY: selectedMoveOffset.offsetY,
              };
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;

              const origin = moveDragOriginRef.current;
              const group = e.currentTarget.getParent() as Konva.Group;
              const pos = group.getRelativePointerPosition();
              if (!origin || !pos || !onSetGlyphMoveOffset) return;

              const raw = invertToRawPoint(pos.x, pos.y);
              onSetGlyphMoveOffset(
                selectedGlyphIndex,
                origin.offsetX + (raw.x - origin.x),
                origin.offsetY + (raw.y - origin.y)
              );
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              moveDragOriginRef.current = null;
            }}
          />
        )}
    </Group>
  );
};

export default ShapeWarpText;