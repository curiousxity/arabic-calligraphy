import type * as opentype from "opentype.js";
import type { PathCommand } from "opentype.js";
import type { GlyphEdit } from "../types";
// Types only, from `normalizeGlyphs` rather than `harfbuzz` — importing the
// latter drags in `import * as hbjsModule from "harfbuzzjs"`, which throws
// under Vitest's Node ESM loader the moment the module is evaluated. Same
// reasoning that moved ARABIC_DIACRITIC_RE into `diacritics.ts`.
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import { applyGlyphEdit } from "./glyphEdits";
import type { JoinPin } from "./joinPins";
import { kashidaFactorForHandle, type KashidaSnap } from "./kashidaFactor";

/**
 * Ink width of a shaped run with `glyphEdits` applied — the *stretched* width
 * `ShapedText` actually draws.
 *
 * Nothing else in the app reports this. `ShapedText`'s own metrics memo takes
 * each glyph's bounding box straight from the raw font outline
 * (`glyphObj.getPath(gx, gy, fontSize).getBoundingBox()`) with no edits
 * applied, and `penX += advance` is deliberately never touched by stretching —
 * so the block's bounds, its hit boxes, and its Konva client rect are all the
 * *unstretched* width and do not move when the kashida dial does. A solver
 * reading any of them would converge to nonsense, silently.
 *
 * The walk below therefore mirrors `ShapedText`'s *drawing* loop rather than
 * its metrics loop: same pen advance, same `dx`/`dy` handling, same
 * `fontSize / unitsPerEm` scale, same per-contour index — and pushes every
 * outline coordinate through `applyGlyphEdit` before taking the extent.
 * `applyGlyphEdit` is imported, never reimplemented: if this module's
 * displacement ever diverged from the renderer's, the solver would optimise a
 * width the user never sees and nothing would fail loudly.
 *
 * Glyph rigs, per-glyph transforms, diacritic overrides and the block-level
 * warp are all deliberately *not* applied — the kashida dial moves only
 * `glyphEdits`, so anything else is a constant offset between this measurement
 * and the drawn ink, identical at every dial position and therefore invisible
 * to the solver.
 *
 * `joinPins` must be the same set `ShapedText` is rendering with (both come
 * from `lib/joinPins.ts`'s `computeJoinPins`). Measuring unpinned ink while
 * the renderer draws pinned ink would make the solver optimise a width the
 * user never sees, and nothing would fail loudly.
 */
