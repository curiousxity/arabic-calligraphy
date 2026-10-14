import type { Block, GuideAttachment, GuideBlock, TextBlock, TextPathBlock } from "../types";
import { DEFAULT_ATTACHMENT } from "./guidePlacement";
import { isClosedPath } from "./guideShapes";
import { parseSvgPath } from "./svgPath";

/**
 * Guide bookkeeping. Pure: attach, detach, delete-with-detach, orphans.
 * A detached text keeps the guide's path as its own curve, so nothing a
 * user attached ever disappears with a guide. See .claude/rules/guides.md.
 */

/** Ascent used when baking a hang offset without font metrics (see guides.md). */
export const DETACH_ASCENT = 0.8;
export const ATTACHED_TEXT_DEFAULT = "نص على الدليل";

/** The font size a text written on a guide opens with when no text block exists to copy. */
export const ATTACHED_TEXT_FONT_SIZE = 53;

/**
 * Typing on a guide. Opened by a double-click on a guide or a key pressed
 * with one selected; the text block is created by the first letter, so an
 * abandoned session leaves nothing behind. Until then `textId` is null and
 * the caret is drawn at `attachment` on the guide. See .claude/rules/guides.md.
 */
export type WritingSession = {
  guideId: number;
  textId: number | null;
  /** Where a new run grows from. */
  attachment: Omit<GuideAttachment, "id">;
  /** The size the new text will open with, for the pre-text caret. */
  fontSize: number;
};

/** A shallow copy of `obj` without `keys` — removes them, which a spread patch cannot. */
function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

export const guidesIn = (blocks: readonly Block[]): GuideBlock[] =>
  blocks.filter((b): b is GuideBlock => b.type === "guide");

export const attachedTo = (blocks: readonly Block[], guideId: number): TextPathBlock[] =>
  blocks.filter((b): b is TextPathBlock => b.type === "textPath" && b.guide?.id === guideId);

export function detachFromGuide(text: TextPathBlock, guide: GuideBlock): TextPathBlock {
  const a = text.guide;
  const hang = a ? (a.side === "inside") !== a.flip : false;
  const gap = (a?.gap ?? 0) * text.fontSize;
  return {
    ...omit(text, ["guide"]),
    textPathD: guide.guideD,
    x: guide.x,
    y: guide.y,
    rotation: guide.rotation ?? 0,
    // TextOnPathText walks reversed when textPathReversed is false; an
    // unflipped attachment walks forward, so it needs `true`.
    textPathReversed: !(a?.flip ?? false),
    textPathBaselineOffset: hang ? DETACH_ASCENT * text.fontSize + gap : -gap,
  };
}

export function deleteBlocksDetachingGuides(blocks: readonly Block[], ids: ReadonlySet<number>): Block[] {
  const dying = new Map(guidesIn(blocks).filter((g) => ids.has(g.id)).map((g) => [g.id, g]));
  return blocks
    .filter((b) => !ids.has(b.id))
    .map((b) => {
      if (b.type !== "textPath" || !b.guide) return b;
      const g = dying.get(b.guide.id);
      return g ? detachFromGuide(b, g) : b;
    });
}

export function hasOrphanedAttachments(blocks: readonly Block[]): boolean {
  const ids = new Set(guidesIn(blocks).map((g) => g.id));
  return blocks.some((b) => b.type === "textPath" && b.guide !== undefined && !ids.has(b.guide.id));
}

/** An attachment whose guide is gone becomes a plain Curve block on its last-known curve. */
export function dropOrphanedAttachments(blocks: readonly Block[]): Block[] {
  const ids = new Set(guidesIn(blocks).map((g) => g.id));
  return blocks.map((b) =>
    b.type !== "textPath" || !b.guide || ids.has(b.guide.id) ? b : omit(b, ["guide"])
  );
}

/** Text-block-only fields that have no meaning on a curve. */
const TEXT_ONLY_FIELDS = [
  "type",
  "align",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "verse",
  "diacriticOverrides",
  "strokeCuts",
  "strokeCutEditMode",
  "detachedMarkOverrides",
  "detachedMarkEditMode",
] as const;

