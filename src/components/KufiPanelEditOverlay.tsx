import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Group, Line, Rect } from "react-konva";
import { EXPORT_HIDDEN } from "../lib/exportChrome";
import { complementOf } from "../lib/complementColor";
import type { KufiPackResult, KufiPanelEdits } from "../lib/kufi/kufiPack";
import {
  firstUnitOfWord,
  handleCentre,
  hitKufiUnit,
  hitRouteHandle,
  hitStretchEnd,
  kufiFormsOf,
  kufiGlyphById,
  nearestHandle,
  nearestHandleAt,
  placementInk,
  placementOf,
  routeHandleOf,
  routeOffsetFor,
  stretchEnds,
  unitRings,
  type KufiHandle,
  type KufiStretchEnd,
} from "../lib/kufi/kufiHit";
import { cellsBetween, paintKufiCell } from "../lib/kufi/kufiPaint";
import {
  kufiFormCycle,
  kufiFormEdits,
  kufiPinEdits,
  kufiPinWordEdits,
  kufiRouteEdits,
  kufiStretchEdits,
} from "../lib/kufi/kufiPanelBlock";
import { kufiLayoutKey, previewKufiLayout, type KufiLayoutInputs } from "../lib/kufi/kufiLayoutClient";
import { PULL_REST_MS, pullAnswer, pullMove, pullRelease, pullRest, pullStart, type KufiPull } from "../lib/kufi/kufiPull";
import { resolveKufiText } from "../lib/kufi/kufiWords";

type Ok = Extract<KufiPackResult, { ok: true }>;
type Cell = { col: number; row: number };

type Props = {
  /** The panel as drawn now: the committed layout, or the live preview while a gesture is held. */
  result: Ok;
  /** The committed layout the gesture starts from (the packer's `previous`). */
  committed: Ok;
  inputs: KufiLayoutInputs;
  /** Cell size in block px. */
  cell: number;
  /** The block's ink colour: the overlay draws in its complement, the editing chrome's colour. */
  color: string;
  onPreview: (result: Ok | null) => void;
  /** A committed edit: the edits to save (already pinned), the result they draw, and the inputs they were made against. */
  onCommit: (fromKey: string, edits: KufiPanelEdits, result: Ok) => void;
  /** Why a gesture changed nothing, against the inputs it was made on. */
  onNotice: (fromKey: string, text: string) => void;
};

/** How far a press may drift, in screen px, and still count as a click. */
const CLICK_SLOP = 10;
/** A double click is swallowed if either press was on a letter; see `AlternateHoverHandles`. */
const DOUBLE_CLICK_WINDOW_MS = 600;
/** The furthest a stroke may be pulled past its current length, or a word along its path, in one drag, in cells. */
const MAX_PULL = 12;
const OUTLINE_PX = 1.5;
/** The stretch handle's side, as a fraction of a cell. */
const HANDLE = 0.7;
/** How long the cell outline shows red after a refused paint: the one transient coloured cue. */
export const FLASH_MS = 300;
export const FLASH_COLOR = "#e03131";

export const NO_ROOM_TO_STRETCH = "No room to stretch that here";
export const NO_ROOM_TO_ROUTE = "No room to move that word here";
export const NO_OTHER_FORM_FITS = "No other form of that letter fits here";
export const SINGLE_FORM = "That letter has one form";

/** What is under the pointer: the letter, the handle it is on (if any) and the handle nearest to it (a stretch end, or a first letter's route handle). */
type Hover = { unitIndex: number; on: KufiHandle | null; nearest: KufiHandle | null };

const sameHover = (a: Hover | null, b: Hover | null) =>
  a === b || (!!a && !!b && a.unitIndex === b.unitIndex && a.on === b.on && a.nearest === b.nearest);
const sameCell = (a: Cell | null, b: Cell | null) => a === b || (!!a && !!b && a.col === b.col && a.row === b.row);

