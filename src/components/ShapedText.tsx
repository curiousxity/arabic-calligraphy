import React, { useEffect, useMemo, useRef, useState } from "react";
import { Group, Shape, Rect, Arc } from "react-konva";
import type Konva from "konva";
import type { PathCommand } from "opentype.js";
import type { HarfBuzzGlyph, ShapedTextResult } from "../lib/harfbuzz";
import { useShapedGlyphs } from "../hooks/useShapedGlyphs";
import { useOverrideGlyph } from "../hooks/useOverrideGlyph";
import { findDiacriticGlyphIndices } from "../lib/diacritics";
import {
  makeOffsetAdapter,
  type DiacriticPlacement,
  type DetachedMarkPlacement,
} from "../lib/diacriticPlacement";
import type { DiacriticOverride, DetachedMarkOverride, GlyphAlternate, StrokeCut } from "../types";
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
import {
  createBlockFillPainter,
  type BlockFill,
  type BlockFillPainter,
} from "../lib/blockFill";
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
import { applySpacing } from "../lib/spacing";
import {
  isOverrideGlyphChar,
  OVERRIDE_SCALE,
  OVERRIDE_RAISE,
  type OverrideGlyph,
} from "../lib/glyphOverrides";
import { DiacriticHoverHandles } from "./DiacriticHoverHandles";
import { DetachedMarkHoverHandles } from "./DetachedMarkHoverHandles";
import { AlternateHoverHandles, type AlternateHitTarget } from "./AlternateHoverHandles";
import { quadFromBox } from "../lib/alternateTargets";
import {
  letterAtOffset,
  type AlternateChoice,
  type LetterAlternates,
} from "../lib/glyphAlternates";

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
  /** Fraction of font size; see lib/spacing.ts. */
  letterSpacing?: number;
  wordSpacing?: number;
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  rotation?: number;
  diacriticOverrides?: DiacriticOverride[];
  strokeCuts?: StrokeCut[];
  glyphAlternates?: GlyphAlternate[];
  /** Block-level OpenType style sets, e.g. ["ss01"]. */
  styleSets?: string[];
  /** Arms the Next Shape overlay. */
  glyphAlternateMode?: boolean;
  /** The letters that have alternates — App passes them for the selected block only. */
  alternateLetters?: LetterAlternates[];
  onPickAlternate?: (letter: number, choice: AlternateChoice | null) => void;
  strokeCutEditMode?: boolean;
  onBeginStrokeCut?: () => void;
  onSetStrokeCut?: (cut: StrokeCut) => void;
  detachedMarkOverrides?: DetachedMarkOverride[];
  /** Arms the "Move dots & marks" overlay. */
  detachedMarkEditMode?: boolean;
  onBeginDetachedMarkDrag?: () => void;
  onSetDetachedMark?: (o: DetachedMarkOverride) => void;
  isSelected?: boolean;
  onBeginDiacriticDrag?: () => void;
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

/** The run's ink extent, which lays out and centres the block. */
type GlyphBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  rawWidth: number;
  rawHeight: number;
};