export function attachTextToGuide(
  text: TextBlock,
  guide: GuideBlock
): { block: TextPathBlock; dropped: string[] } {
  const dropped: string[] = [];
  if (text.diacriticOverrides?.length) dropped.push("diacritic moves");
  if (text.strokeCuts?.length) dropped.push("stroke cuts");
  if (text.detachedMarkOverrides?.length) dropped.push("dot and mark moves");
  if (text.letterSpacing || text.wordSpacing) dropped.push("letter and word spacing");
  if (text.verse) dropped.push("verse membership");
  return {
    block: {
      ...omit(text, TEXT_ONLY_FIELDS),
      type: "textPath",
      textPathD: guide.guideD,
      guide: { id: guide.id, ...DEFAULT_ATTACHMENT },
    },
    dropped,
  };
}

export function newAttachedText(id: number, guide: GuideBlock, style: Partial<Block>): TextPathBlock {
  return {
    text: ATTACHED_TEXT_DEFAULT,
    fontSize: ATTACHED_TEXT_FONT_SIZE,
    color: "#1e3a5f",
    fontFamily: "FatemiMaqala",
    stroke: "#000000",
    shadowColor: "#000000",
    ...(style as Partial<TextPathBlock>),
    id,
    x: guide.x,
    y: guide.y,
    type: "textPath",
    textPathD: guide.guideD,
    guide: { id: guide.id, ...DEFAULT_ATTACHMENT },
  };
}

/** The guide an attached text draws on, in the form its renderer needs; null when gone. */
export function resolveGuidePath(
  blocks: readonly Block[],
  b: TextPathBlock
): { d: string; closed: boolean; x: number; y: number; rotation: number } | null {
  const ref = b.guide;
  if (!ref) return null;
  const g = blocks.find((x): x is GuideBlock => x.type === "guide" && x.id === ref.id);
  if (!g) return null;
  return { d: g.guideD, closed: isClosedPath(parseSvgPath(g.guideD)), x: g.x, y: g.y, rotation: g.rotation ?? 0 };
}

/** Blocks that count toward an export's crop: everything but guides, which are never drawn there. */
export const exportableBlocks = (blocks: readonly Block[]): Block[] => blocks.filter((b) => b.type !== "guide");

/**
 * Keeps every attached text's own geometry — x/y/rotation, curve, walk
 * direction and side offset — equal to what it draws on its guide. Those
 * fields are ignored while attached, but everything that reads a block
 * generically (co-moving drags, mirrors, snapping, and above all the orphan
 * fallback after a guide vanishes) sees them, so they must never go stale.
 * Returns `blocks` itself when nothing changed, so an effect can bail.
 */
export function syncAttachedToGuides(blocks: readonly Block[]): Block[] {
  const byId = new Map(guidesIn(blocks).map((g) => [g.id, g]));
  let changed = false;
  const out = blocks.map((b) => {
    if (b.type !== "textPath" || !b.guide) return b;
    const g = byId.get(b.guide.id);
    if (!g) return b;
    const baked = detachFromGuide(b, g);
    if (
      b.x === baked.x &&
      b.y === baked.y &&
      (b.rotation ?? 0) === baked.rotation &&
      b.textPathD === baked.textPathD &&
      b.textPathReversed === baked.textPathReversed &&
      b.textPathBaselineOffset === baked.textPathBaselineOffset
    ) {
      return b;
    }
    changed = true;
    return { ...baked, guide: b.guide };
  });
  return changed ? out : (blocks as Block[]);
}

/**
 * A reorder that also removed blocks (the Layers panel's delete goes through
 * reorder) must detach the texts of any guide it removed, exactly as
 * `deleteBlocksDetachingGuides` does. A pure reorder is passed through.
 */
export function reorderDetachingGuides(prev: readonly Block[], next: Block[]): Block[] {
  const kept = new Set(next.map((b) => b.id));
  const removedGuides = new Map(guidesIn(prev).filter((g) => !kept.has(g.id)).map((g) => [g.id, g]));
  if (removedGuides.size === 0) return next;
  return next.map((b) => {
    if (b.type !== "textPath" || !b.guide) return b;
    const g = removedGuides.get(b.guide.id);
    return g ? detachFromGuide(b, g) : b;
  });
}
