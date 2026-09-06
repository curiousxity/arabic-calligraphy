import React, { useEffect, useMemo, useRef, useState } from "react";
import { Group, Shape, Rect, Arc } from "react-konva";
import type Konva from "konva";
import type { PathCommand } from "opentype.js";
import type { HarfBuzzGlyph, ShapedTextResult } from "../lib/harfbuzz";
import { warpPoint, type GlyphBounds } from "../lib/warp";
import { useShapedGlyphs } from "../hooks/useShapedGlyphs";
import { useOverrideGlyph } from "../hooks/useOverrideGlyph";
import { findDiacriticGlyphIndices } from "../lib/diacritics";
import {
  makeGlyphTransformAdapter,
  makeOffsetAdapter,
  type GlyphTransformPlacement,
  type DiacriticPlacement,
} from "../lib/diacriticPlacement";
import type { DiacriticOverride, GlyphTransform, StrokeCut } from "../types";
import {
  createBlockFillPainter,
  type BlockFill,
  type BlockFillPainter,
} from "../lib/blockFill";
import {
  filterActiveGlyphTransforms,
  glyphPivot,
  resolveGlyphTransform,
} from "../lib/glyphTransform";
import { ITALIC_SHEAR, fauxBoldStrokeWidth } from "../lib/fitToWidth";
import {
  applyCutsToCommands,
  buildCutPlan,
  findCutZonesSwept,
  flattenContours,
  outlineBounds,
  toSvgCmds,
  DEFAULT_DETECT_OPTS,
  type CutPlan,
  type ResolvedCut,
} from "../lib/strokeCuts";
import {
  StrokeCutHoverHandles,
  type StrokeCutZone,
} from "./StrokeCutHoverHandles";
import { nuqtaUnits } from "../lib/nuqta";
import {
  isOverrideGlyphChar,
  OVERRIDE_SCALE,
  OVERRIDE_RAISE,
  type OverrideGlyph,
} from "../lib/glyphOverrides";
import { DiacriticHoverHandles } from "./DiacriticHoverHandles";
import { GlyphTransformHoverHandles } from "./GlyphTransformHoverHandles";

