import React, { useEffect, useMemo, useRef, useState } from "react";
import { Group, Shape, Rect, Arc, Circle } from "react-konva";
import type Konva from "konva";
import type { PathCommand } from "opentype.js";
import type { HarfBuzzGlyph, ShapedTextResult } from "../lib/harfbuzz";
import { warpPoint, type GlyphBounds } from "../lib/warp";
import { useShapedGlyphs } from "../hooks/useShapedGlyphs";
import { useOverrideGlyph } from "../hooks/useOverrideGlyph";
import {
  applyGlyphEdit,
  MOVE_HANDLE_COLOR,
  STRETCH_ANCHOR_COLOR,
  STRETCH_DRAG_COLOR,
} from "../lib/glyphEdits";
import type { GlyphEdit, GlyphStretchHandle } from "../types";
import {
  isOverrideGlyphChar,
  OVERRIDE_SCALE,
  OVERRIDE_RAISE,
  type OverrideGlyph,
} from "../lib/glyphOverrides";

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
  embossStrength?: number;
  embossHighlightColor?: string;
  embossShadowColor?: string;
  rotation?: number;
  warpX?: number;
  warpY?: number;
  kashidaEditMode?: boolean;
  onKashidaTextChange?: (text: string) => void;
  glyphEditTool?: "move" | "stretch" | null;
  selectedGlyphIndex?: number | null;
  glyphEdits?: GlyphEdit[];
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
  locked?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  debugBounds?: boolean;
};

const fallbackWidth = (text: string, fs: number) =>
  Math.max(text.length * fs * 0.55, 20);

