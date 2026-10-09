/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as opentype from "opentype.js";
import { glyphPathToPdfOps, practiceSheetFilename } from "./practiceSheetPaths";

function loadFont(file: string): opentype.Font {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const data = fs.readFileSync(path.resolve(dir, "../../public/fonts", file));
  return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

describe("glyphPathToPdfOps", () => {
  it("translates, scales and flips y for move and line commands", () => {
    const ops = glyphPathToPdfOps(
      [
        { type: "M", x: 100, y: 200 },
        { type: "L", x: 300, y: 0 },
        { type: "Z" },
      ],
      0.01,
      10,
      50
    );
    expect(ops).toEqual([
      { op: "m", c: [11, 48] },
      { op: "l", c: [13, 50] },
      { op: "h" },
    ]);
  });

  it("promotes a quadratic to a cubic with the standard control-point formula", () => {
    const ops = glyphPathToPdfOps(
      [
        { type: "M", x: 0, y: 0 },
        { type: "Q", x1: 300, y1: 300, x: 600, y: 0 },
      ],
      1,
      0,
      0
    );
    // Q(P0, P1, P2) → C(P0 + 2/3 (P1−P0), P2 + 2/3 (P1−P2), P2), then y flipped.
    expect(ops[1].op).toBe("c");
    expect(ops[1].c).toEqual([200, -200, 400, -200, 600, 0]);
  });

  it("passes cubic commands through with y flipped", () => {
    const ops = glyphPathToPdfOps(
      [
        { type: "M", x: 0, y: 0 },
        { type: "C", x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
      ],
      1,
      0,
      0
    );
    expect(ops[1]).toEqual({ op: "c", c: [1, -2, 3, -4, 5, -6] });
  });

  it("converts a real Amiri glyph into a closed path list", () => {
    const font = loadFont("Amiri.ttf");
    const glyph = font.charToGlyph("ب");
    const ops = glyphPathToPdfOps(glyph.getPath(0, 0, font.unitsPerEm).commands, 0.02, 0, 0);
    expect(ops.length).toBeGreaterThan(4);
    expect(ops[0].op).toBe("m");
    expect(ops.some((o) => o.op === "h")).toBe(true);
    expect(ops.every((o) => o.op === "h" || (o.c ?? []).every(Number.isFinite))).toBe(true);
  });
});

describe("practiceSheetFilename", () => {
  it("keeps Arabic letters and replaces spaces and separators", () => {
    expect(practiceSheetFilename("بسم الله")).toBe("practice-بسم-الله.pdf");
  });

  it("falls back when the text has nothing usable", () => {
    expect(practiceSheetFilename("   ")).toBe("practice-sheet.pdf");
  });
});
