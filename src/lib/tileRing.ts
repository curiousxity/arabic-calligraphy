/**
 * A tiled border built to fit: one library tile repeated round a rectangle,
 * so the motif never stretches whatever the framed block's shape. The tile
 * runs along the top and bottom rows (corners included) and turns 90° down
 * the sides. Pure; library units, the ring centred on the origin. See
 * .claude/rules/marks.md, "Frames".
 */
import { parseSvgPath, type SvgCmd } from "./svgPath";

export type TileSpec = { period: number; band: number };

/** Tile size as a share of the framed block's font size: about the scale of
 *  the hadith panel's border beside its letters. */
export const TILE_SHARE_OF_EM = 0.3;

/** Tiles along the top, and down each side between the corner rows, for a
 *  ring whose opening holds `w`×`h` (any unit, the same as `period`/`band`). */
export function ringCounts(tile: TileSpec, w: number, h: number): { cols: number; side: number } {
  return {
    cols: Math.max(2, Math.ceil((w + 2 * tile.band) / tile.period)),
    side: Math.max(1, Math.ceil(h / tile.period)),
  };
}

const fmt = (v: number) => String(Math.round(v * 10) / 10);

function place(cmds: SvgCmd[], f: (x: number, y: number) => [number, number]): string {
  return cmds.map((c) => {
    switch (c.type) {
      case "M": case "L": { const [x, y] = f(c.x, c.y); return `${c.type}${fmt(x)} ${fmt(y)}`; }
      case "C": {
        const [x1, y1] = f(c.x1, c.y1), [x2, y2] = f(c.x2, c.y2), [x, y] = f(c.x, c.y);
        return `C${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(x)} ${fmt(y)}`;
      }
      case "Q": {
        const [x1, y1] = f(c.x1, c.y1), [x, y] = f(c.x, c.y);
        return `Q${fmt(x1)} ${fmt(y1)} ${fmt(x)} ${fmt(y)}`;
      }
      default: return "Z";
    }
  }).join("");
}

/** The ring's outline: `cols` tiles across, `side` tiles down each side
 *  between the top and bottom rows. */
export function tileRing(tileD: string, tile: TileSpec, cols: number, side: number): string {
  const cmds = parseSvgPath(tileD);
  const { period: p, band: b } = tile;
  const W = cols * p, H = 2 * b + side * p;
  const out: string[] = [];
  for (let i = 0; i < cols; i++) {
    const cx = -W / 2 + (i + 0.5) * p;
    out.push(place(cmds, (x, y) => [x + cx, y - H / 2 + b / 2]));
    out.push(place(cmds, (x, y) => [x + cx, y + H / 2 - b / 2]));
  }
  for (let j = 0; j < side; j++) {
    const cy = -H / 2 + b + (j + 0.5) * p;
    // turned a quarter: the tile's long axis runs down the side
    out.push(place(cmds, (x, y) => [-y - W / 2 + b / 2, x + cy]));
    out.push(place(cmds, (x, y) => [-y + W / 2 - b / 2, x + cy]));
  }
  return out.join("");
}
