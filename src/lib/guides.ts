import type { Block, GuideBlock, TextBlock, TextPathBlock } from "../types";
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
] as const;

export function attachTextToGuide(
  text: TextBlock,
  guide: GuideBlock
): { block: TextPathBlock; dropped: string[] } {
  const dropped: string[] = [];
  if (text.diacriticOverrides?.length) dropped.push("diacritic moves");
  if (text.strokeCuts?.length) dropped.push("stroke cuts");
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
    fontSize: 53,
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