export type GlyphHitBox = {
  glyphIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
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

/** Cuts are stored in font units; a path opentype.js drew at `fontSize` is
 *  already scaled, so the cut positions and distances must be too. The angle
 *  is unaffected — the scaling is uniform. */
function scaleCuts(cuts: ResolvedCut[], scale: number): ResolvedCut[] {
  return cuts.map((c) => ({ cutX: c.cutX * scale, d: c.d * scale, angle: c.angle }));
}

/** Draws each glyph of the run in its own local transform. */
function drawGlyphRun(
  ctx: CanvasRenderingContext2D,
  glyphs: HarfBuzzGlyph[],
  font: NonNullable<ShapedTextResult["font"]>,
  fontSize: number,
  unitsPerEm: number,
  drawStroke: boolean,
  strokeColor: string,
  strokeWidth: number,
  fauxBoldWidth = 0,
  overrideGlyph: OverrideGlyph | null = null,
  diacriticOverrides: DiacriticOverride[] = [],
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
  /** Moved dots and marks, font units; see lib/detachedMarks.ts. */
  markPlan: DetachedMarkPlan = EMPTY_MARK_PLAN
) {
  let penX = 0;
  const upm = Math.max(unitsPerEm || 1000, 1);
  const scale = fontSize / upm;

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

    if (diacriticOverride) {
      ctx.translate(diacriticOverride.offsetX ?? 0, diacriticOverride.offsetY ?? 0);
      const diacScale = diacriticOverride.scale ?? 1;
      ctx.scale(diacScale, diacScale);
      localScale *= diacScale;
    }

    // A dot drawn as its own glyph (NotoSans and kin), moved whole.
    const wholeMark = markPlan.glyphs.get(glyphIndex);
    if (wholeMark) ctx.translate(wholeMark[0] * scale, wholeMark[1] * scale);

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
      // Dot translation first, on raw contour indices; then cut surgery. A
      // dot dragged across a cut line gets cut — accepted residue. (The
      // tashkeel override is different: a ctx transform on a separate glyph.)
      // SvgCmd and PathCommand are structurally identical; `toSvgCmds` is the
      // one checked conversion, and the cast back mirrors how the override
      // glyph's own commands are handled a few lines above.
      const rawCmds = toSvgCmds(opPath.commands);
      const markedCmds = applyMarkPlanToGlyph(rawCmds, markPlan, glyphIndex, scale);
      const sourceCmds: PathCommand[] = cutsHere?.length
        ? (applyCutsToCommands(markedCmds, scaleCuts(cutsHere, scale)) as unknown as PathCommand[])
        : markedCmds === rawCmds
          ? opPath.commands
          : (markedCmds as unknown as PathCommand[]);
      tracePath(ctx, sourceCmds);
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

/**
 * Stable empty defaults, never a fresh `[]` in the parameter list.
 *
 * These three props feed memos below whose work is a walk over every glyph
 * (one `getPath(...).getBoundingBox()` each), so a new array identity per
 * render re-runs that walk on every frame of an unrelated drag. Defaulting
 * here rather than at each call site is what makes the guard hold for
 * *every* caller — `CanvasStage` and `MirrorBlockView` previously each had
 * to hoist a constant of their own to protect this component's memos, and a
 * caller that forgot got a silent per-frame re-walk with nothing to see.
 * `ShapeFillText` already follows this pattern.
 */
const NO_DIACRITIC_OVERRIDES: DiacriticOverride[] = [];
const NO_MARK_OVERRIDES: DetachedMarkOverride[] = [];
const NO_STROKE_CUTS: StrokeCut[] = [];
const NO_GLYPH_ALTERNATES: GlyphAlternate[] = [];
const NO_ALTERNATE_LETTERS: LetterAlternates[] = [];
/** Breathing room around a letter's ink, so its outline does not touch it. */
const ALTERNATE_TARGET_PAD = 3;

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
  letterSpacing = 0,
  wordSpacing = 0,
  opacity = 1,
  stroke = "#000000",
  strokeWidth = 0,
  shadowColor = "#000000",
  shadowBlur = 0,
  shadowOffsetX = 0,
  shadowOffsetY = 0,
  shadowOpacity = 0.35,
  rotation = 0,
  diacriticOverrides = NO_DIACRITIC_OVERRIDES,
  strokeCuts = NO_STROKE_CUTS,
  glyphAlternates = NO_GLYPH_ALTERNATES,
  styleSets,
  glyphAlternateMode = false,
  alternateLetters = NO_ALTERNATE_LETTERS,
  onPickAlternate,
  strokeCutEditMode = false,
  onBeginStrokeCut,
  onSetStrokeCut,
  detachedMarkOverrides = NO_MARK_OVERRIDES,
  detachedMarkEditMode = false,
  onBeginDetachedMarkDrag,
  onSetDetachedMark,
  isSelected = false,
  onBeginDiacriticDrag,
  onDragDiacriticOverride,
  onToggleDiacriticHidden,
  locked,
  draggable = true,
  onClick,
  onTap,
  onDblClick,
  onDragMove,
  onDragEnd,
  debugBounds = false,
}) => {
  const rawShape = useShapedGlyphs(text, fontFamily, glyphAlternates, styleSets);
  // Spacing changes only advances, so applying it here — once, before
  // anything below reads the run — reaches every loop, the bounding box and
  // every overlay. At 0/0 it is the identity and nothing re-renders.
  const spacedGlyphs = useMemo(
    () =>
      applySpacing(
        rawShape.glyphs,
        rawShape.shapableText,
        { letter: letterSpacing, word: wordSpacing },
        Math.max(rawShape.unitsPerEm || 1000, 1)
      ),
    [rawShape.glyphs, rawShape.shapableText, rawShape.unitsPerEm, letterSpacing, wordSpacing]
  );
  const shapeData = useMemo(
    () => (spacedGlyphs === rawShape.glyphs ? rawShape : { ...rawShape, glyphs: spacedGlyphs }),
    [rawShape, spacedGlyphs]
  );
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

  // Detection walks every contour with point-in-polygon tests, so it runs
  // over the whole run only while the tool is armed; otherwise only over the
  // glyphs that carry an override, which is what the plan needs.
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
  // in one pass over the glyph run, since both need the same (expensive)
  // glyphObj.getPath(...).getBoundingBox() call per glyph, so walking the
  // font twice to get each independently would do that work twice.
  const glyphMetrics = useMemo<{
    bounds: GlyphBounds;
    hitBoxes: GlyphHitBox[];
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
        // A moved dot, like a cut, must report the ink it actually draws.
        const hasMarks = markPlan.contours.has(i) || markPlan.glyphs.has(i);
        const box = cutsHere?.length || hasMarks
          ? (() => {
              const raw = toSvgCmds(glyphObj.getPath(0, 0, fontSize).commands);
              const marked = applyMarkPlanToGlyph(raw, markPlan, i, scale);
              const b = outlineBounds(
                cutsHere?.length ? applyCutsToCommands(marked, scaleCuts(cutsHere, scale)) : marked
              );
              const whole = markPlan.glyphs.get(i);
              const ox = (whole?.[0] ?? 0) * scale, oy = (whole?.[1] ?? 0) * scale;
              return { x1: b.x1 + gx + ox, y1: b.y1 + gy + oy, x2: b.x2 + gx + ox, y2: b.y2 + gy + oy };
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
          hitBoxes.push({
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
  }, [shapeData, text, fontSize, cutPlan, markPlan]);

  const glyphBounds = glyphMetrics.bounds;
  const glyphHitBoxes = glyphMetrics.hitBoxes;

  const isBold = fontStyle === "bold" || fontStyle === "bold italic";
  const isItalic = fontStyle === "italic" || fontStyle === "bold italic";
  const fauxBoldWidth = isBold ? fauxBoldStrokeWidth(fontSize) : 0;

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
    const adapter = makeOffsetAdapter(bx + localDrawX, by + localDrawY);

    return glyphHitBoxes
      .filter((b) => diacriticGlyphIndices.has(b.glyphIndex))
      .map((b) => {
        return {
          glyphIndex: b.glyphIndex,
          key: String(b.glyphIndex),
          box: { x: b.x, y: b.y, width: b.width, height: b.height },
          ...adapter,
        };
      });
  }, [
    glyphHitBoxes,
    diacriticGlyphIndices,
    bx,
    by,
    localDrawX,
    localDrawY,
  ]);

  const detachedMarkPlacements = useMemo<DetachedMarkPlacement[]>(() => {
    if (!detachedMarkEditMode || !shapeData.font) return [];
    const upm = Math.max(shapeData.unitsPerEm || 1000, 1);
    const scale = fontSize / upm;
    const adapter = makeOffsetAdapter(bx + localDrawX, by + localDrawY);
    const out: DetachedMarkPlacement[] = [];
    let penX = 0;
    for (let i = 0; i < shapeData.glyphs.length; i++) {
      const g = shapeData.glyphs[i];
      const gx = (penX + (g.dx ?? 0) + (cutPlan.shift[i] ?? 0)) * scale;
      const gy = -(g.dy ?? 0) * scale;
      penX += g.ax ?? 0;
      const list = detectedMarks.get(i);
      if (!list) continue;
      for (const m of list) {
        const off = m.mark < 0 ? markPlan.glyphs.get(i) : markPlan.contours.get(i)?.get(m.mark);
        const dx = off?.[0] ?? 0, dy = off?.[1] ?? 0;
        // m.bounds is in font units in the y-down frame opentype draws at
        // `upm`, the same frame getPath(0, 0, fontSize) uses scaled by
        // `scale`, so one multiply is the whole conversion.
        out.push({
          key: `${i}:${m.mark}`, cluster: m.cluster, glyphId: m.glyphId, mark: m.mark, dx, dy,
          box: {
            x: gx + (m.bounds.x1 + dx) * scale,
            y: gy + (m.bounds.y1 + dy) * scale,
            width: Math.max((m.bounds.x2 - m.bounds.x1) * scale, 1),
            height: Math.max((m.bounds.y2 - m.bounds.y1) * scale, 1),
          },
          ...adapter,
        });
      }
    }
    return out;
  }, [detachedMarkEditMode, detectedMarks, markPlan, shapeData, fontSize, cutPlan, bx, by, localDrawX, localDrawY]);

  // One target per letter that has alternates, its box the union of every
  // glyph in that letter's cluster (a letter and the marks on it).
  const alternateTargets = useMemo<AlternateHitTarget[]>(() => {
    if (!glyphAlternateMode || alternateLetters.length === 0) return [];
    const byLetter = new Map(alternateLetters.map((l) => [l.letter, l]));
    const boxes = new Map<number, { x1: number; y1: number; x2: number; y2: number }>();
    for (const b of glyphHitBoxes) {
      const g = shapeData.glyphs[b.glyphIndex];
      const letter = letterAtOffset(shapeData.shapableText, g?.cl ?? -1);
      if (!byLetter.has(letter)) continue;
      const held = boxes.get(letter);
      boxes.set(letter, {
        x1: Math.min(held?.x1 ?? Infinity, b.x),
        y1: Math.min(held?.y1 ?? Infinity, b.y),
        x2: Math.max(held?.x2 ?? -Infinity, b.x + b.width),
        y2: Math.max(held?.y2 ?? -Infinity, b.y + b.height),
      });
    }
    // Into the overlay's group space: the run is drawn offset by
    // `bx + localDrawX` / `by + localDrawY`, the same offset every other
    // overlay here applies.
    const ox = bx + localDrawX;
    const oy = by + localDrawY;
    return [...boxes].map(([letter, r]) => ({
      key: String(letter),
      letter,
      polygon: quadFromBox(
        { x: r.x1 + ox, y: r.y1 + oy, width: r.x2 - r.x1, height: r.y2 - r.y1 },
        ALTERNATE_TARGET_PAD
      ),
      options: byLetter.get(letter)!.options,
    }));
  }, [
    glyphAlternateMode,
    alternateLetters,
    glyphHitBoxes,
    shapeData.glyphs,
    shapeData.shapableText,
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
          drawGlyphRun(
            ctx as unknown as CanvasRenderingContext2D,
            shapeData.glyphs,
            font,
            fontSize,
            shapeData.unitsPerEm,
            false,
            stroke,
            strokeWidth,
            fauxBoldWidth,
            overrideGlyph,
            activeDiacriticOverrides,
            painter,
            cutPlan,
            markPlan
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
            drawGlyphRun(
              ctx as unknown as CanvasRenderingContext2D,
              shapeData.glyphs,
              font,
              fontSize,
              shapeData.unitsPerEm,
              true,
              stroke,
              strokeWidth,
              0,
              overrideGlyph,
              activeDiacriticOverrides,
              // The outline pass fills too (outline-before-fill is per glyph),
              // and its transform is the same block space the painter was
              // built in, so it reuses the same one.
              painter,
              cutPlan,
              markPlan
            );
            ctx.restore();
          }
        }}
      />

      {/*
        Largest -> smallest: a letter-sized alternates target, then a stretch
        rail along one stroke inside a glyph, then a dot or detached mark,
        then a tashkeel's smaller target. Konva routes to the topmost
        listening shape and later siblings sit on top, so the smaller targets
        must come later.
      */}
      <AlternateHoverHandles
        isSelected={isSelected}
        enabled={glyphAlternateMode}
        targets={alternateTargets}
        alternates={glyphAlternates}
        onPick={onPickAlternate}
      />
      <StrokeCutHoverHandles
        isSelected={isSelected}
        enabled={strokeCutEditMode}
        zones={strokeCutZones}
        cuts={strokeCuts}
        scale={fontSize / Math.max(shapeData.unitsPerEm || 1000, 1)}
        nuqtaPx={nuqtaUnits(fontFamily, fontSize)}
        offsetX={bx + localDrawX}
        offsetY={by + localDrawY}
        onBeginCut={onBeginStrokeCut}
        onSetCut={onSetStrokeCut}
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
        isSelected={isSelected}
        placements={diacriticPlacements}
        diacriticOverrides={diacriticOverrides}
        fontSize={fontSize}
        onBeginDiacriticDrag={onBeginDiacriticDrag}
        onDragDiacriticOverride={onDragDiacriticOverride}
        onToggleDiacriticHidden={onToggleDiacriticHidden}
      />

    </Group>
  );
};

export default ShapedText;