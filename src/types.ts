export type BlockType =
  | "text"
  | "shapeFill"
  | "textPath"
  | "mirror"
  | "guide"
  | "stack";
export type FontStyle = "normal" | "bold" | "italic" | "bold italic";
export type TextAlign = "left" | "center" | "right";

/**
 * A per-instance manual adjustment to one shaped diacritic glyph — keyed
 * by glyphIndex, which has a known fragility: a text edit before this glyph
 * in the string can shift which glyph index the override lands on after
 * re-shaping.
 */
export type DiacriticOverride = {
  glyphIndex: number;
  /** Multiplier on the diacritic's natural size. Default 1. */
  scale?: number;
  /** Extra horizontal shift in local (unscaled) units. Default 0. */
  offsetX?: number;
  /** Extra vertical shift in local (unscaled) units. Default 0. */
  offsetY?: number;
  /** When true, this instance is skipped entirely during drawing. */
  hidden?: boolean;
};

export type GlyphAlternate = {
  /** Index among the text's characters, skipping tatweel (U+0640) and combining marks. */
  letter: number;
  /** The character at that letter when the choice was made — a checksum. */
  char: string;
  /** OpenType feature tag, e.g. "ss01", "salt", "jalt". */
  feature: string;
  /** 1 for on/off features; the alternate's index for salt/aalt/jalt/swsh. */
  value: number;
};

// ---- STREAM-F: ink & surface — BlockFill type ----
// Re-exported from the pure module that owns it, so `types.ts` stays the one
// import site for a block's field types while the gradient maths (and its
// tests) live in `lib/blockFill.ts`.
export type { BlockFill, FillStop } from "./lib/blockFill";
export type { StrokeCut } from "./lib/strokeCuts";
export type { DetachedMarkOverride } from "./lib/detachedMarks";
import type { StrokeCut } from "./lib/strokeCuts";
import type { DetachedMarkOverride } from "./lib/detachedMarks";
import type { BlockFill } from "./lib/blockFill";
import type { SvgCmd } from "./lib/svgPath";
import type { Pt } from "./lib/strokeCuts";
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
  groupId?: number;

  /**
   * Per-instance diacritic adjustments. Lives on BlockCommon rather than
   * TextBlock because plain text and shapeFill blocks both support the
   * on-canvas diacritic handles; textPath blocks inherit it unused, an
   * intentional simplification BlockCommon makes throughout.
   */
  diacriticOverrides?: DiacriticOverride[];

  /**
   * Straight-stroke extensions: a letter's own stroke lengthened by cutting
   * its outline and bridging the gap. Absent means none, so a project saved
   * before this feature renders byte-identically and the payload version
   * needs no bump. Plain text blocks only, the same intentional
   * simplification BlockCommon already makes for diacriticOverrides.
   */
  strokeCuts?: StrokeCut[];
  /** Arms the on-canvas stretch handles. */
  strokeCutEditMode?: boolean;
  /**
   * A letter's dots, hamza or kaf stroke moved off their drawn position.
   * Absent means none, so an older save renders byte-identically. Text and
   * Shape Fill — see `supportsDetachedMarks`.
   */
  detachedMarkOverrides?: DetachedMarkOverride[];
  /** Arms the on-canvas "Move dots & marks" handles. */
  detachedMarkEditMode?: boolean;
  /**
   * Per-letter OpenType alternates ("Next Shape"). Absent means default
   * shapes, so an older save renders byte-identically. Plain text blocks
   * only — see `supportsGlyphAlternates`.
   */
  glyphAlternates?: GlyphAlternate[];
  /** Arms the on-canvas Next Shape tool. */
  glyphAlternateMode?: boolean;
  /**
   * Block-level OpenType style sets (`ss01`–`ss20`) applied to every letter;
   * a letter with its own `glyphAlternates` entry overrides them. Absent
   * means none. Text, Shape Fill and Curve blocks — see `supportsStyleSets`.
   */
  styleSets?: string[];

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

export type VerseLayout = "stacked" | "bayt";

/** A text block's membership in a verse. See `.claude/rules/verse.md`. */
export type VerseTag = {
  /** Shared by every line of one verse. */
  id: number;
  /** Reading order, 0-based. */
  index: number;
  layout: VerseLayout;
  /** Target width in px; absent = the widest line's natural width. */
  width?: number;
  /** Row pitch, × line 0's base font size. */
  lineGap: number;
  /** Bayt gutter between the two misra', × line 0's base font size. */
  columnGap: number;
  /** The size before any shrink-to-fit. */
  baseFontSize: number;
  /** The size the last Justify wrote; a different `fontSize` means the user changed it. */
  fittedFontSize: number;
  /**
   * The user's own spacing, and the totals the last Justify wrote (theirs plus
   * its fill). A block whose spacing still equals the fitted total is
   * re-justified from the stored base; one that differs was set by the user
   * (slider, reset, applied style) and that value becomes the base. Storing
   * the base outright, rather than subtracting the fill back off, is what
   * keeps an absolute write from turning into a negative base.
   */
  baseLetterSpacing: number;
  baseWordSpacing: number;
  fittedLetterSpacing: number;
  fittedWordSpacing: number;
};