/**
 * One pull on the canvas: a stroke end dragged along its stroke, or a word's
 * first letter dragged along its path. Both ask the packer for a repack per
 * cell crossed and show the last preview that packed (`kufiPull.ts`); what
 * differs is how a cell becomes a count, what edits a count means, and what
 * the commit pins.
 */
type PullSpec = {
  kind: "stretch" | "route";
  /** The letter outlined while the pull is held, and clicked by a still press. */
  unitIndex: number;
  /** The stretch end pulled, or the word routed: the handle drawn on the preview while the pull is held. */
  end: KufiStretchEnd | null;
  wordIndex: number | null;
  start: Cell;
  base: number;
  min: number;
  max: number;
  /** Cells along the pull from the press. */
  deltaOf: (c: Cell) => number;
  /** The edits that preview this count, or null when the count cannot be asked for (the box would leave the panel). */
  editsFor: (count: number) => KufiPanelEdits | null;
  /** What the commit saves: the shown preview's edits, pinned where it put the letters. */
  pinFor: (edits: KufiPanelEdits, result: Ok) => KufiPanelEdits;
  notice: string;
};

type Drag = {
  spec: PullSpec;
  /** The pointer at the press in stage px, and whether it has since left `CLICK_SLOP`: a still press is a click on the letter. */
  pressX: number;
  pressY: number;
  moved: boolean;
  pull: KufiPull;
  /** The preview on show, by count: the edits that made it and its panel. */
  shown: { count: number; edits: KufiPanelEdits; result: Ok } | null;
  restTimer: ReturnType<typeof setTimeout> | null;
  ended: boolean;
  /** Ends the drag; `abort` (the overlay unmounting) commits nothing and says nothing. */
  release: (abort?: boolean) => void;
};

/** An Alt-drag painting cells: its running edits and panel, and whether cells go on or off (the first cell decides). */
type Paint = {
  edits: KufiPanelEdits | undefined;
  result: Ok;
  on: boolean | undefined;
  last: Cell;
  changed: boolean;
  release: (abort?: boolean) => void;
};

/**
 * Editing a Kufi panel on the canvas, with no mode to enter: hover a letter
 * and it outlines in the block's editing colour, with one small square on
 * the stretch handle nearest the pointer; click it to cycle its square-Kufi
 * alternates (the ones that pack; a click that finds none says so in the
 * Kufi panel's status line); drag the square to lengthen or shorten that
 * stroke in whole cells while the rest of the panel repacks around it live.
 * A handle sits at the end of a stroke a stretch point lengthens, or, for a
 * stroke with no free end (a baseline joined on both sides), on the slice
 * itself; either way the drag runs along the stroke.
 *
 * **A word's first letter carries a route handle** (`routeHandleOf`: its
 * leading cell, on the baseline side), ranked with the letter's stretch ends
 * so hover shows whichever handle is nearest the pointer. Dragging it along
 * the word's line asks the packer to hold the word that many cells further
 * on (or back), live, as a stretch does; release commits the preview with
 * every letter of the word pinned where it landed, and the offset recorded
 * in `edits.routes`. A press anywhere else on a first letter is the letter's
 * own, as on any letter: a drift drags the whole panel, a still press is a
 * click. Where a route handle and a stretch end share a cell the route wins
 * (`hitRouteHandle` is checked first; the stretch has its other end). Where
 * nothing packs the word snaps back and the status line says so.
 *
 * **Alt paints single cells.** Holding Alt shows a thin outline round the
 * cell under the pointer (any cell, paper or ink); Alt-click toggles it and
 * Alt-drag paints every cell crossed the way the first cell went, one undo
 * step per click or drag. The cells between two pointer samples are filled
 * in (`cellsBetween`, a 4-connected line), so a fast hand paints the same
 * line as a slow one; each cell gets its own 2×2 check. A cell that would
 * make a 2×2 of ink is refused and the outline flashes red for `FLASH_MS`.
 * Painting is arithmetic on the drawn panel (`kufiPaint.ts`), never a
 * repack, so it never waits. Alt is read from the key events and from every
 * pointer event, and the key's default (a browser menu bar on Windows) is
 * suppressed while the pointer is over the panel, so a tap of Alt never
 * leaves the page's focus elsewhere.
 *
 * **Pointer-resolved**, like Next Shape: one listening `Rect` spans the
 * panel and the cell under the pointer is resolved in arithmetic
 * (`kufiHit.ts`); the outline, the handle and the e2e marker are
 * `listening={false}`, so there is no node Konva can retarget hover to and
 * no leave race. A press on a letter is not claimed (the panel still drags
 * from its ink); a press on a handle (stretch or route) or with Alt is, and
 * its drag is a stage listener rather than a node drag, as a Stack tail
 * pull is.
 *
 * **Previews run in the worker.** Each cell the pointer crosses asks
 * `previewKufiLayout` for a repack from the committed panel; the newest
 * request always wins and the panel keeps showing the last preview that
 * packed (`kufiPull.ts` holds the policy: a refused count is asked for once
 * more when the pointer rests, since the repack budget is a clock). Release
 * commits that preview, pinned where the packer put the letter, as one undo
 * step; if nothing the pointer reached packs, nothing is committed and the
 * stroke (or word) snaps back.
 */
