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

/** The lattice grammar inside a mask: ink only on usable cells, no solid 2×2, no empty 2×2 wholly inside. */
function expectRegionGrammar(r: Ok, mask: KufiMask) {
  const { cols, rows } = mask;
  expect(r.cols).toBe(cols);
  expect(r.rows).toBe(rows);
  expect(r.cells.length).toBe(cols * rows);
  for (const p of r.placements) expect(p.turn).toBe(0);
  for (let i = 0; i < cols * rows; i++) if (r.cells[i]) expect(mask.cells[i]).toBe(1);
  for (let y = 0; y + 1 < rows; y++)
    for (let x = 0; x + 1 < cols; x++) {
      const w = [y * cols + x, y * cols + x + 1, (y + 1) * cols + x, (y + 1) * cols + x + 1];
      expect(w.every((i) => r.cells[i])).toBe(false);
      if (w.every((i) => mask.cells[i])) expect(w.every((i) => !r.cells[i])).toBe(false);
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

  it("measure, then pin: الله first packs in a 4-fold alternative wedge at size 23, in its full-height form", () => {
    // Measured 2026-11-01 (sizes 12..60) with the region's whole-letter forms only: الله first packs a
    // wedge at 4-fold alternative 23, 5-fold 27 (both stars), 6-fold classic 32, 6-fold alternative 30;
    // never in the 4-fold classic wedge. No corner and no محمد wedge or corner packs.
    const wedge = (size: number) => starConstruction(4, STAR_KS[4][1], size).regions[1].mask;
    for (let size = 12; size < 23; size++) expect(packKufiRegion({ text: "الله", mask: wedge(size) }).ok).toBe(false);
    const mask = wedge(23);
    const r = packKufiRegion({ text: "الله", mask });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectRegionGrammar(r, mask);
    // never the الله whose alef is drawn in two pieces
    expect(r.placements.map((p) => p.glyphId)).not.toContain("allah.isolated.2");
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

  it("is deterministic: the same call twice gives equal results", () => {
    const mask = starConstruction(4, STAR_KS[4][1], 23).regions[1].mask;
    const a = packKufiRegion({ text: "الله", mask });
    _internal.clearCaches();
    const b = packKufiRegion({ text: "الله", mask });
    expect(b).toEqual(a);
  });
});
