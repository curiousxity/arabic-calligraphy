export type BlockType =
  | "text"
  | "shapeFill"
  | "image"
  | "textPath"
  | "mirror"
  | "squareKufi";
export type FontStyle = "normal" | "bold" | "italic" | "bold italic";
export type TextAlign = "left" | "center" | "right";

/**
 * A per-instance manual adjustment to one shaped diacritic glyph — keyed
 * by glyphIndex, the same scheme GlyphTransform also uses (and shares its
 * known fragility: a text edit before this glyph in the string can shift
 * which glyph index the override lands on after re-shaping).
 */
export type DiacriticOverride = {
  glyphIndex: number;
  /** Multiplier on the diacritic's natural size. Default 1. */
  scale?: number;
  /** Extra vertical shift in local (unscaled) units. Default 0. */
  offsetY?: number;
  /** When true, this instance is skipped entirely during drawing. */
  hidden?: boolean;
};

/**
 * A rigid whole-glyph transform — move and independent x/y scale — keyed
 * by glyphIndex. Distinct from DiacriticOverride (uniform scale + vertical
 * offset, marks only): this moves and scales the finished glyph as a unit.
 *
 * Shares glyphIndex keying with it, including its known fragility: a text
 * edit before this glyph shifts which index the transform lands on after
 * re-shaping. Every glyph is a legitimate target, so unlike DiacriticOverride
 * there is no *inherent* signal to re-check against — which is why the
 * `glyphId` below is recorded and checked instead.
 */
export type GlyphTransform = {
  glyphIndex: number;
  /**
   * The shaped glyph id this transform was created for, used to notice when
   * a text edit has shifted `glyphIndex` onto a different letter — see
   * `ShapedText`'s `activeGlyphTransforms`.
   *
   * Optional on purpose: a transform saved before this field existed cannot
   * be validated, so it keeps the original behaviour of applying to whatever
   * glyph now holds its index rather than being silently discarded.
   */
  glyphId?: number;
  /** Horizontal shift in local (unscaled) units. Default 0. */
  offsetX?: number;
  /** Vertical shift in local (unscaled) units. Default 0. */
  offsetY?: number;
  /** Multiplier on the glyph's natural width. Default 1. */
  scaleX?: number;
  /** Multiplier on the glyph's natural height. Default 1. */
  scaleY?: number;
  /**
   * Turn, in degrees clockwise, about the glyph's own *raw* box centre.
   *
   * Applied inside the scale, so at a non-uniform scale a rotated letter is
   * stretched along the block's axes rather than along its own. That keeps
   * the rotation pivot independent of the scale being dragged — the scale
   * handles snapshot their pivot at drag start, and a pivot that moved with
   * the scale would reintroduce the convergence bug `scaleFromHandleDrag`
   * exists to prevent. Identical either way whenever `scaleX === scaleY`.
   *
   * Optional: absent means no rotation, which is byte-for-byte the rendering
   * that predates the handle.
   */
  rotation?: number;
};

// ---- STREAM-F: ink & surface — BlockFill type ----
// Re-exported from the pure module that owns it, so `types.ts` stays the one
// import site for a block's field types while the gradient maths (and its
// tests) live in `lib/blockFill.ts`.
export type { BlockFill, FillStop } from "./lib/blockFill";
export type { StrokeCut } from "./lib/strokeCuts";
import type { StrokeCut } from "./lib/strokeCuts";
import type { BlockFill } from "./lib/blockFill";
// ---- /STREAM-F ----

type BlockCommon = {
  id: number;
  name?: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontStyle?: FontStyle;
  opacity?: number;
  stroke: string;
  strokeWidth?: number;
  shadowColor: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  locked?: boolean;
  rotation?: number;
  ornamental?: boolean;
  groupId?: number;

  /**
   * Per-instance diacritic adjustments. Lives on BlockCommon rather than
   * TextBlock because plain text and shapeFill blocks both support the
   * on-canvas diacritic handles; image and textPath blocks inherit it
   * unused, an intentional simplification BlockCommon makes throughout.
   */
  diacriticOverrides?: DiacriticOverride[];

  /**
   * Per-glyph rigid move/scale. Plain text blocks only for v1 — the other
   * block types inherit the field unused, the same intentional
   * simplification BlockCommon already makes for diacriticOverrides.
   */
  glyphTransforms?: GlyphTransform[];
  /** Arms the on-canvas move/scale handles. */
  glyphTransformMode?: boolean;

  /**
   * Straight-stroke extensions: a letter's own stroke lengthened by cutting
   * its outline and bridging the gap. Absent means none, so a project saved
   * before this feature renders byte-identically and the payload version
   * needs no bump. Plain text blocks only, the same intentional
   * simplification BlockCommon already makes for glyphTransforms.
   */
  strokeCuts?: StrokeCut[];
  /** Arms the on-canvas stretch handles. */
  strokeCutEditMode?: boolean;

  // ---- STREAM-F: ink & surface — `fill` field on BlockCommon. Absent
  // means the existing flat `color` renders exactly as today. ----
  /**
   * Gradient (or explicit solid) fill for the block's ink.
   *
   * `color` is **not** migrated or removed: a solid fill keeps writing
   * `color` and leaves this undefined, so every block and every saved
   * project that predates this field renders identically. Only a gradient
   * sets it.
   */
  fill?: BlockFill;
  // ---- /STREAM-F ----

  // Shape-import fields, carried by shapeFill blocks. They live on
  // BlockCommon rather than on ShapeFillBlock because the save/load and
  // clipboard paths copy them generically across block types.
  shapeSvgPath?: string;
  shapeWidth?: number;
  shapeHeight?: number;
};

