import { describe, expect, it } from "vitest";
import { resolveKufiText } from "./kufiWords";

describe("resolveKufiText", () => {
  it("treats الله as one allah unit", () => {
    const { units } = resolveKufiText("الله");
    expect(units).toHaveLength(1);
    expect(units[0].skeleton).toBe("allah");
  });

  it("fuses lam-alef", () => {
    const { units } = resolveKufiText("لا");
    expect(units).toHaveLength(1);
    expect(units[0].skeleton).toBe("lamAlef");
  });

  it("numbers words and ends joins at word ends and non-joiners", () => {
    const { units } = resolveKufiText("لا يكلف الله نفسا إلا وسعها");
    expect(units[0].wordIndex).toBe(0);
    expect(Math.max(...units.map((u) => u.wordIndex))).toBe(5);
    const words = [...new Set(units.map((u) => u.wordIndex))];
    expect(words).toEqual([0, 1, 2, 3, 4, 5]);
    for (const w of words) {
      const wu = units.filter((u) => u.wordIndex === w);
      expect(wu[wu.length - 1].joinsNext).toBe(false);
    }
    const sk = units.filter((u) => u.wordIndex === 3).map((u) => [u.skeleton, u.joinsNext]);
    expect(sk).toEqual([["noon", true], ["feh", true], ["seen", true], ["alef", false]]);
  });

  it("drops harakat and reports latin", () => {
    const { units, unsupported } = resolveKufiText("بِسمِ abc");
    expect(units.map((u) => u.skeleton)).toEqual(["beh", "seen", "meem"]);
    expect(unsupported).toEqual(["a", "b", "c"]);
  });

  it("records offsets and keys", () => {
    const { units } = resolveKufiText("بِس");
    expect(units[1].textOffset).toBe(2);
    expect(units[1].key).toBe("seen:final");
    expect(units[0].joinsNext).toBe(true);
  });
});
