import { describe, expect, it } from "vitest";
import { DEFAULT_ANGLE, DOT_PULL, formEntry, formExit, formPaths, loadPenLibrary, NUQTA, PEN, validateLibrary, type Form, type Part, type PenLibrary } from "./penLibrary";
import { polygonArea, sweepPath } from "./penSweep";

const straight = (a: [number, number], b: [number, number]) => ({
  start: { p: a },
  segs: [{ c1: [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3] as [number, number], c2: [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3] as [number, number], to: { p: b } }],
});
const parts: Part[] = [
  { id: "stem", name: "stem", paths: [straight([0, -7], [0, 0])] },
  { id: "flat", name: "flat", paths: [straight([0, 0], [-2, 0])] },
  { id: "flat2", name: "flat2", paths: [straight([0, 0], [-3, 0])] },
  { id: "tuft", name: "tuft", drawn: ["M0 -7 L0.3 -7.4 L0.2 -6.8 Z"] },
];
const forms: Form[] = [
  { id: "alif.standalone.t", letter: "ا", form: "standalone", parts: [{ part: "stem", at: [0, 0], body: true }, { part: "tuft", at: [0, 0] }], anchors: { above: [0, -8], below: [0, 1] } },
  { id: "ba.finishing.t", letter: "ب", form: "finishing", parts: [{ part: "flat", at: [0, 0], body: true }, { part: "flat2", at: [-2, 0], body: true }], dots: [[-1, 1]], anchors: { above: [-2, -1], below: [-2, 1.5] } },
];
const lib = (fs: Form[], ps: Part[] = parts): PenLibrary => ({ parts: new Map(ps.map((p) => [p.id, p])), forms: new Map(fs.map((f) => [f.id, f])), joins: { "*": { gap: 0.5, rise: 0 } } });
const fixture = lib(forms);

describe("the stroke library", () => {
  it("concatenates a form's body parts into one path in writing order", () => {
    const { body, strokes, drawn } = formPaths(fixture, "ba.finishing.t", [0, 0]);
    expect(body!.segs).toHaveLength(2);
    expect(body!.segs[1].to.p).toEqual([-5 * NUQTA, 0]);
    expect(strokes).toHaveLength(0);
    expect(drawn).toHaveLength(0);
  });

  it("reports a body whose parts do not meet", () => {
    const gapped = lib([{ ...forms[1], id: "ya.starting.1", form: "starting", parts: [{ part: "flat", at: [0, 0], body: true }, { part: "flat2", at: [-2.5, 0], body: true }] }]);
    expect(validateLibrary(gapped)).toContain("ya.starting.1: body parts 1 and 2 do not meet");
  });

  it("reports a middle form with no exit", () => {
    const noExit = lib([{ id: "meem.middle.1", letter: "م", form: "middle", parts: [{ part: "tuft", at: [0, 0] }], anchors: { above: [0, -1], below: [0, 1] } }]);
    expect(validateLibrary(noExit)).toContain("meem.middle.1: a middle form needs a body with an entry and an exit");
  });

  it("converts nuqta to units and fills the default angle", () => {
    const { body, drawn } = formPaths(fixture, "alif.standalone.t", [10, 0]);
    expect(body!.start.p).toEqual([10, -7 * NUQTA]);
    expect(body!.start.angle).toBe(DEFAULT_ANGLE);
    expect(drawn).toHaveLength(1);
  });

  it("gives a form's entry and exit with the pen's direction of travel", () => {
    expect(formEntry(fixture, "ba.finishing.t")!.dir).toEqual([-1, 0]);
    expect(formExit(fixture, "ba.finishing.t")!.p).toEqual([-5 * NUQTA, 0]);
    expect(formExit(fixture, "ba.finishing.t")!.dir).toEqual([-1, 0]);
  });

  it("leaves a letter by the piece its part names: the exit is that piece's end, and the piece is no plain stroke", () => {
    // the studio's middle meem: the loop takes the pen in, and a band of its own carries it out over the top
    const loop: Part = { id: "loop", name: "loop", paths: [straight([0, 0], [1, 0]), straight([0.5, -0.5], [-3, 0.2])], exit: 1 };
    const l = lib([{ id: "meem.middle.t", letter: "م", form: "middle", parts: [{ part: "loop", at: [0, 0], body: true }], anchors: { above: [0, -1], below: [0, 1] } }], [loop]);
    const { body, exit, strokes } = formPaths(l, "meem.middle.t", [0, 0]);
    expect(body!.segs[0].to.p).toEqual([NUQTA, 0]);
    expect(exit!.start.p).toEqual([0.5 * NUQTA, -0.5 * NUQTA]);
    expect(strokes).toHaveLength(0);
    expect(formExit(l, "meem.middle.t")!.p).toEqual([-3 * NUQTA, 0.2 * NUQTA]);
    expect(formEntry(l, "meem.middle.t")!.p).toEqual([0, 0]);
    expect(formPaths(fixture, "ba.finishing.t", [0, 0]).exit).toBeNull();
  });

  it("reports an exit piece a part does not have", () => {
    const bad = lib([{ id: "meem.middle.t", letter: "م", form: "middle", parts: [{ part: "flat", at: [0, 0], body: true }], anchors: { above: [0, -1], below: [0, 1] } }], [{ ...parts[1], exit: 1 }]);
    expect(validateLibrary(bad)).toContain("meem.middle.t: body part flat has no piece 2 to leave by");
  });

  it("makes a dot the studio's: the nib, one pen at 149°, pulled 1.06 pens along 64° about the dot's centre", () => {
    // read off the studio's dots (أم أيمن, 2026-10-19): sides of 1.00 pen at 149.4° and 1.06 pens at 64.4°
    const { dots } = formPaths(fixture, "ba.finishing.t", [0, 0]);
    expect(dots).toHaveLength(1);
    const d = dots[0], end = d.segs[0].to;
    expect(d.start.angle).toBe(149);
    expect(end.angle).toBe(149);
    const pull = [end.p[0] - d.start.p[0], end.p[1] - d.start.p[1]];
    expect(Math.hypot(pull[0], pull[1]) / PEN).toBeCloseTo(1.06, 6);
    expect((Math.atan2(-pull[1], pull[0]) * 180) / Math.PI).toBeCloseTo(DOT_PULL, 6);
    expect(DOT_PULL).toBe(64);
    expect([(d.start.p[0] + end.p[0]) / 2, (d.start.p[1] + end.p[1]) / 2]).toEqual([-NUQTA, NUQTA]);
    const want = 1.06 * PEN * PEN * Math.abs(Math.sin(((DOT_PULL - 149) * Math.PI) / 180));
    expect(Math.abs(polygonArea(sweepPath(d, PEN)) - want) / want).toBeLessThan(0.01);
  });

  it("ships a library that validates", () => {
    expect(validateLibrary(loadPenLibrary())).toEqual([]);
  });
});
