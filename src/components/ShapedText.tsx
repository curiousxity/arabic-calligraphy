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
  type DiacriticPlacement,
} from "../lib/diacriticPlacement";
import type { DiacriticOverride, GlyphTransform } from "../types";
import {
  createBlockFillPainter,
  type BlockFill,
  type BlockFillPainter,
} from "../lib/blockFill";
import { resolveGlyphTransform, transformedBox } from "../lib/glyphTransform";
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
  painter: BlockFillPainter | null = null
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
      const { offsetX, offsetY, scaleX, scaleY } = resolveGlyphTransform(transform);
      ctx.translate(offsetX, offsetY);
      ctx.scale(scaleX, scaleY);
      localScale *= (scaleX + scaleY) / 2;
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
    () => findDiacriticGlyphIndices(shapeData.glyphs, shapeData.font),
    [shapeData.glyphs, shapeData.font]
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
    () =>
      glyphTransforms.filter(
        (t) => t.glyphId === undefined || shapeData.glyphs[t.glyphIndex]?.g === t.glyphId
      ),
    [glyphTransforms, shapeData.glyphs]
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
  // — both the RAW (untransformed) boxes every outline-space consumer needs
  // (diacritic placements, the reported box list) and the transform-folded
  // boxes only `GlyphTransformHoverHandles` reads —
  // in one pass over the glyph run, since both variants need the same
  // (expensive) glyphObj.getPath(...).getBoundingBox() call per glyph, so
  // walking the font twice to get each independently would do that work twice.
  const glyphMetrics = useMemo<{
    bounds: GlyphBounds;
    hitBoxes: GlyphHitBox[];
    transformedHitBoxes: GlyphHitBox[];
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
      return { bounds: fallbackBounds(), hitBoxes: [], transformedHitBoxes: [] };
    }

    const upm = Math.max(unitsPerEm || 1000, 1);
    const scale = fontSize / upm;

    let penX = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const hitBoxes: GlyphHitBox[] = [];
    const transformedHitBoxes: GlyphHitBox[] = [];

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
          // `hitBoxes` stays in raw outline space — every consumer besides
          // the move/scale overlay (the diacritic placements, and whatever
          // `onGlyphBoxesChange` feeds) reasons about real font outline
          // points, which a folded-in transform would misalign.
          // `transformedHitBoxes` tracks where each glyph is actually
          // drawn, for the move/scale overlay's own hover targets. The
          // block bounds above deliberately follow neither — those must
          // stay stable, or transforming one glyph would re-layout the
          // entire block.
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

          const t = transformedBox(
            raw,
            gx,
            gy,
            activeGlyphTransforms.find((gt) => gt.glyphIndex === i)
          );
          transformedHitBoxes.push({
            glyphIndex: i,
            x: t.x,
            y: t.y,
            width: Math.max(t.width, 1),
            height: Math.max(t.height, 1),
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
      return { bounds: fallbackBounds(), hitBoxes, transformedHitBoxes };
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
      transformedHitBoxes,
    };
  }, [shapeData, text, fontSize, activeGlyphTransforms]);

  const glyphBounds = glyphMetrics.bounds;
  const glyphHitBoxes = glyphMetrics.hitBoxes;
  const glyphTransformedHitBoxes = glyphMetrics.transformedHitBoxes;

  const isBold = fontStyle === "bold" || fontStyle === "bold italic";
  const isItalic = fontStyle === "italic" || fontStyle === "bold italic";
  const fauxBoldWidth = isBold ? Math.max(fontSize * 0.035, 0.6) : 0;

  const bw = Math.max(glyphBounds.rawWidth, 20);
  const bh = Math.max(fontSize * lineHeight, glyphBounds.rawHeight, 24);
  const bx = align === "left" ? 0 : align === "right" ? -bw : -bw / 2;
  const by = -bh / 2;
  const localDrawX = -glyphBounds.minX + (bw - glyphBounds.rawWidth) / 2;
  const localDrawY = -glyphBounds.minY + (bh - glyphBounds.rawHeight) / 2;

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
          adapter = makeGlyphTransformAdapter({
            offsetX: dx,
            offsetY: dy,
            pivotX: b.gx,
            pivotY: b.gy,
            transformOffsetX: resolved.offsetX,
            transformOffsetY: resolved.offsetY,
            scaleX: resolved.scaleX,
            scaleY: resolved.scaleY,
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
          if (isItalic) ctx.transform(1, 0, -0.25, 1, 0, 0);

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
            painter
          );
          ctx.restore();

          if (strokeWidth > 0) {
            ctx.save();
            ctx.translate(localDrawX, localDrawY);
            if (isItalic) ctx.transform(1, 0, -0.25, 1, 0, 0);
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
              painter
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
        glyphHitBoxes={glyphTransformedHitBoxes}
        glyphTransforms={activeGlyphTransforms}
        offsetX={bx + localDrawX}
        offsetY={by + localDrawY}
        onUpdateGlyphTransform={onUpdateGlyphTransform}
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