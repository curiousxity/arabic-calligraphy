/**
 * Pure helpers for the practice-sheet PDF writer.
 *
 * Split from `practiceSheetPdf.ts` so tests can import them without pulling in
 * `./harfbuzz`, whose static `harfbuzzjs` import throws under Vitest's Node ESM
 * loader. Must not import `./harfbuzz` or `../hooks/useShapedGlyphs`.
 */
import type * as opentype from "opentype.js";

export type PdfPathOp = { op: "m" | "l" | "c" | "h"; c?: number[] };

/**
 * opentype path commands → jsPDF `path()` ops. `scale` is mm per font unit,
 * `(ox, oy)` the pen origin in mm. Font y points up, PDF y points down, so y
 * is negated. jsPDF has no quadratic op; `Q` is promoted to the equivalent
 * cubic (control points at 2/3 of the way from each end to the quadratic
 * control point).
 */
export function glyphPathToPdfOps(
  commands: opentype.PathCommand[],
  scale: number,
  ox: number,
  oy: number
): PdfPathOp[] {
  const ops: PdfPathOp[] = [];
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy - y * scale;
  let cx = 0;
  let cy = 0;
  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        ops.push({ op: "m", c: [X(cmd.x), Y(cmd.y)] });
        cx = cmd.x;
        cy = cmd.y;
        break;
      case "L":
        ops.push({ op: "l", c: [X(cmd.x), Y(cmd.y)] });
        cx = cmd.x;
        cy = cmd.y;
        break;
      case "C":
        ops.push({ op: "c", c: [X(cmd.x1), Y(cmd.y1), X(cmd.x2), Y(cmd.y2), X(cmd.x), Y(cmd.y)] });
        cx = cmd.x;
        cy = cmd.y;
        break;
      case "Q": {
        const c1x = cx + (2 / 3) * (cmd.x1 - cx);
        const c1y = cy + (2 / 3) * (cmd.y1 - cy);
        const c2x = cmd.x + (2 / 3) * (cmd.x1 - cmd.x);
        const c2y = cmd.y + (2 / 3) * (cmd.y1 - cmd.y);
        ops.push({ op: "c", c: [X(c1x), Y(c1y), X(c2x), Y(c2y), X(cmd.x), Y(cmd.y)] });
        cx = cmd.x;
        cy = cmd.y;
        break;
      }
      case "Z":
        ops.push({ op: "h" });
        break;
    }
  }
  return ops;
}

export function practiceSheetFilename(text: string): string {
  const slug = text
    .trim()
    .replace(/[\s/\\:*?"<>|]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `practice-${slug}.pdf` : "practice-sheet.pdf";
}
