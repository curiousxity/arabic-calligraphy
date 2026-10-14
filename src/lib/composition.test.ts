import { describe, it, expect } from "vitest";
import type { TextBlock } from "../types";
import { RADIAL_COUNT_MAX, RADIAL_COUNT_MIN, resolveRadialCount } from "./mirror";
import {
  MIN_RUN_HEIGHT,
  MIN_RUN_WIDTH,
  COMPOSITION_LAYOUTS,
  buildComposition,
  describeComposition,
  estimateRunBox,
  medallionRadius,
  muthannaOffset,
  normalizeRunBox,
} from "./composition";

const source = (patch: Partial<TextBlock> = {}): TextBlock => ({
  id: 7,
  type: "text",
  text: "محمد",
  x: 120,
  y: 80,
  fontSize: 60,
  color: "#1e3a5f",
  fontFamily: "FatemiMaqala",
  stroke: "#000000",
  shadowColor: "#000000",
  ...patch,
});

/** A deterministic id source, standing in for App.tsx's `createNextId`. */
const ids = (start = 100) => {
  let next = start;
  return () => next++;
};

const run = { width: 400, height: 90 };

describe("layout catalogue", () => {
  it("has unique ids", () => {
    const seen = new Set(COMPOSITION_LAYOUTS.map((l) => l.id));
    expect(seen.size).toBe(COMPOSITION_LAYOUTS.length);
  });

  it("offers exactly muthanna and medallion", () => {
    expect(COMPOSITION_LAYOUTS.map((l) => l.id)).toEqual(["muthanna", "medallion"]);
  });
});

describe("normalizeRunBox", () => {
  it("floors a degenerate measurement", () => {
    const box = normalizeRunBox({ width: 0, height: 0 }, 0);
    expect(box.width).toBe(MIN_RUN_WIDTH);
    expect(box.height).toBe(MIN_RUN_HEIGHT);
  });

  it("raises the height to the line the block is drawn on", () => {
    // A name with no ascenders and no tashkeel measures far shorter than its
    // line; spacing a composition by the ink alone would set copies overlapping.
    expect(normalizeRunBox({ width: 300, height: 20 }, 100, 1.2).height).toBe(120);
  });

  it("keeps a measurement that already exceeds the line", () => {
    expect(normalizeRunBox({ width: 300, height: 190 }, 100, 1.2).height).toBe(190);
  });
});

describe("estimateRunBox", () => {
  it("grows with the text and the font size", () => {
    const short = estimateRunBox("محمد", 60);
    const long = estimateRunBox("محمد بن عبد الله", 60);
    expect(long.width).toBeGreaterThan(short.width);
    expect(estimateRunBox("محمد", 120).width).toBeGreaterThan(short.width);
  });

  it("never returns a degenerate box for empty text", () => {
    const box = estimateRunBox("   ", 40);
    expect(box.width).toBeGreaterThanOrEqual(MIN_RUN_WIDTH);
    expect(box.height).toBeGreaterThanOrEqual(MIN_RUN_HEIGHT);
  });
});

describe("muthannaOffset", () => {
  it("leaves a positive gap between the two halves' facing edges", () => {
    // Both halves are centred on their own origin, so the clear space between
    // them is the offset minus one run width.
    expect(muthannaOffset(run) - run.width).toBeGreaterThan(0);
  });

  it("scales its gap with the run height rather than fixing it", () => {
    const small = muthannaOffset({ width: 400, height: 40 });
    const large = muthannaOffset({ width: 400, height: 400 });
    expect(large - 400).toBeGreaterThan(small - 400);
  });
});

describe("medallionRadius", () => {
  it("opens the ring out as copies are added", () => {
    const few = medallionRadius(run, 3);
    const many = medallionRadius(run, 12);
    expect(many).toBeGreaterThan(few);
  });

  it("gives every copy an arc at least as long as the run is tall", () => {
    for (const count of [2, 5, 9, 16]) {
      const radius = medallionRadius(run, count);
      const arc = (2 * Math.PI * radius) / count;
      expect(arc).toBeGreaterThanOrEqual(run.height);
    }
  });

  it("keeps the copies' inner ends clear of the centre", () => {
    // A copy is centred on its spoke point and lies radially, so its inner
    // end is `radius - width / 2`.
    const wide = { width: 900, height: 40 };
    expect(medallionRadius(wide, 3) - wide.width / 2).toBeGreaterThan(0);
  });

  it("clamps a silly count the way the mirror block itself does", () => {
    expect(medallionRadius(run, 999)).toBe(medallionRadius(run, RADIAL_COUNT_MAX));
    expect(medallionRadius(run, 0)).toBe(medallionRadius(run, RADIAL_COUNT_MIN));
  });
});

describe("buildComposition", () => {
  it("muthanna adds one mirrored reflection at the measured offset", () => {
    const block = source();
    const plan = buildComposition(
      { source: block, layout: "muthanna", run },
      ids()
    );
    expect(plan.added).toHaveLength(1);
    const mirror = plan.added[0];
    expect(mirror.type).toBe("mirror");
    if (mirror.type !== "mirror") return;
    expect(mirror.id).toBe(100);
    expect(mirror.sourceId).toBe(block.id);
    expect(mirror.mode).toBe("mirrorX");
    expect(mirror.x).toBeCloseTo(block.x + muthannaOffset(run), 6);
    expect(mirror.y).toBe(block.y);
    // Set in the font the block already carries.
    expect(mirror.fontFamily).toBe(block.fontFamily);
  });

  it("medallion turns the requested number of copies around the source", () => {
    const block = source();
    const plan = buildComposition(
      { source: block, layout: "medallion", run, radialCount: 9 },
      ids()
    );
    const mirror = plan.added[0];
    expect(mirror.type).toBe("mirror");
    if (mirror.type !== "mirror") return;
    expect(mirror.mode).toBe("radial");
    expect(mirror.radialCount).toBe(9);
    expect(mirror.radialRadius).toBeCloseTo(medallionRadius(run, 9), 6);
    // A radial mirror centres on its source rather than standing beside it.
    expect(mirror.x).toBe(block.x);
    expect(mirror.y).toBe(block.y);
  });

  it("medallion clamps an out-of-range count to what the block supports", () => {
    const plan = buildComposition(
      { source: source(), layout: "medallion", run, radialCount: 99 },
      ids()
    );
    const mirror = plan.added[0];
    if (mirror.type !== "mirror") throw new Error("expected a mirror block");
    expect(mirror.radialCount).toBe(resolveRadialCount(99));
  });

  it("takes every new id from the injected allocator", () => {
    const nextId = ids(500);
    const first = buildComposition(
      { source: source(), layout: "muthanna", run },
      nextId
    );
    const second = buildComposition(
      { source: source(), layout: "medallion", run },
      nextId
    );
    expect(first.added[0].id).toBe(500);
    expect(second.added[0].id).toBe(501);
  });

  it("adds companion blocks and leaves the source alone", () => {
    // The composition must not move, rename, retype or restyle the block it
    // is built around — the user's text, position and font are theirs.
    for (const layout of COMPOSITION_LAYOUTS) {
      const block = source();
      const before = structuredClone(block);
      const plan = buildComposition({ source: block, layout: layout.id, run }, ids());
      expect(plan.added).toHaveLength(1);
      expect(block).toEqual(before);
    }
  });
});

describe("describeComposition", () => {
  it("names the composition that was created", () => {
    const muthanna = buildComposition({ source: source(), layout: "muthanna", run }, ids());
    expect(describeComposition(muthanna)).toMatch(/muthanna composition/i);
  });
});
