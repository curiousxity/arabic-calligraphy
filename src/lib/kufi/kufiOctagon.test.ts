import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kufiGlyphById, stretchGlyph } from "./kufiAlphabet";
import { _internal, packKufiRegion } from "./kufiPack";
import {
  layoutKufiOctagon,
  OCTAGON_BAND,
  OCTAGON_DEPTH,
  OCTAGON_MIN_SIZE,
  octagonBandMask,
  octagonBottomField,
  octagonGeometry,
  octagonInk,
  octagonOpen,
  octagonRows,
  octagonSeam,
  octagonShafts,
  octagonTurn,
  type KufiOctagonLayout,
} from "./kufiOctagon";

// Layouts are asserted on the work budget alone, so machine load cannot change them.
beforeAll(() => _internal.setClockOverride(Infinity));
afterAll(() => _internal.setClockOverride(null));

const cache = new Map<string, KufiOctagonLayout>();
/** A layout that must pack; built once per text and size. */
function packed(size: number, text: string): KufiOctagonLayout {
  const key = `${size}|${text}`;
  let l = cache.get(key);
  if (!l) {
    const r = layoutKufiOctagon(size, text);
    expect(r.layout, `${text} at ${size}: ${r.band.ok ? "" : r.band.reason}`).not.toBeNull();
    l = r.layout!;
    cache.set(key, l);
  }
  return l;
}

const ALLAH = "الله";
const rep = (t: string, n: number) => Array.from({ length: n }, () => t).join(" ");
/** الله once, twice and three times along a side, at the smallest square each packs (its band form is 9 wide). */
const CASES: Array<[size: number, text: string]> = [
  [15, ALLAH],
  [25, rep(ALLAH, 2)],
  [35, rep(ALLAH, 3)],
];
/** Other phrases at a square they pack: a heh in إله, a لله, no tall letter at all. */
const PHRASES: Array<[size: number, text: string]> = [
  [33, "لا إله إلا الله"],
  [31, "الحمد لله"],
  [21, "محمد"],
];

function solid2x2(ink: Uint8Array, N: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y + 1 < N; y++)
    for (let x = 0; x + 1 < N; x++)
      if (ink[y * N + x] && ink[y * N + x + 1] && ink[(y + 1) * N + x] && ink[(y + 1) * N + x + 1]) out.push([x, y]);
  return out;
}

/** The columns of a band's strokes: a word of الله's shafts (the second lam, the first lam, the alef; never the heh's wall), `period` apart along the side. */
const allahStrokes = (words: number, period = 10) => Array.from({ length: words }, (_, w) => [4, 6, 8].map((c) => c + period * w)).flat().filter((c) => c >= OCTAGON_DEPTH);

