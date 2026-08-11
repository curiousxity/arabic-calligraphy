import React, { useEffect, useMemo, useRef, useState } from "react";
import { Group, Shape, Rect, Arc, Circle, Path, Line } from "react-konva";
import type Konva from "konva";
import type { PathCommand } from "opentype.js";
import type { HarfBuzzGlyph, ShapedTextResult } from "../lib/harfbuzz";
import { warpPoint, type GlyphBounds } from "../lib/warp";
import { useShapedGlyphs } from "../hooks/useShapedGlyphs";
import { useOverrideGlyph } from "../hooks/useOverrideGlyph";
import {
  applyGlyphEdit,
  prepareGlyphRig,
  applyPreparedGlyphRig,
  MASK_CONTOUR_ON_COLOR,
  MASK_CONTOUR_OFF_COLOR,
  MASK_LASSO_COLOR,
} from "../lib/glyphEdits";
import { useGlyphSchemaCatalog } from "../lib/strokeSchema/glyphLookup";
import type { StretchDefinition } from "../lib/strokeSchema/deriveCatalog";
import { splitContours, deriveContourMask } from "../lib/glyphContours";
import { findDiacriticGlyphIndices } from "../lib/diacritics";
import type {
  GlyphEdit,
  GlyphStretchHandle,
  GlyphRig,
  GlyphRigValue,
  GlyphStretchMask,
  DiacriticOverride,
} from "../types";
import {
  isOverrideGlyphChar,
  OVERRIDE_SCALE,
  OVERRIDE_RAISE,
  type OverrideGlyph,
} from "../lib/glyphOverrides";
import { DiacriticHoverHandles } from "./DiacriticHoverHandles";
import { StrokeStretchHoverHandles } from "./StrokeStretchHoverHandles";

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
  kashidaEditMode?: boolean;
  onKashidaTextChange?: (text: string) => void;
  selectedGlyphIndex?: number | null;
  glyphEdits?: GlyphEdit[];
  glyphMaskEdit?: { handleId: string; mode: "contours" | "lasso" } | null;
  glyphRigs?: GlyphRig[];
  glyphRigValues?: GlyphRigValue[];
  diacriticOverrides?: DiacriticOverride[];
  isSelected?: boolean;
  onDragDiacriticOverride?: (glyphIndex: number, patch: Partial<DiacriticOverride>) => void;
  onToggleDiacriticHidden?: (glyphIndex: number) => void;
  onGlyphBoxesChange?: (boxes: GlyphHitBox[]) => void;
  onGlyphSchemaChange?: (catalog: Record<number, StretchDefinition[]>) => void;
  onUpdateStretchHandle?: (
    glyphIndex: number,
    handleId: string,
    patch: Partial<GlyphStretchHandle>
  ) => void;
  onSetStretchFactor?: (
    glyphIndex: number,
    definition: StretchDefinition,
    factor: number
  ) => void;
  onDeleteStretchHandle?: (glyphIndex: number, handleId: string) => void;
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