type GlyphHitBox = {
  glyphIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** A draggable kashīda handle sitting between two shaped glyphs. */
type KashidaGap = {
  x: number;
  y: number;
  /** String index (into the block's un-elongated text) to splice tatweel characters at. */
  insertIndex: number;
  /** The block's text with this gap's existing tatweel run (if any) removed. */
  baseText: string;
  existingCount: number;
};

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
  fauxBoldWidth = 0,
  overrideGlyph: OverrideGlyph | null = null,
  glyphEdits: GlyphEdit[] = []
) {
  let penX = 0;
  const upm = Math.max(unitsPerEm || 1000, 1);
  const scale = fontSize / upm;
  const width = Math.max(bounds.rawWidth, 1);
  const height = Math.max(bounds.rawHeight, fontSize);

  for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex++) {
    const g = glyphs[glyphIndex];
    const glyphObj = font.glyphs.get(g.g);
    const advance = g.ax ?? 0;

    if (!glyphObj) {
      penX += advance;
      continue;
    }

    const gx = (penX + (g.dx ?? 0)) * scale;
    const gy = -(g.dy ?? 0) * scale;
    const edit = glyphEdits.find((w) => w.glyphIndex === glyphIndex);

    ctx.save();
    ctx.translate(gx, gy);

    if (
      overrideGlyph &&
      (isOverrideGlyphChar(glyphObj.unicode) ||
        glyphObj.unicodes.some(isOverrideGlyphChar))
    ) {
      const glyphScale =
        (fontSize * OVERRIDE_SCALE) /
        Math.max(overrideGlyph.width, overrideGlyph.height, 1);
      ctx.translate(0, -fontSize * OVERRIDE_RAISE);
      ctx.scale(glyphScale, glyphScale);
      tracePath(ctx, overrideGlyph.commands as unknown as PathCommand[]);
    } else {
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
          const handled = applyGlyphEdit(c.x + gx, c.y + gy, edit);
          const p = warpPoint(
            handled.x,
            handled.y,
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
          const handled1 = applyGlyphEdit(c.x1 + gx, c.y1 + gy, edit);
          const p1 = warpPoint(
            handled1.x,
            handled1.y,
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
          const handled2 = applyGlyphEdit(c.x2 + gx, c.y2 + gy, edit);
          const p2 = warpPoint(
            handled2.x,
            handled2.y,
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
    }

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
  embossStrength = 0,
  embossHighlightColor = "#ffffff",
  embossShadowColor = "#000000",
  rotation = 0,
  warpX = 0,
  warpY = 0,
  kashidaEditMode = false,
  onKashidaTextChange,
  glyphEditTool = null,
  selectedGlyphIndex = null,
  glyphEdits = [],
  onGlyphSelect,
  onGlyphBoxesChange,
  onUpdateStretchHandle,
  onSetGlyphMoveOffset,
  locked,
  draggable = true,
  onClick,
  onTap,
  onDblClick,
  onDragMove,
  onDragEnd,
  debugBounds = false,
}) => {
  const shapeData = useShapedGlyphs(text, fontFamily);
  const { hbLoaded } = shapeData;
  const overrideGlyph = useOverrideGlyph();

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
  const localDrawX = -glyphBounds.minX + (bw - glyphBounds.rawWidth) / 2;
  const localDrawY = -glyphBounds.minY + (bh - glyphBounds.rawHeight) / 2;

  const glyphHitBoxes = useMemo<GlyphHitBox[]>(() => {
    const { font, glyphs, unitsPerEm } = shapeData;
    if (!font || glyphs.length === 0) return [];

    const upm = Math.max(unitsPerEm || 1000, 1);
    const scale = fontSize / upm;
    let penX = 0;
    const boxes: GlyphHitBox[] = [];

    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      const glyphObj = font.glyphs.get(g.g);
      const advance = g.ax ?? 0;
      const gx = (penX + (g.dx ?? 0)) * scale;
      const gy = -(g.dy ?? 0) * scale;

      if (glyphObj) {
        const box = glyphObj.getPath(gx, gy, fontSize).getBoundingBox();
        if (isFinite(box.x1) && isFinite(box.x2) && isFinite(box.y1) && isFinite(box.y2)) {
          boxes.push({
            glyphIndex: i,
            x: box.x1,
            y: box.y1,
            width: Math.max(box.x2 - box.x1, 1),
            height: Math.max(box.y2 - box.y1, 1),
          });
        }
      }

      penX += advance;
    }

    return boxes;
  }, [shapeData, fontSize]);

  useEffect(() => {
    onGlyphBoxesChange?.(glyphHitBoxes);
  }, [glyphHitBoxes, onGlyphBoxesChange]);

  const selectedEdit =
    glyphEditTool != null && selectedGlyphIndex != null
      ? glyphEdits.find((w) => w.glyphIndex === selectedGlyphIndex)
      : undefined;
  const selectedStretches = selectedEdit?.stretches ?? [];
  const selectedMoveOffset = selectedEdit?.move ?? { offsetX: 0, offsetY: 0 };
  const selectedGlyphBox =
    selectedGlyphIndex != null
      ? glyphHitBoxes.find((b) => b.glyphIndex === selectedGlyphIndex)
      : undefined;

  const kashidaGaps = useMemo<KashidaGap[]>(() => {
    const { font, glyphs, unitsPerEm } = shapeData;
    if (!kashidaEditMode || !font || glyphs.length < 2) return [];

    const upm = Math.max(unitsPerEm || 1000, 1);
    const scale = fontSize / upm;
    const localDrawX = -glyphBounds.minX + (bw - glyphBounds.rawWidth) / 2;
    const centerY = by + bh / 2;

    const gaps: KashidaGap[] = [];
    let penX = 0;

    for (let i = 0; i < glyphs.length - 1; i++) {
      penX += glyphs[i].ax ?? 0;
      const boundaryX = bx + localDrawX + penX * scale;
      const insertIndex = glyphs[i].cl ?? 0;

      const before = text[insertIndex - 1];
      if (before === undefined || /\s/.test(before)) continue;

      let existingCount = 0;
      while (text[insertIndex + existingCount] === "ـ") existingCount++;

      const after = text[insertIndex + existingCount];
      if (after === undefined || /\s/.test(after)) continue;

      const baseText =
        text.slice(0, insertIndex) + text.slice(insertIndex + existingCount);

      gaps.push({ x: boundaryX, y: centerY, insertIndex, baseText, existingCount });
    }

    return gaps;
  }, [shapeData, text, fontSize, kashidaEditMode, bx, by, bw, bh, glyphBounds]);

  const tatweelWidth = useMemo(() => {
    const font = shapeData.font;
    if (font) {
      try {
        const glyph = font.charToGlyph("ـ");
        if (glyph && typeof glyph.advanceWidth === "number" && glyph.advanceWidth > 0) {
          const upm = Math.max(shapeData.unitsPerEm || 1000, 1);
          return (glyph.advanceWidth / upm) * fontSize;
        }
      } catch {
        // fall through to the estimate below
      }
    }
    return fontSize * 0.5;
  }, [shapeData.font, shapeData.unitsPerEm, fontSize]);

  const [frozenGaps, setFrozenGaps] = useState<KashidaGap[] | null>(null);
  const dragStateRef = useRef<{ originX: number; insertIndex: number; baseText: string } | null>(
    null
  );
  const moveDragOriginRef = useRef<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const displayedGaps = frozenGaps ?? kashidaGaps;

  const commitKashida = (
    insertIndex: number,
    baseText: string,
    deltaX: number
  ) => {
    const count = Math.max(0, Math.min(40, Math.round(deltaX / Math.max(tatweelWidth, 1))));
    const newText =
      baseText.slice(0, insertIndex) + "ـ".repeat(count) + baseText.slice(insertIndex);
    onKashidaTextChange?.(newText);
  };

  return (
    <Group
      id={id}
      x={x}
      y={y}
      rotation={rotation}
      opacity={opacity}
      draggable={draggable && !locked && glyphEditTool == null}
      onClick={(e) => {
        onClick?.();

        if (glyphEditTool == null) return;

        const group = e.currentTarget;
        const pos = group.getRelativePointerPosition();
        if (!pos) return;

        const textSpaceX = pos.x - bx - localDrawX;
        const textSpaceY = pos.y - by - localDrawY;

        const hit = glyphHitBoxes.find(
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

          if (embossStrength > 0) {
            ctx.save();
            ctx.translate(embossStrength, embossStrength);
            ctx.fillStyle = embossShadowColor;
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
              0,
              overrideGlyph,
              glyphEdits
            );
            ctx.restore();

            ctx.save();
            ctx.translate(-embossStrength, -embossStrength);
            ctx.fillStyle = embossHighlightColor;
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
              0,
              overrideGlyph,
              glyphEdits
            );
            ctx.restore();
          }

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
            fauxBoldWidth,
            overrideGlyph,
            glyphEdits
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
              strokeWidth,
              0,
              overrideGlyph,
              glyphEdits
            );
          }

          ctx.restore();
        }}
      />

      {kashidaEditMode &&
        displayedGaps.map((gap, i) => (
          <Circle
            key={i}
            x={gap.x}
            y={gap.y}
            radius={6}
            fill="#d4af37"
            stroke="#ffffff"
            strokeWidth={1.5}
            draggable
            dragBoundFunc={(pos) => ({ x: pos.x, y: gap.y })}
            onMouseDown={(e) => {
              e.cancelBubble = true;
            }}
            onTouchStart={(e) => {
              e.cancelBubble = true;
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;
              dragStateRef.current = {
                originX: gap.x,
                insertIndex: gap.insertIndex,
                baseText: gap.baseText,
              };
              setFrozenGaps(kashidaGaps);
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const state = dragStateRef.current;
              if (!state) return;
              const deltaX = Math.abs(e.target.x() - state.originX);
              commitKashida(state.insertIndex, state.baseText, deltaX);
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              const state = dragStateRef.current;
              if (state) {
                const deltaX = Math.abs(e.target.x() - state.originX);
                commitKashida(state.insertIndex, state.baseText, deltaX);
              }
              dragStateRef.current = null;
              setFrozenGaps(null);
            }}
          />
        ))}

      {glyphEditTool === "stretch" &&
        selectedGlyphIndex != null &&
        selectedStretches.map((h) => (
          <React.Fragment key={h.id}>
            <Circle
              x={bx + localDrawX + h.anchorX}
              y={by + localDrawY + h.anchorY}
              radius={7}
              fill={STRETCH_ANCHOR_COLOR}
              stroke="#ffffff"
              strokeWidth={2}
              draggable
              onMouseDown={(e) => {
                e.cancelBubble = true;
              }}
              onTouchStart={(e) => {
                e.cancelBubble = true;
              }}
              onDragMove={(e) => {
                e.cancelBubble = true;

                const group = e.currentTarget.getParent() as Konva.Group;
                const pos = group.getRelativePointerPosition();
                if (!pos || !onUpdateStretchHandle) return;

                onUpdateStretchHandle(selectedGlyphIndex, h.id, {
                  anchorX: pos.x - bx - localDrawX,
                  anchorY: pos.y - by - localDrawY,
                });
              }}
              onDragEnd={(e) => {
                e.cancelBubble = true;
              }}
            />
            <Circle
              x={bx + localDrawX + h.dragX}
              y={by + localDrawY + h.dragY}
              radius={7}
              fill={STRETCH_DRAG_COLOR}
              stroke="#ffffff"
              strokeWidth={2}
              draggable
              onMouseDown={(e) => {
                e.cancelBubble = true;
              }}
              onTouchStart={(e) => {
                e.cancelBubble = true;
              }}
              onDragMove={(e) => {
                e.cancelBubble = true;

                const group = e.currentTarget.getParent() as Konva.Group;
                const pos = group.getRelativePointerPosition();
                if (!pos || !onUpdateStretchHandle) return;

                onUpdateStretchHandle(selectedGlyphIndex, h.id, {
                  dragX: pos.x - bx - localDrawX,
                  dragY: pos.y - by - localDrawY,
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
        selectedGlyphBox && (
          <Rect
            x={bx + localDrawX + selectedGlyphBox.x + selectedMoveOffset.offsetX}
            y={by + localDrawY + selectedGlyphBox.y + selectedMoveOffset.offsetY}
            width={selectedGlyphBox.width}
            height={selectedGlyphBox.height}
            fill="transparent"
            stroke={MOVE_HANDLE_COLOR}
            strokeWidth={2}
            dash={[6, 4]}
            draggable
            onMouseDown={(e) => {
              e.cancelBubble = true;
            }}
            onTouchStart={(e) => {
              e.cancelBubble = true;
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;

              const group = e.currentTarget.getParent() as Konva.Group;
              const pos = group.getRelativePointerPosition();
              if (!pos) return;

              moveDragOriginRef.current = {
                x: pos.x,
                y: pos.y,
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

              onSetGlyphMoveOffset(
                selectedGlyphIndex,
                origin.offsetX + (pos.x - origin.x),
                origin.offsetY + (pos.y - origin.y)
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

export default ShapedText;