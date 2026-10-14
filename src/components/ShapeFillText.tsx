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
import {
  makeShapeFillInstanceAdapter,
  type DiacriticPlacement,
  type DetachedMarkPlacement,
} from "../lib/diacriticPlacement";
import type { DiacriticOverride, DetachedMarkOverride, GlyphAlternate } from "../types";
import {
  findDetachedMarks,
  buildDetachedMarkPlan,
  overrideGlyphKey,
  glyphIndicesFromKey,
  applyMarkPlanToGlyph,
  EMPTY_MARK_PLAN,
  type DetachedMark,
  type DetachedMarkPlan,
} from "../lib/detachedMarks";
import { toSvgCmds, outlineBounds } from "../lib/strokeCuts";
import { DetachedMarkHoverHandles } from "./DetachedMarkHoverHandles";
import { AlternateHoverHandles, type AlternateHitTarget } from "./AlternateHoverHandles";
import {
  letterAtOffset,
  type AlternateChoice,
  type LetterAlternates,
} from "../lib/glyphAlternates";
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
  /** Block-level OpenType style sets, e.g. ["ss01"]. */
  styleSets?: string[];
  onBeginDiacriticDrag?: () => void;
  onDragDiacriticOverride?: (glyphIndex: number, patch: Partial<DiacriticOverride>) => void;
  onToggleDiacriticHidden?: (glyphIndex: number) => void;
  detachedMarkOverrides?: DetachedMarkOverride[];
  /** Arms the "Move dots & marks" overlay. */
  detachedMarkEditMode?: boolean;
  onBeginDetachedMarkDrag?: () => void;
  onSetDetachedMark?: (o: DetachedMarkOverride) => void;
  /** Per-letter alternates — one pick applies to every tile of that letter. */
  glyphAlternates?: GlyphAlternate[];
  /** Arms the Next Shape overlay. */
  glyphAlternateMode?: boolean;
  /** The letters that have alternates — App passes them for the selected block only. */
  alternateLetters?: LetterAlternates[];
  onPickAlternate?: (letter: number, choice: AlternateChoice | null) => void;
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

