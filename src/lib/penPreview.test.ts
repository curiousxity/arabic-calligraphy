import { describe, expect, it } from "vitest";
import { previewForms } from "./penPreview";
import type { Form, Part, PenLibrary } from "./penLibrary";

const parts: Part[] = [{ id: "stem", name: "stem", paths: [{ start: { p: [0, -7] }, segs: [{ c1: [0, -14 / 3], c2: [0, -7 / 3], to: { p: [0, 0] } }] }] }];
const forms: Form[] = [{ id: "alif.standalone.t", letter: "ا", form: "standalone", parts: [{ part: "stem", at: [0, 0], body: true }], anchors: { above: [0, -8], below: [0, 1] } }];
const fixture: PenLibrary = { parts: new Map(parts.map((p) => [p.id, p])), forms: new Map(forms.map((f) => [f.id, f])), joins: {} };

describe("the authoring preview", () => {
  it("places a form's ink on its plate by origin and scale", () => {
    const p = previewForms(fixture, ["alif.standalone.t"], { file: "x.png", originPx: [500, 800], pxPerNuqta: 40 });
    // the centre line of a 7-nuqta alif rises 7*40 px above the origin
    expect(Math.min(...p.nodes.map((q) => q[1]))).toBeCloseTo(800 - 7 * 40, 6);
    expect(Math.max(...p.nodes.map((q) => q[1]))).toBeCloseTo(800, 6);
    // and its ink straddles that line
    const xs = p.strokes.flat(2).map((q) => q[0]);
    expect(Math.min(...xs)).toBeLessThan(500);
    expect(Math.max(...xs)).toBeGreaterThan(500);
  });

  it("lays several forms side by side on a blank sheet that holds them", () => {
    const p = previewForms(fixture, ["alif.standalone.t", "alif.standalone.t"], null);
    const xs = p.strokes.flat(2).map((q) => q[0]), ys = p.strokes.flat(2).map((q) => q[1]);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(p.size[0]);
    expect(Math.min(...ys)).toBeGreaterThan(0);
    expect(Math.max(...ys)).toBeLessThan(p.size[1]);
  });
});
