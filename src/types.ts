export type BlockType = "text" | "shapeFill" | "image" | "textPath" | "mirror";
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
 * re-shaping. Unlike DiacriticOverride there is no identity signal to
 * re-check against at render time (every glyph is a legitimate target), so
 * a stale transform simply applies to whatever glyph now holds that index.
 */
export type GlyphTransform = {
  glyphIndex: number;
  /** Horizontal shift in local (unscaled) units. Default 0. */
  offsetX?: number;
  /** Vertical shift in local (unscaled) units. Default 0. */
  offsetY?: number;
  /** Multiplier on the glyph's natural width. Default 1. */
  scaleX?: number;
  /** Multiplier on the glyph's natural height. Default 1. */
  scaleY?: number;
};

// ---- STREAM-F: ink & surface — BlockFill type ----
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

  // ---- STREAM-F: ink & surface — `fill` field on BlockCommon. Absent
  // means the existing flat `color` renders exactly as today. ----
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

export type Block = TextBlock | ShapeFillBlock | ImageBlock | TextPathBlock | MirrorBlock;
