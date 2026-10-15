import type { Block } from "../types";

/**
 * Which per-block-type tools a block can actually accept an edit from.
 *
 * These live here, not in `App.tsx`, because the same rule is needed in two
 * places at once: the state layer, whose mutators must refuse a write that no
 * renderer would read, and the Sidebar, which must not offer a checkbox that
 * arms nothing. Written out longhand in the second place, a capability widens
 * in one and silently not the other — both still compile, and the failure is
 * a tool with no way to arm it, or a checkbox whose dots move nothing.
 *
 * That is the trap CLAUDE.md already records twice, against
 * `runStyleForBlock` and `supportsDiacriticOverrides`. Each predicate below
 * narrows to the variants whose renderer really reads the field, so widening
 * a capability is one edit here.
 */

/**
 * The block types that shape text in a font of their own: text, Shape Fill
 * and Curve. A mirror draws its source, a guide is a path, and a stacked
 * composition is a bake nothing re-shapes — all three carry `fontFamily`
 * through `BlockCommon` without reading it. Gates the Font and Content
 * panels and the missing-font notices, so a removed or added block type is
 * one edit here rather than one per site.
 */
export const hasOwnFont = (
  b: Block
): b is Extract<Block, { type: "text" | "shapeFill" | "textPath" }> =>
  b.type === "text" || b.type === "shapeFill" || b.type === "textPath";

/**
 * The block types whose renderers mount `DiacriticHoverHandles`. `textPath`
 * blocks inherit `diacriticOverrides` from `BlockCommon` but have no way to
 * edit or apply it, so the mutators must not write to them.
 */
export const supportsDiacriticOverrides = (
  b: Block
): b is Extract<Block, { type: "text" | "shapeFill" }> =>
  b.type === "text" || b.type === "shapeFill";

/**
 * Plain text blocks only: every block type carries `strokeCuts` via
 * `BlockCommon`, but only `ShapedText` performs the outline surgery, so a
 * wider guard would accept edits and silently discard them.
 */
export const supportsStrokeCuts = (
  b: Block
): b is Extract<Block, { type: "text" }> => b.type === "text";

/**
 * The block types whose renderers shape with `glyphAlternates` and mount
 * the Next Shape overlay: text, Shape Fill (one pick applies to every tile)
 * and Curve. The field sits on `BlockCommon`, so widening this guard is what
 * turns the feature on — and a renderer that does not read the field would
 * still type-check while silently discarding every pick.
 */
export const supportsGlyphAlternates = (
  b: Block
): b is Extract<Block, { type: "text" | "shapeFill" | "textPath" }> =>
  b.type === "text" || b.type === "shapeFill" || b.type === "textPath";

/**
 * Block-level style sets need no on-canvas hit-testing, only shaping, so
 * every renderer that shapes through `useShapedGlyphs` honours them: text,
 * Shape Fill and Curve.
 */
export const supportsStyleSets = (
  b: Block
): b is Extract<Block, { type: "text" | "shapeFill" | "textPath" }> =>
  b.type === "text" || b.type === "shapeFill" || b.type === "textPath";

/**
 * Text and Shape Fill: the two renderers that split a glyph's contours and
 * mount `DetachedMarkHoverHandles`. The fields sit on `BlockCommon`, so a
 * wider guard would accept edits that nothing draws.
 */
export const supportsDetachedMarks = (
  b: Block
): b is Extract<Block, { type: "text" | "shapeFill" }> =>
  b.type === "text" || b.type === "shapeFill";

export const isStackBlock = (b: Block): b is Extract<Block, { type: "stack" }> =>
  b.type === "stack";
