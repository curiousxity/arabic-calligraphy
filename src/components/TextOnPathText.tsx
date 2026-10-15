import React, { useEffect, useMemo } from "react";
import { Group, Shape, Rect, Line } from "react-konva";
import type Konva from "konva";
import { parseSvgPath, replayPath } from "../lib/svgPath";
import {
  pathLength,
  pathBoundingBox,
  buildArcTable,
  curveGlyphPlacements,
  curvePlacementToGroup,
} from "../lib/textPath";
import { useShapedGlyphs } from "../hooks/useShapedGlyphs";
import { AlternateHoverHandles, type AlternateHitTarget } from "./AlternateHoverHandles";
import {
  letterAtOffset,
  type AlternateChoice,
  type LetterAlternates,
} from "../lib/glyphAlternates";
import { DiacriticHoverHandles } from "./DiacriticHoverHandles";
import { findDiacriticGlyphIndices } from "../lib/diacritics";
import { makeCurveGlyphAdapter, type DiacriticPlacement } from "../lib/diacriticPlacement";
import type { DiacriticOverride, GlyphAlternate, GuideAttachment } from "../types";
import { guideCaret, guideGlyphPlacements, guideInkBox, type GuideLayout } from "../lib/guidePlacement";
import { EXPORT_HIDDEN } from "../lib/exportChrome";
import { createBlockFillPainter, type BlockFill } from "../lib/blockFill";

export type TextOnPathTextProps = {
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
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  rotation?: number;

  textPathD: string;
  textPathReversed?: boolean;
  textPathBaselineOffset?: number;
  /**
   * Attached to a guide: the guide's path replaces `textPathD`, and the text
   * keeps its own size at `guideAttachment.offset` (see lib/guidePlacement).
   */
  guidePath?: { d: string; closed: boolean };
  guideAttachment?: GuideAttachment;
  /** Renderer feedback for the panel's shrink note; never saved. */
  onGuideLayout?: (info: { shrink: number }) => void;
  /** Draws a typing caret at the run's reading end (attached text only). */
  caret?: boolean;
  /** Block-level OpenType style sets, e.g. ["ss01"]. */
  styleSets?: string[];
  /** Per-letter alternates (Next Shape). */
  glyphAlternates?: GlyphAlternate[];
  /** Arms the Next Shape overlay — the one per-glyph tool curves support (click-only). */
  glyphAlternateMode?: boolean;
  /** The letters that have alternates — App passes them for the selected block only. */
  alternateLetters?: LetterAlternates[];
  onPickAlternate?: (letter: number, choice: AlternateChoice | null) => void;
  isSelected?: boolean;
  /**
   * Per-mark tashkeel overrides. Offsets are in the letter's own tilted frame
   * at `fontSize`, so "up" is away from the curve at that letter — see
   * `makeCurveGlyphAdapter`.
   */
  diacriticOverrides?: DiacriticOverride[];
  /** One `pushHistory()` per handle drag, taken on drag start. */
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
};

/**
 * Renders shaped text flowing along an arbitrary curve. Each glyph is drawn
 * as a rigid unit (translate to its curve position, rotate to the local
 * tangent), modeled on ShapedText.tsx's glyph loop rather than a
 * per-point remap, since text-on-path doesn't distort individual glyph
 * outlines, it just repositions whole glyphs.
 */
const NO_GLYPH_ALTERNATES: GlyphAlternate[] = [];
const NO_ALTERNATE_LETTERS: LetterAlternates[] = [];
const NO_DIACRITIC_OVERRIDES: DiacriticOverride[] = [];

