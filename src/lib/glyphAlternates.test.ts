import { describe, it, expect } from "vitest";
import {
  activeAlternates,
  activeStyleSets,
  alternatePanelView,
  alternatesKey,
  resolveAlternateTarget,
  charAtLetter,
  currentChoice,
  cycleAlternate,
  fallbackFeatureLabel,
  featureStringFor,
  isOptionalFeature,
  letterAtOffset,
  letterOffsets,
  setAlternate,
  type AlternateOption,
} from "./glyphAlternates";
import type { GlyphAlternate } from "../types";

const TATWEEL = "ـ";
const FATHA = "َ";

describe("letterOffsets", () => {
  it("skips tatweel and combining marks", () => {
    // ه + fatha + tatweel + ه
    expect(letterOffsets(`ه${FATHA}${TATWEEL}ه`)).toEqual([0, 3]);
  });

  it("is unchanged in letter count by inserting kashida", () => {
    expect(letterOffsets("سلام").length).toBe(letterOffsets(`سـلـام`).length);
  });

  it("maps offsets back to letters, -1 for skipped characters", () => {
    const text = `ه${TATWEEL}ه`;
    expect(letterAtOffset(text, 0)).toBe(0);
    expect(letterAtOffset(text, 1)).toBe(-1);
    expect(letterAtOffset(text, 2)).toBe(1);
    expect(letterAtOffset(text, 9)).toBe(-1);
    expect(charAtLetter(text, 1)).toBe("ه");
    expect(charAtLetter(text, 5)).toBeNull();
  });
});

describe("isOptionalFeature", () => {
  it("accepts the optional alternate tags and rejects default Arabic features", () => {
    for (const t of ["salt", "aalt", "jalt", "swsh", "ss01", "ss20", "cv01", "cv99"]) {
      expect(isOptionalFeature(t)).toBe(true);
    }
    for (const t of ["init", "medi", "fina", "isol", "rlig", "calt", "liga", "ss00", "ss21", "cv00", "ss01]"]) {
      expect(isOptionalFeature(t)).toBe(false);
    }
  });
});

describe("featureStringFor", () => {
  const alt = (letter: number, char: string, feature = "ss01", value = 1): GlyphAlternate => ({
    letter,
    char,
    feature,
    value,
  });

  it("emits one ranged feature per alternate, at the letter's offset", () => {
    expect(featureStringFor("هههه", [alt(1, "ه"), alt(3, "ه", "jalt", 2)])).toBe(
      "ss01[1:2]=1,jalt[3:4]=2"
    );
  });

  it("lands on the same letter after kashida is inserted before it", () => {
    expect(featureStringFor(`ه${TATWEEL}${TATWEEL}ه`, [alt(1, "ه")])).toBe("ss01[3:4]=1");
  });

  it("drops an alternate whose character no longer matches (a typed edit shifted it)", () => {
    expect(featureStringFor("بهه", [alt(0, "ه")])).toBe("");
  });

  it("ignores a malformed tag from a hand-edited save rather than splicing it in", () => {
    expect(featureStringFor("هه", [alt(0, "ه", "ss01]=1,liga")])).toBe("");
    expect(featureStringFor("هه", [alt(0, "ه", "liga")])).toBe("");
  });

  it("ignores non-positive or non-integer values", () => {
    expect(featureStringFor("هه", [alt(0, "ه", "salt", 0)])).toBe("");
    expect(featureStringFor("هه", [alt(0, "ه", "salt", 1.5)])).toBe("");
  });

  it("can leave one letter out, for probing that letter", () => {
    expect(featureStringFor("هههه", [alt(1, "ه"), alt(2, "ه")], 1)).toBe("ss01[2:3]=1");
  });

  it("activeAlternates keeps only the valid entries", () => {
    expect(activeAlternates("هه", [alt(0, "ه"), alt(1, "ب"), alt(7, "ه")])).toEqual([alt(0, "ه")]);
  });
});

