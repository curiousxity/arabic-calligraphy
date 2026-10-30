import { describe, expect, it } from "vitest";
import fixture from "./studioStrokes.fixture.json";
import { CRUMB, penPathOf, polygonsPath, shapeInk, strokeInk, studioGroups, validateStudioLibrary, type StudioLibrary, type StudioShape, type StudioStroke } from "./studioStrokes";
import { polygonArea, sweepPath, unionPolygons } from "./penSweep";
import * as clipping from "polygon-clipping";

// The fixture is cut from the built library (scripts/pen/studiolib.py): shape 001 (three one-pen strokes) and 457r,
// whose s0 is the r stroke's bend written as two strokes with its joint trimmed and filled to the studio edge
// (decision 54), plus the handles the fitter's own rule (studiolib.controls) gives one of its paths.
const lib = fixture as unknown as StudioLibrary & {
  expectHandles: { shape: string; stroke: string; pen: number; handles: [[number, number], [number, number]][] };
};
const pc = clipping as unknown as { intersection?: typeof clipping.intersection; default?: { intersection: typeof clipping.intersection } };
const intersection = pc.intersection ?? pc.default!.intersection;
const strokeOf = (shape: string, id: string) => lib.shapes[shape].strokes.find((s) => s.id === id)!;

describe("penPathOf", () => {
  it("rebuilds the fitter's cubic handles from the nodes", () => {
    const { shape, stroke, pen, handles } = lib.expectHandles;
    const path = penPathOf(strokeOf(shape, stroke).pens[pen]);
    expect(path.segs).toHaveLength(handles.length);
    path.segs.forEach((seg, i) => {
      expect(seg.c1[0]).toBeCloseTo(handles[i][0][0], 3);
      expect(seg.c1[1]).toBeCloseTo(handles[i][0][1], 3);
      expect(seg.c2[0]).toBeCloseTo(handles[i][1][0], 3);
      expect(seg.c2[1]).toBeCloseTo(handles[i][1][1], 3);
    });
  });

  it("reads a node's width, full when left out", () => {
    const path = penPathOf([[0, 0, 45], [10, 0, 50, 0.5]]);
    expect(path.start).toEqual({ p: [0, 0], angle: 45, width: 1 });
    expect(path.segs[0].to).toEqual({ p: [10, 0], angle: 50, width: 0.5 });
  });
});

describe("strokeInk", () => {
  it("sweeps a one-pen stroke into one solid shape", () => {
    const ink = strokeInk(strokeOf("001", "s2"), lib.pen, lib.ppn);
    expect(ink).toHaveLength(1);
    expect(ink[0]).toHaveLength(1);
    expect(polygonArea(ink)).toBeGreaterThan(0);
  });

  it("leaves no gap inside a stroke written in pieces, and no ink where the joint was trimmed", () => {
    const st = strokeOf("457r", "s0");
    expect(st.patches?.length).toBeGreaterThan(0);
    expect(st.erase?.length).toBeGreaterThan(0);
    const ink = strokeInk(st, lib.pen, lib.ppn);
    expect(ink).toHaveLength(1);
    expect(ink[0]).toHaveLength(1); // no hole: every gap inside the ink is filled
    const erased = st.erase!.map((r) => [r] as [number, number][][]);
    const left = intersection(ink as never, ...(erased as never[]));
    // what the patches put back where a trim ring touches the studio's ink is the only overlap left
    expect(polygonArea(left as never)).toBeLessThan(0.02 * polygonArea(erased as never));
  });

  it("is the pieces' union with the joint's trim and fill applied", () => {
    const st = strokeOf("457r", "s0");
    const raw = unionPolygons(st.pens.map((p) => sweepPath(penPathOf(p), lib.pen)));
    const ink = strokeInk(st, lib.pen, lib.ppn);
    // trims and patches touch only a thin band at the joint
    expect(Math.abs(polygonArea(ink) - polygonArea(raw)) / polygonArea(raw)).toBeLessThan(0.02);
  });

  it("draws a stroke whose trim meets its ink edge on nearly the same line (449r.s2)", () => {
    // polygon-clipping's difference threw "Unable to find segment ... in SweepLine tree" on this joint's erase rings
    // (the fixture keeps the rings that threw: a first build of every joint's trims, 2026-10-29)
    const st = strokeOf("449r", "s2");
    const ink = strokeInk(st, lib.pen, lib.ppn);
    const raw = unionPolygons(st.pens.map((p) => sweepPath(penPathOf(p), lib.pen)));
    expect(Math.abs(polygonArea(ink) - polygonArea(raw)) / polygonArea(raw)).toBeLessThan(0.02);
  });

  it("keeps a stroke smaller than a crumb", () => {
    const tiny = { id: "s0", recipe: "pen", pens: [[[0, 0, 45, 0.05], [0.3, 0, 45, 0.05]]] } as StudioStroke;
    const ink = strokeInk(tiny, lib.pen, lib.ppn);
    expect(ink).toHaveLength(1);
    expect(polygonArea(ink)).toBeLessThan(CRUMB * lib.ppn * lib.ppn);
  });
});

describe("validateStudioLibrary", () => {
  it("passes the built library's shapes", () => {
    expect(validateStudioLibrary(lib)).toEqual([]);
  });

  it("names a stroke with no pen", () => {
    const bad = { ...lib, shapes: { x: { ...lib.shapes["001"], strokes: [{ id: "s0", recipe: "pen", pens: [] }] } } } as unknown as StudioLibrary;
    expect(validateStudioLibrary(bad)).toEqual(["x.s0: no pen path"]);
  });
});

describe("polygonsPath", () => {
  it("writes each ring as a closed subpath, holes included", () => {
    const d = polygonsPath([[[[0, 0], [10, 0], [10, 10]], [[2, 2], [3, 2], [3, 3]]]]);
    expect(d).toBe("M0 0L10 0L10 10ZM2 2L3 2L3 3Z");
  });

  it("rounds to a hundredth", () => {
    expect(polygonsPath([[[[0.123, 1.006], [2, 2], [3, 0]]]])).toBe("M0.12 1.01L2 2L3 0Z");
  });
});

describe("shapeInk", () => {
  it("gives each stroke's ink, in the shape's order", () => {
    const inks = shapeInk(lib, "001");
    expect(inks.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
    for (const s of inks) expect(polygonArea(s.ink)).toBeGreaterThan(0);
  });
});

describe("studioGroups", () => {
  const shape = (group: string, form: string, variant: number, pairOf?: string): StudioShape =>
    ({ group, form, variant, ...(pairOf ? { pairOf } : {}), origin: [0, 0], strokes: [] });
  const many: StudioLibrary = {
    version: 1, ppn: 25.9, pen: 15.7, shapes: {
      "015": shape("Ba Ta Tha", "Isolated", 1), "001": shape("Alif", "Isolated", 1), "020": shape("Ba Ta Tha", "Final", 1),
      "016": shape("Ba Ta Tha", "Initial", 2), "017": shape("Ba Ta Tha", "Initial", 1), "020g": shape("Ba Ta Tha", "Final", 3, "020"),
    },
  };

  it("keeps the studio's order of letters, by their first shape", () => {
    expect(studioGroups(many).map((g) => g.group)).toEqual(["Alif", "Ba Ta Tha"]);
  });

  it("orders a letter's shapes by form, then variant, pair halves last", () => {
    expect(studioGroups(many)[1].shapes).toEqual(["015", "017", "016", "020", "020g"]);
  });
});
