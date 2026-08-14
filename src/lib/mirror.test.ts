import { describe, it, expect } from "vitest";
import type { Block, MirrorBlock, TextBlock } from "../types";
import {
  DEFAULT_RADIAL_COUNT,
  DEFAULT_RADIAL_RADIUS,
  NEW_MIRROR_OFFSET,
  RADIAL_COUNT_MAX,
  RADIAL_COUNT_MIN,
  buildMirrorBlock,
  canMirrorSourceId,
  dropOrphanedMirrors,
  hasOrphanedMirrors,
  isMirrorSourceCandidate,
  radialCopyTransforms,
  resolveMirrorSource,
  resolveRadialCount,
  resolveRadialRadius,
} from "./mirror";

const text = (id: number, patch: Partial<TextBlock> = {}): TextBlock => ({
  id,
  type: "text",
  text: "حرف",
  x: 10,
  y: 20,
  fontSize: 53,
  color: "#1e3a5f",
  fontFamily: "FatemiMaqala",
  stroke: "#000000",
  shadowColor: "#000000",
  ...patch,
});

const mirror = (id: number, sourceId: number, patch: Partial<MirrorBlock> = {}): MirrorBlock => ({
  ...text(id),
  type: "mirror",
  sourceId,
  mode: "mirrorX",
  ...patch,
});

describe("radialCopyTransforms", () => {
  it("spaces `count` copies evenly around a full turn, starting at 0°", () => {
    const copies = radialCopyTransforms(4, 100);
    expect(copies.map((c) => c.rotation)).toEqual([0, 90, 180, 270]);
  });

  it("pushes each copy `radius` out along its own spoke", () => {
    const [east, south, west, north] = radialCopyTransforms(4, 100);
    expect(east.x).toBeCloseTo(100);
    expect(east.y).toBeCloseTo(0);
    expect(south.x).toBeCloseTo(0);
    expect(south.y).toBeCloseTo(100);
    expect(west.x).toBeCloseTo(-100);
    expect(west.y).toBeCloseTo(0);
    expect(north.x).toBeCloseTo(0);
    expect(north.y).toBeCloseTo(-100);
  });

  it("keeps every copy exactly `radius` from the origin", () => {
    for (const copy of radialCopyTransforms(7, 63)) {
      expect(Math.hypot(copy.x, copy.y)).toBeCloseTo(63);
    }
  });

  it("stacks every copy on the origin at radius 0, still each with its own angle", () => {
    const copies = radialCopyTransforms(3, 0);
    expect(copies.map((c) => c.rotation)).toEqual([0, 120, 240]);
    for (const copy of copies) {
      expect(copy.x).toBeCloseTo(0);
      expect(copy.y).toBeCloseTo(0);
    }
  });

  it("clamps the count into the supported range", () => {
    expect(radialCopyTransforms(1, 10)).toHaveLength(RADIAL_COUNT_MIN);
    expect(radialCopyTransforms(99, 10)).toHaveLength(RADIAL_COUNT_MAX);
  });

  it("falls back to the defaults when the stored values are missing", () => {
    const copies = radialCopyTransforms(undefined, undefined);
    expect(copies).toHaveLength(DEFAULT_RADIAL_COUNT);
    expect(Math.hypot(copies[0].x, copies[0].y)).toBeCloseTo(DEFAULT_RADIAL_RADIUS);
  });
});

describe("resolveRadialCount / resolveRadialRadius", () => {
  it("rounds a fractional count", () => {
    expect(resolveRadialCount(5.4)).toBe(5);
    expect(resolveRadialCount(5.6)).toBe(6);
  });

  it("clamps a corrupted count rather than trusting it", () => {
    expect(resolveRadialCount(-4)).toBe(RADIAL_COUNT_MIN);
    expect(resolveRadialCount(1000)).toBe(RADIAL_COUNT_MAX);
    expect(resolveRadialCount(Number.NaN)).toBe(DEFAULT_RADIAL_COUNT);
  });

  it("passes a finite radius through, including a negative one", () => {
    expect(resolveRadialRadius(0)).toBe(0);
    expect(resolveRadialRadius(-40)).toBe(-40);
    expect(resolveRadialRadius(undefined)).toBe(DEFAULT_RADIAL_RADIUS);
  });
});