describe("alternatesKey", () => {
  it("is empty for none and differs for different choices", () => {
    expect(alternatesKey(undefined)).toBe("");
    expect(alternatesKey([])).toBe("");
    const a = alternatesKey([{ letter: 0, char: "ه", feature: "ss01", value: 1 }]);
    const b = alternatesKey([{ letter: 0, char: "ه", feature: "ss02", value: 1 }]);
    expect(a).not.toBe(b);
  });
});

describe("cycleAlternate", () => {
  const options: AlternateOption[] = [
    { choice: null, glyphId: 1, label: "Default" },
    { choice: { feature: "ss01", value: 1 }, glyphId: 2, label: "Looped Haa" },
    { choice: { feature: "jalt", value: 1 }, glyphId: 3, label: "Justification" },
  ];

  it("steps forward and wraps to the default", () => {
    expect(cycleAlternate(options, null, 1)).toEqual({ feature: "ss01", value: 1 });
    expect(cycleAlternate(options, { feature: "jalt", value: 1 }, 1)).toBeNull();
  });

  it("steps backward and wraps to the last option", () => {
    expect(cycleAlternate(options, null, -1)).toEqual({ feature: "jalt", value: 1 });
  });

  it("treats a choice the list no longer offers as the default", () => {
    expect(cycleAlternate(options, { feature: "ss09", value: 1 }, 1)).toEqual({
      feature: "ss01",
      value: 1,
    });
  });
});

describe("setAlternate / currentChoice", () => {
  it("adds, replaces and removes the one entry for a letter, sorted by letter", () => {
    let list = setAlternate(undefined, 2, "ه", { feature: "ss01", value: 1 });
    list = setAlternate(list, 0, "ه", { feature: "jalt", value: 2 });
    expect(list.map((a) => a.letter)).toEqual([0, 2]);
    list = setAlternate(list, 2, "ه", { feature: "ss02", value: 1 });
    expect(currentChoice(list, 2)).toEqual({ feature: "ss02", value: 1 });
    list = setAlternate(list, 2, "ه", null);
    expect(currentChoice(list, 2)).toBeNull();
    expect(list).toHaveLength(1);
  });
});

describe("fallbackFeatureLabel", () => {
  it("names each family of tag plainly", () => {
    expect(fallbackFeatureLabel({ feature: "ss03", value: 1 })).toBe("Style set 3");
    expect(fallbackFeatureLabel({ feature: "cv12", value: 1 })).toBe("Variant 12");
    expect(fallbackFeatureLabel({ feature: "salt", value: 2 })).toBe("Alternate 2");
    expect(fallbackFeatureLabel({ feature: "jalt", value: 1 })).toBe("Justification");
    expect(fallbackFeatureLabel({ feature: "jalt", value: 3 })).toBe("Justification 3");
    expect(fallbackFeatureLabel({ feature: "swsh", value: 1 })).toBe("Swash");
  });
});

describe("malformed glyphAlternates from a hand-edited save", () => {
  const junk = [null, "ss01", 7, { letter: "x" }, { letter: 0, char: "ه", feature: 5, value: 1 }];

  it("never throws, and treats junk entries as absent", () => {
    expect(() => alternatesKey(junk as never)).not.toThrow();
    expect(activeAlternates("هه", junk as never)).toEqual([]);
    expect(featureStringFor("هه", junk as never)).toBe("");
    expect(currentChoice(junk as never, 0)).toBeNull();
  });

  it("tolerates a non-array value", () => {
    expect(alternatesKey("ss01" as never)).toBe("");
    expect(activeAlternates("هه", "ss01" as never)).toEqual([]);
    expect(featureStringFor("هه", { letter: 0 } as never)).toBe("");
    expect(setAlternate("ss01" as never, 0, "ه", { feature: "ss01", value: 1 })).toHaveLength(1);
  });
});