describe("octagonGeometry", () => {
  it("the line is the side less a band's depth; with no strokes the centre is half the square, of its parity, never wider than the interior less two", () => {
    expect(octagonGeometry(13)).toEqual({ size: 13, line: 7, width: 1, flat: 1 });
    expect(octagonGeometry(21)).toEqual({ size: 21, line: 15, width: 7, flat: 3 });
    expect(octagonGeometry(29)).toEqual({ size: 29, line: 23, width: 15, flat: 7 });
    expect(octagonGeometry(24)).toEqual({ size: 24, line: 18, width: 10, flat: 4 });
    for (let n = OCTAGON_MIN_SIZE; n <= 60; n++) {
      for (const strokes of [[], allahStrokes(Math.ceil(n / 10))]) {
        const g = octagonGeometry(n, strokes);
        expect(g.width % 2).toBe(n % 2);
        expect(g.width).toBeLessThanOrEqual(Math.max(n % 2, n - 2 * OCTAGON_DEPTH - 2));
        expect(g.width).toBeGreaterThanOrEqual(n % 2);
        expect(g.flat % 2).toBe(g.width % 2);
        expect(g.flat).toBeLessThanOrEqual(g.width);
        expect(g.flat).toBeGreaterThanOrEqual(Math.min(1, g.width));
      }
    }
  });

  it("the strokes choose the centre: a 45-degree edge crosses the diagonal at a stroke, the octagon nearest half the square", () => {
    // الله three times a side at 35: strokes at 6, 8, 14, 16, 18, 24, 26, 28; column 24 (X = 14) gives flat + width = 30
    expect(octagonGeometry(35, allahStrokes(3))).toEqual({ size: 35, line: 29, width: 21, flat: 9 });
    // the same alone, and in any order
    expect(octagonGeometry(35, [24])).toMatchObject({ width: 21, flat: 9 });
    expect(octagonGeometry(35, [28, 26, 24])).toMatchObject({ width: 21, flat: 9 });
    // column 14 alone (X = 6) names 9/5, within the quarter's slack from 17.5, so it is taken; column 16 (X = 2) names 5/1,
    // beyond it, so the ratio's own 17/7
    expect(octagonGeometry(35, [14])).toMatchObject({ width: 9, flat: 5 });
    expect(octagonGeometry(35, [16])).toMatchObject({ width: 17, flat: 7 });
    // four times a side at 45: 25/9 (column 14) is nearest 22.5
    expect(octagonGeometry(45, allahStrokes(4))).toMatchObject({ width: 25, flat: 9 });
    // a stroke whose octagon would not fit the interior is passed over (25: column 6 names 17/9, wider than 11; column 8 names 11/7)
    expect(octagonGeometry(25, allahStrokes(2))).toMatchObject({ width: 11, flat: 7 });
    // an even square: strokes at odd X give an even sum, width and flat both even
    expect(octagonGeometry(24, [9])).toMatchObject({ width: 8, flat: 4 });
    // a stroke's octagon more than a quarter of the square from the aim is passed over for the ratio's own
    // (الحمد لله at 33: strokes at 15 and 17 name 5/1; 7 and 9, 24 and 26 name octagons wider than 19)
    expect(octagonGeometry(33, [7, 9, 15, 17, 24, 26])).toMatchObject({ width: 17, flat: 7 });
  });

  it("the open centre is a stepped octagon, centred and four-fold; the diagonals are seams; a quarter turn maps the square onto itself", () => {
    const g = { size: 29, line: 23, width: 9, flat: 3 };
    let open = 0;
    for (let y = 0; y < 29; y++)
      for (let x = 0; x < 29; x++) {
        const [tx, ty] = octagonTurn(29, x, y);
        expect(octagonOpen(g, tx, ty)).toBe(octagonOpen(g, x, y));
        expect(octagonSeam(g, tx, ty)).toBe(octagonSeam(g, x, y));
        if (octagonOpen(g, x, y)) open++;
      }
    // widths 3, 5, 7, 9, 9, 9, 7, 5, 3 (flat 3, width 9)
    expect(open).toBe(3 + 5 + 7 + 9 + 9 + 9 + 7 + 5 + 3);
    expect(octagonOpen(g, 14, 14)).toBe(true);
    expect(octagonOpen(g, 14, 10)).toBe(true); // the flat's middle, top row
    expect(octagonOpen(g, 12, 10)).toBe(false); // beyond the flat
    expect(octagonSeam(g, 0, 0)).toBe(true);
    expect(octagonSeam(g, 28, 0)).toBe(true);
    expect(octagonBottomField(g, 14, 22)).toBe(true);
    expect(octagonBottomField(g, 14, 6)).toBe(false);
    // 21 across with a flat of 9: widths 9, 11, ..., 19, 21 x 9, 19, ..., 9
    const g21 = octagonGeometry(35, allahStrokes(3));
    let open21 = 0;
    for (let y = 0; y < 35; y++) for (let x = 0; x < 35; x++) if (octagonOpen(g21, x, y)) open21++;
    expect(open21).toBe(2 * (9 + 11 + 13 + 15 + 17 + 19) + 21 * 9);
    // four turns are the identity
    let p: [number, number] = [3, 7];
    for (let i = 0; i < 4; i++) p = octagonTurn(29, p[0], p[1]);
    expect(p).toEqual([3, 7]);
  });
});

