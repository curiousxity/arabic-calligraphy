import React, { useMemo } from "react";
import { Group, Shape, Rect } from "react-konva";
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
import type { GlyphAlternate } from "../types";
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
  styleSets,
  glyphAlternates = NO_GLYPH_ALTERNATES,
  glyphAlternateMode = false,
  alternateLetters = NO_ALTERNATE_LETTERS,
  onPickAlternate,
  isSelected = false,
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

  const parsedCmds = useMemo(() => parseSvgPath(textPathD || ""), [textPathD]);
  const curveLen = useMemo(() => pathLength(parsedCmds), [parsedCmds]);
  // RTL text anchors to the curve's end point by default (walking the
  // reversed flattened point list); textPathReversed flips that per block.
  const walkReversed = !textPathReversed;
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

  const layout = useMemo(
    () =>
      hbLoaded && font && parsedCmds.length >= 2
        ? curveGlyphPlacements({ glyphs, fontSize, unitsPerEm, curveLen, arcTable })
        : null,
    [hbLoaded, font, parsedCmds.length, glyphs, fontSize, unitsPerEm, curveLen, arcTable]
  );

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
        polygon: corners.map((c) => curvePlacementToGroup(p, c, textPathBaselineOffset)),
        options: byLetter.get(letter)!.options,
      });
    }
    return out;
  }, [glyphAlternateMode, layout, font, alternateLetters, shapableText, glyphs, textPathBaselineOffset]);
  const pad = Math.max(fontSize, 24);
  const hitX = curveBox.x - pad;
  const hitY = curveBox.y - pad;
  const hitWidth = curveBox.width + pad * 2;
  const hitHeight = curveBox.height + pad * 2;

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

            const { x: px, y: py, angle } = place;
            const opPath = glyphObj.getPath(0, 0, place.size);

            c2d.save();
            // Shape is positioned at (hitX, hitY), which Konva already
            // applies as a canvas translation before sceneFunc runs — so
            // glyph positions (in the curve's own, un-offset coordinate
            // space) need that same offset subtracted back out here.
            c2d.translate(px - hitX, py - hitY);
            c2d.rotate(angle);
            c2d.translate(0, textPathBaselineOffset);
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

      <AlternateHoverHandles
        isSelected={isSelected}
        enabled={glyphAlternateMode}
        targets={alternateTargets}
        alternates={glyphAlternates}
        onPick={onPickAlternate}
      />
    </Group>
  );
};

export default TextOnPathText;