describe("alternatePanelView", () => {
  const target = {
    letter: 1,
    offset: 1,
    options: [
      { choice: null, glyphId: 1, label: "Default" },
      { choice: { feature: "ss01", value: 1 }, glyphId: 2, label: "Looped Haa" },
    ],
  };
  const settled = { letters: [target], fontHasAlternates: true, loading: false, hasFont: true };

  it("keeps showing the strip while a pick re-probes, so it never blinks out", () => {
    expect(alternatePanelView({ ...settled, loading: true }, 1)).toEqual({ kind: "strip", target });
  });

  it("shows loading only when there is nothing to show yet", () => {
    expect(alternatePanelView(undefined, null)).toEqual({ kind: "loading" });
    expect(
      alternatePanelView({ letters: [], fontHasAlternates: false, loading: true, hasFont: false }, 1)
    ).toEqual({ kind: "loading" });
  });

  it("covers the empty states", () => {
    expect(
      alternatePanelView({ letters: [], fontHasAlternates: false, loading: false, hasFont: true }, null)
    ).toEqual({ kind: "noFontAlternates" });
    expect(alternatePanelView(settled, null)).toEqual({ kind: "prompt" });
    expect(alternatePanelView(settled, 0)).toEqual({ kind: "noLetterAlternates" });
  });
});

describe("alternatePanelView: no letter in this text has alternates", () => {
  it("says so rather than prompting to click an outline that is not there", () => {
    expect(
      alternatePanelView({ letters: [], fontHasAlternates: true, loading: false, hasFont: true }, null)
    ).toEqual({ kind: "noTextAlternates" });
  });
});

describe("resolveAlternateTarget", () => {
  const target = { blockId: 3, letter: 1, char: "ه" };

  it("keeps the target while the same character is still at that letter", () => {
    expect(resolveAlternateTarget(target, 3, "سهم")).toBe(1);
  });

  it("drops it once a text edit has put a different character there", () => {
    expect(resolveAlternateTarget(target, 3, "سبهم")).toBeNull();
    expect(resolveAlternateTarget(target, 3, "س")).toBeNull();
  });

  it("ignores a target that belongs to another block, or none at all", () => {
    expect(resolveAlternateTarget(target, 4, "سهم")).toBeNull();
    expect(resolveAlternateTarget(null, 3, "سهم")).toBeNull();
  });
});

describe("style sets in the feature string", () => {
  const alt = (letter: number, feature: string, value = 1): GlyphAlternate => ({
    letter,
    char: "ه",
    feature,
    value,
  });

  it("applies a block's sets to the whole run, first", () => {
    expect(featureStringFor("هههه", [], undefined, ["ss01", "ss03"])).toBe("ss01,ss03");
  });

  it("switches the block's sets off on a letter with its own choice, then applies the choice", () => {
    expect(featureStringFor("هههه", [alt(1, "jalt", 2)], undefined, ["ss01"])).toBe(
      "ss01,ss01[1:2]=0,jalt[1:2]=2"
    );
  });

  it("'none' exempts one letter from the block's sets and adds nothing else", () => {
    expect(featureStringFor("هههه", [alt(2, "none")], undefined, ["ss01"])).toBe(
      "ss01,ss01[2:3]=0"
    );
    // Without block sets there is nothing to exempt the letter from.
    expect(featureStringFor("هههه", [alt(2, "none")])).toBe("");
  });

  it("only accepts ss01–ss20, once each, from a list of strings", () => {
    expect(activeStyleSets(["ss01", "ss01", "salt", "ss21", "ss01]=1,liga", 7, null] as never)).toEqual([
      "ss01",
    ]);
    expect(activeStyleSets("ss01" as never)).toEqual([]);
    expect(activeStyleSets(undefined)).toEqual([]);
  });

  it("alternatesKey still distinguishes a 'none' entry", () => {
    expect(alternatesKey([alt(0, "none")])).not.toBe("");
  });
});
