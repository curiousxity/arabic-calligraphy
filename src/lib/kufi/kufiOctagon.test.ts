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

describe("octagonGeometry", () => {
  it("the line is the side less a band's depth; the centre is about a third of the square, of its parity, never wider than the interior less two", () => {
    expect(octagonGeometry(13)).toEqual({ size: 13, line: 7, width: 1, flat: 1 });
    expect(octagonGeometry(21)).toEqual({ size: 21, line: 15, width: 7, flat: 3 });
    expect(octagonGeometry(29)).toEqual({ size: 29, line: 23, width: 9, flat: 3 });
    expect(octagonGeometry(24)).toMatchObject({ line: 18, width: 8 });
    for (let n = OCTAGON_MIN_SIZE; n <= 60; n++) {
      const g = octagonGeometry(n);
      expect(g.width % 2).toBe(n % 2);
      expect(g.width).toBeLessThanOrEqual(Math.max(n % 2, n - 2 * OCTAGON_DEPTH - 2));
      expect(g.flat % 2).toBe(g.width % 2);
      expect(g.flat).toBeLessThanOrEqual(g.width);
    }
  });

  it("the open centre is a stepped octagon, centred and four-fold; the diagonals are seams; a quarter turn maps the square onto itself", () => {
    const g = octagonGeometry(29);
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
      let lengthened = 0, onOctagon = 0;
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
        // a stroke touches nothing beside it on its way in
        for (let yy = y; yy < size - OCTAGON_BAND; yy++) {
          expect(at(c - 1, yy)).toBe(false);
          expect(at(c + 1, yy)).toBe(false);
        }
      }
      expect(l.strokes).toEqual({ lengthened, onOctagon });
      expect(lengthened).toBeGreaterThan(0);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (octagonOpen(g, x, y)) expect(at(x, y)).toBe(false);
    }
    // three الله a side: the middle word's strokes reach the octagon
    expect(packed(29, rep(ALLAH, 3)).strokes.onOctagon).toBeGreaterThan(0);
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
