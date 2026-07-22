import { describe, it, expect } from "vitest";
import { classifyJoiningForms } from "./arabicJoining";

describe("classifyJoiningForms", () => {
  it("gives a lone dual-joining letter the isolated form", () => {
    const [beh] = classifyJoiningForms("ب");
    expect(beh.form).toBe("isolated");
  });

  it("classifies initial/final across a two-letter dual-joining word", () => {
    const [beh, teh] = classifyJoiningForms("بت");
    expect(beh.form).toBe("initial");
    expect(teh.form).toBe("final");
  });

  it("classifies the middle letter of a three-letter word as medial", () => {
    const [, teh] = classifyJoiningForms("بتب");
    expect(teh.form).toBe("medial");
  });

  it("right-joining letters never take initial/medial forms", () => {
    // ALEF (R) followed by BEH (D): alef can't pass a join forward, so both
    // end up isolated even though they sit next to each other.
    const [alef, beh] = classifyJoiningForms("اب");
    expect(alef.form).toBe("isolated");
    expect(beh.form).toBe("isolated");

    // But a preceding dual-joining letter still joins INTO a right-joining one.
    const [teh, dal] = classifyJoiningForms("تد");
    expect(teh.form).toBe("initial");
    expect(dal.form).toBe("final");
  });

  it("skips transparent combining marks (diacritics) without breaking the join chain", () => {
    // BEH + FATHA (U+064B, transparent) + TEH
    const chars = classifyJoiningForms("بًت");
    expect(chars[0].form).toBe("initial");
    expect(chars[1].form).toBeNull();
    expect(chars[2].form).toBe("final");
  });

  it("a space breaks the join chain", () => {
    const chars = classifyJoiningForms("ب ت");
    expect(chars[0].form).toBe("isolated");
    expect(chars[1].form).toBeNull();
    expect(chars[2].form).toBe("isolated");
  });
});
