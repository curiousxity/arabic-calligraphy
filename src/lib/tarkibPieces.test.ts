import { describe, expect, it } from "vitest";
import { loadTarkibLibrary } from "./tarkibSchema";
import { buildPiece } from "./tarkibPieces";
import { analyzePhrase, type LetterForm, type PhraseLetter } from "./tarkibText";
import { outlineBounds } from "./strokeCuts";
import type { SvgCmd } from "./svgPath";
import type { CutFace } from "../types";

const lib = await loadTarkibLibrary();

/** A PhraseLetter for `char` in `form`, through the real reader. */
function letter(char: string, form: LetterForm): PhraseLetter {
  const word = { standalone: char, starting: char + "ب", middle: "ب" + char + "ب", finishing: "ب" + char }[form];
  const ls = analyzePhrase(word).words[0].runs.flatMap((r) => r.letters);
  return ls.find((l) => l.char === char && l.form === form)!;
}
/** The straight bridge edge spliceJoin needs: an L segment between the face's two points. */
function hasBridgeEdge(cmds: SvgCmd[], f: CutFace): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  let prev: [number, number] | null = null;
  for (const c of cmds) {
    if (c.type === "L" && prev) {
      const ends = [prev, [c.x, c.y]] as const;
      const hit = (p: readonly number[], q: { 0: number; 1: number }) => near(p[0], q[0]) && near(p[1], q[1]);
      if ((hit(ends[0], f.a) && hit(ends[1], f.b)) || (hit(ends[0], f.b) && hit(ends[1], f.a))) return true;
    }
    if (c.type !== "Z") prev = [c.x, c.y];
  }
  return false;
}

describe("buildPiece", () => {
  it("cuts a spliced end at its face, leaving the bridge edge a join needs", () => {
    const s = lib.single.get("ba|starting")!.find((p) => p.exit?.face && !p.standIn)!;
    const b = buildPiece(lib, s.id, letter("ب", "starting"), "p1", 1, { splice: { exit: true } });
    expect(b.piece.faces).toHaveLength(1);
    expect(b.exit!.faceIndex).toBe(0);
    expect(hasBridgeEdge(b.piece.cmds, b.piece.faces[0])).toBe(true);
  });

  it("leaves a touching end whole and reports its anchor", () => {
    const s = lib.single.get("meem|middle")!.find((p) => p.entry && !p.entry.face)!;
    const b = buildPiece(lib, s.id, letter("م", "middle"), "p2", 1);
    expect(b.piece.faces).toEqual([]);
    expect(b.entry!.point).toEqual(s.entry!.point);
    expect(b.entry!.faceIndex).toBeUndefined();
  });

  it("refuses to splice an end with no face", () => {
    const s = lib.single.get("meem|middle")!.find((p) => p.entry && !p.entry.face)!;
    expect(() => buildPiece(lib, s.id, letter("م", "middle"), "p3", 1, { splice: { entry: true } })).toThrow(/no face/);
  });

  it("a dotless tooth gets the letter's dots from the nuqta, above or below", () => {
    const s = lib.single.get("ba|starting")!.find((p) => !p.ownDots)!;
    const t = buildPiece(lib, s.id, letter("ت", "starting"), "p4", 1);
    const top = outlineBounds(t.piece.cmds).y1;
    expect(t.dots).toHaveLength(2);
    expect(t.dots.every((d) => d.role === "mark" && d.parentId === "p4" && d.order === 1)).toBe(true);
    for (const d of t.dots) expect(d.y + d.pivot[1]).toBeLessThan(top);
    const b = buildPiece(lib, s.id, letter("ب", "starting"), "p5", 1);
    expect(b.dots).toHaveLength(1);
    expect(b.dots[0].y + b.dots[0].pivot[1]).toBeGreaterThan(outlineBounds(b.piece.cmds).y2);
  });

  it("carries the schema's stretch zones, for pulls by hand", () => {
    const s = [...lib.schema.values()].find((p) => p.stretch.length && lib.single.get(`${p.letters[0]?.skeleton}|${p.letters[0]?.form}`)?.includes(p))!;
    const b = buildPiece(lib, s.id, letter(s.letters[0].skeleton === "seen" ? "س" : "ب", s.letters[0].form), "p7", 1);
    expect(b.piece.stretch).toEqual(s.stretch);
  });

  it("a standalone form has no faces and no ends", () => {
    const b = buildPiece(lib, lib.single.get("alif|standalone")![0].id, letter("ا", "standalone"), "p6", 1);
    expect(b.piece.faces).toEqual([]);
    expect(b.entry).toBeUndefined();
    expect(b.exit).toBeUndefined();
    expect(b.piece).toMatchObject({ x: 0, y: 0, rotation: 0, homeX: 0, homeY: 0, role: "letter", order: 1 });
  });
});
