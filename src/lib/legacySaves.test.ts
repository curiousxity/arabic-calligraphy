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

  it("drops squareKufi blocks and strips kufi fields from survivors", () => {
    const out = sanitizeLegacyBlocks([
      { ...legacyText, kufiColumns: 3 },
      { ...legacyText, id: 2, type: "squareKufi", kufiColumns: 4, kufiCellEdits: [] },
    ]);
    expect(out).toEqual([legacyText]);
  });

  it("strips warpX and warpY", () => {
    const [out] = sanitizeLegacyBlocks([{ ...legacyText, warpX: 40, warpY: -10 }]);
    expect(out).toEqual(legacyText);
  });
});
