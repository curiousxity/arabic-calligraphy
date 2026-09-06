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

import React, { useMemo, useRef } from "react";
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
import { GlyphTransformHoverHandles } from "./GlyphTransformHoverHandles";
import {
  composeAdapters,
  makeGlyphTransformAdapter,
  makeShapeFillInstanceAdapter,
  type DiacriticPlacement,
  type GlyphTransformPlacement,
  type PlacementAdapter,
} from "../lib/diacriticPlacement";
import {
  filterActiveGlyphTransforms,
  glyphPivot,
  resolveGlyphTransform,
} from "../lib/glyphTransform";
import type { DiacriticOverride, GlyphTransform } from "../types";
import { createBlockFillPainter, type BlockFill } from "../lib/blockFill";

export type ShapeFillTextProps = {
  id?: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  /** Gradient ink. Absent renders the flat `color`, exactly as before. */
  fill?: BlockFill;
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
  /** Armed by Typography's "Move, scale & rotate glyph" checkbox. */
  glyphTransformMode?: boolean;
  glyphTransforms?: GlyphTransform[];
  onUpdateGlyphTransform?: (glyphIndex: number, patch: Partial<GlyphTransform>) => void;
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

/**
 * Stable empty default for `glyphTransforms`, so a block carrying none does
 * not hand the memos below a fresh array identity on every render — the same
 * reason `CanvasStage` keeps its own `NO_GLYPH_TRANSFORMS`.
 */
const NO_GLYPH_TRANSFORMS: GlyphTransform[] = [];
const NO_DIACRITIC_OVERRIDES: DiacriticOverride[] = [];

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
  fill,
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
  diacriticOverrides = NO_DIACRITIC_OVERRIDES,
  onDragDiacriticOverride,
  onToggleDiacriticHidden,
  glyphTransformMode = false,
  glyphTransforms = NO_GLYPH_TRANSFORMS,
  onUpdateGlyphTransform,
  locked,
  draggable = true,
  onClick, onTap, onDblClick, onDragMove, onDragEnd,
  isSelected = false,
  onResizeScale,
}) => {
  const shapeData = useShapedGlyphs(text, fontFamily);

  const groupRef = useRef<Konva.Group>(null);
  /** The block's absolute position at drag start, while a per-glyph tool pins it. */
  const dragPinRef = useRef<{ x: number; y: number } | null>(null);
  const pinDrag = diacriticEditMode || glyphTransformMode;

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

  const glyphBoxByIndex = useMemo(
    () => new Map(glyphLocalBoxes.map((b) => [b.glyphIndex, b])),
    [glyphLocalBoxes]
  );

  // The same `glyphId` staleness rule ShapedText applies, through the same
  // pure helper — extracting it is what makes the rule exist on this renderer
  // at all rather than only on the one it was written for.
  const activeGlyphTransforms = useMemo(
    () => filterActiveGlyphTransforms(glyphTransforms, shapeData.glyphs),
    [glyphTransforms, shapeData.glyphs]
  );

  // Recomputed per render for this component's own current glyph run, so a
  // stale override whose glyph index now lands on a base letter (text edits
  // shift indices) is ignored rather than hiding or ballooning that letter —
  // the same guard ShapedText.tsx already applies.
  const diacriticGlyphIndices = useMemo(
    () =>
      findDiacriticGlyphIndices(
        shapeData.glyphs,
        shapeData.font,
        shapeData.shapableText
      ),
    [shapeData.glyphs, shapeData.font, shapeData.shapableText]
  );

  const activeDiacriticOverrides = useMemo(
    () => diacriticOverrides.filter((o) => diacriticGlyphIndices.has(o.glyphIndex)),
    [diacriticOverrides, diacriticGlyphIndices]
  );

  // Both lists indexed for the draw loop, which runs once per glyph per
  // repetition per line — the worst case in this file's own comments is
  // ~23,000 instances. A linear `.find` over each list per instance, plus a
  // fresh `resolveGlyphTransform` object per transformed glyph, is work
  // proportional to tiles where it should be proportional to glyphs; the
  // transform is resolved once here instead of per tile.
  const transformByIndex = useMemo(
    () =>
      new Map(
        activeGlyphTransforms.map((t) => [t.glyphIndex, resolveGlyphTransform(t)])
      ),
    [activeGlyphTransforms]
  );
  const diacriticByIndex = useMemo(
    () => new Map(activeDiacriticOverrides.map((o) => [o.glyphIndex, o])),
    [activeDiacriticOverrides]
  );

  // Mirrors the sceneFunc's own scanline-tiling loop in plain JS (no canvas
  // needed — `pointInPolygon` is pure) so the diacritic overlay can know
  // where every tiled repetition actually lands. Only computed while that
  // tool is armed (it's a real amount of work).
  const glyphInstances = useMemo<GlyphInstance[]>(() => {
    if (!diacriticEditMode && !glyphTransformMode) return [];
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
    glyphTransformMode,
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

  /**
   * The row frame: the space the draw loop is in after
   * `translate(gx, gy) -> rotate(rotRad)` but *before* the row's own fit
   * scale. The glyph transform is applied there (see the draw loop), so it is
   * the space the move/scale/rotate placements live in — and it is a
   * similarity (a rotation plus the uniform `shapeScale`), which is why the
   * overlay's bearings and rails need no special handling on this renderer.
   *
   * Expressed as `makeShapeFillInstanceAdapter` with unit row scales rather
   * than as a fourth builder, so the two Shape Fill spaces stay visibly the
   * same mapping with one stage removed.
   */
  const rowFrameAdapter = useMemo(
    () => (inst: GlyphInstance) =>
      makeShapeFillInstanceAdapter({
        gx: inst.gx,
        gy: inst.gy,
        rotationDeg: shapeFillTextRotation,
        scX: 1,
        scY: 1,
        shapeScale,
      }),
    [shapeFillTextRotation, shapeScale]
  );

  /**
   * One placement per glyph index, **not** per tiled repetition.
   *
   * The cap is the whole reason this feature is affordable here. Worked from
   * the real loop: a 3000-tall silhouette at `fontSize` 20 gives ~115 rows,
   * and a 2000-wide row with a four-glyph run gives ~50 repetitions — about
   * 23,000 listening Konva rects, which is a frozen tab rather than a slow
   * one. Capping costs nothing semantically: a transform is keyed by glyph
   * index, so **one adjustment already applies to every repetition of that
   * letter**, exactly as `diacriticEditMode` has always worked. The handle is
   * attached to the instance nearest the silhouette's centre, which is the
   * one most likely to be the one being looked at.
   */
  const glyphTransformPlacements = useMemo<GlyphTransformPlacement[]>(() => {
    if (!glyphTransformMode) return [];

    const cxShape = shapeWidth / 2;
    const cyShape = shapeHeight / 2;
    const best = new Map<number, { inst: GlyphInstance; d2: number }>();
    for (const inst of glyphInstances) {
      const dx = inst.gx - cxShape;
      const dy = inst.gy - cyShape;
      const d2 = dx * dx + dy * dy;
      const held = best.get(inst.glyphIndex);
      if (!held || d2 < held.d2) best.set(inst.glyphIndex, { inst, d2 });
    }

    return [...best.entries()]
      // Sorted so the mounted set has a stable order however the scanline
      // happened to walk the silhouette.
      .sort((a, b) => a[0] - b[0])
      .flatMap(([glyphIndex, { inst }]) => {
        const raw = glyphBoxByIndex.get(glyphIndex);
        if (!raw) return [];

        // The box in the row frame: the raw outline box carried through the
        // row's own fit scale, which is the one stage sitting *inside* the
        // glyph transform. Pre-folding the *row* scale is safe — it is
        // layout, fixed for the gesture — where pre-folding the transform
        // would not be.
        const x1 = raw.x * inst.scX;
        const x2 = (raw.x + raw.width) * inst.scX;
        const y1 = raw.y * inst.scY;
        const y2 = (raw.y + raw.height) * inst.scY;

        return [
          {
            glyphIndex,
            key: `glyph:${glyphIndex}`,
            glyphId: raw.glyphId,
            box: {
              x: Math.min(x1, x2),
              y: Math.min(y1, y2),
              width: Math.max(Math.abs(x2 - x1), 1),
              height: Math.max(Math.abs(y2 - y1), 1),
            },
            // The pen origin *is* the row frame's origin: the draw loop has
            // already translated to it, and the glyph path is drawn from
            // (0, 0) in that frame.
            gx: 0,
            gy: 0,
            unitScaleX: Math.abs(inst.scX * shapeScale),
            unitScaleY: Math.abs(inst.scY * shapeScale),
            ...rowFrameAdapter(inst),
          },
        ];
      });
  }, [
    glyphTransformMode,
    glyphInstances,
    glyphBoxByIndex,
    shapeWidth,
    shapeHeight,
    shapeScale,
    rowFrameAdapter,
  ]);

  /**
   * Every tiled repetition that is a diacritic, split out from the placements
   * below so the (potentially very large) walk over `glyphInstances` does not
   * re-run when a glyph transform changes — only the far shorter map over the
   * marks does. That split is what keeps composing the transform into a
   * mark's adapter affordable during a live drag.
   */
  const diacriticInstances = useMemo(
    () =>
      diacriticEditMode
        ? glyphInstances.flatMap((inst, i) =>
            diacriticGlyphIndices.has(inst.glyphIndex) ? [{ inst, i }] : []
          )
        : [],
    [diacriticEditMode, glyphInstances, diacriticGlyphIndices]
  );

  // One placement per tiled repetition of each diacritic. They all edit the
  // same single override, keyed by glyph index — one adjustment therefore
  // applies to every repetition of that mark.
  const diacriticPlacements = useMemo<DiacriticPlacement[]>(() => {
    return diacriticInstances.flatMap(({ inst, i }) => {
      const box = glyphBoxByIndex.get(inst.glyphIndex);
      if (!box) return [];

      // With no glyph transform this is exactly the two-stage mapping this
      // renderer has always used; the transform, when there is one, is the
      // stage the draw loop now inserts between the row frame and the row's
      // own fit scale, so a mark on a moved letter has to be carried through
      // all three to reach where it is actually drawn.
      const transform = activeGlyphTransforms.find(
        (t) => t.glyphIndex === inst.glyphIndex
      );
      let adapter: PlacementAdapter;
      if (transform) {
        const r = resolveGlyphTransform(transform);
        // The turn's pivot in the row frame, from the same `glyphPivot` both
        // renderers' draw loops use — the pen origin is (0, 0) here.
        const pivot = glyphPivot(box, 0, 0);
        adapter = composeAdapters(
          rowFrameAdapter(inst),
          composeAdapters(
            makeGlyphTransformAdapter({
              offsetX: 0,
              offsetY: 0,
              pivotX: 0,
              pivotY: 0,
              transformOffsetX: r.offsetX,
              transformOffsetY: r.offsetY,
              scaleX: r.scaleX,
              scaleY: r.scaleY,
              rotationDeg: r.rotation,
              // Carried through the row's fit scale, matching the draw loop.
              rotationPivotX: pivot.x * inst.scX,
              rotationPivotY: pivot.y * inst.scY,
            }),
            // The row's own fit scale, the stage the mark's override lives
            // inside.
            makeShapeFillInstanceAdapter({
              gx: 0,
              gy: 0,
              rotationDeg: 0,
              scX: inst.scX,
              scY: inst.scY,
              shapeScale: 1,
            })
          )
        );
      } else {
        adapter = makeShapeFillInstanceAdapter({
          gx: inst.gx,
          gy: inst.gy,
          rotationDeg: shapeFillTextRotation,
          scX: inst.scX,
          scY: inst.scY,
          shapeScale,
        });
      }

      return [
        {
          glyphIndex: inst.glyphIndex,
          // Unique per tiled repetition, so React can tell the instances of
          // one mark apart.
          key: `${i}:${inst.glyphIndex}`,
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          ...adapter,
        },
      ];
    });
  }, [
    diacriticInstances,
    glyphBoxByIndex,
    activeGlyphTransforms,
    rowFrameAdapter,
    shapeFillTextRotation,
    shapeScale,
  ]);

  return (
    <Group
      ref={groupRef}
      id={id}
      x={x} y={y}
      rotation={rotation}
      opacity={opacity}
      draggable={draggable && !locked}
      // While either per-glyph tool is armed the silhouette itself must not
      // move: the overlays' hit rects cover most of it, and a press that
      // slipped past one would drag the whole block out from under the
      // handles.
      //
      // Konva's `dragBoundFunc` contract is **absolute stage coordinates**.
      // This used to return the block's layer-space `{ x, y }` props, so at
      // the app's default 275% zoom (or under any pan, or inside a rotated
      // parent) pressing an armed silhouette teleported it to wherever those
      // layer coordinates happened to land on screen. Pinning to the node's
      // own pre-drag absolute position is the fix; it is captured at
      // `dragstart` and falls back to reading the node, which is still at its
      // pre-drag position the first time Konva asks.
      dragBoundFunc={
        pinDrag
          ? () =>
              dragPinRef.current ??
              groupRef.current?.getAbsolutePosition() ?? { x: 0, y: 0 }
          : undefined
      }
      onDragStart={(e) => {
        // Only the block's own drag — a handle Circle's dragstart bubbles
        // here too, and its position is not the block's.
        if (e.target === groupRef.current) {
          dragPinRef.current = e.target.getAbsolutePosition();
        }
      }}
      onClick={onClick}
      onTap={onTap}
      onDblClick={onDblClick}
      onDblTap={onDblClick}
      onDragMove={onDragMove}
      onDragEnd={(e) => {
        dragPinRef.current = null;
        onDragEnd?.(e);
      }}
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

            // Built here, in the silhouette's own (pre-tile) space, so one
            // gradient spans the whole shape. A per-glyph gradient would be
            // meaningless on this block type: the run is tiled across the
            // silhouette, so hundreds of instances would each get a full
            // sweep and the result would read as noise.
            const painter = createBlockFillPainter(targetCtx, fill, fillColor, {
              x: 0,
              y: 0,
              width: shapeWidth,
              height: shapeHeight,
            });
            targetCtx.fillStyle = painter.style;

            const drawGlyphRow = (startPenX: number, sy: number, scX: number, scY: number) => {
              for (let gi = 0; gi < glyphCache.length; gi++) {
                const g = glyphCache[gi];
                if (!g.obj || g.commands.length === 0) continue;
                // No penX accumulator to advance here — glyphCache precomputes
                // each glyph's penX, so skipping the draw already leaves the
                // surrounding letters untouched.
                const diacriticOverride = diacriticByIndex.get(gi);
                if (diacriticOverride?.hidden) continue;
                const gx = startPenX + g.penX * scX + g.dx * scX;
                const gy = sy + g.dy * scY;
                const commands = g.commands;

                targetCtx.save();
                targetCtx.translate(gx, gy);
                if (shapeFillTextRotation !== 0) targetCtx.rotate(rotRad);

                // The per-glyph transform goes here — outside the row's own
                // fit scale, inside the tile's rotation. Two things follow,
                // and the second is a choice rather than a consequence.
                //
                // Outside the diacritic override, which satisfies the
                // ordering ShapedText already fixes: the transform is the
                // outermost rigid transform of the finished glyph, so a mark
                // carrying both stays expressed in the glyph's own
                // pre-transform space and its adapter can still invert a
                // drag back to an unscaled `offsetY`.
                //
                // Outside `scale(scX, scY)` so a stored `offsetX` draws at a
                // uniform magnitude across the whole silhouette. `scX` is a
                // *per-line* fit factor, different on every row, so the same
                // offset placed inside it would move the letter by a
                // different amount on every repetition — which reads as a
                // bug rather than as one edit applied everywhere.
                let glyphMeanScale = 1;
                const glyphTransform = transformByIndex.get(gi);
                if (glyphTransform) {
                  const { offsetX, offsetY, scaleX, scaleY, rotation } =
                    glyphTransform;
                  targetCtx.translate(offsetX, offsetY);
                  targetCtx.scale(scaleX, scaleY);
                  glyphMeanScale = (scaleX + scaleY) / 2;
                  // Inside the glyph's own scale and about its raw box
                  // centre — carried through the row's fit scale, since that
                  // is what this frame's units are — matching ShapedText's
                  // ordering and, with it, `transformedBox`, so the overlay's
                  // frozen scale pivot never moves under a turn.
                  if (rotation !== 0) {
                    const raw = glyphBoxByIndex.get(gi);
                    if (raw) {
                      // Through the shared helper, not restated: `ShapedText`
                      // turns a glyph about exactly this point, and the two
                      // renderers must not drift on where a letter turns.
                      // The pen origin is (0, 0) in this frame.
                      const pivot = glyphPivot(raw, 0, 0);
                      const px = pivot.x * scX;
                      const py = pivot.y * scY;
                      targetCtx.translate(px, py);
                      targetCtx.rotate((rotation * Math.PI) / 180);
                      targetCtx.translate(-px, -py);
                    }
                  }
                }

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
                painter.fill(targetCtx);
                if (includeExtras && fauxBoldWidth > 0) {
                  // `local` keeps the existing per-row compensation; `block`
                  // is the same visible weight measured in the silhouette's
                  // space, where a gradient stroke is issued.
                  painter.strokeWithFill(targetCtx, {
                    local: fauxBoldWidth / scX,
                    // The glyph's mean scale joins the mark's own here for
                    // the same reason the mark's already does: `block` is the
                    // visible weight measured in the silhouette's space, and
                    // a scaled glyph draws its stroke that much heavier.
                    block:
                      fauxBoldWidth * (diacriticOverride?.scale ?? 1) * glyphMeanScale,
                  });
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
        Mounted BEFORE the diacritic overlay and both before the corner resize
        Circle. Konva routes a pointer to the topmost listening shape and
        later siblings sit on top, so the order is largest -> smallest: a
        glyph-sized rect, then a mark's smaller and more precise target, then
        the resize handle at the shape's bottom-right corner.
      */}
      <GlyphTransformHoverHandles
        isSelected={isSelected}
        enabled={glyphTransformMode}
        placements={glyphTransformPlacements}
        glyphTransforms={activeGlyphTransforms}
        onUpdateGlyphTransform={onUpdateGlyphTransform}
      />

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
