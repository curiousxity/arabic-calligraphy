import type { Block, ImageBlock } from "../types";
import { buildMirrorBlock, resolveRadialCount, type MirrorSource } from "./mirror";
import {
  DEFAULT_ORNAMENT_FILL,
  getOrnament,
  listOrnaments,
  ornamentSvgDataUrl,
  type OrnamentDef,
} from "./ornaments";

/**
 * The pure half of "name designs": given a block and how wide its text
 * actually draws, decide what a muthanna / medallion / framed composition of
 * it looks like.
 *
 * It builds **no new primitives**. A muthanna and a medallion are both
 * `buildMirrorBlock` with a measured offset or radius; a frame is an ordinary
 * image block carrying an ornament's own SVG, exactly as the ornament picker
 * already inserts one. All this module adds is the arithmetic that turns a
 * measured run into placements that don't collide — which is the entire
 * difference between "add a mirror" (a fixed 180px nudge the user then drags)
 * and "compose this name", and the reason it is worth a module of its own.
 *
 * Pure by the same discipline as `tatweel.ts` and `fitToWidth.ts`: no React,
 * no Konva, and crucially no `harfbuzz.ts` — the measurement arrives as a
 * `RunBox` the caller obtained from `measureShapedRun`. That is what lets
 * this be unit-tested at all (a static harfbuzzjs import throws under
 * Vitest's Node ESM loader before any test code runs).
 */

export type NameLayoutId = "single" | "muthanna" | "medallion" | "framed";

export type NameLayout = {
  id: NameLayoutId;
  name: string;
  nameAr: string;
  description: string;
};

