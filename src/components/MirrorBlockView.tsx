import React, { useEffect, useMemo, useRef, useState } from "react";
import { Group, Rect } from "react-konva";
import type Konva from "konva";
import { ShapedText } from "./ShapedText";
import { ShapeFillText } from "./ShapeFillText";
import { TextOnPathText } from "./TextOnPathText";
import { ImageBlockView } from "./ImageBlockView";
import { radialCopyTransforms, type MirrorSource } from "../lib/mirror";
import type { MirrorMode } from "../types";

export type MirrorBlockViewProps = {
  id?: string;
  /**
   * The block being reflected, straight out of App state. Rendering from it
   * every frame is what keeps a mirror live: an edit to the source produces a
   * new block object, which re-renders every copy with no sync machinery.
   * `null` when the source is gone — nothing is drawn, and App's orphan pass
   * removes the block shortly after.
   */
  source: MirrorSource | null;
  mode: MirrorMode;
  radialCount?: number;
  radialRadius?: number;
  x: number;
  y: number;
  rotation?: number;
  opacity?: number;
  locked?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
};

type Box = { x: number; y: number; width: number; height: number };

/** The grab area before the content has been measured — small, but never zero. */
const FALLBACK_HIT: Box = { x: -30, y: -30, width: 60, height: 60 };

/** Frames the measured box must hold still before the settle loop stops. */
const SETTLE_FRAMES = 4;
/** Hard cap on the settle loop, so a permanently-unstable source can't spin forever. */
const MAX_SETTLE_FRAMES = 150;
/** Sub-pixel differences aren't worth a re-render. */
const BOX_EPSILON = 0.5;

const boxesMatch = (a: Box | null, b: Box | null) =>
  !!a &&
  !!b &&
  Math.abs(a.x - b.x) < BOX_EPSILON &&
  Math.abs(a.y - b.y) < BOX_EPSILON &&
  Math.abs(a.width - b.width) < BOX_EPSILON &&
  Math.abs(a.height - b.height) < BOX_EPSILON;

/**
 * Draws another block's content under a reflection or a radial repetition —
 * muthanna and medallion compositions.
 *
 * It mounts the *source's own renderer* rather than reimplementing any of
 * them, which is what makes every block type mirrorable for free and keeps
 * the four render algorithms CLAUDE.md deliberately refuses to merge exactly
 * as they are. The copies are drawn at the source's local origin; the
 * mirror's own `x`/`y` place them, because a mirror is an independent object
 * on the canvas and only borrows the source's *content*.
 */
