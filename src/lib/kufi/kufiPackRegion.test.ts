import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packKufiRegion, _internal, type KufiMask, type KufiPackResult } from "./kufiPack";
import { STAR_KS, starConstruction } from "./kufiStarGeometry";

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

  it("measure, then pin: الله first packs in a 4-fold classic wedge at size 18, on three uprights, its feet on the base row", () => {
    // Measured 2026-11-01 (sizes 12..44) with the region's own الله forms, the base row on the ring
    // edge and the heh free to widen: one الله packs a 4-fold wedge at 18 to 25, two at 28 and 29,
    // four at 34 to 36; a 4-fold corner holds one from 25. 5-fold wedges from 21, 6-fold from 24.
    const wedge = (size: number) => starConstruction(4, STAR_KS[4][0], size).regions[1].mask;
    for (let size = 12; size < 18; size++) expect(packKufiRegion({ text: "الله", mask: wedge(size) }).ok).toBe(false);
    const mask = wedge(18);
    const r = packKufiRegion({ text: "الله", mask });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectRegionGrammar(r, mask);
    // the heh on the second lam, never on a stem of its own (allah.isolated.0, .1) nor the gapped alef (.2)
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

  it("fills a wedge with the word repeated, and a corner with one, at 4-fold 28", () => {
    const c = starConstruction(4, STAR_KS[4][0], 28);
    const wedge = packKufiRegion({ text: "الله الله", mask: c.regions[1].mask });
    expect(wedge.ok).toBe(true);
    if (wedge.ok) {
      expectRegionGrammar(wedge, c.regions[1].mask);
      expect(wedge.placements).toHaveLength(2);
      expect(wedge.quality?.squares).toBe(0);
    }
    const corner = packKufiRegion({ text: "الله", mask: c.regions[9].mask });
    expect(corner.ok).toBe(true);
    if (corner.ok) expectRegionGrammar(corner, c.regions[9].mask);
  });

  it("is deterministic: the same call twice gives equal results", () => {
    const mask = starConstruction(4, STAR_KS[4][1], 23).regions[1].mask;
    const a = packKufiRegion({ text: "الله", mask });
    _internal.clearCaches();
    const b = packKufiRegion({ text: "الله", mask });
    expect(b).toEqual(a);
  });
});
