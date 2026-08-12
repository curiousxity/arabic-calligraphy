import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Shape, Rect, Arc } from "react-konva";
import type Konva from "konva";
import type { PathCommand } from "opentype.js";
import { parseSvgPath, replayPath } from "../lib/svgPath";
import { useShapedGlyphs } from "../hooks/useShapedGlyphs";
import { applyGlyphEdit, prepareGlyphRig, applyPreparedGlyphRig } from "../lib/glyphEdits";
import { useGlyphSchemaCatalog } from "../lib/strokeSchema/glyphLookup";
import type { StretchDefinition } from "../lib/strokeSchema/deriveCatalog";
import { deriveContourMask } from "../lib/glyphContours";
import { findDiacriticGlyphIndices } from "../lib/diacritics";
import { DiacriticHoverHandles } from "./DiacriticHoverHandles";
import type { DiacriticPlacement } from "../lib/diacriticPlacement";
import type {
  GlyphEdit,
  GlyphStretchHandle,
  GlyphRig,
  GlyphRigValue,
  DiacriticOverride,
} from "../types";
import {
  applyShapeWarpPoint,
  invertShapeWarpPoint,
  type ShapeWarpMode,
  type GlyphBounds,
} from "../lib/shapeWarpPoint";

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

  glyphEditTool?: "stretch" | null;
  selectedGlyphIndex?: number | null;
  glyphEdits?: GlyphEdit[];
  glyphRigs?: GlyphRig[];
  glyphRigValues?: GlyphRigValue[];
  onGlyphSelect?: (glyphIndex: number | null) => void;
  onGlyphBoxesChange?: (boxes: GlyphHitBox[]) => void;
  onGlyphSchemaChange?: (catalog: Record<number, StretchDefinition[]>) => void;
  onUpdateStretchHandle?: (
    glyphIndex: number,
    handleId: string,
    patch: Partial<GlyphStretchHandle>
  ) => void;

  isSelected?: boolean;
  diacriticOverrides?: DiacriticOverride[];
  onDragDiacriticOverride?: (glyphIndex: number, patch: Partial<DiacriticOverride>) => void;
  onToggleDiacriticHidden?: (glyphIndex: number) => void;
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
  onDragMove,
  onDragEnd,
  debugBounds = false,
  glyphEditTool = null,
  glyphEdits = [],
  glyphRigs = [],
  glyphRigValues = [],
  onGlyphSelect,
  onGlyphBoxesChange,
  onGlyphSchemaChange,
  onUpdateStretchHandle,
  isSelected = false,
  diacriticOverrides = [],
  onDragDiacriticOverride,
  onToggleDiacriticHidden,
}) => {
  const shapeData = useShapedGlyphs(text, fontFamily);
  const { hbLoaded } = shapeData;
  const glyphSchemaCatalog = useGlyphSchemaCatalog(
    shapeData.shapableText,
    shapeData.glyphs,
    shapeData.font
  );

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

  // Computes the overall glyph-run bounding box (glyphBounds) and per-glyph
  // layout boxes (glyphLayouts) in one pass — both need the same (expensive)
  // glyphObj.getPath(...).getBoundingBox() call per glyph, so walking the
  // font twice to get each independently would do that work twice. Note the
  // two outputs deliberately stay asymmetric, matching prior behavior:
  // glyphLayouts always has one entry per glyph (synthesizing a guessed box
  // when a glyph is missing/degenerate, so callers always have something to
  // position against), while glyphBounds's overall min/max only folds in
  // glyphs that actually produced a finite box.
  const glyphMetrics = useMemo<{ bounds: GlyphBounds; layouts: GlyphLayout[] }>(() => {
    const fallbackBounds = (): GlyphBounds => {
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
    };

    const { font, glyphs, unitsPerEm } = shapeData;

    if (!font || glyphs.length === 0) {
      return { bounds: fallbackBounds(), layouts: [] };
    }

    const upm = Math.max(unitsPerEm || 1000, 1);
    const scale = fontSize / upm;

    let penX = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
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

        if (isFinite(box.x1) && isFinite(box.x2)) {
          minX = Math.min(minX, box.x1);
          maxX = Math.max(maxX, box.x2);
        }

        if (isFinite(box.y1) && isFinite(box.y2)) {
          minY = Math.min(minY, box.y1);
          maxY = Math.max(maxY, box.y2);
        }

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

    const overallBounds = !isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)
      ? fallbackBounds()
      : {
          minX,
          minY,
          maxX,
          maxY,
          rawWidth: Math.max(maxX - minX, 1),
          rawHeight: Math.max(maxY - minY, 1),
        };

    return { bounds: overallBounds, layouts };
  }, [shapeData, text, fontSize]);

  const glyphBounds = glyphMetrics.bounds;
  const glyphLayouts = glyphMetrics.layouts;

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

  // Recomputed per render for this component's own current glyph run, so a
  // stale override whose glyph index now lands on a base letter (text edits
  // shift indices) is ignored rather than hiding or ballooning that letter —
  // the same guard ShapedText.tsx already applies.
  const diacriticGlyphIndices = useMemo(
    () => findDiacriticGlyphIndices(shapeData.glyphs, shapeData.font),
    [shapeData.glyphs, shapeData.font]
  );

  const activeDiacriticOverrides = useMemo(
    () => diacriticOverrides.filter((o) => diacriticGlyphIndices.has(o.glyphIndex)),
    [diacriticOverrides, diacriticGlyphIndices]
  );

  useEffect(() => {
    onGlyphBoxesChange?.(hitBoxes);
  }, [hitBoxes, onGlyphBoxesChange]);

  useEffect(() => {
    onGlyphSchemaChange?.(glyphSchemaCatalog);
  }, [glyphSchemaCatalog, onGlyphSchemaChange]);

  // Handles no longer get their axis from dragging — it's auto-computed once
  // at creation (App.tsx's setStretchFactor). The mask still needs the real
  // glyph outline, which only this component has, so it's derived here, once,
  // the first time a new maskAuto handle with no mask yet shows up — for
  // every glyph with pending handles, not just the canvas-selected one, since
  // the Morph panel's sliders create handles without any canvas selection.
  useEffect(() => {
    if (!onUpdateStretchHandle) return;
    const { font, glyphs } = shapeData;
    if (!font) return;

    for (const edit of glyphEdits) {
      const pending = edit.stretches.filter((h) => h.maskAuto && h.mask == null);
      if (pending.length === 0) continue;

      const g = glyphs[edit.glyphIndex];
      const glyphObj = g ? font.glyphs.get(g.g) : undefined;
      if (!glyphObj) continue;

      const box = hitBoxes.find((b) => b.glyphIndex === edit.glyphIndex);
      const gx = box?.gx ?? 0;
      const gy = box?.gy ?? 0;
      const commands = glyphObj.getPath(0, 0, fontSize).commands as PathCommand[];

      for (const h of pending) {
        const mask = deriveContourMask(commands, [
          { x: h.anchorX - gx, y: h.anchorY - gy },
          { x: h.dragOriginX - gx, y: h.dragOriginY - gy },
        ]);
        if (mask) onUpdateStretchHandle(edit.glyphIndex, h.id, { mask });
      }
    }
  }, [glyphEdits, shapeData, hitBoxes, fontSize, onUpdateStretchHandle]);

  const bw = Math.max(warpShapeWidth, 20);
  const bh = Math.max(warpShapeHeight, 20);
  const bx = -bw / 2;
  const by = -bh / 2;

  const invertToRawPoint = useCallback(
    (screenX: number, screenY: number) =>
      invertShapeWarpPoint(
        screenX - bx,
        screenY - by,
        glyphBounds,
        bw,
        bh,
        warpShapePadding,
        warpShapeMode,
        warpShapeStrength
      ),
    [bx, by, glyphBounds, bw, bh, warpShapePadding, warpShapeMode, warpShapeStrength]
  );

  // The warp itself is the adapter: forward for drawing, Newton-inverted for
  // reading a drag back. Every placement shares one pair, since the warp is a
  // property of the block rather than of an individual mark.
  const diacriticPlacements = useMemo<DiacriticPlacement[]>(() => {
    const toCanvas = (x: number, y: number) => {
      const p = applyShapeWarpPoint(
        x,
        y,
        glyphBounds,
        bw,
        bh,
        warpShapePadding,
        warpShapeMode,
        warpShapeStrength
      );
      return { x: p.x + bx, y: p.y + by };
    };
    const toLocal = (x: number, y: number) => invertToRawPoint(x, y);

    return hitBoxes
      .filter((b) => diacriticGlyphIndices.has(b.glyphIndex))
      .map((b) => ({
        glyphIndex: b.glyphIndex,
        key: String(b.glyphIndex),
        box: { x: b.x, y: b.y, width: b.width, height: b.height },
        toCanvas,
        toLocal,
      }));
  }, [
    hitBoxes,
    diacriticGlyphIndices,
    glyphBounds,
    bw,
    bh,
    bx,
    by,
    warpShapePadding,
    warpShapeMode,
    warpShapeStrength,
    invertToRawPoint,
  ]);

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
        sceneFunc={(ctx) => {
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
          // (offsetX, offsetY).
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

              const diacriticOverride = activeDiacriticOverrides.find(
                (o) => o.glyphIndex === glyphIndex
              );
              if (diacriticOverride?.hidden) {
                penX += advance;
                continue;
              }

              const gx = (penX + (g.dx ?? 0)) * scale;
              const gy = -(g.dy ?? 0) * scale;
              const preparedRig = prepareGlyphRig(fontFamily, g.g, fontSize, glyphRigs, glyphRigValues, gx, gy);

              const warpPoint = (cx: number, cy: number) => {
                // Override applied here, before applyShapeWarpPoint, so an
                // adjusted mark keeps being bent along with the rest of the
                // run instead of floating off its letter. This is
                // deliberately the opposite order from ShapedText, whose own
                // warpX/warpY is a mild distortion rather than the point of
                // the block type — see the design spec.
                const ds = diacriticOverride?.scale ?? 1;
                const dy = diacriticOverride?.offsetY ?? 0;
                const baseX = gx + cx * ds;
                const baseY = gy + dy + cy * ds;
                const pGlyph = applyGlyphEdit(baseX, baseY, edit);
                const pRigged = applyPreparedGlyphRig(pGlyph.x, pGlyph.y, preparedRig);

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
        }}
      />

      <DiacriticHoverHandles
        isSelected={isSelected}
        placements={diacriticPlacements}
        diacriticOverrides={diacriticOverrides}
        fontSize={fontSize}
        onDragDiacriticOverride={onDragDiacriticOverride}
        onToggleDiacriticHidden={onToggleDiacriticHidden}
      />
    </Group>
  );
};

export default ShapeWarpText;