import { describe, it, expect } from "vitest";
import { sanitizeLegacyBlocks } from "./legacySaves";

export const legacyText = { id: 1, type: "text", text: "حرف", fontFamily: "Amiri", fontSize: 72, color: "#000", x: 0, y: 0 };

describe("sanitizeLegacyBlocks", () => {
  it("drops shapeWarp blocks", () => {
    const out = sanitizeLegacyBlocks([legacyText, { ...legacyText, id: 4, type: "shapeWarp" }]);
    expect(out.map((b) => b.id)).toEqual([1]);
  });

  it("strips the Morph Glyph Editor and glyph-transform fields", () => {
    const [out] = sanitizeLegacyBlocks([{ ...legacyText, glyphEdits: [], glyphTransforms: [] }]);
    expect(out).toEqual(legacyText);
  });
});
