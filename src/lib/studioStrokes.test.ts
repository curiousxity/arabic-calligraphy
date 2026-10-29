import { describe, expect, it } from "vitest";
import fixture from "./studioStrokes.fixture.json";
import { CRUMB, penPathOf, strokeInk, validateStudioLibrary, type StudioLibrary, type StudioStroke } from "./studioStrokes";
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
