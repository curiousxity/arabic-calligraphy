// src/lib/stackDraft.test.ts
import { describe, it, expect } from "vitest";
import type { StackBlock, StackPiece } from "../types";
import type { SvgCmd } from "./svgPath";
import {
  draftOf, draftChanged, patchPieces, setJoinBend, resetDraft, inkBoundsPx, arrangeDraft, fitTransform,
} from "./stackDraft";

// Synthetic pieces: nothing here is shaped, so hand-made rectangles are fine
// (CLAUDE.md's fixture rule is about shaping).
const UPM = 1000;
const rect = (w: number, h: number): SvgCmd[] => [
  { type: "M", x: 0, y: -h }, { type: "L", x: w, y: -h }, { type: "L", x: w, y: 0 }, { type: "L", x: 0, y: 0 }, { type: "Z" },
];
const letter = (id: string, order: number, x: number, w: number, h: number, extra: Partial<StackPiece> = {}): StackPiece => ({
  id, cmds: rect(w, h), x, y: 0, rotation: 0, pivot: [w / 2, -h / 2], homeX: x, homeY: 0, order, role: "letter", faces: [], ...extra,
});

// Two fixtures. The join one carries a join whose faces do not exist on the
// synthetic pieces (`faces: []`): `assembleStackOutline` skips such a join,
// which is fine for the join-field tests, but measurement and arranging use
// the joinless fixture so nothing depends on that skip.
const block = (joins: boolean): StackBlock => ({
  id: 1, type: "stack", x: 100, y: 200, rotation: 15,
  text: "", fontSize: 100, color: "#000", fontFamily: "Amiri",
  source: { text: "اب", fontFamily: "Amiri" }, unitsPerEm: UPM,
  nib: { width: 60, minFraction: 0.5 },
  pieces: [letter("a", 0, 0, 200, 600), letter("b", 1, 300, 300, 400)],
  joins: joins
    ? [{ id: "j1", from: { pieceId: "a", faceIndex: 0 }, to: { pieceId: "b", faceIndex: 0 }, bow: 0.4, depth: 0.2, rest: { bow: 0.1, depth: 0 } }]
    : [],
} as unknown as StackBlock);

describe("draftOf / draftChanged", () => {
  it("copies the block's editable fields and reports no change until something is patched", () => {
    const d = draftOf(block(true));
    expect(d.x).toBe(100); expect(d.rotation).toBe(15); expect(d.pieces.length).toBe(2);
    expect(draftChanged(d, d)).toBe(false);
    expect(draftChanged(d, patchPieces(d, [{ id: "a", y: -50 }]))).toBe(true);
    expect(draftChanged(d, { ...d, fontSize: 101 })).toBe(true);
    expect(draftChanged(d, { ...d, nib: { ...d.nib, minFraction: 0.6 } })).toBe(true);
    expect(draftChanged(d, { ...d, x: 101 })).toBe(true);
  });
});

describe("patchPieces / setJoinBend / resetDraft", () => {
  it("patches by id, keeps ids, and leaves other pieces untouched by reference", () => {
    const d = draftOf(block(true));
    const n = patchPieces(d, [{ id: "b", x: 310, rotation: 0.3 }]);
    expect(n.pieces[1]).toMatchObject({ id: "b", x: 310, rotation: 0.3 });
    expect(n.pieces[0]).toBe(d.pieces[0]);
  });
  it("sets a join's bow and depth", () => {
    const n = setJoinBend(draftOf(block(true)), "j1", { bow: -0.2, depth: 0.5 });
    expect(n.joins[0]).toMatchObject({ bow: -0.2, depth: 0.5 });
  });
  it("reset returns pieces home, joins to rest, and drops fillers", () => {
    const d = draftOf(block(true));
    const moved = patchPieces(d, [{ id: "a", x: 50, y: -90, rotation: 0.4 }]);
    const withFiller = { ...moved, pieces: [...moved.pieces, { ...letter("f", 9, 0, 40, 40), role: "mark" as const, filler: true as const }] };
    const r = resetDraft(withFiller);
    expect(r.pieces.map((p) => p.id)).toEqual(["a", "b"]);
    expect(r.pieces[0]).toMatchObject({ x: 0, y: 0, rotation: 0 });
    expect(r.joins[0]).toMatchObject({ bow: 0.1, depth: 0 });
  });
});