export const KufiPanelEditOverlay: React.FC<Props> = ({ result, committed, inputs, cell, color, onPreview, onCommit, onNotice }) => {
  const [hover, setHover] = useState<Hover | null>(null);
  const [cellHover, setCellHover] = useState<Cell | null>(null);
  const [alt, setAlt] = useState(false);
  const [flash, setFlash] = useState<Cell | null>(null);
  const [dragging, setDragging] = useState<Drag | null>(null);
  const groupRef = useRef<Konva.Group>(null);
  const drag = useRef<Drag | null>(null);
  const paint = useRef<Paint | null>(null);
  /** Whether the pointer is over the panel: Alt's default is suppressed only then. */
  const over = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A press on a letter: where, and where the panel was, so a press that moved it is not a click. */
  const press = useRef<{ unitIndex: number; x: number; y: number; panelX: number; panelY: number } | null>(null);
  const lastLetterPress = useRef(-Infinity);
  const cycling = useRef(false);
  const accent = useMemo(() => complementOf(color), [color]);
  const fromKey = kufiLayoutKey(inputs);
  const units = useMemo(() => resolveKufiText(inputs.text).units, [inputs.text]);

  const width = result.cols * cell;
  const height = result.rows * cell;

  // The cursor says what a press here does; cleared with the hover.
  const cursor = alt
    ? cellHover
      ? "crosshair"
      : null
    : hover
      ? hover.on
        ? hover.on.kind === "route"
          ? "grab"
          : hover.on.dc !== 0
            ? "ew-resize"
            : "ns-resize"
        : "pointer"
      : null;
  useEffect(() => {
    const stage = groupRef.current?.getStage();
    if (!stage || !cursor) return;
    const style = stage.container().style;
    const prev = style.cursor;
    style.cursor = cursor;
    return () => {
      style.cursor = prev;
    };
  }, [cursor]);

  // Alt: held or not, from the key itself. Its default is suppressed while the
  // pointer is over the panel (on Windows a lone Alt moves focus to the
  // browser's menu); losing the window forgets it.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Alt") return;
      if (over.current) e.preventDefault();
      setAlt(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Alt") return;
      if (over.current) e.preventDefault();
      setAlt(false);
    };
    // losing the window ends a held gesture too, committing nothing: a
    // mouseup the page never sees must not commit on the next click anywhere
    const blur = () => {
      setAlt(false);
      drag.current?.release(true);
      paint.current?.release(true);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // A gesture outliving the overlay (the panel deselected mid-gesture) commits nothing.
  useEffect(
    () => () => {
      drag.current?.release(true);
      paint.current?.release(true);
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    },
    []
  );

  const panelNode = () => groupRef.current?.getParent() ?? null;
  /** The pointer in cell units (fractional), and the cell it is in. */
  const pointer = (): { at: { x: number; y: number }; cell: Cell } | null => {
    const pos = groupRef.current?.getRelativePointerPosition();
    if (!pos) return null;
    const at = { x: pos.x / cell, y: pos.y / cell };
    return { at, cell: { col: Math.floor(at.x), row: Math.floor(at.y) } };
  };
  const pointerCell = (): Cell | null => pointer()?.cell ?? null;
  const inside = (c: Cell | null): c is Cell => !!c && c.col >= 0 && c.row >= 0 && c.col < result.cols && c.row < result.rows;
  /** The letter's handles: its route handle first (it takes a tie), then its stretch ends. */
  const handlesOf = (r: Ok, unitIndex: number): KufiHandle[] => {
    const u = units[unitIndex];
    const route = u && firstUnitOfWord(units, u.wordIndex) === unitIndex ? routeHandleOf(r, units, u.wordIndex) : null;
    return route ? [route, ...stretchEnds(r, unitIndex)] : stretchEnds(r, unitIndex);
  };
  /**
   * What the pointer is on. Of the handles whose hit cells include the
   * pointer's cell (a route handle and a stretch end often share a first
   * letter's leading corner), the one whose drawn square is nearest the
   * pointer: so what hover shows is what a press takes.
   */
  const hoverAt = (p: { at: { x: number; y: number }; cell: Cell } | null): Hover | null => {
    if (!p) return null;
    const { at, cell: c } = p;
    const hits = [hitRouteHandle(result, units, c.col, c.row), hitStretchEnd(result, c.col, c.row)].filter((h): h is KufiHandle => h !== null);
    const on = nearestHandleAt(hits, at.x, at.y);
    const unitIndex = on ? on.unitIndex : hitKufiUnit(result, c.col, c.row);
    if (unitIndex === null) return null;
    return { unitIndex, on, nearest: on ?? nearestHandleAt(handlesOf(result, unitIndex), at.x, at.y) };
  };
  const updateHover = (altKey: boolean) => {
    const p = pointer();
    const c = p?.cell ?? null;
    const next = hoverAt(p);
    setHover((cur) => (sameHover(cur, next) ? cur : next));
    const cc = inside(c) ? c : null;
    setCellHover((cur) => (sameCell(cur, cc) ? cur : cc));
    // the pointer event knows whether Alt is down, whatever the key events said
    setAlt(altKey);
  };
  const flashAt = (c: Cell) => {
    setFlash(c);
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      flashTimer.current = null;
      setFlash(null);
    }, FLASH_MS);
  };

  /** Click: the next alternate of this letter that packs, tried in table order; one undo step. */
  const cycleForm = useCallback(
    async (unitIndex: number) => {
      if (cycling.current || drag.current || paint.current) return;
      const p = placementOf(committed, unitIndex);
      if (!p) return;
      const ids = kufiFormCycle(inputs.text, unitIndex, p.glyphId);
      if (ids.length === 0) {
        onNotice(fromKey, SINGLE_FORM);
        return;
      }
      cycling.current = true;
      try {
        for (const id of ids) {
          const edits = kufiFormEdits(inputs.edits, unitIndex, id);
          // null is "superseded", not "does not pack": nothing else previews
          // while a cycle runs, but ask once more rather than skip the form
          let r = await previewKufiLayout({ ...inputs, edits }, committed);
          if (r === null) r = await previewKufiLayout({ ...inputs, edits }, committed);
          if (r?.ok) {
            onCommit(fromKey, kufiPinEdits(edits, r, unitIndex), r);
            return;
          }
        }
        onNotice(fromKey, NO_OTHER_FORM_FITS);
      } finally {
        cycling.current = false;
      }
    },
    [committed, inputs, fromKey, onCommit, onNotice]
  );

  const beginPull = (spec: PullSpec, stage: Konva.Stage | null) => {
    if (!stage || drag.current || paint.current || cycling.current) return;
    const pressed = stage.getPointerPosition() ?? { x: 0, y: 0 };
    const state: Drag = {
      spec,
      pressX: pressed.x,
      pressY: pressed.y,
      moved: false,
      pull: pullStart(spec.base, spec.min, spec.max),
      shown: null,
      restTimer: null,
      ended: false,
      release: () => {},
    };
    const clearRest = () => {
      if (state.restTimer !== null) clearTimeout(state.restTimer);
      state.restTimer = null;
    };
    const request = (count: number) => {
      const edits = spec.editsFor(count);
      if (!edits) {
        // nothing to ask: the count is refused outright, and a rest will not change that
        state.pull = pullAnswer(state.pull, count, false).pull;
        return;
      }
      previewKufiLayout({ ...inputs, edits }, committed).then(
        (r) => {
          // superseded, or over
          if (r === null || state.ended) return;
          const a = pullAnswer(state.pull, count, r.ok);
          state.pull = a.pull;
          if (a.show && r.ok) {
            state.shown = { count, edits, result: r };
            onPreview(r);
          } else if (!r.ok && state.pull.refused === count) {
            // a refusal may be the clock, not the panel: once the pointer rests, ask again
            clearRest();
            state.restTimer = setTimeout(() => {
              state.restTimer = null;
              if (state.ended) return;
              const rest = pullRest(state.pull);
              state.pull = rest.pull;
              if (rest.request !== null) request(rest.request);
            }, PULL_REST_MS);
          }
        },
        (err: unknown) => console.warn(err)
      );
    };
    const move = () => {
      const at = stage.getPointerPosition();
      if (at && Math.hypot(at.x - state.pressX, at.y - state.pressY) > CLICK_SLOP) state.moved = true;
      const c = pointerCell();
      if (!c) return;
      const m = pullMove(state.pull, spec.deltaOf(c));
      if (m.pull === state.pull) return;
      state.pull = m.pull;
      clearRest();
      if (m.clear) {
        state.shown = null;
        onPreview(null);
      }
      if (m.request !== null) request(m.request);
    };
    const release = (abort = false) => {
      if (state.ended) return;
      state.ended = true;
      clearRest();
      stage.off(".kufipull");
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
      drag.current = null;
      // Whatever ends the drag, the panel goes back to drawing its own
      // layout: an uncommitted preview must never stay on a deselected
      // panel (it would draw, and export, a layout that was never saved),
      // and the chrome stops drawing the pulled letter (a blur mid-pull
      // once left its outline and handle up; on unmount this is harmless).
      onPreview(null);
      setDragging(null);
      if (abort) return;
      const r = pullRelease(state.pull);
      if (r.kind === "commit" && state.shown?.count === r.count)
        onCommit(fromKey, spec.pinFor(state.shown.edits, state.shown.result), state.shown.result);
      else if (r.kind === "refused") onNotice(fromKey, spec.notice);
      // A press and release that never moved is a click on the letter, as it
      // is anywhere else on the letter: a handle is not a dead spot.
      else if (r.kind === "cancel" && !state.moved) void cycleForm(spec.unitIndex);
    };
    const onUp = () => release();
    state.release = release;
    drag.current = state;
    setDragging(state);
    setHover(null);
    stage.on("mousemove.kufipull touchmove.kufipull", move);
    stage.on("mouseup.kufipull touchend.kufipull", onUp);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
  };

  const beginStretch = (end: KufiStretchEnd, start: Cell, stage: Konva.Stage | null) => {
    const p = placementOf(committed, end.unitIndex);
    const g = p ? kufiGlyphById(p.glyphId) : null;
    if (!p || !g) return;
    const base = g.stretch.map((_, i) => p.stretch[i] ?? 0);
    const at = base[end.stretchIndex];
    beginPull(
      {
        kind: "stretch",
        unitIndex: end.unitIndex,
        end,
        wordIndex: null,
        start,
        base: at,
        min: -(g.stretch[end.stretchIndex].min ?? 0),
        max: at + MAX_PULL,
        deltaOf: (c) => (c.col - start.col) * end.dc + (c.row - start.row) * end.dr,
        editsFor: (count) => {
          const counts = base.slice();
          counts[end.stretchIndex] = count;
          return kufiStretchEdits(inputs.edits, end.unitIndex, counts);
        },
        pinFor: (edits, r) => kufiPinEdits(edits, r, end.unitIndex),
        notice: NO_ROOM_TO_STRETCH,
      },
      stage
    );
  };

  const beginRoute = (wordIndex: number, start: Cell, stage: Konva.Stage | null) => {
    const first = firstUnitOfWord(units, wordIndex);
    if (first === null || !placementOf(committed, first)) return;
    const base = inputs.edits?.routes?.[wordIndex] ?? 0;
    const pressedAt = routeOffsetFor(committed, units, wordIndex, start.col, start.row);
    beginPull(
      {
        kind: "route",
        unitIndex: first,
        end: null,
        wordIndex,
        start,
        base,
        min: base - MAX_PULL,
        max: base + MAX_PULL,
        deltaOf: (c) => routeOffsetFor(committed, units, wordIndex, c.col, c.row) - pressedAt,
        editsFor: (count) => kufiRouteEdits(inputs.edits, committed, units, wordIndex, count),
        pinFor: (edits, r) => kufiPinWordEdits(edits, r, units, wordIndex),
        notice: NO_ROOM_TO_ROUTE,
      },
      stage
    );
  };

  /** Alt-press: toggle the cell, then paint every cell the pointer crosses the same way; one undo step on release. */
  const beginPaint = (start: Cell, stage: Konva.Stage | null) => {
    if (!stage || drag.current || paint.current || cycling.current || !inside(start)) return;
    const state: Paint = { edits: inputs.edits, result: committed, on: undefined, last: start, changed: false, release: () => {} };
    const at = (c: Cell) => {
      if (!inside(c)) return;
      const r = paintKufiCell(state.result, state.edits, c.col, c.row, state.on);
      if (r.kind === "refused") {
        flashAt(c);
        // the first cell wanted ink (erasing is never refused): the drag paints
        if (state.on === undefined) state.on = true;
        return;
      }
      if (r.kind !== "ok") return;
      if (state.on === undefined) state.on = r.result.cells[c.row * r.result.cols + c.col] === 1;
      state.result = r.result;
      state.edits = r.edits;
      state.changed = true;
      onPreview(r.result);
    };
    const move = () => {
      const c = pointerCell();
      if (!c || sameCell(c, state.last)) return;
      // every cell between the last sample and this one, so a fast hand
      // skips none; each is painted (and may be refused) on its own
      for (const step of cellsBetween(state.last, c)) at(step);
      state.last = c;
      // the outline follows the cell being painted
      setCellHover(inside(c) ? c : null);
    };
    const release = (abort = false) => {
      if (paint.current !== state) return;
      paint.current = null;
      stage.off(".kufipaint");
      window.removeEventListener("mouseup", onUp);
      onPreview(null);
      if (abort) {
        setAlt(false);
        return;
      }
      if (!state.changed || !state.edits) return;
      onCommit(fromKey, state.edits, state.result);
    };
    const onUp = () => release();
    state.release = release;
    paint.current = state;
    at(start);
    stage.on("mousemove.kufipaint", move);
    stage.on("mouseup.kufipaint", onUp);
    window.addEventListener("mouseup", onUp);
  };

  // What the chrome draws: while a pull is held, the pulled letter's outline
  // and its handle on the previewed panel; otherwise the hovered letter's and
  // the handle nearest the pointer. With Alt down, the cell outline instead.
  const shownUnit = alt && !dragging ? null : dragging ? dragging.spec.unitIndex : hover?.unitIndex ?? null;
  const outlines = useMemo(
    () => (shownUnit === null ? [] : unitRings(result, shownUnit).map((ring) => ring.flatMap(([x, y]) => [x * cell, y * cell]))),
    [result, shownUnit, cell]
  );
  const handle = useMemo((): KufiHandle | null => {
    if (shownUnit === null) return null;
    if (!dragging) return hover?.nearest ?? null;
    if (dragging.spec.wordIndex !== null) return routeHandleOf(result, units, dragging.spec.wordIndex);
    const d = dragging.spec.end;
    if (!d) return null;
    const same = stretchEnds(result, shownUnit).filter((e) => e.kind === d.kind && e.stretchIndex === d.stretchIndex && e.dc === d.dc && e.dr === d.dr);
    return nearestHandle(same, d.col, d.row);
  }, [result, units, shownUnit, dragging, hover]);
  const outlinedCell = flash ?? (alt && !dragging ? cellHover : null);

  // Read-only scene data for the e2e harness, in dev builds only (like the
  // `__HARF__` bridge): with one hit node there is no per-letter node a test
  // could find. Group-space px of a cell of each letter (the ink cell nearest
  // its centroid), of every handle, each word's first letter and its reading
  // step, and the drawn lattice itself as rows of `#` and `.`.
  const targets = useMemo(() => {
    if (!import.meta.env.DEV) return null;
    const letters = result.placements.map((p) => {
      const ink = placementInk(result, p);
      if (ink.length === 0) return null;
      let cx = 0;
      let cy = 0;
      for (const i of ink) {
        cx += i % result.cols;
        cy += Math.floor(i / result.cols);
      }
      cx /= ink.length;
      cy /= ink.length;
      const at = ink.reduce(
        (best, i) => {
          const d = Math.hypot((i % result.cols) - cx, Math.floor(i / result.cols) - cy);
          return d < best.d ? { i, d } : best;
        },
        { i: ink[0], d: Infinity }
      ).i;
      const unit = units[p.unitIndex];
      return {
        unit: p.unitIndex,
        glyphId: p.glyphId,
        forms: unit ? kufiFormsOf(unit).length : 1,
        x: ((at % result.cols) + 0.5) * cell,
        y: (Math.floor(at / result.cols) + 0.5) * cell,
      };
    });
    const ends = result.placements.flatMap((p) =>
      stretchEnds(result, p.unitIndex).map((e) => ({
        unit: p.unitIndex,
        si: e.stretchIndex,
        kind: e.kind,
        dc: e.dc,
        dr: e.dr,
        x: (e.col + 0.5) * cell,
        y: (e.row + 0.5) * cell,
      }))
    );
    // each word's route handle: its first letter, reading step, and a point on
    // the handle's square inside its own cell (the square straddles the edge)
    const words = result.placements.flatMap((p) => {
      const u = units[p.unitIndex];
      if (!u || firstUnitOfWord(units, u.wordIndex) !== p.unitIndex) return [];
      const h = routeHandleOf(result, units, u.wordIndex);
      if (!h) return [];
      return [{ word: u.wordIndex, unit: p.unitIndex, dc: h.dc, dr: h.dr, x: (h.col + 0.5 - h.dc * 0.25) * cell, y: (h.row + 0.5 - h.dr * 0.25) * cell }];
    });
    const grid: string[] = [];
    for (let r = 0; r < result.rows; r++) {
      let line = "";
      for (let c = 0; c < result.cols; c++) line += result.cells[r * result.cols + c] ? "#" : ".";
      grid.push(line);
    }
    return { letters: letters.filter((l) => l !== null), ends, words, grid, cell };
  }, [result, units, cell]);

  return (
    <Group ref={groupRef} name={EXPORT_HIDDEN}>
      <Rect
        name="kufi-edit-hit"
        width={width}
        height={height}
        fill="transparent"
        onMouseMove={(e) => {
          over.current = true;
          if (!drag.current && !paint.current) updateHover(e.evt.altKey);
        }}
        onMouseLeave={() => {
          over.current = false;
          if (!drag.current && !paint.current) {
            setHover(null);
            setCellHover(null);
          }
        }}
        onMouseDown={(e) => {
          if (e.evt.button !== 0) return;
          const p = pointer();
          const c = p?.cell ?? null;
          press.current = null;
          if (e.evt.altKey) {
            // Alt paints: claimed, whatever is under the pointer
            e.cancelBubble = true;
            if (c) beginPaint(c, e.target.getStage());
            return;
          }
          const h = hoverAt(p);
          if (h?.on && c) {
            // the handle's drag is this tool's, never the block's: a stretch
            // end pulls its stroke, a route handle drags its word along its path
            e.cancelBubble = true;
            lastLetterPress.current = performance.now();
            if (h.on.kind === "route") beginRoute(h.on.wordIndex, c, e.target.getStage());
            else beginStretch(h.on, c, e.target.getStage());
          } else if (h) {
            // not claimed: a press that drifts drags the whole panel
            const panel = panelNode();
            press.current = { unitIndex: h.unitIndex, x: e.evt.clientX, y: e.evt.clientY, panelX: panel?.x() ?? 0, panelY: panel?.y() ?? 0 };
            lastLetterPress.current = performance.now();
          }
        }}
        onTouchStart={(e) => {
          const p = pointer();
          const c = p?.cell ?? null;
          const h = hoverAt(p);
          if (h?.on && c) {
            e.cancelBubble = true;
            if (h.on.kind === "route") beginRoute(h.on.wordIndex, c, e.target.getStage());
            else beginStretch(h.on, c, e.target.getStage());
          } else if (h) lastLetterPress.current = performance.now();
        }}
        // A click is read on release within a small slop, for the pressed
        // letter: Konva's `click` does not fire once the pointer has moved.
        // A press that moved the panel (Konva drags from the first pixel)
        // already took its own undo step and is not also a click.
        onMouseUp={(e) => {
          const p = press.current;
          press.current = null;
          if (!p || Math.hypot(e.evt.clientX - p.x, e.evt.clientY - p.y) > CLICK_SLOP) return;
          const panel = panelNode();
          if (panel && (panel.x() !== p.panelX || panel.y() !== p.panelY)) return;
          void cycleForm(p.unitIndex);
        }}
        onTap={() => {
          const h = hoverAt(pointer());
          if (h && !h.on) void cycleForm(h.unitIndex);
        }}
        // The first click changes the letter; a quick second one must not
        // reach the block's edit handler and focus the textarea.
        onDblClick={(e) => {
          if (performance.now() - lastLetterPress.current < DOUBLE_CLICK_WINDOW_MS) e.cancelBubble = true;
        }}
        onDblTap={(e) => {
          if (performance.now() - lastLetterPress.current < DOUBLE_CLICK_WINDOW_MS) e.cancelBubble = true;
        }}
      />
      {outlines.map((points, i) => (
        <Line
          key={i}
          name="kufi-hover-outline"
          points={points}
          closed
          stroke={accent}
          strokeWidth={OUTLINE_PX}
          strokeScaleEnabled={false}
          listening={false}
        />
      ))}
      {handle && (
        <Rect
          name={handle.kind === "route" ? "kufi-route-handle" : "kufi-stretch-handle"}
          // an end's square sits on the edge the stroke grows across, a slice grip on its
          // cell, a route handle on the word's leading edge (`handleCentre`)
          x={handleCentre(handle).x * cell - (HANDLE * cell) / 2}
          y={handleCentre(handle).y * cell - (HANDLE * cell) / 2}
          width={HANDLE * cell}
          height={HANDLE * cell}
          fill={accent}
          listening={false}
        />
      )}
      {outlinedCell && (
        <Rect
          name="kufi-cell-outline"
          x={outlinedCell.col * cell}
          y={outlinedCell.row * cell}
          width={cell}
          height={cell}
          stroke={flash ? FLASH_COLOR : accent}
          strokeWidth={OUTLINE_PX}
          strokeScaleEnabled={false}
          fillEnabled={false}
          listening={false}
        />
      )}
      {targets && (
        <Group name="kufi-edit-targets" listening={false} letters={targets.letters} ends={targets.ends} words={targets.words} grid={targets.grid} cellPx={targets.cell} />
      )}
    </Group>
  );
};
