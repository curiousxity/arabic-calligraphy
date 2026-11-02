import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packKufiRegion, _internal, type KufiMask, type KufiPackResult } from "./kufiPack";
import { STAR_KS, starConstruction } from "./kufiStarGeometry";
import { kufiGlyphById, kufiShaftTops, stretchGlyph } from "./kufiAlphabet";
import { resolveKufiText } from "./kufiWords";

// Layouts are asserted on the work budget alone, so machine load cannot change them.
beforeAll(() => _internal.setClockOverride(Infinity));
afterAll(() => _internal.setClockOverride(null));

type Ok = Extract<KufiPackResult, { ok: true }>;

function fullMask(cols: number, rows: number): KufiMask {
  return { cols, rows, cells: new Uint8Array(cols * rows).fill(1) };
}

/**
 * The lattice grammar inside a mask: ink only on usable cells, no solid 2×2, and no empty 2×2
 * away from the slanted sides (one with a cell of usable margin all round; below the base row
 * counts as usable, since that edge is a frame, not a side).
 */
function expectRegionGrammar(r: Ok, mask: KufiMask) {
  const { cols, rows } = mask;
  expect(r.cols).toBe(cols);
  expect(r.rows).toBe(rows);
  expect(r.cells.length).toBe(cols * rows);
  for (const p of r.placements) expect(p.turn).toBe(0);
  for (let i = 0; i < cols * rows; i++) if (r.cells[i]) expect(mask.cells[i]).toBe(1);
  const margin = (y: number, x: number) => x >= 0 && x < cols && (y >= rows || (y >= 0 && mask.cells[y * cols + x] === 1));
  for (let y = 0; y + 1 < rows; y++)
    for (let x = 0; x + 1 < cols; x++) {
      const w = [y * cols + x, y * cols + x + 1, (y + 1) * cols + x, (y + 1) * cols + x + 1];
      expect(w.every((i) => r.cells[i])).toBe(false);
      let inside = true;
      for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) if (!margin(y + dy, x + dx)) inside = false;
      if (inside) expect(w.every((i) => !r.cells[i])).toBe(false);
    }
}

