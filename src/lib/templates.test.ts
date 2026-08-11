import { describe, it, expect } from "vitest";
import { STARTER_TEMPLATES, buildBlocksFromTemplate } from "./templates";

describe("STARTER_TEMPLATES fields", () => {
  it("every template has exactly one field per block", () => {
    for (const t of STARTER_TEMPLATES) {
      expect(t.fields, `${t.id} is missing fields`).toBeDefined();
      expect(t.fields!.length).toBe(t.blocks.length);
    }
  });

  it("every field's blockIndex is a valid, unique index into that template's blocks", () => {
    for (const t of STARTER_TEMPLATES) {
      const indices = t.fields!.map((f) => f.blockIndex).sort();
      expect(indices).toEqual(t.blocks.map((_, i) => i).sort());
    }
  });

  it("every field has a non-empty label", () => {
    for (const t of STARTER_TEMPLATES) {
      for (const f of t.fields!) {
        expect(f.label.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("buildBlocksFromTemplate", () => {
  const eidGreeting = STARTER_TEMPLATES.find((t) => t.id === "eid-greeting")!;
  const bismillah = STARTER_TEMPLATES.find((t) => t.id === "bismillah-card")!;

  it("reproduces the original blocks when every value matches the default", () => {
    const defaults = eidGreeting.fields!.map((f) => eidGreeting.blocks[f.blockIndex].text);
    const result = buildBlocksFromTemplate(eidGreeting, defaults);
    expect(result.map((b) => b.text)).toEqual(eidGreeting.blocks.map((b) => b.text));
  });

  it("applies an edited value to the correct block by index, leaving the other block untouched", () => {
    const result = buildBlocksFromTemplate(eidGreeting, ["عيد سعيد", "كل عام وأنتم بخير"]);
    expect(result[0].text).toBe("عيد سعيد");
    expect(result[1].text).toBe("كل عام وأنتم بخير");
  });

  it("falls back to the original text for a blank value", () => {
    const result = buildBlocksFromTemplate(eidGreeting, ["", "   "]);
    expect(result[0].text).toBe(eidGreeting.blocks[0].text);
    expect(result[1].text).toBe(eidGreeting.blocks[1].text);
  });

  it("does not mutate the original template", () => {
    const originalText = bismillah.blocks[0].text;
    buildBlocksFromTemplate(bismillah, ["something else entirely"]);
    expect(bismillah.blocks[0].text).toBe(originalText);
  });

  it("preserves every other block property (font, color, size, position) unchanged", () => {
    const result = buildBlocksFromTemplate(bismillah, ["new text"]);
    expect(result[0].fontFamily).toBe(bismillah.blocks[0].fontFamily);
    expect(result[0].color).toBe(bismillah.blocks[0].color);
    expect(result[0].fontSize).toBe(bismillah.blocks[0].fontSize);
    expect(result[0].x).toBe(bismillah.blocks[0].x);
    expect(result[0].y).toBe(bismillah.blocks[0].y);
  });
});