describe("layoutKufiOctagon", { timeout: 120_000 }, () => {
  it("packs the side with no filler squares or bars, and reads the same on every call", () => {
    for (const [size, text] of CASES) {
      const l = packed(size, text);
      expect(l.band.quality).toMatchObject({ squares: 0, bars: 0 });
      expect(l.band.cols).toBe(size - OCTAGON_DEPTH);
      expect(l.band.rows).toBe(OCTAGON_BAND);
      const again = layoutKufiOctagon(size, text).layout!;
      expect(Array.from(again.cells)).toEqual(Array.from(l.cells));
      expect(Array.from(again.frame)).toEqual(Array.from(l.frame));
    }
  });

  it("the lattice grammar holds over the whole square: no solid 2x2, with or without the lines", () => {
    for (const [size, text] of CASES) {
      const l = packed(size, text);
      expect(solid2x2(l.cells, size)).toEqual([]);
      expect(solid2x2(octagonInk(l, true), size)).toEqual([]);
      // the frame adds cells on the outer ring only
      l.frame.forEach((v, i) => {
        if (!v) return;
        const x = i % size, y = Math.floor(i / size);
        expect(x === 0 || y === 0 || x === size - 1 || y === size - 1).toBe(true);
        expect(l.cells[i]).toBe(0);
      });
    }
  });

  it("every side is a quarter turn of the bottom one, never a mirror", () => {
    for (const [size, text] of CASES) {
      const l = packed(size, text);
      const at = (a: Uint8Array, x: number, y: number) => a[y * size + x];
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const [tx, ty] = octagonTurn(size, x, y);
          expect(at(l.cells, tx, ty)).toBe(at(l.cells, x, y));
          expect(at(l.frame, tx, ty)).toBe(at(l.frame, x, y));
        }
      // the bottom band is the packing itself, feet on the bottom edge
      const L = l.band.cols;
      for (let r = 0; r < OCTAGON_BAND; r++)
        for (let c = 0; c < L; c++) expect(at(l.cells, c, size - OCTAGON_BAND + r)).toBe(l.band.cells[r * L + c]);
    }
  });

  it("the lengthened strokes end on the octagon or on a diagonal, and the centre stays open", () => {
    for (const [size, text] of CASES) {
      const l = packed(size, text);
      const g = l.geometry;
      const at = (x: number, y: number) => l.cells[y * size + x] === 1;
      let lengthened = 0, onOctagon = 0, onDiagonal = 0;
      for (let c = OCTAGON_DEPTH; c < g.line; c++) {
        // a stroke in the field above the band
        let y = size - OCTAGON_DEPTH;
        if (!at(c, y)) continue;
        while (y - 1 >= 0 && at(c, y - 1) && octagonBottomField(g, c, y - 1)) y--;
        lengthened++;
        const above = y - 1;
        const ends = octagonOpen(g, c, above) || octagonSeam(g, c, above);
        expect(ends, `${text} at ${size}, column ${c}`).toBe(true);
        if (octagonOpen(g, c, above)) onOctagon++;
        else onDiagonal++;
        // a stroke touches nothing beside it on its way in
        for (let yy = y; yy < size - OCTAGON_BAND; yy++) {
          expect(at(c - 1, yy)).toBe(false);
          expect(at(c + 1, yy)).toBe(false);
        }
      }
      expect(l.strokes).toEqual({ lengthened, onOctagon, onDiagonal });
      expect(lengthened).toBeGreaterThan(0);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (octagonOpen(g, x, y)) expect(at(x, y)).toBe(false);
    }
    // three الله a side: the middle word's strokes reach the octagon
    expect(packed(35, rep(ALLAH, 3)).strokes.onOctagon).toBeGreaterThan(0);
  });

  it("three الله a side at 35: the strokes' ends trace the octagon, the crossing stroke on its edge and the diagonal at once", () => {
    const l = packed(35, rep(ALLAH, 3));
    const g = l.geometry;
    expect(g).toMatchObject({ width: 21, flat: 9 });
    expect(l.strokes).toEqual({ lengthened: 8, onOctagon: 4, onDiagonal: 4 });
    const at = (x: number, y: number) => l.cells[y * 35 + x] === 1;
    /** The stroke in column `c` of the bottom field ends at row `y`: ink there, paper above. */
    const endsAt = (c: number, y: number) => at(c, y) && !at(c, y - 1);
    // under the flat side (columns 13 to 21, open to row 27) the middle word's three shafts end at the same depth
    for (const c of [14, 16, 18]) expect(endsAt(c, 28) && octagonOpen(g, c, 27)).toBe(true);
    // the crossing stroke, column 24 (the third word's second lam): its next cell (24, 24) is open and lies on the diagonal
    expect(endsAt(24, 25)).toBe(true);
    expect(octagonOpen(g, 24, 24) && octagonSeam(g, 24, 24)).toBe(true);
    // the left band's copy of it (row 24) ends at (9, 24) against the same edge's other crossing cell (10, 24)
    expect(at(9, 24) && !at(10, 24) && at(5, 24)).toBe(true);
    expect(octagonOpen(g, 10, 24) && octagonSeam(g, 10, 24)).toBe(true);
    // beyond the crossing the strokes end on the diagonal staircase, one cell deeper per column toward the square's corner
    expect(endsAt(26, 27) && octagonSeam(g, 26, 26)).toBe(true);
    expect(endsAt(28, 29) && octagonSeam(g, 28, 28)).toBe(true);
    expect(endsAt(8, 27) && octagonSeam(g, 8, 26)).toBe(true);
    expect(endsAt(6, 29) && octagonSeam(g, 6, 28)).toBe(true);
    // the heh's box keeps its own wall under its bar, in the band: nothing rises out of it (words at 10 and 20; columns 10 to 12, 20 to 22)
    for (const c of [10, 11, 12, 20, 21, 22]) expect(at(c, 29), `column ${c}`).toBe(false);
    expect(at(12, 30) && at(12, 31) && at(10, 30) && !at(10, 31)).toBe(true);
  });

  it("only a shaft is lengthened: an alef's or a lam's upright with a bare top, never a heh's wall, a box's side or a tooth", () => {
    const TALL = ["alef.", "lam.", "lamAlef.", "allah.", "kaf.", "tah."];
    for (const [size, text] of [...CASES, ...PHRASES]) {
      const l = packed(size, text);
      const b = l.band;
      const L = b.cols;
      const ink = (x: number, y: number) => x >= 0 && x < L && y >= 0 && y < OCTAGON_BAND && b.cells[y * L + x] === 1;
      // the band's top-row cells, by the letter drawn there
      const owner = new Map<number, string>();
      for (const p of b.placements) {
        expect(p.turn).toBe(0);
        const found = kufiGlyphById(p.glyphId);
        expect(found, p.glyphId).not.toBeNull();
        if (p.row !== 0) continue;
        stretchGlyph(found!.glyph, p.stretch)[0].split("").forEach((ch, j) => {
          if (ch === "#") owner.set(p.col + j, p.glyphId);
        });
      }
      const shafts = octagonShafts(b);
      for (const c of shafts) {
        const id = owner.get(c);
        expect(id && TALL.some((t) => id.startsWith(t)), `${text} at ${size}: column ${c} is ${id ?? "no letter's"}`).toBe(true);
        expect(ink(c, 0) && ink(c, 1) && !ink(c - 1, 0) && !ink(c + 1, 0), `${text} at ${size}: column ${c} is not a bare upright`).toBe(true);
      }
      // what rises out of the band is exactly the shafts under the interior
      const lengthened: number[] = [];
      for (let c = 0; c < L; c++) if (l.cells[(size - OCTAGON_DEPTH) * size + c]) lengthened.push(c);
      expect(lengthened).toEqual(shafts.filter((c) => c >= OCTAGON_DEPTH));
      // a heh's columns are never among them, nor the heh of الله (its box: the glyph's first three columns, widened by its column stretch)
      for (const p of b.placements) {
        let box: number[] = [];
        if (p.glyphId.startsWith("heh.")) box = Array.from({ length: stretchGlyph(kufiGlyphById(p.glyphId)!.glyph, p.stretch)[0].length }, (_, j) => p.col + j);
        else if (p.glyphId.startsWith("allah.")) box = Array.from({ length: 3 + (p.stretch[1] ?? 0) }, (_, j) => p.col + j);
        for (const c of box) expect(shafts, `${text} at ${size}: ${p.glyphId} at ${p.col}, column ${c}`).not.toContain(c);
      }
    }
    // محمد has no tall letter, so nothing is lengthened, however tall its boxes are drawn
    expect(packed(21, "محمد").strokes).toEqual({ lengthened: 0, onOctagon: 0, onDiagonal: 0 });
    // the band takes الله with the heh's own wall (`allah.isolated.5`), so every word gives three shafts: both lams and the alef
    const b35 = packed(35, rep(ALLAH, 3)).band;
    expect(b35.placements.map((p) => p.glyphId)).toEqual(["allah.isolated.5", "allah.isolated.5", "allah.isolated.5"]);
    expect(octagonShafts(b35)).toEqual([4, 6, 8, 14, 16, 18, 24, 26, 28]);
    // the wedges' merged form (the heh hanging off the second lam) would give two: that lam is the heh's wall, capped by its bar
    const merged = packKufiRegion({ text: rep(ALLAH, 3), mask: octagonBandMask(29), bars: false, place: "wedge" });
    expect(merged.ok && merged.placements.map((p) => p.glyphId)).toEqual(["allah.isolated.3", "allah.isolated.3", "allah.isolated.3"]);
    expect(merged.ok && octagonShafts(merged)).toEqual([4, 6, 12, 14, 20, 22]);
  });

  it("a text that does not fill its line, or does not fit it, packs no square and says why", () => {
    const short = layoutKufiOctagon(25, ALLAH);
    expect(short.layout).toBeNull();
    expect(short.band).toMatchObject({ ok: false, reason: "tooShort" });
    const long = layoutKufiOctagon(15, rep(ALLAH, 2));
    expect(long.layout).toBeNull();
    expect(long.band).toMatchObject({ ok: false, reason: "tooLong" });
  });

  it("pins الله once a side at 15 and three times at 35, with the lines", () => {
    expect(octagonRows(packed(15, ALLAH), true)).toMatchSnapshot();
    expect(octagonRows(packed(35, rep(ALLAH, 3)), true)).toMatchSnapshot();
  });
});
