import { describe, expect, it } from "vitest";
import { loadMarkGroups } from "./markLibrary";
import { analyzePhrase } from "./tarkibText";
import { formsFromName, loadTarkibLibrary } from "./tarkibSchema";
import { splitAtCut } from "./stackGeometry";
import { leavesStub } from "./tarkibEnds";
import { parseSvgPath } from "./svgPath";
import { flattenContours, outlineBounds } from "./strokeCuts";
import { pointInPolygon } from "./svgPath";
import type { SvgCmd } from "./svgPath";

const lib = await loadTarkibLibrary();
const area = (cmds: SvgCmd[]) => { const b = outlineBounds(cmds); return (b.x2 - b.x1) * (b.y2 - b.y1); };

describe("tarkib piece schema", () => {
  it("has a schema entry for every Thuluth piece", async () => {
    const groups = await loadMarkGroups();
    const ids = groups.find((g) => g.id === "thuluth")!.items.map((i) => i.id);
    for (const id of ids) expect(lib.schema.has(id), id).toBe(true);
  });

  it("reads letters and forms from the pieces' names", () => {
    expect(formsFromName("Ain, middle, 3 (ـعـ)")).toEqual([{ char: "ع", skeleton: "ain", form: "middle" }]);
    expect(formsFromName("Ba, nun or ya tooth, starting, 2 (بـ)")).toEqual([{ char: "ب", skeleton: "ba", form: "starting" }]);
    expect(formsFromName("Qaf, middle, 1 (ـقـ)")).toEqual([{ char: "ق", skeleton: "fa", form: "middle" }]);
    expect(formsFromName("Initial beh (two dots) joined to sad (بص)")).toEqual([{ char: "ب", skeleton: "ba", form: "starting" }, { char: "ص", skeleton: "sad", form: "finishing" }]);
    expect(formsFromName("Joined ra (ـر)")).toEqual([{ char: "ر", skeleton: "ra", form: "finishing" }]);
    expect(formsFromName("Ta marbuta, finishing, 2 (ـة), second set")).toEqual([{ char: "ة", skeleton: "ha", form: "finishing" }]);
    expect(formsFromName("Meem, middle, 1 (ـمـ), second set (?)")).toEqual([{ char: "م", skeleton: "meem", form: "middle" }]);
    expect(formsFromName("Ba 1½ nuqtas wide, joined to a final letter, part 10")).toEqual([]);
  });

  it("every face a usable piece records cuts it legally, keeping the body", () => {
    const usable = new Set([...lib.single.values(), ...lib.multi.values()].flat());
    for (const s of usable) for (const [face, keep] of [[s.entry?.face, "far"], [s.exit?.face, "near"]] as const) {
      if (!face) continue;
      const r = splitAtCut(parseSvgPath(lib.items.get(s.itemId)!.d), face);
      expect(r, s.id).not.toBeNull();
      const kept = keep === "far" ? r!.far : r!.near, cut = keep === "far" ? r!.near : r!.far;
      expect(area(kept), s.id).toBeGreaterThan(area(cut));
    }
  });

  it("usable pieces carry the faces their forms need", () => {
    for (const s of new Set([...lib.single.values(), ...lib.multi.values()].flat())) {
      const first = s.letters[0].form, last = s.letters[s.letters.length - 1].form;
      if (first === "middle" || first === "finishing") expect(s.entry, s.id).toBeDefined();
      if (last === "starting" || last === "middle") expect(s.exit, s.id).toBeDefined();
    }
  });

  it("covers every letter of the first target", () => {
    for (const l of analyzePhrase("أُمّ أَيْمَن الحُبّ حَيَاتِي").words.flatMap((w) => w.runs.flatMap((r) => r.letters)))
      expect(lib.single.get(`${l.skeleton}|${l.form}`)?.length ?? 0, `${l.char} ${l.form}`).toBeGreaterThan(0);
  });

  it("a letter with no middle form gets its starting forms as stand-ins, entered at the foot", () => {
    const mids = lib.single.get("jeem|middle")!;
    expect(mids.length).toBeGreaterThan(0);
    for (const s of mids.filter((m) => m.standIn)) {
      expect(lib.schema.get(s.id)).toBe(s);
      expect(s.id).toBe(`${s.itemId}@middle`);
      expect(s.letters[0].form).toBe("middle");
      expect(s.entry!.angle).toBeCloseTo(Math.PI);
      expect(s.exit).toBeDefined();
    }
  });

  it("has the second set's real middle forms, and a dotted piece serves only its own letter", () => {
    const mids = lib.single.get("jeem|middle")!;
    expect(mids.some((s) => s.itemId.startsWith("thuluth-w3-") && !s.standIn)).toBe(true);
    for (const s of mids.filter((m) => m.ownDots)) expect(["ج", "خ"]).toContain(s.letters[0].char);
  });

  it("a second-set piece of a dotted letter draws its own dots, even a touching pair", () => {
    // the ya's two dots are one shape on that sheet; read as no dots, the
    // composer added a second pair under it
    const ya = [...lib.schema.values()].find((s) => s.itemId === "thuluth-w3-27")!;
    expect(ya.letters[0].char).toBe("ي");
    expect(ya.ownDots).toBe(true);
    const alif = [...lib.schema.values()].find((s) => s.itemId.startsWith("thuluth-w1-") && s.letters[0]?.char === "ا")!;
    expect(alif.ownDots).toBe(false);
  });

  it("never trims away a counter: every join cut keeps all the piece's contours", () => {
    const count = (c: SvgCmd[]) => c.filter((k) => k.type === "M").length;
    for (const s of lib.schema.values()) {
      const cmds = parseSvgPath(lib.items.get(s.itemId)!.d);
      for (const [end, keep] of [["entry", "far"], ["exit", "near"]] as const) {
        const f = s[end]?.face;
        if (!f) continue;
        const r = splitAtCut(cmds, f)!;
        expect(count(keep === "far" ? r.far : r.near), `${s.id} ${end}`).toBe(count(cmds));
      }
    }
  });

  it("offers only trims that leave no corner of the old end standing, wherever one does", () => {
    // the alif foot (thuluth-v3-25) and the ha (thuluth-w3-6) of the first
    // target: their shallow trims ran out through the designer's slanted end
    // and left its corner as a step beside the bridge
    let checked = 0;
    for (const s of lib.schema.values()) {
      const cmds = parseSvgPath(lib.items.get(s.itemId)!.d);
      for (const [end, keep] of [["entry", "far"], ["exit", "near"]] as const) {
        const e = s[end];
        if (!e?.options) continue;
        const stub = e.options.map((f) => {
          const r = splitAtCut(cmds, f)!;
          const t: [number, number] = [Math.cos(f.angle), Math.sin(f.angle)];
          return leavesStub(keep === "far" ? r.far : r.near, r.nearFace, keep === "far" ? t : [-t[0], -t[1]]);
        });
        if (stub.includes(false)) { expect(stub, `${s.id} ${end}`).not.toContain(true); checked++; }
      }
    }
    expect(checked).toBeGreaterThan(100);
    for (const id of ["thuluth-v3-25", "thuluth-w3-6"]) expect(lib.schema.get(id)?.entry?.options?.length, id).toBeGreaterThan(0);
  });

  it("keeps most generated join faces: a cut window wide enough for a tapering stroke", () => {
    // sized to the flat edge alone, 445 of 714 windows missed the stroke's
    // second crossing and the piece could only join by touch (no climbs)
    let exits = 0, entries = 0;
    for (const s of lib.schema.values()) { if (s.exit?.face) exits++; if (s.entry?.face) entries++; }
    expect(exits).toBeGreaterThan(100);
    expect(entries).toBeGreaterThan(100);
  });

  it("draws every source at one scale: the bought alifs stand within a quarter of the scans' alif", () => {
    // the bought alif cells were once cut ~1.5x too large (their upright
    // stems measured as the full pen): thuluth/nibScale.py corrects them
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const alifs = lib.single.get("alif|standalone")!.filter((s) => !s.standIn);
    const h = (re: RegExp) => median(alifs.filter((s) => re.test(s.itemId)).map((s) => lib.items.get(s.itemId)!.h));
    const scans = h(/^thuluth-(?![vw]\d)/);
    for (const re of [/^thuluth-v\d/, /^thuluth-w\d/]) {
      expect(h(re) / scans, String(re)).toBeGreaterThan(0.8);
      expect(h(re) / scans, String(re)).toBeLessThan(1.25);
    }
  });

  it("has a pen-stamp nuqta: a rhombus with pen-wide sides, solid across", () => {
    const contours = flattenContours(parseSvgPath(lib.nuqtaD)) as [number, number][][];
    const b = outlineBounds(parseSvgPath(lib.nuqtaD));
    expect(b.x2 - b.x1).toBeGreaterThan(60);
    expect(b.x2 - b.x1).toBeLessThan(76);
    let solid = 0;
    for (let x = -30; x <= 30; x += 2) if (contours.some((c) => pointInPolygon(x, 0, c))) solid++;
    expect(solid).toBeGreaterThanOrEqual(29);
  });
});
