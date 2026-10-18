import { describe, expect, it } from "vitest";
import { loadTarkibLibrary } from "./tarkibSchema";
import { chainPhraseOnLine, chainRun, defaultChoice } from "./tarkibChain";
import { analyzePhrase } from "./tarkibText";
import { assembleStackOutlineReport, pieceTransform } from "./stackOutline";
import { transformCmds } from "./stackGeometry";
import { flattenContours, outlineBounds } from "./strokeCuts";
import { pointInPolygon } from "./svgPath";
import type { StackPiece } from "../types";

const lib = await loadTarkibLibrary();
const NIB = { width: 48, minFraction: 0.5 };
const centreX = (p: StackPiece) => { const b = outlineBounds(p.cmds); return p.x + (b.x1 + b.x2) / 2; };

describe("chainRun", () => {
  it("meets every pair at its anchors and splices whatever joins it made", () => {
    const run = analyzePhrase("حياتي").words[0].runs[0];          // ح ي ا: the alif ends the run
    const c = chainRun(lib, run, defaultChoice(lib, run)!, "a", 0);
    expect(c.meets).toHaveLength(c.pieces.filter((p) => p.role === "letter" && !p.parentId).length - 1);
    for (const m of c.meets) expect(Math.hypot(m.exit[0] - m.entry[0], m.exit[1] - m.entry[1])).toBeLessThan(3);
    expect(assembleStackOutlineReport(c.pieces, c.joins, NIB).skipped).toBe(0);
  });

  it("a stretch lengthens the run by the asked amount and adds a stretch join", () => {
    const s = [...lib.schema.values()].find((p) => p.stretch.length && p.letters.length === 1 && p.letters[0].form === "standalone" && !p.standIn)!;
    const char = Object.entries({ ba: "ب", seen: "س", sad: "ص", ta: "ط", fa: "ف", kaf: "ك", ya: "ى", nun: "ن", ra: "ر", waw: "و", qaf: "ق" })
      .find(([k]) => k === s.letters[0].skeleton)![1];
    const run = analyzePhrase(char).words[0].runs[0];
    const ch = { schemaIds: [s.id], climbs: [], stretch: {} };
    const plain = chainRun(lib, run, ch, "a", 0);
    const long = chainRun(lib, run, { ...ch, stretch: { a0: 96 } }, "a", 0);
    expect(long.width - plain.width).toBeCloseTo(96 * Math.abs(Math.cos(s.stretch[0].angle)), -1);
    expect(long.joins.length).toBe(plain.joins.length + 1);
  });

  it("keeps every dot clear of all the run's ink", () => {
    for (const text of ["أيمن", "حياتي", "تي", "بين"]) {
      const run = analyzePhrase(text).words.flatMap((w) => w.runs).find((r) => r.letters.length > 1)!;
      const c = chainRun(lib, run, defaultChoice(lib, run)!, "a", 0);
      const letters = c.pieces.filter((p) => p.role === "letter");
      const ink = letters.flatMap((p) => flattenContours(transformCmds(p.cmds, pieceTransform(p))) as [number, number][][]);
      for (const d of c.pieces.filter((p) => p.role === "mark")) {
        const centre: [number, number] = [d.x + d.pivot[0], d.y + d.pivot[1]];
        expect(ink.some((poly) => pointInPolygon(centre[0], centre[1], poly)), `${text} ${d.id}`).toBe(false);
      }
    }
  });

  it("puts the dots of a dotless tooth with it", () => {
    const run = analyzePhrase("تي").words[0].runs[0];
    const c = chainRun(lib, run, defaultChoice(lib, run)!, "a", 0);
    expect(c.pieces.filter((p) => p.role === "mark").length).toBeGreaterThanOrEqual(2);
  });
});

describe("defaultChoice", () => {
  it("picks a typical piece, not the longest display form", () => {
    const run = analyzePhrase("ا").words[0].runs[0];
    const pick = defaultChoice(lib, run)!.schemaIds[0];
    const hs = lib.single.get("alif|standalone")!.map((s) => lib.items.get(s.itemId)!.h).sort((a, b) => a - b);
    const h = lib.items.get(lib.schema.get(pick)!.itemId)!.h;
    expect(h).toBeGreaterThanOrEqual(hs[Math.floor(hs.length / 4)]);
    expect(h).toBeLessThanOrEqual(hs[Math.ceil((3 * hs.length) / 4) - 1]);
  });
});

describe("chainPhraseOnLine", () => {
  it("reads right to left: each later letter sits to the left", () => {
    const r = chainPhraseOnLine(lib, "أيمن");
    if ("error" in r) throw new Error(r.error);
    const letters = r.pieces.filter((p) => p.role === "letter" && !p.parentId).sort((a, b) => a.order - b.order);
    for (let i = 1; i < letters.length; i++) expect(centreX(letters[i])).toBeLessThan(centreX(letters[i - 1]));
  });

  it("composes the first target, every letter there", () => {
    const r = chainPhraseOnLine(lib, "أُمّ أَيْمَن الحُبّ حَيَاتِي");
    if ("error" in r) throw new Error(r.error);
    expect(r.pieceIds.length).toBeGreaterThanOrEqual(10);
    expect(assembleStackOutlineReport(r.pieces, r.joins, NIB).skipped).toBe(0);
  });

  it("refuses a phrase with letters it cannot draw, naming them", () => {
    expect(chainPhraseOnLine(lib, "حب 7")).toEqual({ error: "unsupported", letters: ["7"] });
  });
});


