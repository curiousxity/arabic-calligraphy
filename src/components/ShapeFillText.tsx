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
 *  - shapeScale, stroke all preserved.
 */

import React, { useMemo } from "react";
import { Group, Shape, Rect, Circle } from "react-konva";
import type Konva from "konva";
import {
  parseSvgPath,
  pathToPolygon,
  pointInPolygon,
  replayPath,
  type SvgCmd,
} from "../lib/svgPath";
import { useShapedGlyphs } from "../hooks/useShapedGlyphs";
import { findDiacriticGlyphIndices } from "../lib/diacritics";
import { DiacriticHoverHandles } from "./DiacriticHoverHandles";
import {
  makeShapeFillInstanceAdapter,
  type DiacriticPlacement,
} from "../lib/diacriticPlacement";
import type { DiacriticOverride } from "../types";

export type ShapeFillTextProps = {
  id?: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
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
  diacriticEditMode?: boolean;
  diacriticOverrides?: DiacriticOverride[];
  onDragDiacriticOverride?: (glyphIndex: number, patch: Partial<DiacriticOverride>) => void;
  onToggleDiacriticHidden?: (glyphIndex: number) => void;
  locked?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  isSelected?: boolean;
  onResizeScale?: (newScale: number) => void;
};

type GlyphInstance = {
  glyphIndex: number;
  gx: number;
  gy: number;
  scX: number;
  scY: number;
};

type ShapeFillLine = {
  lineY: number;
  scX: number;
  scY: number;
  /** Starting pen-x for each tiled repetition on this line. */
  repStartXs: number[];
};

/**
 * Scanline-tiles the glyph run across the shape's silhouette: for each row,
 * finds the shape's left/right edges via ray-casting samples, then works out
 * how many repetitions of the glyph run fit and the x-scale that makes them
 * span the row exactly. Shared by the actual drawing pass and by the
 * diacritic overlay's instance layout, which both need the exact same
 * per-line layout — computing it twice risked the two silently drifting out
 * of sync.
 */
function computeShapeFillLines(params: {
  fontSize: number;
  shapeFillSpacing: number;
  shapeWidth: number;
  shapeHeight: number;
  shapeFillScaleX: number;
  shapeFillScaleY: number;
  totalAdvance: number;
  inShape: (x: number, y: number) => boolean;
}): ShapeFillLine[] {
  const {
    fontSize,
    shapeFillSpacing,
    shapeWidth,
    shapeHeight,
    shapeFillScaleX,
    shapeFillScaleY,
    totalAdvance,
    inShape,
  } = params;

  const lineH = fontSize * shapeFillSpacing;
  const sampleStep = Math.max(2, Math.round(fontSize / 8));
  let lineY = fontSize * 0.85;
  const lines: ShapeFillLine[] = [];

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

      const repStartXs: number[] = [];
      for (let r = 0; r < reps; r++) {
        repStartXs.push(lx + r * effectiveAdvance * fitScaleX);
      }

      lines.push({ lineY, scX, scY, repStartXs });
    }

    lineY += lineH;
  }

  return lines;
}

