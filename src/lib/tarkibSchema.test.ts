import { describe, expect, it } from "vitest";
import { loadMarkGroups } from "./markLibrary";
import { analyzePhrase } from "./tarkibText";
import { formsFromName, loadTarkibLibrary } from "./tarkibSchema";
import { splitAtCut } from "./stackGeometry";
import { parseSvgPath } from "./svgPath";
import { outlineBounds } from "./strokeCuts";
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
    expect(formsFromName("Ain, middle, 3 (ـعـ)")).toEqual([{ skeleton: "ain", form: "middle" }]);
    expect(formsFromName("Ba, nun or ya tooth, starting, 2 (بـ)")).toEqual([{ skeleton: "ba", form: "starting" }]);
    expect(formsFromName("Qaf, middle, 1 (ـقـ)")).toEqual([{ skeleton: "fa", form: "middle" }]);
    expect(formsFromName("Initial beh (two dots) joined to sad (بص)")).toEqual([{ skeleton: "ba", form: "starting" }, { skeleton: "sad", form: "finishing" }]);
    expect(formsFromName("Joined ra (ـر)")).toEqual([{ skeleton: "ra", form: "finishing" }]);
    expect(formsFromName("Ba 1½ nuqtas wide, joined to a final letter, part 10")).toEqual([]);
  });

  it("every face a usable piece records cuts it legally, keeping the body", () => {
    const usable = new Set([...lib.single.values(), ...lib.multi.values()].flat());
    for (const s of usable) for (const [face, keep] of [[s.entry?.face, "far"], [s.exit?.face, "near"]] as const) {
      if (!face) continue;
      const r = splitAtCut(parseSvgPath(lib.items.get(s.id)!.d), face);
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
      expect(s.letters[0].form).toBe("middle");
      expect(s.entry!.angle).toBeCloseTo(Math.PI);
      expect(s.exit).toBeDefined();
    }
  });

  it("has a one-pen nuqta", () => {
    const b = outlineBounds(parseSvgPath(lib.nuqtaD));
    expect(b.x2 - b.x1).toBeGreaterThan(40);
    expect(b.x2 - b.x1).toBeLessThan(56);
  });
});
