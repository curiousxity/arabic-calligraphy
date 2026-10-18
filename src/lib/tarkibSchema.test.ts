import { describe, expect, it } from "vitest";
import { loadMarkGroups } from "./markLibrary";
import { analyzePhrase } from "./tarkibText";
import { formsFromName, loadTarkibLibrary } from "./tarkibSchema";
import { splitAtCut } from "./stackGeometry";
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