export const ShapeFillText: React.FC<ShapeFillTextProps> = ({
  id,
  text,
  x, y,
  fontSize,
  color,
  fontFamily,
  fontStyle = "normal",
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
  diacriticEditMode = false,
  diacriticOverrides = [],
  onDragDiacriticOverride,
  onToggleDiacriticHidden,
  locked,
  draggable = true,
  onClick, onTap, onDblClick, onDragMove, onDragEnd,
  isSelected = false,
  onResizeScale,
}) => {
  const shapeData = useShapedGlyphs(text, fontFamily);

  // Parse SVG path once
  const parsedCmds = useMemo(() => parseSvgPath(shapeSvgPath || ""), [shapeSvgPath]);

  // Build polygon for hit-testing once
  const polygon = useMemo(() => pathToPolygon(parsedCmds, 12), [parsedCmds]);

  // Pre-compute glyph path commands + advances
  const glyphCache = useMemo(() => {
    const { glyphs, font, unitsPerEm } = shapeData;
    if (!font) return [];
    const scale = fontSize / unitsPerEm;
    let penX = 0;
    return glyphs.map((g) => {
      const obj = font.glyphs.get(g.g);
      const dx = (g.dx ?? 0) * scale;
      const dy = (g.dy ?? 0) * scale;
      const advance = (g.ax ?? 0) * scale;
      const commands: SvgCmd[] = obj ? obj.getPath(0, 0, fontSize).commands : [];
      const result = { obj, penX, dx, dy, advance, commands, glyphId: g.g };
      penX += advance;
      return result;
    });
  }, [shapeData, fontSize]);

  const totalAdvance = glyphCache.reduce((s, g) => s + g.advance, 0);

  const isBold = fontStyle === "bold" || fontStyle === "bold italic";
  const isItalic = fontStyle === "italic" || fontStyle === "bold italic";
  const fauxBoldWidth = isBold ? Math.max(fontSize * 0.035, 0.6) : 0;

  const scaledW = shapeWidth * shapeScale;
  const scaledH = shapeHeight * shapeScale;

  // Per-glyph outline bounds, in glyph-local space.
  const glyphLocalBoxes = useMemo(() => {
    const boxes: {
      glyphIndex: number;
      x: number;
      y: number;
      width: number;
      height: number;
      glyphId: number;
    }[] = [];
    for (let i = 0; i < glyphCache.length; i++) {
      const g = glyphCache[i];
      if (!g.obj) continue;
      const box = g.obj.getPath(0, 0, fontSize).getBoundingBox();
      if (isFinite(box.x1) && isFinite(box.x2) && isFinite(box.y1) && isFinite(box.y2)) {
        boxes.push({
          glyphIndex: i,
          x: box.x1,
          y: box.y1,
          width: Math.max(box.x2 - box.x1, 1),
          height: Math.max(box.y2 - box.y1, 1),
          glyphId: g.glyphId,
        });
      }
    }
    return boxes;
  }, [glyphCache, fontSize]);

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

  // Mirrors the sceneFunc's own scanline-tiling loop in plain JS (no canvas
  // needed — `pointInPolygon` is pure) so the diacritic overlay can know
  // where every tiled repetition actually lands. Only computed while that
  // tool is armed (it's a real amount of work).
  const glyphInstances = useMemo<GlyphInstance[]>(() => {
    if (!diacriticEditMode) return [];
    if (!shapeSvgPath || parsedCmds.length === 0) return [];
    if (!shapeData.font || glyphCache.length === 0 || totalAdvance <= 0) return [];

    const inShape = (px: number, py: number) => pointInPolygon(px, py, polygon);
    const lines = computeShapeFillLines({
      fontSize,
      shapeFillSpacing,
      shapeWidth,
      shapeHeight,
      shapeFillScaleX,
      shapeFillScaleY,
      totalAdvance,
      inShape,
    });
    const instances: GlyphInstance[] = [];

    for (const line of lines) {
      for (const startPenX of line.repStartXs) {
        for (let gi = 0; gi < glyphCache.length; gi++) {
          const g = glyphCache[gi];
          if (!g.obj || g.commands.length === 0) continue;
          instances.push({
            glyphIndex: gi,
            gx: startPenX + g.penX * line.scX + g.dx * line.scX,
            gy: line.lineY + g.dy * line.scY,
            scX: line.scX,
            scY: line.scY,
          });
        }
      }
    }

    return instances;
  }, [
    diacriticEditMode,
    shapeSvgPath,
    parsedCmds,
    shapeData.font,
    glyphCache,
    totalAdvance,
    fontSize,
    shapeFillSpacing,
    shapeWidth,
    shapeHeight,
    shapeFillScaleX,
    shapeFillScaleY,
    polygon,
  ]);

  // One placement per tiled repetition of each diacritic. They all edit the
  // same single override, keyed by glyph index — one adjustment therefore
  // applies to every repetition of that mark.
  const diacriticPlacements = useMemo<DiacriticPlacement[]>(() => {
    if (!diacriticEditMode) return [];

    const boxByIndex = new Map(glyphLocalBoxes.map((b) => [b.glyphIndex, b]));

    return glyphInstances.flatMap((inst, i) => {
      if (!diacriticGlyphIndices.has(inst.glyphIndex)) return [];
      const box = boxByIndex.get(inst.glyphIndex);
      if (!box) return [];

      return [
        {
          glyphIndex: inst.glyphIndex,
          // Unique per tiled repetition, so React can tell the instances of
          // one mark apart.
          key: `${i}:${inst.glyphIndex}`,
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          ...makeShapeFillInstanceAdapter({
            gx: inst.gx,
            gy: inst.gy,
            rotationDeg: shapeFillTextRotation,
            scX: inst.scX,
            scY: inst.scY,
            shapeScale,
          }),
        },
      ];
    });
  }, [
    diacriticEditMode,
    glyphInstances,
    glyphLocalBoxes,
    diacriticGlyphIndices,
    shapeFillTextRotation,
    shapeScale,
  ]);

  return (
    <Group
      id={id}
      x={x} y={y}
      rotation={rotation}
      opacity={opacity}
      draggable={draggable && !locked}
      dragBoundFunc={diacriticEditMode ? () => ({ x, y }) : undefined}
      onClick={onClick}
      onTap={onTap}
      onDblClick={onDblClick}
      onDblTap={onDblClick}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      listening
    >
      <Rect x={0} y={0} width={scaledW} height={scaledH} fill="transparent" strokeEnabled={false} listening />

      <Shape
        listening={false}
        shadowColor={shadowBlur > 0 ? shadowColor : undefined}
        shadowBlur={shadowBlur}
        shadowOffsetX={shadowOffsetX}
        shadowOffsetY={shadowOffsetY}
        shadowOpacity={shadowOpacity}
        sceneFunc={(ctx) => {
          if (!shapeSvgPath || parsedCmds.length === 0) return;

          const rotRad = (shapeFillTextRotation * Math.PI) / 180;

          // If no text data yet, draw a semi-transparent placeholder fill
          // (there's nothing shaped yet to draw).
          if (!shapeData.font || glyphCache.length === 0 || totalAdvance <= 0) {
            ctx.save();
            ctx.scale(shapeScale, shapeScale);
            replayPath(ctx as unknown as CanvasRenderingContext2D, parsedCmds);
            ctx.fillStyle = color + "33"; // 20% opacity hint
            ctx.fill();
            ctx.restore();
            return;
          }

          // Draws the whole shape-filled glyph run once, in `fillColor`, offset
          // by (offsetX, offsetY).
          const drawPass = (
            targetCtx: CanvasRenderingContext2D,
            fillColor: string,
            offsetX: number,
            offsetY: number,
            includeExtras: boolean
          ) => {
            targetCtx.save();
            targetCtx.translate(offsetX, offsetY);
            targetCtx.scale(shapeScale, shapeScale);

            // Clip to shape using replayed path commands (Konva-safe, no Path2D)
            replayPath(targetCtx, parsedCmds);
            targetCtx.clip();

            targetCtx.fillStyle = fillColor;

            const drawGlyphRow = (startPenX: number, sy: number, scX: number, scY: number) => {
              for (let gi = 0; gi < glyphCache.length; gi++) {
                const g = glyphCache[gi];
                if (!g.obj || g.commands.length === 0) continue;
                // No penX accumulator to advance here — glyphCache precomputes
                // each glyph's penX, so skipping the draw already leaves the
                // surrounding letters untouched.
                const diacriticOverride = activeDiacriticOverrides.find(
                  (o) => o.glyphIndex === gi
                );
                if (diacriticOverride?.hidden) continue;
                const gx = startPenX + g.penX * scX + g.dx * scX;
                const gy = sy + g.dy * scY;
                const commands = g.commands;

                targetCtx.save();
                targetCtx.translate(gx, gy);
                if (shapeFillTextRotation !== 0) targetCtx.rotate(rotRad);
                targetCtx.scale(scX, scY);
                if (diacriticOverride) {
                  // Applied inside the row's own scale so an adjusted mark
                  // keeps being scaled with its row, and pivoted on the
                  // glyph's pen origin — the same meaning offsetY has on
                  // plain text.
                  targetCtx.translate(0, diacriticOverride.offsetY ?? 0);
                  const ds = diacriticOverride.scale ?? 1;
                  targetCtx.scale(ds, ds);
                }
                if (isItalic) targetCtx.transform(1, 0, -0.25, 1, 0, 0);
                replayPath(targetCtx, commands);
                // Outline before fill — see the same ordering in
                // ShapedText.tsx: a centred stroke drawn after the fill lays
                // half its width back over the letter and thickens it.
                if (includeExtras && strokeWidth > 0) {
                  targetCtx.strokeStyle = stroke;
                  targetCtx.lineWidth = strokeWidth / scX;
                  targetCtx.stroke();
                }
                targetCtx.fill();
                if (includeExtras && fauxBoldWidth > 0) {
                  targetCtx.strokeStyle = fillColor;
                  targetCtx.lineWidth = fauxBoldWidth / scX;
                  targetCtx.stroke();
                }
                targetCtx.restore();
              }
            };

            // Scanline fill — use ray-casting polygon test (no Path2D / isPointInPath)
            // The polygon is in original (pre-scale) path coordinates, matching lineY
            const inShape = (px: number, py: number) => pointInPolygon(px, py, polygon);
            const lines = computeShapeFillLines({
              fontSize,
              shapeFillSpacing,
              shapeWidth,
              shapeHeight,
              shapeFillScaleX,
              shapeFillScaleY,
              totalAdvance,
              inShape,
            });

            for (const line of lines) {
              for (const startPenX of line.repStartXs) {
                drawGlyphRow(startPenX, line.lineY, line.scX, line.scY);
              }
            }

            targetCtx.restore();
          };

          drawPass(ctx as unknown as CanvasRenderingContext2D, color, 0, 0, true);
        }}
      />

      {/*
        Mounted before the corner resize Circle so that handle keeps winning
        Konva's topmost-listener contest at the shape's bottom-right corner.
      */}
      <DiacriticHoverHandles
        isSelected={isSelected && diacriticEditMode}
        placements={diacriticPlacements}
        diacriticOverrides={diacriticOverrides}
        fontSize={fontSize}
        onDragDiacriticOverride={onDragDiacriticOverride}
        onToggleDiacriticHidden={onToggleDiacriticHidden}
      />

      {isSelected && !locked && (
        <Circle
          x={scaledW}
          y={scaledH}
          radius={8}
          fill="#d4af37"
          stroke="#ffffff"
          strokeWidth={2}
          draggable
          onMouseDown={(e) => { e.cancelBubble = true; }}
          onTouchStart={(e) => { e.cancelBubble = true; }}
          onDragMove={(e) => {
            e.cancelBubble = true;
            const group = e.currentTarget.getParent() as Konva.Group;
            const pos = group.getRelativePointerPosition();
            if (!pos) return;
            const dist = Math.hypot(pos.x, pos.y);
            const baseDist = Math.hypot(shapeWidth, shapeHeight);
            const newScale = Math.max(0.2, Math.min(3, dist / Math.max(baseDist, 1)));
            onResizeScale?.(newScale);
          }}
          onDragEnd={(e) => { e.cancelBubble = true; }}
        />
      )}

    </Group>
  );
};

export default ShapeFillText;
