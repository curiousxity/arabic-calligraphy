import type { Block, MirrorBlock, MirrorMode } from "../types";

/**
 * The pure half of the muthanna / radial feature: everything about a mirror
 * block that can be decided without Konva or React. `MirrorBlockView.tsx`
 * mounts the source's own renderer inside the transforms this module
 * computes; `App.tsx` uses the resolution and orphan helpers.
 */

export const RADIAL_COUNT_MIN = 2;
export const RADIAL_COUNT_MAX = 16;
export const DEFAULT_RADIAL_COUNT = 6;
export const DEFAULT_RADIAL_RADIUS = 120;

/**
 * How far a freshly-created mirror is placed from its source. A pure module
 * cannot measure the source's rendered width, so this is a fixed nudge that
 * only has to be big enough that the new block is visibly its own object —
 * the user drags it into place, which is the whole point of the mirror
 * carrying its own position.
 */
export const NEW_MIRROR_OFFSET = 180;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** A block that may legally be a mirror's source: anything that is not itself a mirror. */
export type MirrorSource = Exclude<Block, MirrorBlock>;

/**
 * One radial copy's placement, in the mirror block's own local space.
 *
 * Konva rotates a Group about its own `(x, y)`, so a copy drawn at local
 * origin lands at `(x, y)` turned by `rotation` — which is exactly the
 * medallion arrangement: each copy pushed `radius` out along its own spoke
 * and turned to face along it.
 */
export type RadialCopyTransform = { rotation: number; x: number; y: number };

/**
 * A mirror may only reflect a real, non-mirror block. Rejecting a mirror as a
 * source at creation time is the whole cycle guard: with one level allowed,
 * no chain can close on itself, and the renderer never recurses.
 */
export const isMirrorSourceCandidate = (block: Block | null | undefined): block is MirrorSource =>
  !!block && block.type !== "mirror";

/** True when `sourceId` names a block in `blocks` that may be mirrored. */
export const canMirrorSourceId = (blocks: Block[], sourceId: number): boolean =>
  isMirrorSourceCandidate(blocks.find((b) => b.id === sourceId));

/**
 * The block a mirror draws, or `null` when its source is gone (or has since
 * become something a mirror may not reflect). A null result renders nothing.
 */
export const resolveMirrorSource = (blocks: Block[], mirror: MirrorBlock): MirrorSource | null => {
  const source = blocks.find((b) => b.id === mirror.sourceId);
  return isMirrorSourceCandidate(source) ? source : null;
};

/** Rounds and clamps a stored/incoming radial count into the supported range. */
export const resolveRadialCount = (count: number | undefined): number =>
  Number.isFinite(count)
    ? clamp(Math.round(count as number), RADIAL_COUNT_MIN, RADIAL_COUNT_MAX)
    : DEFAULT_RADIAL_COUNT;

/** Falls back to the default radius for a missing or non-finite stored value. */
export const resolveRadialRadius = (radius: number | undefined): number =>
  Number.isFinite(radius) ? (radius as number) : DEFAULT_RADIAL_RADIUS;

/**
 * The `count` copies of a radial composition, evenly spaced around a full
 * turn starting at 0° (pointing along +x, the canvas's own reference
 * direction). Angles are degrees because that is what Konva's `rotation`
 * takes.
 */
export const radialCopyTransforms = (
  count: number | undefined,
  radius: number | undefined
): RadialCopyTransform[] => {
  const n = resolveRadialCount(count);
  const r = resolveRadialRadius(radius);
  return Array.from({ length: n }, (_, i) => {
    const rotation = (i * 360) / n;
    const radians = (rotation * Math.PI) / 180;
    return { rotation, x: r * Math.cos(radians), y: r * Math.sin(radians) };
  });
};

/**
 * Drops every mirror whose source no longer resolves.
 *
 * Used in two places for the same reason: on load (a saved project whose
 * source block was deleted in an older session) and after a delete (the
 * source going away takes its reflections with it). One pass is enough
 * because a mirror can never be another mirror's source.
 */
export const dropOrphanedMirrors = (blocks: Block[]): Block[] =>
  blocks.filter((b) => b.type !== "mirror" || resolveMirrorSource(blocks, b) !== null);

/** Whether `dropOrphanedMirrors` would change anything — cheap enough to guard a setState with. */
export const hasOrphanedMirrors = (blocks: Block[]): boolean =>
  blocks.some((b) => b.type === "mirror" && resolveMirrorSource(blocks, b) === null);

/**
 * Builds the mirror block for a source. It copies the source's `BlockCommon`
 * styling fields so the layer list and the shared panels show something
 * sensible, but the mirror's *content* always comes from the source at render
 * time — none of the copied text/font fields are read by `MirrorBlockView`.
 */
export const buildMirrorBlock = (
  id: number,
  source: MirrorSource,
  mode: MirrorMode,
  offset: number = NEW_MIRROR_OFFSET
): MirrorBlock => ({
  id,
  type: "mirror",
  sourceId: source.id,
  mode,
  radialCount: mode === "radial" ? DEFAULT_RADIAL_COUNT : undefined,
  radialRadius: mode === "radial" ? DEFAULT_RADIAL_RADIUS : undefined,
  name: mode === "radial" ? "Radial" : "Mirror",
  text: source.text,
  x: mode === "radial" ? source.x : source.x + offset,
  y: source.y,
  fontSize: source.fontSize,
  color: source.color,
  fontFamily: source.fontFamily,
  fontStyle: source.fontStyle,
  opacity: source.opacity ?? 1,
  stroke: source.stroke,
  strokeWidth: source.strokeWidth,
  shadowColor: source.shadowColor,
  shadowBlur: source.shadowBlur,
  shadowOffsetX: source.shadowOffsetX,
  shadowOffsetY: source.shadowOffsetY,
  shadowOpacity: source.shadowOpacity,
  locked: false,
  rotation: 0,
});
