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
 * `runStyleForBlock` and `filterActiveGlyphTransforms`. Each predicate below
 * narrows to the variants whose renderer really reads the field, so widening
 * a capability is one edit here.
 */

/**
 * The block types whose renderers mount `DiacriticHoverHandles`. `image` and
 * `textPath` blocks inherit `diacriticOverrides` from `BlockCommon` but have
 * no way to edit or apply it, so the mutators must not write to them.
 */
export const supportsDiacriticOverrides = (
  b: Block
): b is Extract<Block, { type: "text" | "shapeFill" }> =>
  b.type === "text" || b.type === "shapeFill";

/**
 * The two block types whose renderers mount `GlyphTransformHoverHandles` and
 * apply the transform in their draw loop. `image`, `textPath`, `squareKufi`
 * and `mirror` carry `glyphTransforms`/`glyphTransformMode` via `BlockCommon`
 * but no renderer of theirs reads them, so accepting an edit there would
 * silently discard it.
 */
export const supportsGlyphTransforms = (
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
 * Square-kufi blocks only — the fields live on `SquareKufiBlock` rather than
 * on `BlockCommon`, so this is the guard that makes the cell mutators
 * type-check against the one variant that can draw a cell.
 */
export const supportsKufiCellEdits = (
  b: Block
): b is Extract<Block, { type: "squareKufi" }> => b.type === "squareKufi";
