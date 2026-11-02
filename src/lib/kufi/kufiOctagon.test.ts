import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _internal } from "./kufiPack";
import {
  layoutKufiOctagon,
  OCTAGON_BAND,
  OCTAGON_DEPTH,
  OCTAGON_MIN_SIZE,
  octagonBottomField,
  octagonGeometry,
  octagonInk,
  octagonOpen,
  octagonRows,
  octagonSeam,
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
/** الله once, twice and three times along a side, at the smallest square each packs. */
const CASES: Array<[size: number, text: string]> = [
  [13, ALLAH],
  [21, rep(ALLAH, 2)],
  [29, rep(ALLAH, 3)],
];

function solid2x2(ink: Uint8Array, N: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y + 1 < N; y++)
    for (let x = 0; x + 1 < N; x++)
      if (ink[y * N + x] && ink[y * N + x + 1] && ink[(y + 1) * N + x] && ink[(y + 1) * N + x + 1]) out.push([x, y]);
  return out;
}

/** The columns of a band's strokes: a word of الله's three uprights, `period` apart along the side. */
const allahStrokes = (words: number, period = 8) => Array.from({ length: words }, (_, w) => [2, 4, 6].map((c) => c + period * w)).flat().filter((c) => c >= OCTAGON_DEPTH);

describe("octagonGeometry", () => {
  it("the line is the side less a band's depth; with no strokes the centre is half the square, of its parity, never wider than the interior less two", () => {
    expect(octagonGeometry(13)).toEqual({ size: 13, line: 7, width: 1, flat: 1 });
    expect(octagonGeometry(21)).toEqual({ size: 21, line: 15, width: 7, flat: 3 });
    expect(octagonGeometry(29)).toEqual({ size: 29, line: 23, width: 15, flat: 7 });
    expect(octagonGeometry(24)).toEqual({ size: 24, line: 18, width: 10, flat: 4 });
    for (let n = OCTAGON_MIN_SIZE; n <= 60; n++) {
      for (const strokes of [[], allahStrokes(Math.ceil(n / 8))]) {
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
    // الله three times a side at 29: strokes at 6, 10, 12, 14, 18, 20, 22; column 10 (X = 8) gives flat + width = 18
    expect(octagonGeometry(29, allahStrokes(3))).toEqual({ size: 29, line: 23, width: 13, flat: 5 });
    // the same from either half of the band, and in any order
    expect(octagonGeometry(29, [10])).toMatchObject({ width: 13, flat: 5 });
    expect(octagonGeometry(29, [22, 18, 20])).toMatchObject({ width: 13, flat: 5 });
    // column 12 alone (X = 4) names 7/3, beyond the quarter's slack from 14.5, so the ratio's own 15/7; the centre column names nothing
    expect(octagonGeometry(29, [12])).toMatchObject({ width: 15, flat: 7 });
    expect(octagonGeometry(29, [14])).toMatchObject({ width: 15, flat: 7 });
    // four times a side at 37: 23/11 (column 10), 19/7 (12) and 13/5 (14) fit; 19 is nearest 18.5
    expect(octagonGeometry(37, allahStrokes(4))).toMatchObject({ width: 19, flat: 7 });
    // a stroke whose octagon would not fit the interior is passed over (21: column 6 names 13/5, wider than 7)
    expect(octagonGeometry(21, allahStrokes(2))).toMatchObject({ width: 7, flat: 3 });
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
    // 13 across with a flat of 5: widths 5, 7, 9, 11, 13 x 5, 11, 9, 7, 5
    const g13 = octagonGeometry(29, allahStrokes(3));
    let open13 = 0;
    for (let y = 0; y < 29; y++) for (let x = 0; x < 29; x++) if (octagonOpen(g13, x, y)) open13++;
    expect(open13).toBe(5 + 7 + 9 + 11 + 13 * 5 + 11 + 9 + 7 + 5);
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
    expect(packed(29, rep(ALLAH, 3)).strokes.onOctagon).toBeGreaterThan(0);
  });

  it("three الله a side at 29: the strokes' ends trace the octagon, the crossing stroke on its edge and the diagonal at once", () => {
    const l = packed(29, rep(ALLAH, 3));
    const g = l.geometry;
    expect(g).toMatchObject({ width: 13, flat: 5 });
    expect(l.strokes).toEqual({ lengthened: 7, onOctagon: 4, onDiagonal: 3 });
    const at = (x: number, y: number) => l.cells[y * 29 + x] === 1;
    /** The stroke in column `c` of the bottom field ends at row `y`: ink there, paper above. */
    const endsAt = (c: number, y: number) => at(c, y) && !at(c, y - 1);
    // under the flat side (columns 12 to 16, open to row 20) the strokes end at the same depth
    expect(endsAt(12, 21)).toBe(true);
    expect(endsAt(14, 21)).toBe(true);
    // the crossing stroke, column 10: its next cell (10, 18) is open and lies on the diagonal
    expect(endsAt(10, 19)).toBe(true);
    expect(octagonOpen(g, 10, 18) && octagonSeam(g, 10, 18)).toBe(true);
    // the left band's stroke at row 18 (the bottom's column 18 turned) ends at (9, 18): with (12, 21) and (10, 19)
    // on one 45-degree line, the octagon's lower-left edge drawn by both fields' ends
    expect(at(9, 18) && !at(10, 18) && at(5, 18)).toBe(true);
    for (const [x, y] of [[12, 21], [10, 19], [9, 18]]) expect(x - y).toBe(-9);
    // beyond the crossing the strokes end on the diagonal staircase: column 6 at the seam row, column 20 at row 21
    expect(endsAt(6, 23) && octagonSeam(g, 6, 22)).toBe(true);
    expect(endsAt(20, 21) && octagonSeam(g, 20, 20)).toBe(true);
  });

  it("a text that does not fill its line, or does not fit it, packs no square and says why", () => {
    const short = layoutKufiOctagon(21, ALLAH);
    expect(short.layout).toBeNull();
    expect(short.band).toMatchObject({ ok: false, reason: "tooShort" });
    const long = layoutKufiOctagon(13, rep(ALLAH, 2));
    expect(long.layout).toBeNull();
    expect(long.band).toMatchObject({ ok: false, reason: "tooLong" });
  });

  it("pins الله once a side at 13 and three times at 29, with the lines", () => {
    expect(octagonRows(packed(13, ALLAH), true)).toMatchSnapshot();
    expect(octagonRows(packed(29, rep(ALLAH, 3)), true)).toMatchSnapshot();
  });
});
