import { describe, it, expect } from "vitest";
import type { TextBlock } from "../types";
import { RADIAL_COUNT_MAX, RADIAL_COUNT_MIN, resolveRadialCount } from "./mirror";
import {
  DEFAULT_FRAME_COLOR,
  DEFAULT_FRAME_ID,
  FRAME_TAG,
  MIN_RUN_HEIGHT,
  MIN_RUN_WIDTH,
  NAME_LAYOUTS,
  buildNameDesign,
  describeNameDesign,
  estimateRunBox,
  frameBoxFor,
  frameOrnaments,
  framePadding,
  medallionRadius,
  muthannaOffset,
  normalizeRunBox,
} from "./nameDesign";
import { getOrnament } from "./ornaments";

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
    const seen = new Set(NAME_LAYOUTS.map((l) => l.id));
    expect(seen.size).toBe(NAME_LAYOUTS.length);
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

describe("frameBoxFor", () => {
  const viewBox = { w: 300, h: 220 };

  it("preserves the ornament's aspect ratio", () => {
    const box = frameBoxFor(viewBox, run);
    expect(box.width / box.height).toBeCloseTo(viewBox.w / viewBox.h, 6);
  });

  it("holds the run plus padding on both axes", () => {
    const pad = framePadding(run);
    const box = frameBoxFor(viewBox, run);
    expect(box.width).toBeGreaterThanOrEqual(run.width + pad * 2 - 1e-6);
    expect(box.height).toBeGreaterThanOrEqual(run.height + pad * 2 - 1e-6);
  });

  it("holds a run that is taller than it is wide", () => {
    const tall = { width: 60, height: 600 };
    const pad = framePadding(tall);
    const box = frameBoxFor(viewBox, tall);
    expect(box.height).toBeGreaterThanOrEqual(tall.height + pad * 2 - 1e-6);
  });
});

describe("frameOrnaments", () => {
  it("offers only ornaments the library itself tags as frames", () => {
    const frames = frameOrnaments();
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(frame.tags).toContain(FRAME_TAG);
  });

  it("includes the default frame", () => {
    expect(frameOrnaments().some((f) => f.id === DEFAULT_FRAME_ID)).toBe(true);
  });
});

describe("buildNameDesign", () => {
  it("single applies the style and adds nothing", () => {
    const plan = buildNameDesign(
      { source: source(), layout: "single", fontFamily: "Thuluth", run },
      ids()
    );
    expect(plan.patch).toEqual({ fontFamily: "Thuluth" });
    expect(plan.added).toEqual([]);
  });

  it("muthanna adds one mirrored reflection at the measured offset", () => {
    const block = source();
    const plan = buildNameDesign(
      { source: block, layout: "muthanna", fontFamily: "Diwani", run },
      ids()
    );
    expect(plan.placement).toBe("front");
    expect(plan.added).toHaveLength(1);
    const mirror = plan.added[0];
    expect(mirror.type).toBe("mirror");
    if (mirror.type !== "mirror") return;
    expect(mirror.id).toBe(100);
    expect(mirror.sourceId).toBe(block.id);
    expect(mirror.mode).toBe("mirrorX");
    expect(mirror.x).toBeCloseTo(block.x + muthannaOffset(run), 6);
    expect(mirror.y).toBe(block.y);
    // The reflection carries the style just chosen, not the one replaced.
    expect(mirror.fontFamily).toBe("Diwani");
  });

  it("medallion turns the requested number of copies around the source", () => {
    const block = source();
    const plan = buildNameDesign(
      { source: block, layout: "medallion", fontFamily: "Kufi", run, radialCount: 9 },
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
    const plan = buildNameDesign(
      { source: source(), layout: "medallion", fontFamily: "Kufi", run, radialCount: 99 },
      ids()
    );
    const mirror = plan.added[0];
    if (mirror.type !== "mirror") throw new Error("expected a mirror block");
    expect(mirror.radialCount).toBe(resolveRadialCount(99));
  });

  it("framed inserts a centred image frame behind the name", () => {
    const block = source();
    const plan = buildNameDesign(
      {
        source: block,
        layout: "framed",
        fontFamily: "Amiri",
        run,
        frameId: DEFAULT_FRAME_ID,
        frameColor: "#8c1c13",
      },
      ids()
    );
    expect(plan.placement).toBe("behind");
    const frame = plan.added[0];
    expect(frame.type).toBe("image");
    if (frame.type !== "image") return;

    const def = getOrnament(DEFAULT_FRAME_ID);
    if (!def) throw new Error("the default frame ornament is missing");
    const box = frameBoxFor(def.viewBox, run);
    expect(frame.shapeWidth).toBeCloseTo(box.width, 6);
    expect(frame.shapeHeight).toBeCloseTo(box.height, 6);
    // An image block's x/y is its top-left corner while a centre-aligned text
    // block is centred on its own — so the frame is offset by half its box.
    expect(frame.x).toBeCloseTo(block.x - box.width / 2, 6);
    expect(frame.y).toBeCloseTo(block.y - box.height / 2, 6);
    expect(frame.imageDataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(frame.color).toBe("#8c1c13");
  });

  it("framed falls back to the default frame for an unknown id", () => {
    const plan = buildNameDesign(
      { source: source(), layout: "framed", fontFamily: "Amiri", run, frameId: "no-such-frame" },
      ids()
    );
    expect(plan.added).toHaveLength(1);
    expect(plan.added[0].name).toBe(getOrnament(DEFAULT_FRAME_ID)?.name);
  });

  it("framed defaults its colour rather than leaving it unset", () => {
    const plan = buildNameDesign(
      { source: source(), layout: "framed", fontFamily: "Amiri", run },
      ids()
    );
    expect(plan.added[0].color).toBe(DEFAULT_FRAME_COLOR);
  });

  it("takes every new id from the injected allocator", () => {
    const nextId = ids(500);
    const first = buildNameDesign(
      { source: source(), layout: "muthanna", fontFamily: "Kufi", run },
      nextId
    );
    const second = buildNameDesign(
      { source: source(), layout: "framed", fontFamily: "Kufi", run },
      nextId
    );
    expect(first.added[0].id).toBe(500);
    expect(second.added[0].id).toBe(501);
  });

  it("never patches anything but the style", () => {
    // The design must not move, rename or retype the block it is built around
    // — the user's text and position are theirs.
    for (const layout of NAME_LAYOUTS) {
      const plan = buildNameDesign(
        { source: source(), layout: layout.id, fontFamily: "Ruqaa", run },
        ids()
      );
      expect(Object.keys(plan.patch)).toEqual(["fontFamily"]);
    }
  });
});

describe("describeNameDesign", () => {
  it("distinguishes a style change from a composition", () => {
    const single = buildNameDesign(
      { source: source(), layout: "single", fontFamily: "Kufi", run },
      ids()
    );
    const muthanna = buildNameDesign(
      { source: source(), layout: "muthanna", fontFamily: "Kufi", run },
      ids()
    );
    expect(describeNameDesign(single)).toMatch(/style/i);
    expect(describeNameDesign(muthanna)).toMatch(/muthanna/i);
  });
});
