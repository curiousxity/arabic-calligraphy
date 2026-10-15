// src/lib/stackDraft.ts
// The stack editor window's staged state and every mutation it performs.
// Pure: never imports ./harfbuzz. Geometry in font units like the block;
// `inkBoundsPx` and `fitTransform` are the only px-aware parts.
import type { StackBlock, StackPiece, StackJoin } from "../types";
import type { CurveTrace } from "./stackCurve";
import { bendCurveAt, healTail, splitPieceAtCut } from "./stackConvert";
import { arrangeStackInShape, type ArrangeResult, type FillerShape } from "./stackArrange";
import { assembleStackOutline, stackScale } from "./stackOutline";
import { outlineBounds } from "./strokeCuts";

export type StackDraft = {
  pieces: StackPiece[];
  joins: StackJoin[];
  fontSize: number;
  nib: { width: number; minFraction: number };
  /** Carried so a canvas-guide arrange can move the block on Done; nothing
   *  else in the window touches them. */
  x: number;
  y: number;
  rotation: number;
};

export type Box = { x1: number; y1: number; x2: number; y2: number };
export type PiecePatch = { id: string; x?: number; y?: number; rotation?: number };

export function draftOf(block: StackBlock): StackDraft {
  return {
    pieces: block.pieces ?? [],
    joins: block.joins ?? [],
    fontSize: block.fontSize,
    nib: block.nib,
    x: block.x,
    y: block.y,
    rotation: block.rotation ?? 0,
  };
}

/**
 * Whether Done has anything to commit. Arrays compare by reference: every
 * mutation here returns a new array, and an undo back to the opening state
 * restores the opening arrays themselves, so reference equality is "nothing
 * happened". A drag that nets to zero counts as a change; that costs one
 * history step, never a lost edit.
 */
export function draftChanged(a: StackDraft, b: StackDraft): boolean {
  return (
    a.pieces !== b.pieces || a.joins !== b.joins || a.fontSize !== b.fontSize ||
    a.nib.minFraction !== b.nib.minFraction || a.nib.width !== b.nib.width ||
    a.x !== b.x || a.y !== b.y || a.rotation !== b.rotation
  );
}

export function patchPieces(d: StackDraft, patches: PiecePatch[]): StackDraft {
  const byId = new Map(patches.map((p) => [p.id, p]));
  return { ...d, pieces: d.pieces.map((p) => { const q = byId.get(p.id); return q ? { ...p, ...q, id: p.id } : p; }) };
}

export function setJoinBend(d: StackDraft, joinId: string, bend: { bow: number; depth: number }): StackDraft {
  return { ...d, joins: d.joins.map((j) => (j.id === joinId ? { ...j, bow: bend.bow, depth: bend.depth } : j)) };
}

/** Cut a piece; the cap is the piece the split appended (the overlay pulls it in the same gesture). */
export function splitDraft(
  d: StackDraft, pieceId: string, cut: { cutX: number; angle: number }
): { draft: StackDraft; cap: { id: string; x: number; y: number } } | null {
  const next = splitPieceAtCut(d.pieces, d.joins, pieceId, cut);
  if (!next) return null;
  const cap = next.pieces[next.pieces.length - 1];
  return { draft: { ...d, pieces: next.pieces, joins: next.joins }, cap: { id: cap.id, x: cap.x, y: cap.y } };
}

/** Free the curve the hover traced into a join. */
export function bendDraft(d: StackDraft, pieceId: string, trace: CurveTrace): { draft: StackDraft; joinId: string } | null {
  const next = bendCurveAt(d.pieces, d.joins, pieceId, trace);
  if (!next) return null;
  return { draft: { ...d, pieces: next.pieces, joins: next.joins }, joinId: next.joinId };
}

/** Delete the stretch a pulled tail hangs from: the letter is whole again. */
export function healDraft(d: StackDraft, pieceId: string): StackDraft | null {
  const next = healTail(d.pieces, d.joins, pieceId);
  return next ? { ...d, pieces: next.pieces, joins: next.joins } : null;
}

/** Pieces replaced whole by id (a cut sliding moves outline between two). */
export function replacePieces(d: StackDraft, pieces: StackPiece[]): StackDraft {
  const byId = new Map(pieces.map((p) => [p.id, p]));
  return { ...d, pieces: d.pieces.map((p) => byId.get(p.id) ?? p) };
}

/** Pieces home, joins to rest, fillers gone (home is the conversion, which had none). */
export function resetDraft(d: StackDraft): StackDraft {
  return {
    ...d,
    pieces: d.pieces.filter((p) => !p.filler).map((p) => ({ ...p, x: p.homeX, y: p.homeY, rotation: 0 })),
    joins: d.joins.map((j) => ({ ...j, bow: j.rest?.bow ?? 0, depth: j.rest?.depth ?? 0 })),
  };
}

/** The assembled outline's bounds in block-local px (rotation 0), fillers excluded. */
export function inkBoundsPx(d: StackDraft, unitsPerEm: number): Box {
  const s = stackScale(d.fontSize, unitsPerEm);
  const b = outlineBounds(assembleStackOutline(d.pieces.filter((p) => !p.filler), d.joins, d.nib));
  return { x1: b.x1 * s, y1: b.y1 * s, x2: b.x2 * s, y2: b.y2 * s };
}

/**
 * Arrange the draft's letters into `shapePx` (block-local px, centred on the
 * origin). Earlier fillers are stripped first so a re-run never accumulates
 * them. `placement` moves the block (a canvas guide); absent, it stays.
 * Returns null when nothing fits; lets the arranger's throw propagate.
 */
export function arrangeDraft(
  d: StackDraft, unitsPerEm: number, shapePx: Array<[number, number]>, fillers: FillerShape[],
  placement?: { x: number; y: number; rotation: number }
): { draft: StackDraft; result: ArrangeResult } | null {
  const result = arrangeStackInShape({
    pieces: d.pieces.filter((p) => !p.filler), joins: d.joins, shapePx,
    fontSize: d.fontSize, unitsPerEm, fillers, pullStems: true,
  });
  if (!result) return null;
  return {
    draft: { ...d, pieces: result.pieces, joins: result.joins, fontSize: result.fontSize, ...(placement ?? {}) },
    result,
  };
}

/**
 * The group transform that shows `ink` (block-local px, before rotation)
 * centred in `frame` with `marginFraction` of the frame's shorter side kept
 * clear on every edge. The rotated bounds are fitted, so a turned block
 * stays inside the frame.
 */
export function fitTransform(
  ink: Box, rotationDeg: number, frame: { width: number; height: number }, marginFraction: number
): { scale: number; x: number; y: number } {
  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const corners: Array<[number, number]> = [[ink.x1, ink.y1], [ink.x2, ink.y1], [ink.x2, ink.y2], [ink.x1, ink.y2]];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of corners) {
    const rx = x * c - y * s, ry = x * s + y * c;
    x1 = Math.min(x1, rx); y1 = Math.min(y1, ry); x2 = Math.max(x2, rx); y2 = Math.max(y2, ry);
  }
  const margin = Math.min(frame.width, frame.height) * marginFraction;
  const usableW = Math.max(frame.width - 2 * margin, 1);
  const usableH = Math.max(frame.height - 2 * margin, 1);
  const w = Math.max(x2 - x1, 1e-6), h = Math.max(y2 - y1, 1e-6);
  const scale = Math.max(Math.min(usableW / w, usableH / h), 1e-3);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  return { scale, x: frame.width / 2 - cx * scale, y: frame.height / 2 - cy * scale };
}