describe("cycle guard", () => {
  it("accepts every non-mirror block as a source", () => {
    expect(isMirrorSourceCandidate(text(1))).toBe(true);
  });

  it("rejects a mirror as a source — one level only", () => {
    expect(isMirrorSourceCandidate(mirror(2, 1))).toBe(false);
  });

  it("rejects a missing block", () => {
    expect(isMirrorSourceCandidate(undefined)).toBe(false);
    expect(isMirrorSourceCandidate(null)).toBe(false);
  });

  it("answers the same question by id against a block list", () => {
    const blocks: Block[] = [text(1), mirror(2, 1)];
    expect(canMirrorSourceId(blocks, 1)).toBe(true);
    expect(canMirrorSourceId(blocks, 2)).toBe(false);
    expect(canMirrorSourceId(blocks, 99)).toBe(false);
  });
});

describe("resolveMirrorSource", () => {
  it("finds the source block by id", () => {
    const source = text(1);
    expect(resolveMirrorSource([source, mirror(2, 1)], mirror(2, 1))).toBe(source);
  });

  it("returns null when the source is gone", () => {
    expect(resolveMirrorSource([mirror(2, 1)], mirror(2, 1))).toBeNull();
  });

  it("returns null when the source is itself a mirror", () => {
    const blocks: Block[] = [text(1), mirror(2, 1), mirror(3, 2)];
    expect(resolveMirrorSource(blocks, mirror(3, 2))).toBeNull();
  });
});

describe("dropOrphanedMirrors", () => {
  it("keeps mirrors whose source is present", () => {
    const blocks: Block[] = [text(1), mirror(2, 1)];
    expect(dropOrphanedMirrors(blocks)).toEqual(blocks);
  });

  it("drops a mirror whose source was deleted", () => {
    const blocks: Block[] = [text(1), mirror(2, 99)];
    expect(dropOrphanedMirrors(blocks).map((b) => b.id)).toEqual([1]);
  });

  it("drops a mirror pointing at another mirror (a save from a broken writer)", () => {
    const blocks: Block[] = [text(1), mirror(2, 1), mirror(3, 2)];
    expect(dropOrphanedMirrors(blocks).map((b) => b.id)).toEqual([1, 2]);
  });

  it("never touches non-mirror blocks", () => {
    const blocks: Block[] = [text(1), text(2), text(3)];
    expect(dropOrphanedMirrors(blocks)).toEqual(blocks);
  });

  it("agrees with hasOrphanedMirrors", () => {
    expect(hasOrphanedMirrors([text(1), mirror(2, 1)])).toBe(false);
    expect(hasOrphanedMirrors([text(1), mirror(2, 99)])).toBe(true);
  });
});

describe("buildMirrorBlock", () => {
  it("points at the source and sits beside it", () => {
    const source = text(1, { x: 100, y: 40 });
    const built = buildMirrorBlock(7, source, "mirrorX");
    expect(built).toMatchObject({
      id: 7,
      type: "mirror",
      sourceId: 1,
      mode: "mirrorX",
      x: 100 + NEW_MIRROR_OFFSET,
      y: 40,
    });
  });

  it("gives a radial block the defaults and leaves it on the source's own origin", () => {
    const source = text(1, { x: 100, y: 40 });
    const built = buildMirrorBlock(7, source, "radial");
    expect(built).toMatchObject({
      mode: "radial",
      radialCount: DEFAULT_RADIAL_COUNT,
      radialRadius: DEFAULT_RADIAL_RADIUS,
      x: 100,
      y: 40,
    });
  });

  it("leaves the radial fields unset for a reflection", () => {
    const built = buildMirrorBlock(7, text(1), "mirrorY");
    expect(built.radialCount).toBeUndefined();
    expect(built.radialRadius).toBeUndefined();
  });

  it("produces a block that is not itself a legal source", () => {
    expect(isMirrorSourceCandidate(buildMirrorBlock(7, text(1), "mirrorX"))).toBe(false);
  });
});