export function measureStretchedRunWidth(args: {
  glyphs: HarfBuzzGlyph[];
  font: opentype.Font;
  fontSize: number;
  unitsPerEm: number;
  glyphEdits: GlyphEdit[];
  joinPins?: Map<number, JoinPin[]>;
}): number {
  const { glyphs, font, fontSize, glyphEdits } = args;
  if (!font || glyphs.length === 0) return 0;

  const upm = Math.max(args.unitsPerEm || 1000, 1);
  const scale = fontSize / upm;

  let penX = 0;
  let minX = Infinity;
  let maxX = -Infinity;

  const track = (x: number) => {
    if (!Number.isFinite(x)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  };

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const glyphObj = font.glyphs.get(g.g);
    const advance = g.ax ?? 0;

    if (glyphObj) {
      const gx = (penX + (g.dx ?? 0)) * scale;
      const gy = -(g.dy ?? 0) * scale;
      const edit = glyphEdits.find((e) => e.glyphIndex === i);
      const pins = args.joinPins?.get(i);

      let contourIndex = -1;
      for (const cmd of glyphObj.getPath(0, 0, fontSize).commands as PathCommand[]) {
        const c = cmd as {
          type: PathCommand["type"];
          x?: number;
          y?: number;
          x1?: number;
          y1?: number;
          x2?: number;
          y2?: number;
        };

        if (c.type === "M") contourIndex++;

        if (typeof c.x === "number" && typeof c.y === "number") {
          track(applyGlyphEdit(c.x + gx, c.y + gy, edit, contourIndex, pins).x);
        }
        if (typeof c.x1 === "number" && typeof c.y1 === "number") {
          track(applyGlyphEdit(c.x1 + gx, c.y1 + gy, edit, contourIndex, pins).x);
        }
        if (typeof c.x2 === "number" && typeof c.y2 === "number") {
          track(applyGlyphEdit(c.x2 + gx, c.y2 + gy, edit, contourIndex, pins).x);
        }
      }
    }

    penX += advance;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return 0;
  return maxX - minX;
}

/**
 * Applies the kashida dial's distribution across a block's edits, without
 * touching state — this is what lets `solveKashidaAmount` evaluate dozens of
 * candidate dial positions.
 *
 * The formula itself lives in `lib/kashidaFactor.ts` and is shared with
 * `App.tsx`'s `setBlockKashidaAmount`. It used to be duplicated here, which
 * meant the two had to be kept in step by hand or the solver would optimise
 * a width that applying its own answer would not reproduce. Pass the same
 * `snap` the app is using, for the same reason.
 */
export function applyKashidaAmountToEdits(
  glyphEdits: GlyphEdit[],
  amount: number,
  snap?: KashidaSnap
): GlyphEdit[] {
  return glyphEdits.map((edit) => ({
    ...edit,
    stretches: edit.stretches.map((h) => {
      const factor = kashidaFactorForHandle(h, amount, snap);
      return factor == null ? h : { ...h, factor };
    }),
  }));
}

/** Whether a block has any handle the kashida dial can actually move. */
export function hasKashidaEligibleHandles(glyphEdits: GlyphEdit[]): boolean {
  return glyphEdits.some((edit) =>
    edit.stretches.some((h) => h.kashidaEligible && h.maxFactor != null)
  );
}

export type JustifySolution = {
  /** 0-100, the dial value to apply. */
  amount: number;
  achievedWidth: number;
  /** False when even amount=100 falls short of the target. */
  reachable: boolean;
};

export type SolveKashidaOptions = {
  /** How close to `targetWidth` counts as solved. Default 0.5px. */
  tolerancePx?: number;
  /** Bisection steps. 12 already reach sub-pixel precision on any realistic width. */
  maxIterations?: number;
};

/**
 * Finds the kashida dial position (0-100) whose stretched width best matches
 * `targetWidth`, by bisecting `measureAtAmount` over [0, 100].
 *
 * Width is monotonically non-decreasing in the dial — every eligible handle's
 * `factor` rises with the dial and each one only ever displaces outline points
 * outward along its own axis — which is what makes bisection safe here.
 *
 * The two ends are special-cased rather than bisected into:
 * - target already met at 0 (the run is naturally wide enough): return 0, so
 *   "fit" never *adds* stretch that the composition did not ask for.
 * - target still unmet at 100: return `{ amount: 100, reachable: false }` with
 *   the width that was achieved. Applying the maximum and telling the user it
 *   fell short is more useful than throwing or doing nothing.
 */
export function solveKashidaAmount(
  measureAtAmount: (amount: number) => number,
  targetWidth: number,
  opts: SolveKashidaOptions = {}
): JustifySolution {
  const tolerance = opts.tolerancePx ?? 0.5;
  const maxIterations = Math.max(1, opts.maxIterations ?? 24);

  const widthAtZero = measureAtAmount(0);
  if (widthAtZero >= targetWidth - tolerance) {
    return { amount: 0, achievedWidth: widthAtZero, reachable: true };
  }

  const widthAtMax = measureAtAmount(100);
  if (widthAtMax < targetWidth - tolerance) {
    return { amount: 100, achievedWidth: widthAtMax, reachable: false };
  }

  let lo = 0;
  let hi = 100;
  let best: JustifySolution = { amount: 100, achievedWidth: widthAtMax, reachable: true };

  for (let i = 0; i < maxIterations; i++) {
    const mid = (lo + hi) / 2;
    const width = measureAtAmount(mid);

    if (Math.abs(width - targetWidth) < Math.abs(best.achievedWidth - targetWidth)) {
      best = { amount: mid, achievedWidth: width, reachable: true };
    }

    if (Math.abs(width - targetWidth) <= tolerance) {
      return { amount: mid, achievedWidth: width, reachable: true };
    }

    if (width < targetWidth) lo = mid;
    else hi = mid;
  }

  return best;
}

/**
 * Shapes one block's text and solves for the kashida dial position whose
 * stretched width lands on `targetWidth`.
 *
 * Lives here rather than in `App.tsx` for the parallel-stream merge contract
 * (see docs/superpowers/specs/PARALLEL.md): a stream may only add *calls* to
 * shared files, and `App.tsx`'s import block is not inside this stream's
 * anchors. For the same reason `shapeText`/`FONT_URLS` are pulled in with a
 * dynamic `import()` instead of a static one — a static import would drag
 * `harfbuzzjs` into this module's graph, which throws under Vitest's Node ESM
 * loader the moment `justify.test.ts` evaluates it (the same constraint that
 * keeps `diacritics.ts` free of a harfbuzz import).
 *
 * Shaping is cheap here: `shapeText` caches by `text|fontUrl`, so this reuses
 * the exact run the renderer already shaped rather than redoing that work.
 */
export async function solveJustifyForBlock(args: {
  text: string;
  fontFamily: string;
  fontSize: number;
  glyphEdits: GlyphEdit[];
  targetWidth: number;
  opts?: SolveKashidaOptions;
  snapToNuqta?: boolean;
}): Promise<JustifySolution | null> {
  const [{ shapeText }, { FONT_URLS }] = await Promise.all([
    import("./harfbuzz"),
    import("../hooks/useShapedGlyphs"),
  ]);

  const fontUrl = FONT_URLS[args.fontFamily] ?? FONT_URLS.NotoSans;
  const { glyphs, font, unitsPerEm } = await shapeText(args.text || "", fontUrl);
  if (!font || glyphs.length === 0) return null;

  const { computeJoinPins, PIN_RADIUS_NUQTA } = await import("./joinPins");
  const { nuqtaPx } = await import("./nuqta");
  const nuqta = nuqtaPx(args.fontFamily, args.fontSize);
  const joinPins =
    nuqta == null
      ? undefined
      : computeJoinPins({
          glyphs,
          font,
          fontSize: args.fontSize,
          unitsPerEm,
          pinRadius: nuqta * PIN_RADIUS_NUQTA,
        });

  return solveKashidaAmount(
    (amount) =>
      measureStretchedRunWidth({
        glyphs,
        font,
        fontSize: args.fontSize,
        unitsPerEm,
        glyphEdits: applyKashidaAmountToEdits(args.glyphEdits, amount, {
          fontFamily: args.fontFamily,
          enabled: args.snapToNuqta ?? false,
        }),
        joinPins,
      }),
    args.targetWidth,
    args.opts
  );
}