describe("packKufiRegion", { timeout: 120_000 }, () => {
  it("the box is the region: a full mask packs on upright lines only, inside the grammar", () => {
    const mask = fullMask(21, 11);
    const r = packKufiRegion({ text: "الله أكبر", mask });
    if (r.ok) expectRegionGrammar(r, mask);
    else expect(["tooShort", "tooLong"]).toContain(r.reason);
  });

  it("an empty mask is too small for any text, and never throws", () => {
    const r = packKufiRegion({ text: "الله", mask: { cols: 0, rows: 0, cells: new Uint8Array(0) } });
    expect(r).toEqual({ ok: false, reason: "tooLong", suggestions: [] });
  });

  it("measure, then pin: الله first packs in a 4-fold classic wedge at size 20, on four uprights, its feet on the base row", () => {
    // Measured 2026-11-02 (sizes 12..50) with the star's four-upright الله (9 wide, the heh's own
    // wall), the base row on the ring edge, the heh free to widen and a word's shafts carried up
    // together or not at all: one الله packs a 4-fold wedge at 20 to 27 and never two or more (the
    // pocket above a heh's box has no legal filler, and two words no longer stand on one line
    // before the slanted sides close); a 4-fold corner holds one at 29 to 31, three at 46. 5-fold
    // wedges hold one at 24 to 29, three at 40; 6-fold one at 30 to 33, two at 34 to 40. (The
    // merged three-upright form held two in a 4-fold wedge at 27 and 28, one from 18.)
    const wedge = (size: number) => starConstruction(4, STAR_KS[4][0], size).regions[1].mask;
    for (let size = 12; size < 20; size++) expect(packKufiRegion({ text: "الله", mask: wedge(size) }).ok).toBe(false);
    const mask = wedge(20);
    const r = packKufiRegion({ text: "الله", mask });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectRegionGrammar(r, mask);
    // the star form: four uprights at the line's height, never the panel's taller forms (.0, .1) nor the gapped alef (.2)
    expect(r.placements.map((p) => p.glyphId)).toEqual(["allah.isolated.3"]);
    // the edge rule on the base row: the feet line it, no two neighbouring usable cells empty
    for (let x = 0; x + 1 < mask.cols; x++) {
      const i = (mask.rows - 1) * mask.cols + x;
      if (mask.cells[i] && mask.cells[i + 1]) expect(r.cells[i] || r.cells[i + 1]).toBeTruthy();
    }
    // "#" ink, "." paper inside the mask, " " outside it
    const art: string[] = [];
    for (let y = 0; y < mask.rows; y++) {
      let line = "";
      for (let x = 0; x < mask.cols; x++) {
        const i = y * mask.cols + x;
        line += r.cells[i] ? "#" : mask.cells[i] ? "." : " ";
      }
      art.push(line);
    }
    expect(art.join("\n")).toMatchSnapshot();
  });

  it("fills a 6-fold wedge with the word twice at 34, and a 4-fold corner with one at 29", () => {
    const six = starConstruction(6, STAR_KS[6][0], 34);
    const wedge = packKufiRegion({ text: "الله الله", mask: six.regions[1].mask });
    expect(wedge.ok).toBe(true);
    if (wedge.ok) {
      expectRegionGrammar(wedge, six.regions[1].mask);
      expect(wedge.placements).toHaveLength(2);
      expect(wedge.quality?.squares).toBe(0);
    }
    const four = starConstruction(4, STAR_KS[4][0], 29);
    const corner = packKufiRegion({ text: "الله", mask: four.regions[9].mask });
    expect(corner.ok).toBe(true);
    if (corner.ok) expectRegionGrammar(corner, four.regions[9].mask);
    // two الله in a 4-fold wedge at 28 packed on the merged form alone (2026-11-02): no longer
    expect(packKufiRegion({ text: "الله الله", mask: starConstruction(4, STAR_KS[4][0], 28).regions[1].mask }).ok).toBe(false);
  });

  /** الله repeated, in the wedges and corners that pack it (measured 2026-11-02, see above). */
  const rep = (n: number) => Array.from({ length: n }, () => "الله").join(" ");
  const FITS: Array<[fold: 4 | 5 | 6, size: number, region: number, text: string]> = [
    [4, 20, 1, rep(1)], [4, 25, 1, rep(1)], [4, 29, 9, rep(1)], [4, 46, 9, rep(3)],
    [5, 24, 1, rep(1)], [5, 28, 1, rep(1)], [5, 40, 1, rep(3)],
    [6, 30, 1, rep(1)], [6, 34, 1, rep(2)], [6, 38, 1, rep(2)],
  ];
  const packedFits = () =>
    FITS.map(([fold, size, region, text]) => {
      const mask = starConstruction(fold, STAR_KS[fold][0], size).regions[region].mask;
      const r = packKufiRegion({ text, mask });
      expect(r.ok, `${fold}-fold ${size} region ${region} ${text}`).toBe(true);
      return { fold, size, region, text, mask, r: r as Ok };
    });
  /** How far the ink runs straight up from the top of the glyph's column `j`. */
  const riseOf = (r: Ok, p: Ok["placements"][number], rows: string[], j: number): number | null => {
    const ink = (x: number, y: number) => x >= 0 && y >= 0 && x < r.cols && y < r.rows && r.cells[y * r.cols + x] === 1;
    let i = 0;
    while (i < rows.length && rows[i][j] !== "#") i++;
    if (i >= rows.length) return null;
    let n = 0;
    while (ink(p.col + j, p.row + i - 1 - n)) n++;
    return n;
  };

  it("carries only a shaft up to the side: no heh wall, box side or capped top is ever extended above its glyph", () => {
    // The user, 2026-11-02: a heh (or any box or bowl wall) is never carried up, only the shaft of a
    // tall letter. Every glyph's columns are checked: a column whose top is not a shaft's
    // (`kufiShaftTops`: a capped top such as the heh's wall under its bar, the barred form's bar,
    // or any column of a letter outside KUFI_SHAFT_LETTERS) has paper right above it.
    let hehWalls = 0;
    for (const { fold, size, region, mask, r } of packedFits()) {
      expectRegionGrammar(r, mask);
      for (const p of r.placements) {
        const found = kufiGlyphById(p.glyphId)!;
        const rows = stretchGlyph(found.glyph, p.stretch);
        const tops = kufiShaftTops(found.skeleton, rows);
        for (let j = 0; j < rows[0].length; j++) {
          const rise = riseOf(r, p, rows, j);
          if (rise === null || tops[j] >= 0) continue;
          let i = 0;
          while (rows[i][j] !== "#") i++;
          if (rows[i][j - 1] === "#" || rows[i][j + 1] === "#") hehWalls++;
          expect(rise, `${fold}-fold ${size} region ${region}: ${p.glyphId} at ${p.col},${p.row} column ${j} carried up`).toBe(0);
        }
      }
    }
    expect(hehWalls).toBeGreaterThan(20); // every الله has capped tops, so the rule was exercised
  });

  it("every الله packed in a wedge or corner stands on four uprights, the heh's wall its own: never a form whose heh wall is a lam", () => {
    let words = 0;
    for (const { r } of packedFits())
      for (const p of r.placements) {
        if (!p.glyphId.startsWith("allah.")) continue;
        words++;
        // along the body's top row: the heh's box (its bar, widened or not) then three bare uprights, a paper column between each
        const body = stretchGlyph(kufiGlyphById(p.glyphId)!.glyph, p.stretch).slice(-5);
        const runs = body[0].match(/#+/g) ?? [];
        expect(runs.length, p.glyphId).toBeGreaterThanOrEqual(4);
        expect(runs.slice(-3), p.glyphId).toEqual(["#", "#", "#"]);
      }
    expect(words).toBeGreaterThan(10);
  });

  it("a word's shafts rise together or not at all: never a lone lengthened shaft beside its unlengthened siblings", () => {
    // The user, 2026-11-02: one tall stroke beside the heh's box read as the heh's stem. Per word,
    // every shaft (`kufiShaftTops`) is carried up, by lengths the slanted side may vary, or none is.
    let risen = 0, still = 0;
    for (const { fold, size, region, text, r } of packedFits()) {
      const { units } = resolveKufiText(text);
      const rises = new Map<number, number[]>();
      for (const p of r.placements) {
        const found = kufiGlyphById(p.glyphId)!;
        const rows = stretchGlyph(found.glyph, p.stretch);
        const tops = kufiShaftTops(found.skeleton, rows);
        const word = units[p.unitIndex].wordIndex;
        for (let j = 0; j < tops.length; j++) {
          if (tops[j] < 0) continue;
          const list = rises.get(word) ?? [];
          rises.set(word, list);
          list.push(riseOf(r, p, rows, j)!);
        }
      }
      for (const [word, list] of rises) {
        const up = list.filter((n) => n > 0).length;
        expect(up === 0 || up === list.length, `${fold}-fold ${size} region ${region}: word ${word} rises ${list.join(",")}`).toBe(true);
        if (up > 0) risen++;
        else still++;
      }
    }
    // both outcomes occur: words carried up as one, and words left at the line's height
    expect(risen).toBeGreaterThan(0);
    expect(still).toBeGreaterThan(0);
  });

  it("is deterministic: the same call twice gives equal results", () => {
    const mask = starConstruction(4, STAR_KS[4][1], 23).regions[1].mask;
    const a = packKufiRegion({ text: "الله", mask });
    _internal.clearCaches();
    const b = packKufiRegion({ text: "الله", mask });
    expect(b).toEqual(a);
  });
});