const NO_DIACRITIC_OVERRIDES: DiacriticOverride[] = [];
const NO_MARK_OVERRIDES: DetachedMarkOverride[] = [];
const NO_GLYPH_ALTERNATES: GlyphAlternate[] = [];
const NO_ALTERNATE_LETTERS: LetterAlternates[] = [];
/** In local glyph units, before the row's fit scale — matches the text block's 3px at a 1:1 row. */
const ALTERNATE_TARGET_PAD = 3;

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
  styleSets,
  glyphAlternates = NO_GLYPH_ALTERNATES,
  glyphAlternateMode = false,
  alternateLetters = NO_ALTERNATE_LETTERS,
  onPickAlternate,
  onBeginDiacriticDrag,
  onDragDiacriticOverride,
  onToggleDiacriticHidden,
  detachedMarkOverrides = NO_MARK_OVERRIDES,
  detachedMarkEditMode = false,
  onBeginDetachedMarkDrag,
  onSetDetachedMark,
  locked,
  draggable = true,
  onClick, onTap, onDblClick, onDragMove, onDragEnd,
  isSelected = false,
  onResizeScale,
}) => {
  const shapeData = useShapedGlyphs(text, fontFamily, glyphAlternates, styleSets);

  const groupRef = useRef<Konva.Group>(null);
  /** The block's absolute position at drag start, while a per-glyph tool pins it. */
  const dragPinRef = useRef<{ x: number; y: number } | null>(null);
  const pinDrag = diacriticEditMode || detachedMarkEditMode;

  // Parse SVG path once
  const parsedCmds = useMemo(() => parseSvgPath(shapeSvgPath || ""), [shapeSvgPath]);

  // Build polygon for hit-testing once
  const polygon = useMemo(() => pathToPolygon(parsedCmds, 12), [parsedCmds]);

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

  // Detection walks every contour with point-in-polygon tests, so it runs
  // over the whole run only while the tool is armed; otherwise only over the
  // glyphs that carry an override. Declared above `glyphCache`, which reads
  // the plan: a `const` read before its declaration throws at runtime.
  // Keyed on *which* glyphs carry overrides, not on the overrides array:
  // a drag replaces that array every frame, and re-detecting per frame
  // (and on Shape Fill re-tiling the silhouette) made the handle lag.
  const overrideKey = useMemo(
    () => (detachedMarkEditMode ? null : overrideGlyphKey(detachedMarkOverrides, shapeData.glyphs)),
    [detachedMarkEditMode, detachedMarkOverrides, shapeData.glyphs]
  );
  const detectedMarks = useMemo(() => {
    const only = overrideKey === null ? undefined : glyphIndicesFromKey(overrideKey);
    if (only && only.size === 0) return new Map<number, DetachedMark[]>();
    return findDetachedMarks(
      shapeData.glyphs, shapeData.font, shapeData.unitsPerEm, diacriticGlyphIndices, fontFamily, only
    );
  }, [overrideKey, shapeData.glyphs, shapeData.font, shapeData.unitsPerEm, diacriticGlyphIndices, fontFamily]);

  const markPlan = useMemo<DetachedMarkPlan>(
    () => (detachedMarkOverrides.length ? buildDetachedMarkPlan(detachedMarkOverrides, shapeData.glyphs, detectedMarks) : EMPTY_MARK_PLAN),
    [detachedMarkOverrides, shapeData.glyphs, detectedMarks]
  );

  // Pre-compute glyph path commands + advances. Plan-free: this is what the
  // tiling reads, and a dot drag must not re-tile the silhouette per frame.
  const baseGlyphCache = useMemo(() => {
    const { glyphs, font, unitsPerEm } = shapeData;
    if (!font) return [];
    const scale = fontSize / unitsPerEm;
    let penX = 0;
    return glyphs.map((g) => {
      const obj = font.glyphs.get(g.g);
      const dx = (g.dx ?? 0) * scale;
      const dy = (g.dy ?? 0) * scale;
      const advance = (g.ax ?? 0) * scale;
      const commands: SvgCmd[] = obj ? toSvgCmds(obj.getPath(0, 0, fontSize).commands) : [];
      const result = { obj, penX, dx, dy, advance, commands, glyphId: g.g };
      penX += advance;
      return result;
    });
  }, [shapeData, fontSize]);

  // The same, with moved dots applied once per glyph (never per tile); a
  // whole-glyph mark's offset folds into dx/dy so every repetition carries
  // it. The draw loop and the hover boxes read this one.
  const glyphCache = useMemo(() => {
    if (markPlan === EMPTY_MARK_PLAN) return baseGlyphCache;
    const scale = fontSize / Math.max(shapeData.unitsPerEm || 1000, 1);
    return baseGlyphCache.map((g, i) => {
      const whole = markPlan.glyphs.get(i);
      const commands = applyMarkPlanToGlyph(g.commands, markPlan, i, scale);
      if (!whole && commands === g.commands) return g;
      return { ...g, dx: g.dx + (whole?.[0] ?? 0) * scale, dy: g.dy + (whole?.[1] ?? 0) * scale, commands };
    });
  }, [baseGlyphCache, markPlan, fontSize, shapeData.unitsPerEm]);

  const totalAdvance = baseGlyphCache.reduce((s, g) => s + g.advance, 0);

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
    }[] = [];
    for (let i = 0; i < glyphCache.length; i++) {
      const g = glyphCache[i];
      if (!g.obj) continue;
      // From the drawn commands, so a moved dot's box is where it is drawn.
      const box = outlineBounds(g.commands);
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
    return boxes;
  }, [glyphCache]);

  const glyphBoxByIndex = useMemo(
    () => new Map(glyphLocalBoxes.map((b) => [b.glyphIndex, b])),
    [glyphLocalBoxes]
  );

  const activeDiacriticOverrides = useMemo(
    () => diacriticOverrides.filter((o) => diacriticGlyphIndices.has(o.glyphIndex)),
    [diacriticOverrides, diacriticGlyphIndices]
  );

  // Indexed for the draw loop, which runs once per glyph per repetition per
  // line — the worst case in this file's own comments is ~23,000 instances,
  // so a linear `.find` per instance is work proportional to tiles where it
  // should be proportional to glyphs.
  const diacriticByIndex = useMemo(
    () => new Map(activeDiacriticOverrides.map((o) => [o.glyphIndex, o])),
    [activeDiacriticOverrides]
  );

  // Mirrors the sceneFunc's own scanline-tiling loop in plain JS (no canvas
  // needed — `pointInPolygon` is pure) so the diacritic overlay can know
  // where every tiled repetition actually lands. Only computed while the
  // diacritic tool or Next Shape is armed (it's a real amount of work).
  const glyphInstances = useMemo<GlyphInstance[]>(() => {
    const empty: GlyphInstance[] = [];
    if (!diacriticEditMode && !glyphAlternateMode && !detachedMarkEditMode) return empty;
    if (!shapeSvgPath || parsedCmds.length === 0) return empty;
    if (!shapeData.font || baseGlyphCache.length === 0 || totalAdvance <= 0) return empty;

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
        for (let gi = 0; gi < baseGlyphCache.length; gi++) {
          const g = baseGlyphCache[gi];
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
    glyphAlternateMode,
    detachedMarkEditMode,
    shapeSvgPath,
    parsedCmds,
    shapeData.font,
    baseGlyphCache,
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
   * Next Shape targets: every tiled repetition of every letter that has
   * alternates, as a quad in this group's space. The letter's local box goes
   * through the same instance adapter the diacritic handles trust, so the
   * tile's rotation, its row's fit scale and `shapeScale` are all honoured.
   * Thousands of these are fine: the overlay hit-tests them in arithmetic
   * behind one listening node.
   */
  const alternateTargets = useMemo<AlternateHitTarget[]>(() => {
    if (!glyphAlternateMode || alternateLetters.length === 0) return [];
    const byLetter = new Map(alternateLetters.map((l) => [l.letter, l]));
    const out: AlternateHitTarget[] = [];
    glyphInstances.forEach((inst, i) => {
      // A mark shares its base letter's cluster, so it would resolve to the
      // same letter — but as a tiny quad drawn after (so above) the base,
      // stealing the hover from the top of every vocalised letter. The text
      // and Curve builders already target the letter, not its marks.
      if (diacriticGlyphIndices.has(inst.glyphIndex)) return;
      const letter = letterAtOffset(shapeData.shapableText, shapeData.glyphs[inst.glyphIndex]?.cl ?? -1);
      const la = byLetter.get(letter);
      const box = glyphBoxByIndex.get(inst.glyphIndex);
      if (!la || !box) return;
      const adapter = makeShapeFillInstanceAdapter({
        gx: inst.gx,
        gy: inst.gy,
        rotationDeg: shapeFillTextRotation,
        scX: inst.scX,
        scY: inst.scY,
        shapeScale,
      });
      const pad = ALTERNATE_TARGET_PAD;
      out.push({
        key: `${i}:${inst.glyphIndex}`,
        letter,
        polygon: [
          adapter.toCanvas(box.x - pad, box.y - pad),
          adapter.toCanvas(box.x + box.width + pad, box.y - pad),
          adapter.toCanvas(box.x + box.width + pad, box.y + box.height + pad),
          adapter.toCanvas(box.x - pad, box.y + box.height + pad),
        ],
        options: la.options,
      });
    });
    return out;
  }, [
    glyphAlternateMode,
    alternateLetters,
    glyphInstances,
    glyphBoxByIndex,
    diacriticGlyphIndices,
    shapeData.glyphs,
    shapeData.shapableText,
    shapeFillTextRotation,
    shapeScale,
  ]);

  /** Every tiled repetition that is a diacritic. */
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

      const adapter = makeShapeFillInstanceAdapter({
        gx: inst.gx,
        gy: inst.gy,
        rotationDeg: shapeFillTextRotation,
        scX: inst.scX,
        scY: inst.scY,
        shapeScale,
      });

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
    shapeFillTextRotation,
    shapeScale,
  ]);

  // One placement per tiled repetition of each detached mark. The instances
  // come from the plan-free cache, so the mark's own offset moves the box
  // here for both routes.
  const detachedMarkPlacements = useMemo<DetachedMarkPlacement[]>(() => {
    if (!detachedMarkEditMode) return [];
    const scale = fontSize / Math.max(shapeData.unitsPerEm || 1000, 1);
    const out: DetachedMarkPlacement[] = [];
    glyphInstances.forEach((inst, i) => {
      const list = detectedMarks.get(inst.glyphIndex);
      if (!list) return;
      const adapter = makeShapeFillInstanceAdapter({
        gx: inst.gx, gy: inst.gy, rotationDeg: shapeFillTextRotation, scX: inst.scX, scY: inst.scY, shapeScale,
      });
      for (const m of list) {
        const off = m.mark < 0 ? markPlan.glyphs.get(inst.glyphIndex) : markPlan.contours.get(inst.glyphIndex)?.get(m.mark);
        const dx = off?.[0] ?? 0, dy = off?.[1] ?? 0;
        const bx = dx, by = dy;
        out.push({
          key: `${i}:${inst.glyphIndex}:${m.mark}`, cluster: m.cluster, glyphId: m.glyphId, mark: m.mark, dx, dy,
          box: {
            x: (m.bounds.x1 + bx) * scale, y: (m.bounds.y1 + by) * scale,
            width: Math.max((m.bounds.x2 - m.bounds.x1) * scale, 1), height: Math.max((m.bounds.y2 - m.bounds.y1) * scale, 1),
          },
          ...adapter,
        });
      }
    });
    return out;
  }, [detachedMarkEditMode, glyphInstances, detectedMarks, markPlan, shapeData.unitsPerEm, fontSize, shapeFillTextRotation, shapeScale]);

  return (
    <Group
      ref={groupRef}
      id={id}
      x={x} y={y}
      rotation={rotation}
      opacity={opacity}
      draggable={draggable && !locked}
      // While the diacritic tool is armed the silhouette itself must not
      // move: the overlay's hit rects cover much of it, and a press that
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

                targetCtx.scale(scX, scY);
                if (diacriticOverride) {
                  // Applied inside the row's own scale so an adjusted mark
                  // keeps being scaled with its row, and pivoted on the
                  // glyph's pen origin — the same meaning offsetY has on
                  // plain text.
                  targetCtx.translate(diacriticOverride.offsetX ?? 0, diacriticOverride.offsetY ?? 0);
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
                    // The mark's own scale joins here: `block` is the
                    // visible weight measured in the silhouette's space.
                    block:
                      fauxBoldWidth * (diacriticOverride?.scale ?? 1),
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
        Largest -> smallest, all before the corner resize Circle: Konva routes
        a pointer to the topmost listening shape, so a mark's handles must sit
        above the letter-sized Next Shape target, and the resize handle at the
        shape's bottom-right corner above both.
      */}
      <AlternateHoverHandles
        isSelected={isSelected}
        enabled={glyphAlternateMode}
        targets={alternateTargets}
        alternates={glyphAlternates}
        onPick={onPickAlternate}
      />
      <DetachedMarkHoverHandles
        isSelected={isSelected}
        enabled={detachedMarkEditMode}
        placements={detachedMarkPlacements}
        fontScale={fontSize / Math.max(shapeData.unitsPerEm || 1000, 1)}
        fontSize={fontSize}
        onBeginDrag={onBeginDetachedMarkDrag}
        onSet={onSetDetachedMark}
      />
      <DiacriticHoverHandles
        isSelected={isSelected && diacriticEditMode}
        placements={diacriticPlacements}
        diacriticOverrides={diacriticOverrides}
        fontSize={fontSize}
        onBeginDiacriticDrag={onBeginDiacriticDrag}
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