type Props = {
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
  diacriticOverrides?: DiacriticOverride[];
  glyphTransforms?: GlyphTransform[];
  glyphTransformMode?: boolean;
  strokeCuts?: StrokeCut[];
  strokeCutEditMode?: boolean;
  onSetStrokeCut?: (cut: StrokeCut) => void;
  onUpdateGlyphTransform?: (glyphIndex: number, patch: Partial<GlyphTransform>) => void;
  isSelected?: boolean;
  onDragDiacriticOverride?: (glyphIndex: number, patch: Partial<DiacriticOverride>) => void;
  onToggleDiacriticHidden?: (glyphIndex: number) => void;
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
/** Cuts are stored in font units; a path opentype.js drew at `fontSize` is
 *  already scaled, so the cut positions and distances must be too. The angle
 *  is unaffected — the scaling is uniform. */
function scaleCuts(cuts: ResolvedCut[], scale: number): ResolvedCut[] {
  return cuts.map((c) => ({ cutX: c.cutX * scale, d: c.d * scale, angle: c.angle }));
}

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
  diacriticOverrides: DiacriticOverride[] = [],
  glyphTransforms: GlyphTransform[] = [],
  /**
   * How the glyph interiors get painted. Built by the caller while the ctx
   * still sits in the block's own space, so a gradient spans the whole run
   * rather than restarting inside every letter — see `lib/blockFill.ts`.
   */
  painter: BlockFillPainter | null = null,
  /**
   * Straight-stroke extensions, resolved against this run. Its `shift` is in
   * font units (the same space as `penX`); its `surgery` cuts are too, so
   * they are scaled by `scale` before being applied to a path opentype.js
   * has already drawn at `fontSize`.
   */
  cutPlan: CutPlan | null = null,
  /**
   * Each glyph's rotation pivot — the centre of its own **raw** outline box,
   * relative to that glyph's pen origin. Passed in rather than measured here
   * because `glyphMetrics` has already walked the font for exactly these
   * boxes, and its boxes are post-cut: a `getBoundingBox()` taken in this
   * loop would turn a surgically lengthened letter about the centre of the
   * letter it used to be.
   */
  glyphPivots: Map<number, { x: number; y: number }> | null = null
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

    const gx = (penX + (g.dx ?? 0) + (cutPlan?.shift[glyphIndex] ?? 0)) * scale;
    const gy = -(g.dy ?? 0) * scale;

    ctx.save();
    ctx.translate(gx, gy);

    // How much this glyph's own space is scaled relative to the block's, so a
    // line width chosen here can be restated in block space for the gradient
    // painter (which strokes with the transform reset).
    let localScale = 1;

    const transform = glyphTransforms.find((t) => t.glyphIndex === glyphIndex);
    if (transform) {
      // The context is already translated to this glyph's pen origin, so
      // this scales about the pen origin — on the baseline, at the start
      // of the advance — with no pivot arithmetic. Deliberately does NOT
      // touch `penX += advance` below: a moved or widened glyph must never
      // shift its neighbours.
      const { offsetX, offsetY, scaleX, scaleY, rotation } = resolveGlyphTransform(transform);
      ctx.translate(offsetX, offsetY);
      ctx.scale(scaleX, scaleY);
      localScale *= (scaleX + scaleY) / 2;

      // Rotation goes *inside* the scale, about the glyph's own raw box
      // centre. Two consequences, both deliberate. The pivot never depends
      // on the scale, so the scale handles' drag-start snapshot stays valid
      // — a scale-dependent pivot is the divergence `scaleFromHandleDrag`
      // exists to remove, and it is zero at rotation 0 so it would ship
      // green. And at a non-uniform scale a turned letter is stretched along
      // the block's axes rather than along its own; that is an aesthetic
      // choice, identical either way whenever scaleX === scaleY.
      //
      // Guarded so the overwhelmingly common untouched path is unchanged
      // instruction for instruction.
      if (rotation !== 0) {
        const pivot = glyphPivots?.get(glyphIndex);
        if (pivot) {
          ctx.translate(pivot.x, pivot.y);
          ctx.rotate((rotation * Math.PI) / 180);
          ctx.translate(-pivot.x, -pivot.y);
        }
      }
    }

    // Applied *inside* the glyph transform: the transform is the outermost
    // rigid transform of the finished glyph, so a mark carrying both keeps
    // its override expressed in the glyph's own pre-transform (text) space.
    // That is what lets DiacriticHoverHandles hand this same composition to
    // `makeGlyphTransformAdapter` and read a drag back as an unscaled
    // offsetY. Reversing these two blocks multiplies the transform's offset
    // by the diacritic's scale and leaves the overlay unable to invert it.
    if (diacriticOverride) {
      ctx.translate(0, diacriticOverride.offsetY ?? 0);
      const diacScale = diacriticOverride.scale ?? 1;
      ctx.scale(diacScale, diacScale);
      localScale *= diacScale;
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
      const cutsHere = cutPlan?.surgery.get(glyphIndex);
      // SvgCmd and PathCommand are structurally identical; `toSvgCmds` is the
      // one checked conversion, and the cast back mirrors how the override
      // glyph's own commands are handled a few lines above.
      const sourceCmds: PathCommand[] = cutsHere?.length
        ? (applyCutsToCommands(
            toSvgCmds(opPath.commands),
            scaleCuts(cutsHere, scale)
          ) as unknown as PathCommand[])
        : opPath.commands;
      const cmds: PathCommand[] = sourceCmds.map((cmd) => {
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
          const p = warpPoint(c.x + gx, c.y + gy, bounds, width, height, warpX, warpY);
          out.x = p.x - gx;
          out.y = p.y - gy;
        }

        if (typeof c.x1 === "number" && typeof c.y1 === "number") {
          const p1 = warpPoint(c.x1 + gx, c.y1 + gy, bounds, width, height, warpX, warpY);
          out.x1 = p1.x - gx;
          out.y1 = p1.y - gy;
        }

        if (typeof c.x2 === "number" && typeof c.y2 === "number") {
          const p2 = warpPoint(c.x2 + gx, c.y2 + gy, bounds, width, height, warpX, warpY);
          out.x2 = p2.x - gx;
          out.y2 = p2.y - gy;
        }

        return out as PathCommand;
      });

      tracePath(ctx, cmds);
    }

    // Outline first, fill second. A canvas stroke straddles the path, so
    // stroking *after* the fill lays half the outline's width back over the
    // letter — thickening every stem and closing up counters as the width
    // rises. Filling over the stroke hides that inner half, leaving the
    // letterform at its designed weight with the outline sitting outside it.
    if (drawStroke && strokeWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }

    if (painter) painter.fill(ctx);
    else ctx.fill();
    if (fauxBoldWidth > 0 && !drawStroke) {
      if (painter)
        painter.strokeWithFill(ctx, {
          local: fauxBoldWidth,
          block: fauxBoldWidth * localScale,
        });
      else {
        ctx.strokeStyle = ctx.fillStyle as string;
        ctx.lineWidth = fauxBoldWidth;
        ctx.stroke();
      }
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
  fill,
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
  diacriticOverrides = [],
  glyphTransforms = [],
  glyphTransformMode = false,
  strokeCuts = [],
  strokeCutEditMode = false,
  onSetStrokeCut,
  isSelected = false,
  onDragDiacriticOverride,
  onToggleDiacriticHidden,
  onUpdateGlyphTransform,
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

  // The set of glyph indices this render pass actually considers a
  // diacritic — used to guard `diacriticOverrides` at draw time so a
  // stale override (e.g. after a text edit shifted which glyph index it
  // lands on) degrades to a no-op instead of hiding/scaling a base
  // letter.
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

  // The same staleness guard for glyph transforms. Overrides can be
  // re-validated by asking whether the glyph at that index is still a
  // diacritic at all; a transform has no such signal, because every glyph is
  // a legitimate target — so it carries the glyph id it was made for and we
  // check that instead. A transform written before `glyphId` existed has
  // nothing to check against and is kept, preserving the old behaviour for
  // saved projects rather than dropping their edits.
  const activeGlyphTransforms = useMemo(
    () => filterActiveGlyphTransforms(glyphTransforms, shapeData.glyphs),
    [glyphTransforms, shapeData.glyphs]
  );

  /**
   * Cuts resolved against this run, built once and used by both glyph loops
   * so the ink drawn and the ink measured can never disagree.
   *
   * Built in **font units**, not px: `nuqtaUnits` is asked for one nuqta at
   * `upm`, which puts `shift` in the same space as `penX` and leaves the
   * surgery cuts to be scaled at the point they meet a path opentype.js has
   * drawn at `fontSize`.
   */
  const cutPlan = useMemo(
    () =>
      buildCutPlan(
        shapeData.glyphs,
        strokeCuts,
        nuqtaUnits(fontFamily, Math.max(shapeData.font?.unitsPerEm || 1000, 1))
      ),
    [shapeData.glyphs, shapeData.font, strokeCuts, fontFamily]
  );

  /**
   * Detected stretchable strokes, one entry per zone.
   *
   * Only computed while the tool is armed — the sweep rotates each outline
   * through fifteen candidate angles, which is far too much to run on every
   * text block on the canvas all the time. Zones come back in font units,
   * matching where `StrokeCut.localX` is stored, so a cut survives a
   * font-size change.
   */
  const strokeCutZones = useMemo<StrokeCutZone[]>(() => {
    const font = shapeData.font;
    if (!strokeCutEditMode || !font) return [];
    const upm = Math.max(shapeData.unitsPerEm || 1000, 1);
    const scale = fontSize / upm;
    const opts = {
      ...DEFAULT_DETECT_OPTS,
      step: upm / 100,
      minZoneWidth: upm / 40,
    };

    const out: StrokeCutZone[] = [];
    let penX = 0;
    for (let i = 0; i < shapeData.glyphs.length; i++) {
      const g = shapeData.glyphs[i];
      const glyphObj = font.glyphs.get(g.g);
      if (!glyphObj) {
        penX += g.ax ?? 0;
        continue;
      }
      const gx = (penX + (g.dx ?? 0) + (cutPlan.shift[i] ?? 0)) * scale;
      const gy = -(g.dy ?? 0) * scale;
      const zones = findCutZonesSwept(
        flattenContours(toSvgCmds(glyphObj.getPath(0, 0, upm).commands)),
        { glyphIndex: i, cluster: g.cl ?? 0 },
        opts
      );
      for (const zone of zones) out.push({ ...zone, gx, gy, glyphId: g.g });
      penX += g.ax ?? 0;
    }
    return out;
  }, [strokeCutEditMode, shapeData, fontSize, cutPlan]);

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
  // — both the RAW (untransformed) boxes every outline-space consumer needs
  // (diacritic placements, the reported box list) and the transform-folded
  // boxes only `GlyphTransformHoverHandles` reads —
  // in one pass over the glyph run, since both variants need the same
  // (expensive) glyphObj.getPath(...).getBoundingBox() call per glyph, so
  // walking the font twice to get each independently would do that work twice.
  const glyphMetrics = useMemo<{
    bounds: GlyphBounds;
    hitBoxes: GlyphHitBox[];
    /**
     * Rotation pivots, by glyph index — read off the same raw boxes as
     * `hitBoxes`, in the same font walk, so the draw loop and the overlay
     * turn every glyph about the identical point. These boxes are post-cut,
     * which a pivot measured inside the draw loop would not be.
     */
    pivots: Map<number, { x: number; y: number }>;
  }>(() => {
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
      return {
        bounds: fallbackBounds(),
        hitBoxes: [],
        pivots: new Map(),
      };
    }

    const upm = Math.max(unitsPerEm || 1000, 1);
    const scale = fontSize / upm;

    let penX = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const hitBoxes: GlyphHitBox[] = [];
    const pivots = new Map<number, { x: number; y: number }>();

    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      const glyphObj = font.glyphs.get(g.g);
      const advance = g.ax ?? 0;

      if (glyphObj) {
        const gx = (penX + (g.dx ?? 0) + (cutPlan.shift[i] ?? 0)) * scale;
        const gy = -(g.dy ?? 0) * scale;
        // A cut letter must report the ink it actually draws, or snapping,
        // alignment and Fit to width all keep measuring the un-stretched run.
        const cutsHere = cutPlan.surgery.get(i);
        const box = cutsHere?.length
          ? (() => {
              const b = outlineBounds(
                applyCutsToCommands(
                  toSvgCmds(glyphObj.getPath(0, 0, fontSize).commands),
                  scaleCuts(cutsHere, scale)
                )
              );
              return { x1: b.x1 + gx, y1: b.y1 + gy, x2: b.x2 + gx, y2: b.y2 + gy };
            })()
          : glyphObj.getPath(gx, gy, fontSize).getBoundingBox();

        if (isFinite(box.x1) && isFinite(box.x2)) {
          minX = Math.min(minX, box.x1);
          maxX = Math.max(maxX, box.x2);
        }

        if (isFinite(box.y1) && isFinite(box.y2)) {
          minY = Math.min(minY, box.y1);
          maxY = Math.max(maxY, box.y2);
        }

        if (isFinite(box.x1) && isFinite(box.x2) && isFinite(box.y1) && isFinite(box.y2)) {
          // `hitBoxes` stays in **raw** outline space, and every consumer
          // now takes it that way — the diacritic placements, whatever
          // `onGlyphBoxesChange` feeds, and (since the overlay port) the
          // move/scale/rotate placements too, which fold the transform in
          // themselves via `transformedBox`. That is what keeps this walk —
          // one `getPath(...).getBoundingBox()` per glyph, the expensive
          // thing in this component — off the live drag value, so a scale
          // gesture no longer re-walks the font every frame. The block
          // bounds above are raw for a different reason: they must stay
          // stable, or transforming one glyph would re-layout the entire
          // block.
          const raw = {
            x: box.x1,
            y: box.y1,
            width: Math.max(box.x2 - box.x1, 1),
            height: Math.max(box.y2 - box.y1, 1),
          };
          hitBoxes.push({
            glyphIndex: i,
            x: raw.x,
            y: raw.y,
            width: raw.width,
            height: raw.height,
            glyphId: g.g,
            gx,
            gy,
          });

          pivots.set(i, glyphPivot(raw, gx, gy));
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
      return { bounds: fallbackBounds(), hitBoxes, pivots };
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
      pivots,
    };
  }, [shapeData, text, fontSize, cutPlan]);

  const glyphBounds = glyphMetrics.bounds;
  const glyphHitBoxes = glyphMetrics.hitBoxes;
  const glyphPivots = glyphMetrics.pivots;

  const isBold = fontStyle === "bold" || fontStyle === "bold italic";
  const isItalic = fontStyle === "italic" || fontStyle === "bold italic";
  const fauxBoldWidth = isBold ? fauxBoldStrokeWidth(fontSize) : 0;

  const bw = Math.max(glyphBounds.rawWidth, 20);
  const bh = Math.max(fontSize * lineHeight, glyphBounds.rawHeight, 24);
  const bx = align === "left" ? 0 : align === "right" ? -bw : -bw / 2;
  const by = -bh / 2;
  const localDrawX = -glyphBounds.minX + (bw - glyphBounds.rawWidth) / 2;
  const localDrawY = -glyphBounds.minY + (bh - glyphBounds.rawHeight) / 2;

  /**
   * Move/scale/rotate placements: one per glyph, with the **raw** box and the
   * glyph's pen origin, and the plain translation into group space as the
   * adapter. The transform is deliberately absent — the overlay resolves it
   * per render, so this memo does not rebuild on every frame of a drag.
   */
  const glyphTransformPlacements = useMemo<GlyphTransformPlacement[]>(() => {
    const adapter = makeOffsetAdapter(bx + localDrawX, by + localDrawY);
    return glyphHitBoxes.map((b) => ({
      glyphIndex: b.glyphIndex,
      // One placement per glyph, so the glyph index is already unique.
      key: String(b.glyphIndex),
      glyphId: b.glyphId,
      box: { x: b.x, y: b.y, width: b.width, height: b.height },
      gx: b.gx,
      gy: b.gy,
      ...adapter,
    }));
  }, [glyphHitBoxes, bx, by, localDrawX, localDrawY]);

  // Identity-plus-offset placements: this component's local space already
  // *is* the glyph-run space its overlay draws in, so its adapter is a
  // plain translation by the same offset every other overlay here uses.
  const diacriticPlacements = useMemo<DiacriticPlacement[]>(() => {
    const dx = bx + localDrawX;
    const dy = by + localDrawY;
    const plain = makeOffsetAdapter(dx, dy);

    return glyphHitBoxes
      .filter((b) => diacriticGlyphIndices.has(b.glyphIndex))
      .map((b) => {
        // A mark that also carries a glyph transform needs that transform
        // in its adapter, or its handles sit where the mark *would* be
        // undistorted. `glyphHitBoxes` are raw, so the adapter is what
        // applies it.
        const transform = activeGlyphTransforms.find((t) => t.glyphIndex === b.glyphIndex);
        let adapter = plain;

        if (transform) {
          const resolved = resolveGlyphTransform(transform);
          // The rotation pivot is in this same local space, so it is the
          // glyph's raw box centre put back where the metrics walk found it.
          const pivot = glyphPivots.get(b.glyphIndex);
          adapter = makeGlyphTransformAdapter({
            offsetX: dx,
            offsetY: dy,
            pivotX: b.gx,
            pivotY: b.gy,
            transformOffsetX: resolved.offsetX,
            transformOffsetY: resolved.offsetY,
            scaleX: resolved.scaleX,
            scaleY: resolved.scaleY,
            rotationDeg: pivot ? resolved.rotation : 0,
            rotationPivotX: b.gx + (pivot?.x ?? 0),
            rotationPivotY: b.gy + (pivot?.y ?? 0),
          });
        }

        return {
          glyphIndex: b.glyphIndex,
          key: String(b.glyphIndex),
          box: { x: b.x, y: b.y, width: b.width, height: b.height },
          ...adapter,
        };
      });
  }, [
    glyphHitBoxes,
    activeGlyphTransforms,
    glyphPivots,
    diacriticGlyphIndices,
    bx,
    by,
    localDrawX,
    localDrawY,
  ]);

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
          if (isItalic) ctx.transform(1, 0, -ITALIC_SHEAR, 1, 0, 0);

          // Built here, with the ctx already in the block's own space (the
          // run-centring translate and the italic shear applied), so the
          // gradient spans the whole word and shears with it.
          const painter = createBlockFillPainter(ctx, fill, color, {
            x: glyphBounds.minX,
            y: glyphBounds.minY,
            width: glyphBounds.rawWidth,
            height: glyphBounds.rawHeight,
          });
          ctx.fillStyle = painter.style;
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
            activeDiacriticOverrides,
            activeGlyphTransforms,
            painter,
            cutPlan,
            glyphPivots
          );
          ctx.restore();

          if (strokeWidth > 0) {
            ctx.save();
            ctx.translate(localDrawX, localDrawY);
            if (isItalic) ctx.transform(1, 0, -ITALIC_SHEAR, 1, 0, 0);
            // This pass fills as well as strokes (the outline-before-fill
            // ordering is per glyph), and `ctx.restore()` above popped the
            // fill style the first pass set — so it has to be re-applied, or
            // the run is repainted in whatever style the context happened to
            // be carrying.
            ctx.fillStyle = painter.style;
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
              activeDiacriticOverrides,
              activeGlyphTransforms,
              // The outline pass fills too (outline-before-fill is per glyph),
              // and its transform is the same block space the painter was
              // built in, so it reuses the same one.
              painter,
              cutPlan,
              glyphPivots
            );
            ctx.restore();
          }
        }}
      />

      {/*
        Mounted BEFORE the diacritic overlay: Konva routes a pointer to the
        topmost listening shape, and these rects are glyph-sized, so they
        must not paint over a mark's smaller, more precise target.
      */}
      <GlyphTransformHoverHandles
        isSelected={isSelected}
        enabled={glyphTransformMode}
        placements={glyphTransformPlacements}
        glyphTransforms={activeGlyphTransforms}
        onUpdateGlyphTransform={onUpdateGlyphTransform}
      />

      {/*
        Between the two: the move/scale rects are glyph-sized, a stretch rail
        runs along one stroke inside a glyph, and a mark's target is smaller
        still. Konva routes to the topmost listening shape and later siblings
        sit on top, so this is largest -> smallest.
      */}
      <StrokeCutHoverHandles
        isSelected={isSelected}
        enabled={strokeCutEditMode}
        zones={strokeCutZones}
        cuts={strokeCuts}
        scale={fontSize / Math.max(shapeData.unitsPerEm || 1000, 1)}
        nuqtaPx={nuqtaUnits(fontFamily, fontSize)}
        offsetX={bx + localDrawX}
        offsetY={by + localDrawY}
        onSetCut={onSetStrokeCut}
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

export default ShapedText;