describe("inkBoundsPx", () => {
  it("measures the assembled outline in px at the draft's size, ignoring fillers", () => {
    const d = draftOf(block(false));
    const b = inkBoundsPx(d, UPM);
    // 600 font units tall at 100px/1000upm = 60px; x spans 0..600 units = 60px.
    expect(b.y2 - b.y1).toBeCloseTo(60, 0);
    expect(b.x2 - b.x1).toBeCloseTo(60, 0);
    const withFiller = { ...d, pieces: [...d.pieces, { ...letter("f", 9, 5000, 40, 40), role: "mark" as const, filler: true as const }] };
    expect(inkBoundsPx(withFiller, UPM).x2).toBeCloseTo(b.x2, 0);
  });
});

describe("arrangeDraft", () => {
  it("re-flows the letters into the shape, keeps the block in place unless a placement is given", () => {
    const d = draftOf(block(false));
    const tall: Array<[number, number]> = [[-60, -200], [60, -200], [60, 200], [-60, 200]];
    const r = arrangeDraft(d, UPM, tall, []);
    expect(r).not.toBeNull();
    expect(r!.draft.x).toBe(100); expect(r!.draft.y).toBe(200); expect(r!.draft.rotation).toBe(15);
    expect(r!.result.rows).toBeGreaterThanOrEqual(1);
    const placed = arrangeDraft(d, UPM, tall, [], { x: 1, y: 2, rotation: 3 });
    expect(placed!.draft).toMatchObject({ x: 1, y: 2, rotation: 3 });
  });
  it("strips earlier fillers before arranging", () => {
    const d = draftOf(block(false));
    const withFiller = { ...d, pieces: [...d.pieces, { ...letter("f", 9, 0, 40, 40), role: "mark" as const, filler: true as const }] };
    const tall: Array<[number, number]> = [[-60, -200], [60, -200], [60, 200], [-60, 200]];
    const r = arrangeDraft(withFiller, UPM, tall, []);
    expect(r!.draft.pieces.some((p) => p.filler)).toBe(false);
  });
  it("returns null for a degenerate shape (the arranger's own null case)", () => {
    const d = draftOf(block(false));
    expect(arrangeDraft(d, UPM, [[0, 0], [1, 1]], [])).toBeNull();
  });
});

describe("fitTransform", () => {
  const frame = { width: 800, height: 600 };
  it("scales the ink to the frame minus the margin and centres it", () => {
    const t = fitTransform({ x1: -50, y1: -100, x2: 50, y2: 100 }, 0, frame, 0.12);
    // Shorter side 600, margin 72 each side → 456 usable height for 200 of ink.
    expect(t.scale).toBeCloseTo(456 / 200, 3);
    // Ink centre (0, 0) lands at the frame's centre.
    expect(t.x).toBeCloseTo(400, 3); expect(t.y).toBeCloseTo(300, 3);
  });
  it("uses the rotated bounds so a turned composition still fits", () => {
    const up = fitTransform({ x1: -200, y1: -10, x2: 200, y2: 10 }, 0, frame, 0.12);
    const turned = fitTransform({ x1: -200, y1: -10, x2: 200, y2: 10 }, 90, frame, 0.12);
    // Upright the 400-wide bar is limited by width; turned 90° it is 400 tall
    // and limited by the (shorter) height, so it scales less.
    expect(turned.scale).toBeLessThan(up.scale);
    expect(turned.scale * 400).toBeLessThanOrEqual(600 - 2 * 72 + 1e-6);
  });
  it("offsets so an off-centre ink box is centred", () => {
    const t = fitTransform({ x1: 100, y1: 100, x2: 300, y2: 200 }, 0, frame, 0);
    // Ink centre (200, 150) × scale must land at (400, 300).
    expect(t.x + 200 * t.scale).toBeCloseTo(400, 3);
    expect(t.y + 150 * t.scale).toBeCloseTo(300, 3);
  });
  it("never divides by zero on empty ink", () => {
    const t = fitTransform({ x1: 0, y1: 0, x2: 0, y2: 0 }, 0, frame, 0.12);
    expect(Number.isFinite(t.scale)).toBe(true);
    expect(t.scale).toBeGreaterThan(0);
  });
});
