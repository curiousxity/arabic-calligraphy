import { describe, it, expect } from "vitest";
import { sanitizeLegacyBlocks } from "./legacySaves";
import { dropOrphanedMirrors } from "./mirror";
import { dropOrphanedAttachments } from "./guides";

const legacyText = { id: 1, type: "text", text: "حرف", fontFamily: "Amiri", fontSize: 72, color: "#000", x: 0, y: 0 };

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

  it("legacy squareKufi dropped, kufiPanel round-trips", () => {
    const panel = {
      ...legacyText,
      id: 2,
      type: "kufiPanel",
      text: "لا يكلف الله نفسا إلا وسعها",
      panelCols: 21,
      panelRows: 21,
      panelEdits: {
        forms: { 3: "lam.medial.1" },
        stretch: { 0: [2] },
        routes: { 1: 2 },
        pinned: { 5: { unitIndex: 5, key: "kaf:medial", glyphId: "kaf.medial.0", col: 4, row: 7, turn: 1, stretch: [0, 1] } },
        cells: [{ unitIndex: 2, key: "lam:initial", dx: 1, dy: -1, on: true }],
      },
    };
    const payload = {
      version: 5,
      blocks: [{ ...legacyText, id: 1, type: "squareKufi", kufiColumns: 12, kufiCellEdits: [] }, panel],
    };
    // The same chain App's applyParsedLayoutPayload runs on a loaded save.
    const parsed = JSON.parse(JSON.stringify(payload)) as { blocks: unknown[] };
    const out = dropOrphanedAttachments(dropOrphanedMirrors(sanitizeLegacyBlocks(parsed.blocks)));
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(panel);
  });
});