export type TextBlock = BlockCommon & {
  type: "text";
  align?: TextAlign;
  lineHeight?: number;
  warpX?: number;
  warpY?: number;
};

export type ShapeFillBlock = BlockCommon & {
  type: "shapeFill";
  shapeScale?: number;
  shapeFillSpacing?: number;
  shapeFillScaleX?: number;
  shapeFillScaleY?: number;
  shapeFillTextRotation?: number;
  /** Arms the on-canvas diacritic hover handles. Opt-in on shapeFill only: a fill tiles its glyph run across the whole silhouette, so the handles' scanline layout pass and their per-instance hit rects are real cost. */
  diacriticEditMode?: boolean;
};

export type ImageBlock = BlockCommon & {
  type: "image";
  imageDataUrl: string;
  imageScale?: number;
};

export type TextPathBlock = BlockCommon & {
  type: "textPath";
  /** SVG path `d` string defining the curve the text follows. */
  textPathD: string;
  /** Manual override for which end of the curve the text starts from. */
  textPathReversed?: boolean;
  /** Perpendicular offset of the text baseline from the curve; 0 = on the curve. */
  textPathBaselineOffset?: number;
  /** True while the on-canvas pen-tool curve editor is active for this block. */
  textPathEditMode?: boolean;
};

// owner of the `BlockType` union (line 1) and the `Block` union just below
// this phase, and may edit those two lines directly. ----

/** How a mirror block transforms the content it borrows from its source. */
export type MirrorMode = "mirrorX" | "mirrorY" | "radial";

/**
 * A block that draws *another* block's content under a transform — the
 * classical muthanna (a composition and its reflection reading toward each
 * other) and radial medallions.
 *
 * It has no content of its own: `sourceId` is looked up in `blocks` on every
 * render, so editing the source re-renders every copy with no sync machinery.
 * Its position, though, is entirely its own — the transform applies to the
 * source's content, never to the source's place on the canvas.
 *
 * Like every other variant it carries the whole of `BlockCommon`, including
 * the text/font fields no mirror renderer reads. That is the same deliberate
 * simplification `ImageBlock` already makes.
 *
 * A mirror's source may never itself be a mirror — rejected at creation, and
 * re-checked when resolving, which is what keeps the renderer from recursing.
 */
export type MirrorBlock = BlockCommon & {
  type: "mirror";
  /** The block whose content is reflected. Never another mirror. */
  sourceId: number;
  mode: MirrorMode;
  /** Radial only: how many copies around the circle. 2–16, default 6. */
  radialCount?: number;
  /** Radial only: how far each copy sits from the mirror block's origin, in px. */
  radialRadius?: number;
};

/**
 * Square kufi (كوفي مربع): the block's text drawn as strokes on a lattice
 * rather than as shaped glyph outlines.
 *
 * It is the one block type that loads no font — a square-kufi letter *is* its
 * cells, so `fontFamily` is inert here (as `fontSize` already is on a curve),
 * and `fontSize` is read only for how large one lattice cell comes out. The
 * layout, the alphabet and the reasoning behind both live in
 * `lib/squareKufi.ts` and `lib/squareKufiAlphabet.ts`.
 *
 * The three dials below are spacing, not grammar: stroke width and the gap
 * between two joined letters are fixed at one cell, which is what square kufi
 * *is*. `columns` is what turns a running band into a square panel.
 */
export type SquareKufiBlock = BlockCommon & {
  type: "squareKufi";
  /** Wrap width in cells. 0 or absent runs the text as one unbroken band. */
  kufiColumns?: number;
  /** Blank lattice rows between wrapped lines. */
  kufiLineGap?: number;
  /** Blank lattice columns between two words. */
  kufiWordGap?: number;
};

export type Block =
  | TextBlock
  | ShapeFillBlock
  | ImageBlock
  | TextPathBlock
  | MirrorBlock
  | SquareKufiBlock;