/** The compositions offered, in the order the wizard shows them. */
export const NAME_LAYOUTS: NameLayout[] = [
  {
    id: "single",
    name: "Single",
    nameAr: "مفرد",
    description: "The name on its own, in the style you chose.",
  },
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
  {
    id: "framed",
    name: "Framed",
    nameAr: "مؤطر",
    description: "The name inside a decorative frame from the shape library.",
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
 * `buildNameDesign` runs over its input (the operation is idempotent, so a
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

/**
 * Clearance left between the name and the frame around it.
 *
 * Generous on purpose: the ornaments tagged as frames carry their own border
 * band inside their box (the `border-frame` ring's is ~11% of its width), and
 * the padding has to swallow that band before it starts being clearance. Too
 * tight reads as a mistake; too loose is a drag away from right.
 */
export const framePadding = (run: RunBox): number => Math.max(run.height * 0.9, 48);

/**
 * The size to insert a frame ornament at so the name sits inside it.
 *
 * Aspect is preserved rather than stretched — these are drawn assets, the
 * same reason the ornament picker passes `preserveAspect` to the SVG
 * importer — so the box is scaled by whichever axis needs more.
 */
export const frameBoxFor = (viewBox: { w: number; h: number }, run: RunBox): RunBox => {
  const pad = framePadding(run);
  const neededWidth = run.width + pad * 2;
  const neededHeight = run.height + pad * 2;
  const scale = Math.max(neededWidth / viewBox.w, neededHeight / viewBox.h);
  return { width: viewBox.w * scale, height: viewBox.h * scale };
};

/** The library's own tag for an ornament that reads as a frame. */
export const FRAME_TAG = "frame";
export const DEFAULT_FRAME_ID = "border-frame";
/**
 * The ornament palette's own default, read from `lib/ornaments.ts` rather
 * than restated — a second copy of the hex drifted the moment either the
 * shape picker's palette or this one was edited.
 */
export const DEFAULT_FRAME_COLOR = DEFAULT_ORNAMENT_FILL;

/**
 * The frames on offer — filtered by the library's own tag rather than a
 * hand-kept list here, so an ornament added to `src/data/ornaments/` shows up
 * in this wizard by dropping the file in, exactly as it does in the picker.
 */
export const frameOrnaments = (): OrnamentDef[] =>
  listOrnaments().filter((o) => o.tags.includes(FRAME_TAG));

export type NameDesignRequest = {
  /** The block the design is built around. Never a mirror. */
  source: MirrorSource;
  layout: NameLayoutId;
  /** The style chosen in the gallery; applied to the source. */
  fontFamily: string;
  /** The source's measured extent, already through `normalizeRunBox`. */
  run: RunBox;
  radialCount?: number;
  frameId?: string;
  frameColor?: string;
};

/**
 * What the wizard collects — everything a request needs except the block it
 * is built around and its measurement, which only `App.tsx` can supply.
 *
 * Declared here rather than in the dialog so the state layer does not import
 * a domain type back out of a component, and so a new `NameDesignRequest`
 * field is a type error at the wizard rather than a silent omission.
 */
export type NameDesignSelection = Omit<NameDesignRequest, "source" | "run">;

export type NameDesignPlan = {
  /** The composition that was built, so a describer needs no second argument. */
  layout: NameLayoutId;
  /** Patch for the source block — always at least the chosen style. */
  patch: Partial<Block>;
  /** Companion blocks to insert, in order. */
  added: Block[];
  /**
   * Where `added` belongs in z-order relative to the source. A frame must be
   * drawn *before* the name or it covers it; a reflection is a peer and goes
   * on top, where every other newly created block goes.
   */
  placement: "behind" | "front";
};

/**
 * An image block holding an ornament's own SVG, sized and centred on the name.
 *
 * Built explicitly rather than by patching a template block, for the reason
 * `buildMirrorBlock` beside it is: the fields a block needs are not optional,
 * and spreading a caller's block would carry text/warp/glyph fields that mean
 * nothing on an image and would then be saved with it.
 */
const buildFrameBlock = (
  id: number,
  source: MirrorSource,
  def: OrnamentDef,
  box: RunBox,
  color: string
): ImageBlock => ({
  id,
  type: "image",
  name: def.name,
  text: "",
  imageDataUrl: ornamentSvgDataUrl(def, color),
  imageScale: 1,
  shapeWidth: box.width,
  shapeHeight: box.height,
  // An image block's x/y is its top-left corner, while a centre-aligned text
  // block is centred on its own x/y — so centring the frame on the name is a
  // half-box shift, not a copy of the source's position.
  x: source.x - box.width / 2,
  y: source.y - box.height / 2,
  fontSize: source.fontSize,
  color,
  fontFamily: source.fontFamily,
  opacity: source.opacity ?? 1,
  stroke: source.stroke,
  strokeWidth: 0,
  shadowColor: source.shadowColor,
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowOpacity: 0,
  locked: false,
  rotation: 0,
});

/**
 * The whole composition, as a patch plus the blocks to add.
 *
 * `nextId` is injected rather than called from a module counter so the caller
 * keeps owning id allocation (`App.tsx`'s `createNextId`), and so a test can
 * hand in a deterministic sequence.
 *
 * The mirror is built from the source **with the new font already applied**:
 * `buildMirrorBlock` copies the source's styling fields for the layer list,
 * and building it from the pre-patch block would label the reflection with
 * the font the user just replaced.
 */
export function buildNameDesign(
  request: NameDesignRequest,
  nextId: () => number
): NameDesignPlan {
  const patch: Partial<Block> = { fontFamily: request.fontFamily };
  const source = { ...request.source, fontFamily: request.fontFamily } as MirrorSource;
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
      return { layout, patch, added: [mirror], placement: "front" };
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
      return { layout, patch, added: [mirror], placement: "front" };
    }

    case "framed": {
      // An unknown id falls back to the first tagged frame rather than
      // failing: the id can only come from a stale UI state or a hand-edited
      // call, and dropping the composition silently would be worse.
      const def =
        getOrnament(request.frameId ?? DEFAULT_FRAME_ID) ?? getOrnament(DEFAULT_FRAME_ID);
      if (!def) return { layout, patch, added: [], placement: "behind" };
      const box = frameBoxFor(def.viewBox, run);
      const frame = buildFrameBlock(
        nextId(),
        source,
        def,
        box,
        request.frameColor ?? DEFAULT_FRAME_COLOR
      );
      return { layout, patch, added: [frame], placement: "behind" };
    }

    case "single":
    default:
      return { layout, patch, added: [], placement: "front" };
  }
}

/** One-line report of what was created, for the sidebar's status row. */
export const describeNameDesign = (plan: NameDesignPlan): string => {
  const label = NAME_LAYOUTS.find((l) => l.id === plan.layout)?.name ?? "Design";
  if (plan.added.length === 0) return `Applied the ${label.toLowerCase()} style.`;
  return `Created a ${label.toLowerCase()} design.`;
};