/** The verse-wide part of a tag — what the Verse panel edits. */
export type VerseSettings = Pick<VerseTag, "layout" | "width" | "lineGap" | "columnGap">;

export type TextBlock = BlockCommon & {
  type: "text";
  align?: TextAlign;
  lineHeight?: number;
  /** Space at gaps between a word's pieces, as a fraction of font size. Absent = 0. See lib/spacing.ts. */
  letterSpacing?: number;
  /** Space at word gaps, as a fraction of font size. Absent = 0. */
  wordSpacing?: number;
  /** Set when this block is a line of a verse; see .claude/rules/verse.md. */
  verse?: VerseTag;
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
  /**
   * Set when this text is attached to a guide: the guide's path replaces
   * `textPathD` and the text keeps its own size. See .claude/rules/guides.md.
   */
  guide?: GuideAttachment;
};

export type GuideShape = "circle" | "ellipse" | "arc" | "wave" | "line" | "pen" | "teardrop" | "almond" | "svg";
export type GuideParams = { width?: number; height?: number; sweep?: number; amplitude?: number };

/** A dashed construction path that Curve text can attach to; never exported. */
export type GuideBlock = BlockCommon & {
  type: "guide";
  /** SVG path in the block's local space, centred on its origin. */
  guideD: string;
  guideShape: GuideShape;
  /** What the Guide panel edits; `guideD` is regenerated from it (never for pen). */
  guideParams?: GuideParams;
  /** Pen point editing active (pen guides only). */
  guideEditMode?: boolean;
  /** Uploaded-SVG guides: the outline as uploaded, centred on the origin at
   *  its natural size. `guideD` is it scaled to `guideParams.width`. */
  guideSvgD?: string;
};

/** The two outline points on a cut line and the stroke's outward direction
 *  there (radians, pointing away from the piece), piece-local font units. */
export type CutFace = { a: Pt; b: Pt; tangent: number };

export type StackPiece = {
  id: string;
  /** Closed contours, piece-local font units, cut faces closed by a straight
   *  bridge edge between `face.a` and `face.b`. */
  cmds: SvgCmd[];
  /** Placement relative to the block origin, font units. */
  x: number;
  y: number;
  /** Radians, about `pivot`. */
  rotation: number;
  /** Piece-local point the rotation turns about — the outline centre when
   *  the piece was made. Stored, not derived: a later split would move it. */
  pivot: Pt;
  /** Where "Reset layout" returns the piece to. */
  homeX: number;
  homeY: number;
  /** Reading order; a drag carries every piece with a greater order. */
  order: number;
  role: "letter" | "mark";
  /** Marks: the letter they ride with. */
  parentId?: string;
  /** Placed by "Fill a guide shape" to busy the gaps (tashkeel, ornaments);
   *  stripped on re-run and on Reset layout. */
  filler?: true;
  faces: CutFace[];
};

export type StackJoin = {
  id: string;
  from: { pieceId: string; faceIndex: number };
  to: { pieceId: string; faceIndex: number };
  /** Asymmetry of the curve's two handles (A's is chord/3·(1+depth+bow), B's
   *  chord/3·(1+depth−bow)): swings an S-shaped join. 0 is the tangent-matched
   *  default. */
  bow: number;
  /** Common lengthening of both handles: rounds out a U-shaped join. Absent = 0. */
  depth?: number;
  /** Width multipliers at even parameters along the curve, 1 = the linear
   *  interpolation of the two faces. Absent = linear (every join today). A
   *  curve converted from a letter carries its own sampled width here. */
  profile?: number[];
  /** The bend double-click returns to. Absent = { bow: 0, depth: 0 }. A
   *  curve converted from a letter rests at the bend that reproduces it. */
  rest?: { bow: number; depth: number };
  /** Made from an inserted tatweel rather than a cut in the letter. */
  fallback?: true;
};

/** A text block baked into movable letter pieces joined by synthesised
 *  curves. One-way; the spelling cannot be edited. */
export type StackBlock = BlockCommon & {
  type: "stack";
  source: { text: string; fontFamily: string };
  unitsPerEm: number;
  nib: { width: number; minFraction: number };
  pieces: StackPiece[];
  joins: StackJoin[];
};

export type GuideAttachment = {
  /** The guide block's id. */
  id: number;
  /** 0..1 along the guide, in its un-flipped direction. */
  offset: number;
  align: "start" | "center" | "end";
  side: "outside" | "inside";
  flip: boolean;
  /** Distance from the line, × font size. */
  gap: number;
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
 * simplification `BlockCommon` makes throughout.
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

export type Block =
  | TextBlock
  | ShapeFillBlock
  | TextPathBlock
  | MirrorBlock
  | GuideBlock
  | StackBlock;
