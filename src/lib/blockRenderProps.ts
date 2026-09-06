import type { Block } from "../types";

/**
 * What a block's own fields say about how to draw it, per block type.
 *
 * Two places render a block's content: `CanvasStage`, on the ordinary path,
 * and `MirrorBlockView`, which mounts the *source's* renderer inside its
 * transform wrapper. Both were mapping block fields to renderer props by
 * hand, and the second had silently dropped a field four separate times —
 * `fill`, `strokeCuts`, `glyphTransforms`, `kufiComposition`/`kufiCellEdits`
 * — each fixed by adding the one line that was missed, with nothing to stop
 * a fifth. The failure is invisible on the ordinary path: `CanvasStage`
 * looks right, and only the mirror draws the wrong thing.
 *
 * So the mapping lives here once. A caller spreads the builder for the type
 * it is rendering and adds only what is genuinely its own: position, opacity
 * and the interaction handlers on the canvas; the fixed position, the
 * `locked`/`draggable` overrides and the arming flags turned off in a
 * mirror. A new `BlockCommon` field a renderer reads is then one edit here
 * and it reaches both.
 *
 * Deliberately **not** included: `x`/`y`, `opacity`, `isSelected`, `locked`,
 * `draggable`, every `on*` callback, and every `*EditMode` arming flag. Those
 * are exactly the things the two callers must disagree about — a mirror is
 * pinned at its wrapper's origin, is never selected, and can never edit.
 */

/** Styling shared by all four text-bearing renderers. */
export function typographicProps(b: Block) {
  return {
    text: b.text,
    fontSize: b.fontSize,
    color: b.color,
    fill: b.fill,
    fontFamily: b.fontFamily,
    fontStyle: b.fontStyle ?? ("normal" as const),
    stroke: b.stroke,
    strokeWidth: b.strokeWidth ?? 0,
    shadowColor: b.shadowColor,
    shadowBlur: b.shadowBlur ?? 0,
    shadowOffsetX: b.shadowOffsetX ?? 0,
    shadowOffsetY: b.shadowOffsetY ?? 0,
    shadowOpacity: b.shadowOpacity ?? 0.35,
    rotation: b.rotation ?? 0,
  };
}

/** A plain text block, for `ShapedText`. */
export function shapedTextProps(b: Extract<Block, { type: "text" }>) {
  return {
    ...typographicProps(b),
    align: b.align ?? ("center" as const),
    lineHeight: b.lineHeight ?? 1.2,
    warpX: b.warpX ?? 0,
    warpY: b.warpY ?? 0,
    diacriticOverrides: b.diacriticOverrides,
    glyphTransforms: b.glyphTransforms,
    strokeCuts: b.strokeCuts,
  };
}

/** A shape-fill block, for `ShapeFillText`. */
export function shapeFillProps(b: Extract<Block, { type: "shapeFill" }>) {
  return {
    ...typographicProps(b),
    shapeSvgPath: b.shapeSvgPath ?? "",
    shapeWidth: b.shapeWidth ?? 400,
    shapeHeight: b.shapeHeight ?? 400,
    shapeScale: b.shapeScale ?? 1,
    shapeFillSpacing: b.shapeFillSpacing ?? 1.3,
    shapeFillScaleX: b.shapeFillScaleX ?? 1,
    shapeFillScaleY: b.shapeFillScaleY ?? 1,
    shapeFillTextRotation: b.shapeFillTextRotation ?? 0,
    diacriticOverrides: b.diacriticOverrides,
    glyphTransforms: b.glyphTransforms,
  };
}

/** A square-kufi block, for `SquareKufiText`. */
export function squareKufiProps(b: Extract<Block, { type: "squareKufi" }>) {
  return {
    ...typographicProps(b),
    kufiColumns: b.kufiColumns,
    kufiComposition: b.kufiComposition,
    kufiLineGap: b.kufiLineGap,
    kufiWordGap: b.kufiWordGap,
    kufiCellEdits: b.kufiCellEdits,
  };
}

/** A text-on-path block, for `TextOnPathText`. */
export function textPathProps(b: Extract<Block, { type: "textPath" }>) {
  return {
    ...typographicProps(b),
    textPathD: b.textPathD,
    textPathReversed: b.textPathReversed ?? false,
    textPathBaselineOffset: b.textPathBaselineOffset ?? 0,
  };
}

/** An image block, for `ImageBlockView`. */
export function imageProps(b: Extract<Block, { type: "image" }>) {
  return {
    imageDataUrl: b.imageDataUrl,
    imageWidth: b.shapeWidth ?? 300,
    imageHeight: b.shapeHeight ?? 300,
    imageScale: b.imageScale ?? 1,
    rotation: b.rotation ?? 0,
  };
}
