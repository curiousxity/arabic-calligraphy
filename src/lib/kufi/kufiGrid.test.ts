import { describe, it, expect } from "vitest";
import {
  rotateRows,
  inkBlocks2x2,
  emptyBlocks2x2,
  isConnected4,
  cellRings,
  gridFromRows,
  type Grid,
  type Ring,
} from "./kufiGrid";

const toGrid = (rows: string[]): Grid => ({
  cols: rows[0].length,
  rows: rows.length,
  cells: Uint8Array.from(rows.flatMap((r) => Array.from(r, (c) => (c === "#" ? 1 : 0)))),
});

describe("rotateRows", () => {
  it("turns a quarter clockwise", () => {
    expect(rotateRows(["#.", "##"], 1)).toEqual(["##", "#."]);
  });

  it("returns the input after four turns", () => {
    const rows = ["#..", "###"];
    let r = rows;
    for (let i = 0; i < 4; i++) r = rotateRows(r, 1);
    expect(r).toEqual(rows);
  });

  it("swaps dimensions on an odd turn", () => {
    expect(rotateRows(["###", "..."], 1)).toEqual([".#", ".#", ".#"]);
  });
});

describe("2x2 blocks", () => {
  it("finds a solid block of ink", () => {
    expect(inkBlocks2x2(toGrid(["##", "##"]))).toEqual([[0, 0]]);
  });

  it("finds no ink block in an L", () => {
    expect(inkBlocks2x2(toGrid(["#.", "##"]))).toEqual([]);
  });

  it("finds a 2x2 hole in a 4x4 frame", () => {
    const frame = ["####", "#..#", "#..#", "####"];
    expect(emptyBlocks2x2(toGrid(frame))).toEqual([[1, 1]]);
  });

  it("finds no 2x2 hole in a 3x3 frame", () => {
    expect(emptyBlocks2x2(toGrid(["###", "#.#", "###"]))).toEqual([]);
  });
});

describe("isConnected4", () => {
  it("is false for diagonal-only contact", () => {
    expect(isConnected4(["#.", ".#"])).toBe(false);
  });

  it("is true for an edge-connected shape", () => {
    expect(isConnected4(["#.", "##"])).toBe(true);
  });
});

/**
 * Twice the signed area. In screen coordinates — y growing downward — a
 * visually clockwise ring gives a *positive* shoelace sum, which is the
 * opposite of the usual maths-textbook reading and worth stating rather than
 * re-deriving at each assertion.
 */
function signedArea2(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum;
}

describe("cellRings", () => {
  const grid = (rows: string[]) => ({
    cells: rows.flatMap((r) => Array.from(r, (c) => c === "#")),
    cols: rows[0].length,
    rows: rows.length,
  });

  it("traces one cell as one clockwise square", () => {
    const g = grid(["#"]);
    const rings = cellRings(g.cells, g.cols, g.rows);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(signedArea2(rings[0])).toBeGreaterThan(0);
  });

  it("collapses a straight run to its corners", () => {
    const g = grid(["#####"]);
    const rings = cellRings(g.cells, g.cols, g.rows);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
  });

  it("winds a hole against its outer ring", () => {
    // This is what lets the renderer use plain nonzero fill and still get the
    // counter of ه and ص. Same winding on both would fill the hole solid.
    const g = grid(["###", "#.#", "###"]);
    const rings = cellRings(g.cells, g.cols, g.rows);
    expect(rings).toHaveLength(2);
    const areas = rings.map(signedArea2);
    expect(Math.sign(areas[0])).not.toBe(Math.sign(areas[1]));
  });

  it("traces two separated shapes as two rings", () => {
    const g = grid(["#.#"]);
    expect(cellRings(g.cells, g.cols, g.rows)).toHaveLength(2);
  });

  it("keeps every edge axis-aligned on an irregular shape", () => {
    const g = grid(["##.#", ".###", "##.."]);
    for (const ring of cellRings(g.cells, g.cols, g.rows)) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < ring.length; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[(i + 1) % ring.length];
        expect(x0 === x1 || y0 === y1).toBe(true);
      }
    }
  });
});

describe("gridFromRows", () => {
  it("packs ASCII rows into a row-major grid", () => {
    const g = gridFromRows(["#.", ".#", "##"]);
    expect(g.cols).toBe(2);
    expect(g.rows).toBe(3);
    expect(Array.from(g.cells)).toEqual([1, 0, 0, 1, 1, 1]);
  });

  it("agrees with inkBlocks2x2 on a solid block", () => {
    expect(inkBlocks2x2(gridFromRows(["##", "##"]))).toEqual([[0, 0]]);
  });

  it("is empty for no rows", () => {
    expect(gridFromRows([])).toEqual({ cols: 0, rows: 0, cells: new Uint8Array(0) });
  });
});
