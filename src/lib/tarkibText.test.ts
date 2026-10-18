import { describe, expect, it } from "vitest";
import { analyzePhrase } from "./tarkibText";

describe("analyzePhrase", () => {
  it("splits the first target into words and connected runs", () => {
    const a = analyzePhrase("أُمّ أَيْمَن الحُبّ حَيَاتِي");
    expect(a.words.map((w) => w.runs.map((r) => r.letters.map((l) => l.char).join("")))).toEqual([
      ["أ", "م"], ["أ", "يمن"], ["ا", "لحب"], ["حيا", "تي"],
    ]);
    expect(a.hasVowels).toBe(true);
    expect(a.unsupported).toEqual([]);
  });

  it("gives forms by position in the run", () => {
    const [run] = analyzePhrase("يمن").words[0].runs;
    expect(run.letters.map((l) => [l.skeleton, l.form])).toEqual([["ba", "starting"], ["meem", "middle"], ["nun", "finishing"]]);
  });

  it("attaches marks to their letter and keeps shadda with its vowel", () => {
    const m = analyzePhrase("أُمّ").words[0].runs[1].letters[0];
    expect(m.marks).toEqual(["ّ"]);
    const alif = analyzePhrase("أُمّ").words[0].runs[0].letters[0];
    expect(alif).toMatchObject({ skeleton: "alif", hamza: "above", marks: ["ُ"] });
  });

  it("maps hamza seats, ta marbuta and alif maqsura", () => {
    const ls = analyzePhrase("سئل مؤمن رحمة على").words.flatMap((w) => w.runs.flatMap((r) => r.letters));
    expect(ls.find((l) => l.char === "ئ")).toMatchObject({ skeleton: "ba", hamza: "above", dots: { count: 0 } });
    expect(ls.find((l) => l.char === "ؤ")).toMatchObject({ skeleton: "waw", hamza: "above" });
    expect(ls.find((l) => l.char === "ة")).toMatchObject({ skeleton: "ha", dots: { count: 2, side: "above" } });
    expect(ls.find((l) => l.char === "ى")).toMatchObject({ skeleton: "ya", dots: { count: 0 } });
  });

  it("treats lam-alif and the word Allah as one letter", () => {
    expect(analyzePhrase("سلام").words[0].runs.map((r) => r.letters.map((l) => l.skeleton))).toEqual([["seen", "lamalif"], ["meem"]]);
    expect(analyzePhrase("الله").words[0].runs[0].letters).toMatchObject([{ skeleton: "allah", form: "standalone" }]);
  });

  it("lists what it cannot draw", () => {
    expect(analyzePhrase("محمد 7 abc!").unsupported).toEqual(["7", "a", "b", "c", "!"]);
    expect(analyzePhrase("حياتي").hasVowels).toBe(false);
  });

  it("a final nun and ya take their own skeletons, a medial one the tooth", () => {
    const ls = analyzePhrase("بين").words[0].runs[0].letters;
    expect(ls.map((l) => [l.skeleton, l.form, l.dots])).toEqual([
      ["ba", "starting", { count: 1, side: "below" }],
      ["ba", "middle", { count: 2, side: "below" }],
      ["nun", "finishing", { count: 1, side: "above" }],
    ]);
  });
});