export type GlyphHitBox = {
  glyphIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  glyphId: number;
  gx: number;
  gy: number;
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

/** Renders path commands (offset by dx/dy) as an SVG path `d` string, for Konva's <Path>. */
function commandsToSvgPath(commands: PathCommand[], dx: number, dy: number): string {
  const parts: string[] = [];
  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        parts.push(`M${cmd.x + dx},${cmd.y + dy}`);
        break;
      case "L":
        parts.push(`L${cmd.x + dx},${cmd.y + dy}`);
        break;
      case "C":
        parts.push(
          `C${cmd.x1 + dx},${cmd.y1 + dy} ${cmd.x2 + dx},${cmd.y2 + dy} ${cmd.x + dx},${cmd.y + dy}`
        );
        break;
      case "Q":
        parts.push(`Q${cmd.x1 + dx},${cmd.y1 + dy} ${cmd.x + dx},${cmd.y + dy}`);
        break;
      case "Z":
        parts.push("Z");
        break;
    }
  }
  return parts.join(" ");
}

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
  glyphEdits: GlyphEdit[] = [],
  fontFamily = "",
  glyphRigs: GlyphRig[] = [],
  glyphRigValues: GlyphRigValue[] = [],
  diacriticOverrides: DiacriticOverride[] = []
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

    const diacriticOverride = diacriticOverrides.find((o) => o.glyphIndex === glyphIndex);
    if (diacriticOverride?.hidden) {
      penX += advance;
      continue;
    }

    const gx = (penX + (g.dx ?? 0)) * scale;
    const gy = -(g.dy ?? 0) * scale;
    const edit = glyphEdits.find((w) => w.glyphIndex === glyphIndex);
    const preparedRig = prepareGlyphRig(fontFamily, g.g, fontSize, glyphRigs, glyphRigValues, gx, gy);

    ctx.save();
    ctx.translate(gx, gy);

    if (diacriticOverride) {
      ctx.translate(0, diacriticOverride.offsetY ?? 0);
      const diacScale = diacriticOverride.scale ?? 1;
      ctx.scale(diacScale, diacScale);
    }

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
      let contourIndex = -1;
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

        if (c.type === "M") contourIndex++;

        if (typeof c.x === "number" && typeof c.y === "number") {
          const handled = applyGlyphEdit(c.x + gx, c.y + gy, edit, contourIndex);
          const rigged = applyPreparedGlyphRig(handled.x, handled.y, preparedRig, contourIndex);
          const p = warpPoint(
            rigged.x,
            rigged.y,
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
          const handled1 = applyGlyphEdit(c.x1 + gx, c.y1 + gy, edit, contourIndex);
          const rigged1 = applyPreparedGlyphRig(handled1.x, handled1.y, preparedRig, contourIndex);
          const p1 = warpPoint(
            rigged1.x,
            rigged1.y,
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
          const handled2 = applyGlyphEdit(c.x2 + gx, c.y2 + gy, edit, contourIndex);
          const rigged2 = applyPreparedGlyphRig(handled2.x, handled2.y, preparedRig, contourIndex);
          const p2 = warpPoint(
            rigged2.x,
            rigged2.y,
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
  rotation = 0,
  warpX = 0,
  warpY = 0,
  kashidaEditMode = false,
  onKashidaTextChange,
  selectedGlyphIndex = null,
  glyphEdits = [],
  glyphMaskEdit = null,
  glyphRigs = [],
  glyphRigValues = [],
  diacriticOverrides = [],
  isSelected = false,
  onDragDiacriticOverride,
  onToggleDiacriticHidden,
  onGlyphBoxesChange,
  onGlyphSchemaChange,
  onUpdateStretchHandle,
  onSetStretchFactor,
  onDeleteStretchHandle,
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
  const glyphSchemaCatalog = useGlyphSchemaCatalog(
    shapeData.shapableText,
    shapeData.glyphs,
    shapeData.font
  );

  // The set of glyph indices this render pass actually considers a
  // diacritic — used to guard `diacriticOverrides` at draw time so a
  // stale override (e.g. after a text edit shifted which glyph index it
  // lands on) degrades to a no-op instead of hiding/scaling a base
  // letter.
  const diacriticGlyphIndices = useMemo(
    () => findDiacriticGlyphIndices(shapeData.glyphs, shapeData.font),
    [shapeData.glyphs, shapeData.font]
  );

  const activeDiacriticOverrides = useMemo(
    () => diacriticOverrides.filter((o) => diacriticGlyphIndices.has(o.glyphIndex)),
    [diacriticOverrides, diacriticGlyphIndices]
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

  // Computes glyph bounding-box extents (glyphBounds) and per-glyph hit boxes
  // (glyphHitBoxes) in one pass over the glyph run — both need the same
  // (expensive) glyphObj.getPath(...).getBoundingBox() call per glyph, so
  // walking the font twice to get each independently would do that work twice.
  const glyphMetrics = useMemo<{ bounds: GlyphBounds; hitBoxes: GlyphHitBox[] }>(() => {
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
      return { bounds: fallbackBounds(), hitBoxes: [] };
    }

    const upm = Math.max(unitsPerEm || 1000, 1);
    const scale = fontSize / upm;

    let penX = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const hitBoxes: GlyphHitBox[] = [];

    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
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

        if (isFinite(box.x1) && isFinite(box.x2) && isFinite(box.y1) && isFinite(box.y2)) {
          hitBoxes.push({
            glyphIndex: i,
            x: box.x1,
            y: box.y1,
            width: Math.max(box.x2 - box.x1, 1),
            height: Math.max(box.y2 - box.y1, 1),
            glyphId: g.g,
            gx,
            gy,
          });
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
      return { bounds: fallbackBounds(), hitBoxes };
    }

    return {
      bounds: {
        minX,
        minY,
        maxX,
        maxY,
        rawWidth: Math.max(maxX - minX, 1),
        rawHeight: Math.max(maxY - minY, 1),
      },
      hitBoxes,
    };
  }, [shapeData, text, fontSize]);

  const glyphBounds = glyphMetrics.bounds;
  const glyphHitBoxes = glyphMetrics.hitBoxes;

  const isBold = fontStyle === "bold" || fontStyle === "bold italic";
  const isItalic = fontStyle === "italic" || fontStyle === "bold italic";
  const fauxBoldWidth = isBold ? Math.max(fontSize * 0.035, 0.6) : 0;

  const bw = Math.max(glyphBounds.rawWidth, 20);
  const bh = Math.max(fontSize * lineHeight, glyphBounds.rawHeight, 24);
  const bx = align === "left" ? 0 : align === "right" ? -bw : -bw / 2;
  const by = -bh / 2;
  const localDrawX = -glyphBounds.minX + (bw - glyphBounds.rawWidth) / 2;
  const localDrawY = -glyphBounds.minY + (bh - glyphBounds.rawHeight) / 2;

  useEffect(() => {
    onGlyphBoxesChange?.(glyphHitBoxes);
  }, [glyphHitBoxes, onGlyphBoxesChange]);

  useEffect(() => {
    onGlyphSchemaChange?.(glyphSchemaCatalog);
  }, [glyphSchemaCatalog, onGlyphSchemaChange]);

  /** The selected glyph's outline split into contours, in the same text-space coords as stretch anchor/drag points — used by the "by stroke" mask-editing overlay. */
  const selectedGlyphContours = useMemo(() => {
    if (selectedGlyphIndex == null) return [];
    const { font, glyphs } = shapeData;
    const g = font ? glyphs[selectedGlyphIndex] : undefined;
    const glyphObj = g ? font!.glyphs.get(g.g) : undefined;
    if (!glyphObj) return [];

    const box = glyphHitBoxes.find((b) => b.glyphIndex === selectedGlyphIndex);
    const gx = box?.gx ?? 0;
    const gy = box?.gy ?? 0;
    const commands = glyphObj.getPath(0, 0, fontSize).commands as PathCommand[];

    return splitContours(commands).map((cmds, contourIndex) => ({
      contourIndex,
      data: commandsToSvgPath(cmds, gx, gy),
    }));
  }, [shapeData, selectedGlyphIndex, glyphHitBoxes, fontSize]);

  const selectedEdit =
    selectedGlyphIndex != null
      ? glyphEdits.find((w) => w.glyphIndex === selectedGlyphIndex)
      : undefined;
  const selectedStretches = selectedEdit?.stretches ?? [];

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

      const box = glyphHitBoxes.find((b) => b.glyphIndex === edit.glyphIndex);
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
  }, [glyphEdits, shapeData, glyphHitBoxes, fontSize, onUpdateStretchHandle]);

  const activeMaskHandle =
    glyphMaskEdit != null
      ? selectedStretches.find((h) => h.id === glyphMaskEdit.handleId)
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
  const lassoActiveRef = useRef(false);
  const [lassoDrawPoints, setLassoDrawPoints] = useState<{ x: number; y: number }[]>([]);

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

  const toggleMaskContour = (contourIndex: number) => {
    if (!onUpdateStretchHandle || !activeMaskHandle || selectedGlyphIndex == null) return;
    const current: number[] =
      activeMaskHandle.mask?.mode === "contours" ? activeMaskHandle.mask.contourIndices : [];
    const next = current.includes(contourIndex)
      ? current.filter((i) => i !== contourIndex)
      : [...current, contourIndex];
    const mask: GlyphStretchMask = { mode: "contours", contourIndices: next };
    onUpdateStretchHandle(selectedGlyphIndex, activeMaskHandle.id, { mask, maskAuto: false });
  };

  const commitLasso = () => {
    if (
      !onUpdateStretchHandle ||
      !activeMaskHandle ||
      selectedGlyphIndex == null ||
      lassoDrawPoints.length < 3
    ) {
      setLassoDrawPoints([]);
      return;
    }
    const mask: GlyphStretchMask = {
      mode: "lasso",
      points: lassoDrawPoints.map((p) => ({ x: p.x - bx - localDrawX, y: p.y - by - localDrawY })),
    };
    onUpdateStretchHandle(selectedGlyphIndex, activeMaskHandle.id, { mask, maskAuto: false });
    setLassoDrawPoints([]);
  };

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
            fauxBoldWidth,
            overrideGlyph,
            glyphEdits,
            fontFamily,
            glyphRigs,
            glyphRigValues,
            activeDiacriticOverrides
          );
          ctx.restore();

          if (strokeWidth > 0) {
            ctx.save();
            ctx.translate(localDrawX, localDrawY);
            if (isItalic) ctx.transform(1, 0, -0.25, 1, 0, 0);
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
              glyphEdits,
              fontFamily,
              glyphRigs,
              glyphRigValues,
              activeDiacriticOverrides
            );
            ctx.restore();
          }
        }}
      />

      {/*
        Stroke-stretch overlay mounts BEFORE the diacritic overlay: Konva
        routes a pointer to the topmost listening shape, and this overlay's
        per-glyph hover rects are large (they cover a whole letter plus
        wherever its dots can rest), while a diacritic's hit rect is small
        and sits inside that same area. Mounted later, the stroke rects
        would paint on top and steal hover from every mark above a letter
        that has an authored schema.
      */}
      <StrokeStretchHoverHandles
        isSelected={isSelected}
        glyphSchemaCatalog={glyphSchemaCatalog}
        glyphEdits={glyphEdits}
        glyphHitBoxes={glyphHitBoxes}
        offsetX={bx + localDrawX}
        offsetY={by + localDrawY}
        onSetStretchFactor={onSetStretchFactor}
        onDeleteStretchHandle={onDeleteStretchHandle}
      />

      <DiacriticHoverHandles
        isSelected={isSelected}
        glyphs={shapeData.glyphs}
        font={shapeData.font}
        glyphHitBoxes={glyphHitBoxes}
        diacriticOverrides={diacriticOverrides}
        offsetX={bx + localDrawX}
        offsetY={by + localDrawY}
        fontSize={fontSize}
        onDragDiacriticOverride={onDragDiacriticOverride}
        onToggleDiacriticHidden={onToggleDiacriticHidden}
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

      {glyphMaskEdit?.mode === "contours" &&
        activeMaskHandle &&
        selectedGlyphContours.map((c) => {
          const included =
            activeMaskHandle.mask?.mode === "contours" &&
            activeMaskHandle.mask.contourIndices.includes(c.contourIndex);
          return (
            <Path
              key={c.contourIndex}
              x={bx + localDrawX}
              y={by + localDrawY}
              data={c.data}
              fill={included ? MASK_CONTOUR_ON_COLOR : MASK_CONTOUR_OFF_COLOR}
              opacity={included ? 0.45 : 0.25}
              stroke={included ? MASK_CONTOUR_ON_COLOR : MASK_CONTOUR_OFF_COLOR}
              strokeWidth={1}
              onClick={(e) => {
                e.cancelBubble = true;
                toggleMaskContour(c.contourIndex);
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                toggleMaskContour(c.contourIndex);
              }}
              onMouseDown={(e) => {
                e.cancelBubble = true;
              }}
            />
          );
        })}

      {glyphMaskEdit?.mode === "lasso" && activeMaskHandle && (
        <>
          <Rect
            x={bx}
            y={by}
            width={bw}
            height={bh}
            fill="transparent"
            listening
            onMouseDown={(e) => {
              e.cancelBubble = true;
              const group = e.currentTarget.getParent() as Konva.Group;
              const pos = group.getRelativePointerPosition();
              if (!pos) return;
              lassoActiveRef.current = true;
              setLassoDrawPoints([pos]);
            }}
            onMouseMove={(e) => {
              if (!lassoActiveRef.current) return;
              e.cancelBubble = true;
              const group = e.currentTarget.getParent() as Konva.Group;
              const pos = group.getRelativePointerPosition();
              if (!pos) return;
              setLassoDrawPoints((prev) => [...prev, pos]);
            }}
            onMouseUp={(e) => {
              if (!lassoActiveRef.current) return;
              e.cancelBubble = true;
              lassoActiveRef.current = false;
              commitLasso();
            }}
            onTouchStart={(e) => {
              e.cancelBubble = true;
              const group = e.currentTarget.getParent() as Konva.Group;
              const pos = group.getRelativePointerPosition();
              if (!pos) return;
              lassoActiveRef.current = true;
              setLassoDrawPoints([pos]);
            }}
            onTouchMove={(e) => {
              if (!lassoActiveRef.current) return;
              e.cancelBubble = true;
              const group = e.currentTarget.getParent() as Konva.Group;
              const pos = group.getRelativePointerPosition();
              if (!pos) return;
              setLassoDrawPoints((prev) => [...prev, pos]);
            }}
            onTouchEnd={(e) => {
              if (!lassoActiveRef.current) return;
              e.cancelBubble = true;
              lassoActiveRef.current = false;
              commitLasso();
            }}
            onClick={(e) => {
              e.cancelBubble = true;
            }}
          />
          {activeMaskHandle.mask?.mode === "lasso" && (
            <Line
              points={activeMaskHandle.mask.points.flatMap((p) => [
                bx + localDrawX + p.x,
                by + localDrawY + p.y,
              ])}
              closed
              fill="rgba(34, 197, 94, 0.2)"
              stroke={MASK_LASSO_COLOR}
              strokeWidth={2}
              listening={false}
            />
          )}
          {lassoDrawPoints.length > 1 && (
            <Line
              points={lassoDrawPoints.flatMap((p) => [p.x, p.y])}
              closed
              fill="rgba(34, 197, 94, 0.15)"
              stroke={MASK_LASSO_COLOR}
              strokeWidth={2}
              dash={[6, 4]}
              listening={false}
            />
          )}
        </>
      )}

    </Group>
  );
};

export default ShapedText;