export const MirrorBlockView: React.FC<MirrorBlockViewProps> = ({
  id,
  source,
  mode,
  radialCount,
  radialRadius,
  x,
  y,
  rotation = 0,
  opacity = 1,
  locked,
  draggable,
  onClick,
  onTap,
  onDblClick,
  onDragMove,
  onDragEnd,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const contentRef = useRef<Konva.Group>(null);
  const [hitBox, setHitBox] = useState<Box | null>(null);

  // The source's renderer, drawn at the mirror's local origin and stripped of
  // everything interactive: no drag handlers, no `isSelected`, and none of the
  // per-glyph hover overlays' arming props, so no handle can ever mount inside
  // a mirror. The `listening={false}` wrapper below is the belt to this
  // braces — a Konva node is non-listening if any ancestor is.
  const copy = useMemo(() => {
    if (!source) return null;
    const common = {
      x: 0,
      y: 0,
      opacity: 1,
      rotation: source.rotation ?? 0,
      locked: true,
      draggable: false,
    };
    if (source.type === "image") {
      return (
        <ImageBlockView
          {...common}
          imageDataUrl={source.imageDataUrl}
          imageWidth={source.shapeWidth ?? 300}
          imageHeight={source.shapeHeight ?? 300}
          imageScale={source.imageScale ?? 1}
        />
      );
    }
    const typographic = {
      ...common,
      text: source.text,
      fontSize: source.fontSize,
      color: source.color,
      fill: source.fill,
      fontFamily: source.fontFamily,
      fontStyle: source.fontStyle ?? ("normal" as const),
      stroke: source.stroke,
      strokeWidth: source.strokeWidth ?? 0,
      shadowColor: source.shadowColor,
      shadowBlur: source.shadowBlur ?? 0,
      shadowOffsetX: source.shadowOffsetX ?? 0,
      shadowOffsetY: source.shadowOffsetY ?? 0,
      shadowOpacity: source.shadowOpacity ?? 0.35,
    };
    if (source.type === "shapeFill") {
      return (
        <ShapeFillText
          {...typographic}
          shapeSvgPath={source.shapeSvgPath ?? ""}
          shapeWidth={source.shapeWidth ?? 400}
          shapeHeight={source.shapeHeight ?? 400}
          shapeScale={source.shapeScale ?? 1}
          shapeFillSpacing={source.shapeFillSpacing ?? 1.3}
          shapeFillScaleX={source.shapeFillScaleX ?? 1}
          shapeFillScaleY={source.shapeFillScaleY ?? 1}
          shapeFillTextRotation={source.shapeFillTextRotation ?? 0}
          diacriticOverrides={source.diacriticOverrides ?? []}
          diacriticEditMode={false}
        />
      );
    }
    if (source.type === "textPath") {
      return (
        <TextOnPathText
          {...typographic}
          textPathD={source.textPathD}
          textPathReversed={source.textPathReversed ?? false}
          textPathBaselineOffset={source.textPathBaselineOffset ?? 0}
        />
      );
    }
    return (
      <ShapedText
        {...typographic}
        align={source.align ?? "center"}
        lineHeight={source.lineHeight ?? 1.2}
        warpX={source.warpX ?? 0}
        warpY={source.warpY ?? 0}
        diacriticOverrides={source.diacriticOverrides ?? []}
        glyphTransforms={source.glyphTransforms}
        glyphTransformMode={false}
      />
    );
  }, [source]);

  const radialCopies = useMemo(
    () => (mode === "radial" ? radialCopyTransforms(radialCount, radialRadius) : null),
    [mode, radialCount, radialRadius]
  );

  // The content is non-listening, so the mirror needs a hit rect of its own to
  // be clickable and draggable — and its size can only come from measuring
  // what actually got drawn.
  //
  // A plain effect isn't enough: shaping is async (HarfBuzz WASM plus a font
  // fetch) and completes inside the *child*, which never re-runs a parent
  // effect. So this settles instead — it re-measures each frame until the box
  // has held still for a few frames, then stops. Bounded on both ends, and it
  // restarts whenever the source or the transform changes.
  useEffect(() => {
    let frames = 0;
    let stable = 0;
    let last: Box | null = null;
    let handle = 0;

    const tick = () => {
      const content = contentRef.current;
      const group = groupRef.current;
      if (content && group) {
        const measured = content.getClientRect({
          relativeTo: group,
          skipShadow: true,
          skipStroke: true,
        });
        if (measured.width > 0 && measured.height > 0) {
          if (boxesMatch(last, measured)) {
            stable += 1;
          } else {
            stable = 0;
            setHitBox((prev) => (boxesMatch(prev, measured) ? prev : measured));
          }
          last = measured;
        }
      }
      frames += 1;
      if (stable < SETTLE_FRAMES && frames < MAX_SETTLE_FRAMES) {
        handle = requestAnimationFrame(tick);
      }
    };

    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [source, mode, radialCount, radialRadius]);

  const hit = hitBox ?? FALLBACK_HIT;

  return (
    <Group
      id={id}
      ref={groupRef}
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
      {/* The mirror's whole drag surface — see the settle loop above. */}
      <Rect
        name="mirror-hit"
        x={hit.x}
        y={hit.y}
        width={hit.width}
        height={hit.height}
        fill="transparent"
        strokeEnabled={false}
        listening
      />

      <Group ref={contentRef} listening={false}>
        {radialCopies
          ? radialCopies.map((t, i) => (
              <Group key={i} x={t.x} y={t.y} rotation={t.rotation}>
                {copy}
              </Group>
            ))
          : copy && (
              <Group scaleX={mode === "mirrorX" ? -1 : 1} scaleY={mode === "mirrorY" ? -1 : 1}>
                {copy}
              </Group>
            )}
      </Group>
    </Group>
  );
};