export const TextOnPathText: React.FC<TextOnPathTextProps> = ({
  id,
  text,
  x,
  y,
  fontSize,
  color,
  fill,
  fontFamily,
  fontStyle = "normal",
  opacity = 1,
  stroke = "#000000",
  strokeWidth = 0,
  shadowColor = "#000000",
  shadowBlur = 0,
  shadowOffsetX = 0,
  shadowOffsetY = 0,
  shadowOpacity = 0.35,
  rotation = 0,
  textPathD,
  textPathReversed = false,
  textPathBaselineOffset = 0,
  guidePath,
  guideAttachment,
  onGuideLayout,
  caret = false,
  styleSets,
  glyphAlternates = NO_GLYPH_ALTERNATES,
  glyphAlternateMode = false,
  alternateLetters = NO_ALTERNATE_LETTERS,
  onPickAlternate,
  isSelected = false,
  diacriticOverrides = NO_DIACRITIC_OVERRIDES,
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
}) => {
  const { glyphs, font, unitsPerEm, hbLoaded, shapableText } = useShapedGlyphs(
    text,
    fontFamily,
    glyphAlternates,
    styleSets
  );
  const isItalic = fontStyle === "italic" || fontStyle === "bold italic";

  // Attached to a guide: the guide's path, walked flipped or not, with the
  // natural-size placement. Otherwise the block's own curve, stretched to fit.
  const attached = guideAttachment && guidePath ? guideAttachment : null;
  const curveD = attached ? guidePath!.d : textPathD;
  const parsedCmds = useMemo(() => parseSvgPath(curveD || ""), [curveD]);
  const curveLen = useMemo(() => pathLength(parsedCmds), [parsedCmds]);
  // RTL text anchors to the curve's end point by default (walking the
  // reversed flattened point list); textPathReversed flips that per block.
  const walkReversed = attached ? attached.flip : !textPathReversed;
  // Built once per curve (not once per glyph, per render) — the arc-length
  // lookup used inside the glyph loop below just does a table scan instead
  // of re-flattening the whole path from scratch every time.
  const arcTable = useMemo(
    () => buildArcTable(parsedCmds, walkReversed),
    [parsedCmds, walkReversed]
  );

  // Bounding box of the curve itself, padded generously since glyphs can
  // extend above/below the baseline (mirrors ShapedText.tsx's hit-rect
  // padding logic, keyed off fontSize instead of measured glyph extents).
  const curveBox = useMemo(() => pathBoundingBox(parsedCmds), [parsedCmds]);

  const guideClosed = guidePath?.closed ?? false;
  const layout = useMemo(() => {
    if (!hbLoaded || !font || parsedCmds.length < 2) return null;
    if (attached) {
      return guideGlyphPlacements({
        glyphs,
        fontSize,
        unitsPerEm,
        ascender: font.ascender,
        arcTable,
        closed: guideClosed,
        attachment: attached,
      });
    }
    const fit = curveGlyphPlacements({ glyphs, fontSize, unitsPerEm, curveLen, arcTable });
    return fit ? { placements: fit.placements, baselineOffset: textPathBaselineOffset, shrink: 1 } : null;
  }, [hbLoaded, font, parsedCmds.length, glyphs, fontSize, unitsPerEm, curveLen, arcTable, attached, guideClosed, textPathBaselineOffset]);
  const baselineOffset = layout?.baselineOffset ?? textPathBaselineOffset;

  const shrink = attached ? layout?.shrink : undefined;
  useEffect(() => {
    if (shrink !== undefined) onGuideLayout?.({ shrink });
  }, [shrink, onGuideLayout]);

  /**
   * Next Shape targets: one per letter that has alternates — its widest
   * glyph, so a mark riding on it is not a second target — as the glyph's
   * ink box carried through the very placement the draw loop uses
   * (`curveGlyphPlacements`), so the outline tilts with the letter.
   */
  const alternateTargets = useMemo<AlternateHitTarget[]>(() => {
    if (!glyphAlternateMode || !layout || !font || alternateLetters.length === 0) return [];
    const byLetter = new Map(alternateLetters.map((l) => [l.letter, l]));
    const widest = new Map<number, number>();
    layout.placements.forEach((p) => {
      const letter = letterAtOffset(shapableText, glyphs[p.glyphIndex]?.cl ?? -1);
      if (!byLetter.has(letter)) return;
      const held = widest.get(letter);
      if (held === undefined || (glyphs[p.glyphIndex].ax ?? 0) > (glyphs[held].ax ?? 0)) {
        widest.set(letter, p.glyphIndex);
      }
    });
    const out: AlternateHitTarget[] = [];
    for (const [letter, glyphIndex] of widest) {
      const p = layout.placements[glyphIndex];
      const glyphObj = font.glyphs.get(glyphs[glyphIndex].g);
      const bb = glyphObj?.getPath(0, 0, p.size).getBoundingBox();
      if (!bb || !isFinite(bb.x1) || !isFinite(bb.y1)) continue;
      const pad = 3;
      const corners = [
        { x: bb.x1 - pad, y: bb.y1 - pad },
        { x: bb.x2 + pad, y: bb.y1 - pad },
        { x: bb.x2 + pad, y: bb.y2 + pad },
        { x: bb.x1 - pad, y: bb.y2 + pad },
      ];
      out.push({
        key: String(letter),
        letter,
        polygon: corners.map((c) => curvePlacementToGroup(p, c, baselineOffset)),
        options: byLetter.get(letter)!.options,
      });
    }
    return out;
  }, [glyphAlternateMode, layout, font, alternateLetters, shapableText, glyphs, baselineOffset]);
  // Which glyphs are tashkeel, recomputed per render like ShapedText does, so
  // a stale override (a text edit shifted its glyph index onto a letter)
  // draws as a no-op instead of moving or hiding that letter.
  const diacriticGlyphIndices = useMemo(
    () => findDiacriticGlyphIndices(glyphs, font, shapableText),
    [glyphs, font, shapableText]
  );
  const diacriticByIndex = useMemo(
    () =>
      new Map(
        diacriticOverrides
          .filter((o) => diacriticGlyphIndices.has(o.glyphIndex))
          .map((o) => [o.glyphIndex, o])
      ),
    [diacriticOverrides, diacriticGlyphIndices]
  );

  // One hover target per mark, in its own letter's tilted frame at
  // `fontSize`, so the overlay's handles and drags turn with the letter.
  const diacriticPlacements = useMemo<DiacriticPlacement[]>(() => {
    if (!isSelected || !layout || !font || diacriticGlyphIndices.size === 0) return [];
    const out: DiacriticPlacement[] = [];
    for (const p of layout.placements) {
      if (!diacriticGlyphIndices.has(p.glyphIndex)) continue;
      const bb = font.glyphs.get(glyphs[p.glyphIndex].g)?.getPath(0, 0, fontSize).getBoundingBox();
      if (!bb || !isFinite(bb.x1) || !isFinite(bb.y1)) continue;
      out.push({
        glyphIndex: p.glyphIndex,
        key: String(p.glyphIndex),
        box: { x: bb.x1, y: bb.y1, width: bb.x2 - bb.x1, height: bb.y2 - bb.y1 },
        ...makeCurveGlyphAdapter({
          x: p.x,
          y: p.y,
          angle: p.angle,
          k: p.size / Math.max(fontSize, 1e-4),
          baselineOffset,
        }),
      });
    }
    return out;
  }, [isSelected, layout, font, glyphs, fontSize, diacriticGlyphIndices, baselineOffset]);

  // Attached text only covers part of its guide, so its hit area is its own
  // letters' extent, not the whole guide's box: a circle guide's box would
  // otherwise swallow every click inside the medallion.
  const hitBox = useMemo(() => {
    if (!attached) return curveBox;
    // Nothing drawn yet (being typed, or still shaping): no hit area at all,
    // or a closed guide's box would claim the whole medallion.
    if (!layout || !font || layout.placements.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    const extentEm = (font.ascender - font.descender) / Math.max(unitsPerEm || 1000, 1);
    return guideInkBox(layout.placements, layout.placements[0].size, extentEm, baselineOffset);
  }, [attached, layout, font, unitsPerEm, curveBox, baselineOffset]);
  // The caret, in group space: a line from the baseline up the font's ascent,
  // tilted to the tangent where the next letter will go.
  const caretPoints = useMemo(() => {
    if (!caret || !attached || !font || !hbLoaded || parsedCmds.length < 2) return null;
    const c = guideCaret({
      glyphs,
      // The attached branch above is what produced it, so this is a GuideLayout.
      layout: layout as GuideLayout | null,
      fontSize,
      unitsPerEm,
      ascender: font.ascender,
      arcTable,
      closed: guideClosed,
      attachment: attached,
    });
    const ascent = (font.ascender * c.size) / Math.max(unitsPerEm || 1000, 1);
    const a = curvePlacementToGroup(c, { x: 0, y: 0 }, c.baselineOffset);
    const b = curvePlacementToGroup(c, { x: 0, y: -ascent }, c.baselineOffset);
    return [a.x, a.y, b.x, b.y];
  }, [caret, attached, font, hbLoaded, parsedCmds.length, glyphs, layout, fontSize, unitsPerEm, arcTable, guideClosed]);
  const pad = attached ? 0 : Math.max(fontSize, 24);
  const hitX = hitBox.x - pad;
  const hitY = hitBox.y - pad;
  const hitWidth = hitBox.width + pad * 2;
  const hitHeight = hitBox.height + pad * 2;

  return (
    <Group
      id={id}
      x={x}
      y={y}
      rotation={rotation}
      draggable={draggable && !locked}
      onClick={onClick}
      onTap={onTap}
      onDblClick={onDblClick}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      opacity={opacity}
    >
      {/* Transparent hit rect for selection/dragging */}
      <Rect
        x={hitX}
        y={hitY}
        width={hitWidth}
        height={hitHeight}
        fill="transparent"
        strokeEnabled={false}
        listening
      />

      <Shape
        x={hitX}
        y={hitY}
        width={hitWidth}
        height={hitHeight}
        listening={false}
        shadowColor={shadowBlur > 0 ? shadowColor : undefined}
        shadowBlur={shadowBlur}
        shadowOffsetX={shadowOffsetX}
        shadowOffsetY={shadowOffsetY}
        shadowOpacity={shadowOpacity}
        sceneFunc={(ctx) => {
          if (!hbLoaded || !font || parsedCmds.length < 2 || curveLen <= 0) return;

          // Auto-fit: the effective size always spans the curve exactly,
          // same idea ShapeFillText already applies per-row to shape width.
          // Computed once, in `curveGlyphPlacements`, which the Next Shape
          // overlay also outlines from.
          if (!layout) return;
          const c2d = ctx as unknown as CanvasRenderingContext2D;

          // Built before the glyph loop, while the ctx is still in the
          // Shape's own space, so one gradient spans the whole curve. Each
          // glyph below is drawn under its own translate+rotate to the
          // tangent, and the painter is what keeps the gradient from
          // rotating with it.
          const painter = createBlockFillPainter(c2d, fill, color, {
            x: curveBox.x - hitX,
            y: curveBox.y - hitY,
            width: curveBox.width,
            height: curveBox.height,
          });

          for (const place of layout.placements) {
            const glyphObj = font.glyphs.get(glyphs[place.glyphIndex].g);
            if (!glyphObj) continue;
            const diacritic = diacriticByIndex.get(place.glyphIndex);
            if (diacritic?.hidden) continue;

            const { x: px, y: py, angle } = place;
            const opPath = glyphObj.getPath(0, 0, place.size);

            c2d.save();
            // Shape is positioned at (hitX, hitY), which Konva already
            // applies as a canvas translation before sceneFunc runs — so
            // glyph positions (in the curve's own, un-offset coordinate
            // space) need that same offset subtracted back out here.
            c2d.translate(px - hitX, py - hitY);
            c2d.rotate(angle);
            c2d.translate(0, baselineOffset);
            if (diacritic) {
              // In the letter's own tilted frame, scaled with the curve's
              // fit, and pivoted on the pen origin like ShapedText's.
              const k = place.size / Math.max(fontSize, 1e-4);
              c2d.translate((diacritic.offsetX ?? 0) * k, (diacritic.offsetY ?? 0) * k);
              const ds = diacritic.scale ?? 1;
              c2d.scale(ds, ds);
            }
            if (isItalic) c2d.transform(1, 0, -0.25, 1, 0, 0);

            c2d.fillStyle = painter.style;
            replayPath(c2d, opPath.commands);

            // Outline before fill — see the same ordering in ShapedText.tsx.
            if (strokeWidth > 0) {
              c2d.strokeStyle = stroke;
              c2d.lineWidth = strokeWidth;
              c2d.stroke();
            }
            painter.fill(c2d);

            c2d.restore();
          }
        }}
      />

      {caretPoints && (
        <Line
          name={EXPORT_HIDDEN}
          points={caretPoints}
          stroke="#d4af37"
          strokeWidth={2}
          lineCap="round"
          listening={false}
        />
      )}

      <AlternateHoverHandles
        isSelected={isSelected}
        enabled={glyphAlternateMode}
        targets={alternateTargets}
        alternates={glyphAlternates}
        onPick={onPickAlternate}
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

export default TextOnPathText;
