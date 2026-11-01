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
 * through `BlockCommon` without reading it, as does a Kufi panel, which draws
 * lattice cells rather than a font's glyphs. Gates the Font panel and the
 * missing-font notices (Content goes by `hasOwnText`), so a removed or added block type is
 * one edit here rather than one per site.
 */
export const hasOwnFont = (
  b: Block
): b is Extract<Block, { type: "text" | "shapeFill" | "textPath" }> =>
  b.type === "text" || b.type === "shapeFill" || b.type === "textPath";

/**
 * The block types whose own `text` is drawn and can be edited in Content:
 * the three font renderers plus the Kufi panel, which packs its text into
 * lattice cells without a font, and the Kufi star, whose text is what
 * Find layouts splits over its regions.
 */
export const hasOwnText = (
  b: Block
): b is Extract<Block, { type: "text" | "shapeFill" | "textPath" | "kufiPanel" | "kufiStar" }> =>
  hasOwnFont(b) || b.type === "kufiPanel" || b.type === "kufiStar";

/**
 * A square-Kufi panel. Every per-glyph tool below (diacritics, stroke cuts,
 * Next Shape, style sets, detached marks) keys off shaped font glyphs, which
 * this block has none of, so each guard leaves it out.
 */
export const isKufiPanel = (b: Block): b is Extract<Block, { type: "kufiPanel" }> =>
  b.type === "kufiPanel";

/** A Kufi star panel: no font, no shaped glyphs, so the same per-glyph tools skip it. */
export const isKufiStar = (b: Block): b is Extract<Block, { type: "kufiStar" }> => b.type === "kufiStar";

/**
 * The block types whose renderers mount `DiacriticHoverHandles`: text, Shape
 * Fill and Curve (where an offset is in the letter's own tilted frame). A
 * mirror, guide or stack inherits `diacriticOverrides` from `BlockCommon`
 * without reading it, so the mutators must not write to them.
 */
export const supportsDiacriticOverrides = (
  b: Block
): b is Extract<Block, { type: "text" | "shapeFill" | "textPath" }> =>
  b.type === "text" || b.type === "shapeFill" || b.type === "textPath";

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
