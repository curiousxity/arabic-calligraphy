import type { Block } from "../types";
import { buildMirrorBlock, resolveRadialCount, type MirrorSource } from "./mirror";

/**
 * The pure half of Compositions: given a block and how wide its text
 * actually draws, decide what a muthanna / medallion composition of it looks
 * like.
 *
 * It builds **no new primitives**. A muthanna and a medallion are both
 * `buildMirrorBlock` with a measured offset or radius. All this module adds is the arithmetic that turns a
 * measured run into placements that don't collide — which is the entire
 * difference between "add a mirror" (a fixed 180px nudge the user then drags)
 * and "compose this text", and the reason it is worth a module of its own.
 *
 * Pure by the same discipline as `tatweel.ts` and `fitToWidth.ts`: no React,
 * no Konva, and crucially no `harfbuzz.ts` — the measurement arrives as a
 * `RunBox` the caller obtained from `measureShapedRun`. That is what lets
 * this be unit-tested at all (a static harfbuzzjs import throws under
 * Vitest's Node ESM loader before any test code runs).
 */

export type CompositionLayoutId = "muthanna" | "medallion";

export type CompositionLayout = {
  id: CompositionLayoutId;
  name: string;
  nameAr: string;
  description: string;
};

/** The compositions offered, in the order the wizard shows them. */
export const COMPOSITION_LAYOUTS: CompositionLayout[] = [
  {
    id: "muthanna",
    name: "Muthanna",
    nameAr: "مثنى",
    description: "The name and its mirror image, set facing each other.",
  },
  {
    id: "medallion",
    name: "Medallion",
    nameAr: "شمسة",
    description: "Copies of the name turned evenly around a centre.",
  },
];

/** How wide and tall a name actually draws, in block space. */
export type RunBox = { width: number; height: number };

/**
 * Floors for a measured run. A block whose text is empty (or whose shaping
 * failed) measures at or near zero, and every placement below divides the
 * canvas up by these numbers — an unguarded zero would stack a whole
 * medallion on one point.
 *
 * They are applied in exactly one place, `normalizeRunBox`, which
 * `buildComposition` runs over its input (the operation is idempotent, so a
 * caller that already normalized pays nothing). The placement formulas below
 * therefore read `run.width`/`run.height` directly and say what they mean.
 */
export const MIN_RUN_WIDTH = 40;
export const MIN_RUN_HEIGHT = 24;

/**
 * Brings a raw measurement up to what the canvas will actually occupy.
 *
 * The height deliberately mirrors `ShapedText`'s own `bh` rule
 * (`max(fontSize * lineHeight, ink height, 24)`): a name with no ascenders
 * and no tashkeel measures far shorter than the line it is drawn on, and
 * spacing a medallion by the ink alone would set its copies overlapping.
 */
export const normalizeRunBox = (box: RunBox, fontSize = 0, lineHeight = 1.2): RunBox => ({
  width: Math.max(box.width, MIN_RUN_WIDTH),
  height: Math.max(box.height, fontSize * lineHeight, MIN_RUN_HEIGHT),
});

/**
 * A crude run box from the text alone, used only when shaping fails.
 *
 * Deliberately rough — it exists so a font that will not load produces a
 * loose composition the user can drag into place, rather than no composition
 * at all.
 */
export const estimateRunBox = (text: string, fontSize: number): RunBox =>
  normalizeRunBox(
    { width: Math.max(text.trim().length, 1) * fontSize * 0.55, height: fontSize },
    fontSize
  );

/**
 * How far a muthanna's reflection sits from its source, centre to centre.
 *
 * Both halves are centred on their own origin, so a centre-to-centre gap of
 * `width + gap` leaves exactly `gap` of clear space between the two runs'
 * facing edges. The gap scales with the run's height rather than being fixed,
 * so a 24px name and a 240px name are spaced alike in proportion.
 */
export const muthannaOffset = (run: RunBox): number =>
  run.width + Math.max(run.height * 0.25, 24);

/**
 * The radius a medallion's copies sit at.
 *
 * Each radial copy is *rotated to face along its own spoke*
 * (`radialCopyTransforms`), so a copy lies radially: its width runs outward
 * and its height is what crowds its neighbours. Two constraints follow, and
 * the radius is whichever is larger:
 *
 * - **Tangential:** each copy owns an arc of `2πr / count`, which must hold
 *   the run's height plus a gap — this is what makes a 12-copy medallion
 *   open out rather than overlap itself where a 4-copy one need not.
 * - **Radial:** the copy is centred on its spoke point, so its inner end sits
 *   at `r - width/2`; keeping `r` at `0.6 × width` holds that end just clear
 *   of the centre, where the source block itself is drawn.
 */
export const medallionRadius = (run: RunBox, count?: number): number => {
  const n = resolveRadialCount(count);
  const gap = Math.max(run.height * 0.4, 16);
  const tangential = (n * (run.height + gap)) / (2 * Math.PI);
  return Math.max(tangential, run.width * 0.6);
};

export type CompositionRequest = {
  /** The block the design is built around. Never a mirror. */
  source: MirrorSource;
  layout: CompositionLayoutId;
  /** The source's measured extent, already through `normalizeRunBox`. */
  run: RunBox;
  radialCount?: number;
};

/**
 * What the wizard collects — everything a request needs except the block it
 * is built around and its measurement, which only `App.tsx` can supply.
 *
 * Declared here rather than in the dialog so the state layer does not import
 * a domain type back out of a component, and so a new `CompositionRequest`
 * field is a type error at the wizard rather than a silent omission.
 */
export type CompositionSelection = Omit<CompositionRequest, "source" | "run">;

export type CompositionPlan = {
  /** The composition that was built, so a describer needs no second argument. */
  layout: CompositionLayoutId;
  /** Companion blocks to insert, in order. */
  added: Block[];
};

/**
 * The whole composition: the blocks to add around the source, which itself is
 * left untouched — the composition is set in the font the block already has.
 *
 * `nextId` is injected rather than called from a module counter so the caller
 * keeps owning id allocation (`App.tsx`'s `createNextId`), and so a test can
 * hand in a deterministic sequence.
 */
export function buildComposition(
  request: CompositionRequest,
  nextId: () => number
): CompositionPlan {
  const source = request.source;
  // The one place the run floors are enforced. Idempotent, so a caller that
  // already normalized (App.tsx does) pays nothing.
  const run = normalizeRunBox(request.run);
  const layout = request.layout;

  switch (layout) {
    case "muthanna": {
      const mirror = {
        ...buildMirrorBlock(nextId(), source, "mirrorX", muthannaOffset(run)),
        name: "Muthanna",
      };
      return { layout, added: [mirror] };
    }

    case "medallion": {
      // `resolveRadialCount` already answers `DEFAULT_RADIAL_COUNT` for a
      // missing or non-finite count, so no coalesce is needed here.
      const count = resolveRadialCount(request.radialCount);
      const mirror = {
        ...buildMirrorBlock(nextId(), source, "radial"),
        radialCount: count,
        radialRadius: medallionRadius(run, count),
        name: "Medallion",
      };
      return { layout, added: [mirror] };
    }
  }
}

/** One-line report of what was created, for the sidebar's status row. */
export const describeComposition = (plan: CompositionPlan): string => {
  const label = COMPOSITION_LAYOUTS.find((l) => l.id === plan.layout)?.name ?? "Composition";
  return `Created a ${label.toLowerCase()} composition.`;
};
