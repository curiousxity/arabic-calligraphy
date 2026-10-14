import { describe, it, expect } from "vitest";
import { sanitizeLegacyBlocks } from "./legacySaves";
import { dropOrphanedMirrors } from "./mirror";

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

  it("drops image blocks and strips image and ornament fields from survivors", () => {
    const out = sanitizeLegacyBlocks([
      { ...legacyText, ornamental: true, imageScale: 2 },
      { ...legacyText, id: 2, type: "image", imageDataUrl: "data:," },
    ]);
    expect(out).toEqual([legacyText]);
  });

  it("a mirror of a removed image block is dropped by the orphan pass App runs next", () => {
    const out = dropOrphanedMirrors(
      sanitizeLegacyBlocks([
        legacyText,
        { ...legacyText, id: 2, type: "image", imageDataUrl: "data:," },
        { ...legacyText, id: 3, type: "mirror", sourceId: 2, mode: "mirrorX" },
      ])
    );
    expect(out.map((b) => b.id)).toEqual([1]);
  });
});
