import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Group, Label, Line, Rect, Tag, Text } from "react-konva";
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
  kufiPlaceOf,
  nearestHandle,
  nearestHandleAt,
  placedBox,
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
  kufiMovedUnits,
  kufiPinEdits,
  kufiPinWordEdits,
  kufiRouteEdits,
  kufiStretchEdits,
  type KufiTool,
} from "../lib/kufi/kufiPanelBlock";
import { kufiNoticeAt } from "../lib/kufi/kufiPanelStatus";
import { kufiLayoutKey, previewKufiLayout, type KufiLayoutInputs } from "../lib/kufi/kufiLayoutClient";
import { PULL_REST_MS, evenRouteStep, pullAnswer, pullMove, pullRelease, pullRest, pullStart, snapPull, type KufiPull } from "../lib/kufi/kufiPull";
import { resolveKufiText } from "../lib/kufi/kufiWords";
import { KUFI_STRETCH_STEPS, kufiLetterOptions, kufiStretchTry, type KufiLetterOptions, type KufiTry } from "../lib/kufi/kufiExplore";
import { useKufiExplore } from "../hooks/useKufiExplore";

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
  /** Why a gesture changed nothing, against the inputs it was made on, and the letter it was on; null when a gesture starts (clears the one on show). */
  onNotice: (fromKey: string, notice: KufiNotice | null) => void;
  /** The notice on show (App clears it after `KUFI_NOTICE_MS`): drawn beside its letter while `key` is these inputs' key. */
  notice?: ({ key: string } & KufiNotice) | null;
  /** The tool picked in the sidebar's tool row: which handles show and what a press does. */
  tool?: KufiTool;
  /** A still click on a letter selects it (its options show in the sidebar); a still click on paper clears it. */
  onSelectLetter?: (unitIndex: number | null) => void;
  /** The letter picked now (App's `kufiLetter` for this panel): in Select, a click on it cycles its form; a click on another letter only picks that one. */
  pickedUnit?: number | null;
};

/** A refusal or confirmation, drawn as a short label beside the letter it is about. */
export type KufiNotice = { text: string; unitIndex: number };
/** How long a notice stays beside its letter. */
export const KUFI_NOTICE_MS = 2000;
/** The notice label's type size and padding, in screen px (the label is drawn at the stage's inverse scale). */
const NOTICE_FONT_PX = 12;
const NOTICE_PAD_PX = 4;

/** How far a press may drift, in screen px, and still count as a click. */
const CLICK_SLOP = 10;
/** A double click is swallowed if either press was on a letter; see `AlternateHoverHandles`. */
const DOUBLE_CLICK_WINDOW_MS = 600;
/** The furthest a stroke may be pulled past its current length, or a word along its path, in one drag, in cells. */
const MAX_PULL = 12;
const OUTLINE_PX = 1.5;
/** The route handle's side, as a fraction of a cell. */
const HANDLE = 0.7;
/** A stretch end's square in the Stretch tool: a whole cell, every end of the hovered letter at once. */
const STRETCH_HANDLE = 1;
/** The ends not under the pointer draw this faint, so the letter's ink still reads beneath them. */
const IDLE_HANDLE_OPACITY = 0.55;
/** The marks at the lengths that fit, drawn while a stretch is held: fainter still, so the pulled end reads over them. */
const FIT_MARK_OPACITY = 0.35;
/** How long the cell outline shows red after a refused paint: the one transient coloured cue. */
export const FLASH_MS = 300;
export const FLASH_COLOR = "#e03131";
/**
 * The outline round each letter outside the dragged word that a Move word
 * preview changed: the hover outline's stroke in a colour of its own, so the
 * letters the packer rearranged read apart from the word being moved.
 */
export const MOVED_COLOR = "#0ca678";

export const NO_ROOM_TO_STRETCH = "No room to stretch that here";
export const NO_ROOM_TO_ROUTE = "No room to move that word here";
export const NO_OTHER_FORM_FITS = "No other form of that letter fits here";
export const SINGLE_FORM = "That letter has one form";

/** What is under the pointer: the letter, and the current tool's handle it is on (if any). */
type Hover = { unitIndex: number; on: KufiHandle | null };

const sameHover = (a: Hover | null, b: Hover | null) => a === b || (!!a && !!b && a.unitIndex === b.unitIndex && a.on === b.on);
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
  /**
   * What exploration knows about this count: the counts that fit on its side
   * of the start, each with its explored try, or null when it has not been
   * explored (a route, a slice not yet reached, a count further than
   * `KUFI_STRETCH_STEPS` reach). Null asks the packer as before.
   */
  explored?: (count: number) => Array<{ count: number; try: KufiTry & { result: Ok } }> | null;
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

/** A paint drag (the Paint tool, or Alt): its running edits and panel, and whether cells go on or off (the first cell decides). */
type Paint = {
  edits: KufiPanelEdits | undefined;
  result: Ok;
  on: boolean | undefined;
  last: Cell;
  changed: boolean;
  release: (abort?: boolean) => void;
};

/**
 * Editing a Kufi panel on the canvas, with the **tool** picked in the
 * sidebar's tool row (`KufiToolRow`; App state, Select by default, back to
 * Select when the selection changes):
 *
 * - **Select**: hover outlines a letter; a still click on a letter not
 *   picked yet only picks it (the sidebar lists its options); a still click
 *   on the picked letter swaps it to its next square-Kufi alternate that
 *   packs (a click that finds none says so beside the letter). No handles.
 * - **Stretch**: hover outlines a letter and shows **every** stretch end of
 *   it that can fit, each a whole-cell square; drag one to lengthen or
 *   shorten that stroke in whole cells while the rest of the panel repacks
 *   around it live, with a faint mark at each length exploration found to
 *   fit. A still click on a letter (or a handle) only selects it.
 * - **Move word**: every word's route handle shows; drag one to slide the
 *   word along its line. A still click on a letter only selects it.
 * - **Paint**: the cell under the pointer outlines; click or drag paints, as
 *   Alt does from any tool.
 *
 * In every tool but Paint a press on a letter away from a handle is not
 * claimed: a drift drags the whole panel.
 *
 * A stretch handle sits at the end of a stroke a stretch point lengthens,
 * or, for a stroke with no free end (a baseline joined on both sides), on
 * the slice itself; either way the drag runs along the stroke.
 *
 * **Refusals and confirmations draw beside the letter** (`notice`, a Konva
 * label named `kufi-notice`, export-hidden with the rest of the overlay):
 * the overlay reports one through `onNotice`, App holds it for
 * `KUFI_NOTICE_MS` and clears it when the next gesture starts.
 *
 * **A word's first letter carries a route handle** (`routeHandleOf`: its
 * leading cell, on the baseline side), shown in the Move word tool. Dragging it along
 * the word's line asks the packer to hold the word that many cells further
 * on (or back), live, as a stretch does, in steps of two cells only
 * (`evenRouteStep`: the lattice's parity refuses every odd move, and a
 * refused move costs the packer about half a second, measured, and at most
 * about 1.55 s: the rounds' 150 ms clock and the step's 1400 ms). The packer may
 * rearrange the rest of the panel round the word; while such a preview is
 * shown, every other letter it changed is outlined in `MOVED_COLOR`.
 * Release commits the preview with every letter of the word pinned where it
 * landed (or the whole panel, when any letter outside the word changed),
 * and the offset recorded in `edits.routes`. A press anywhere else on a first letter is the letter's
 * own, as on any letter: a drift drags the whole panel, a still press is a
 * click. Each tool hit-tests only its own handles, so a route handle and a
 * stretch end sharing a cell never compete. Where nothing packs the word
 * snaps back and says so beside the letter.
 *
 * **Paint (or Alt from any tool) paints single cells.** A thin outline
 * shows round the cell under the pointer (any cell, paper or ink); a click
 * toggles it and a drag paints every cell crossed the way the first cell went, one undo
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
export const KufiPanelEditOverlay: React.FC<Props> = ({
  result,
  committed,
  inputs,
  cell,
  color,
  onPreview,
  onCommit,
  onNotice,
  notice = null,
  tool = "select",
  onSelectLetter,
  pickedUnit = null,
}) => {
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
  const press = useRef<{ unitIndex: number | null; x: number; y: number; panelX: number; panelY: number } | null>(null);
  const lastLetterPress = useRef(-Infinity);
  const cycling = useRef(false);
  const accent = useMemo(() => complementOf(color), [color]);
  const fromKey = kufiLayoutKey(inputs);
  const units = useMemo(() => resolveKufiText(inputs.text).units, [inputs.text]);
  // What exploring the committed panel has found (the sidebar's strip reads
  // the same state): each letter's forms and stretch lengths that fit,
  // worked out per letter on first use.
  const explore = useKufiExplore(inputs);
  const optionsOf = useMemo(() => {
    const memo = new Map<number, KufiLetterOptions>();
    return (unitIndex: number): KufiLetterOptions => {
      let o = memo.get(unitIndex);
      if (!o) memo.set(unitIndex, (o = kufiLetterOptions(inputs.text, committed, explore, unitIndex)));
      return o;
    };
  }, [inputs.text, committed, explore]);
  /** A stretch end shows unless exploration has tried its slice and no length of it fits. */
  const endShown = useCallback(
    (e: KufiStretchEnd) => {
      const fitting = optionsOf(e.unitIndex).stretch.get(e.stretchIndex);
      return !fitting || fitting.length > 0;
    },
    [optionsOf]
  );

  const width = result.cols * cell;
  const height = result.rows * cell;
  /** Whether a press paints: the Paint tool, or Alt held in any tool. */
  const painting = alt || tool === "paint";

  // The cursor says what a press here does; cleared with the hover.
  const cursor = painting
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
  /**
   * What the pointer is on: the letter, and the handle of the current tool
   * whose hit cells include the pointer's cell (Stretch: a stretch end that
   * can fit; Move word: a route handle; Select and Paint have none). A
   * handle's paper cell counts as its letter's, so hover shows what a press
   * takes.
   */
  const hoverAt = (p: { at: { x: number; y: number }; cell: Cell } | null): Hover | null => {
    if (!p) return null;
    const { at, cell: c } = p;
    const hits: KufiHandle[] = [];
    if (tool === "stretch") {
      const end = hitStretchEnd(result, c.col, c.row, endShown);
      if (end) hits.push(end);
    } else if (tool === "move") {
      const route = hitRouteHandle(result, units, c.col, c.row);
      if (route) hits.push(route);
    }
    const on = nearestHandleAt(hits, at.x, at.y);
    const unitIndex = on ? on.unitIndex : hitKufiUnit(result, c.col, c.row);
    if (unitIndex === null) return null;
    return { unitIndex, on };
  };
  /** A still click on a letter picks it; in Select, a click on the letter already picked swaps its form. */
  const clickLetter = (unitIndex: number) => {
    if (tool === "select" && unitIndex === pickedUnit) void cycleForm(unitIndex);
    else onSelectLetter?.(unitIndex);
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

  /**
   * Click on the picked letter: swaps it to the next alternate that packs,
   * in table order; one undo step. A form exploration has tried is taken from
   * its try (no pack under the pointer) or skipped; one not tried yet is
   * asked of the packer while exploration is still running, and skipped once
   * it is done or failed (the sidebar then says "Not checked" and disables it
   * too). So once every form is known, a click that finds none says so at once.
   */
  const cycleForm = useCallback(
    async (unitIndex: number) => {
      if (cycling.current || drag.current || paint.current) return;
      onSelectLetter?.(unitIndex);
      const p = placementOf(committed, unitIndex);
      if (!p) return;
      const ids = kufiFormCycle(inputs.text, unitIndex, p.glyphId, kufiPlaceOf(committed, unitIndex));
      if (ids.length === 0) {
        onNotice(fromKey, { text: SINGLE_FORM, unitIndex });
        return;
      }
      const known = optionsOf(unitIndex).forms;
      // exploration over (done or failed): a form it never reached is "not checked", skipped as the sidebar disables it
      const settled = !!explore?.done;
      cycling.current = true;
      try {
        for (const id of ids) {
          const option = known.find((f) => f.glyphId === id);
          if (option?.fits === false) continue;
          if (option && option.fits === null && settled) continue;
          if (option?.fits && option.try?.result) {
            onCommit(fromKey, option.try.edits, option.try.result);
            return;
          }
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
        onNotice(fromKey, { text: NO_OTHER_FORM_FITS, unitIndex });
      } finally {
        cycling.current = false;
      }
    },
    [committed, inputs, fromKey, onCommit, onNotice, onSelectLetter, optionsOf, explore]
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
      if (m.request === null) return;
      const known = spec.explored?.(m.request) ?? null;
      if (known === null) {
        request(m.request);
        return;
      }
      if (known.length === 0) {
        // exploration tried every count on this side and none fits: refused, with no repack and no retry
        state.pull = pullAnswer(state.pull, m.request, false).pull;
        return;
      }
      // snap to the nearest count that fits, shown from its explored try
      const to = snapPull(m.request, known.map((k) => k.count));
      const hit = known.find((k) => k.count === to)!;
      state.pull = { ...state.pull, shown: to, refused: null };
      if (state.shown?.count === to) return;
      state.shown = { count: to, edits: hit.try.edits, result: hit.try.result };
      onPreview(hit.try.result);
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
      else if (r.kind === "refused") onNotice(fromKey, { text: spec.notice, unitIndex: spec.unitIndex });
      // A press and release that never moved is a click on the letter, as it
      // is anywhere else on the letter: a handle is not a dead spot. Pulls
      // happen only in Stretch and Move word, where a click only selects.
      else if (r.kind === "cancel" && !state.moved) onSelectLetter?.(spec.unitIndex);
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
        explored: (count) => {
          // explored only within the steps tried from the drawn count, and only once the whole slice is
          if (Math.abs(count - at) > Math.max(...KUFI_STRETCH_STEPS)) return null;
          const fitting = optionsOf(end.unitIndex).stretch.get(end.stretchIndex);
          if (!fitting) return null;
          const side = Math.sign(count - at);
          const out: Array<{ count: number; try: KufiTry & { result: Ok } }> = [];
          for (const c of fitting) {
            if (Math.sign(c - at) !== side) continue;
            const t = kufiStretchTry(explore, end.unitIndex, end.stretchIndex, c);
            if (t?.result) out.push({ count: c, try: { ...t, result: t.result } });
          }
          return out;
        },
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
        // two cells at a time: an odd move never packs, so it is never asked for
        deltaOf: (c) => evenRouteStep(routeOffsetFor(committed, units, wordIndex, c.col, c.row) - pressedAt),
        editsFor: (count) => kufiRouteEdits(inputs.edits, committed, units, wordIndex, count),
        pinFor: (edits, r) => kufiPinWordEdits(edits, committed, r, units, wordIndex),
        notice: NO_ROOM_TO_ROUTE,
      },
      stage
    );
  };

  /** A paint press (the Paint tool, or Alt): toggle the cell, then paint every cell the pointer crosses the same way; one undo step on release. */
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
      window.removeEventListener("touchend", onUp);
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
    stage.on("mousemove.kufipaint touchmove.kufipaint", move);
    stage.on("mouseup.kufipaint touchend.kufipaint", onUp);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
  };

  // What the chrome draws: while a pull is held, the pulled letter's outline
  // and its handle on the previewed panel; otherwise the hovered letter's,
  // and the tool's handles (Stretch: every end of the hovered letter that
  // can fit; Move word: every word's route handle). Painting (the Paint
  // tool, or Alt), the cell outline instead.
  const shownUnit = painting && !dragging ? null : dragging ? dragging.spec.unitIndex : hover?.unitIndex ?? null;
  const outlines = useMemo(
    () => (shownUnit === null ? [] : unitRings(result, shownUnit).map((ring) => ring.flatMap(([x, y]) => [x * cell, y * cell]))),
    [result, shownUnit, cell]
  );
  // While a word's move is previewed, the other letters it changed.
  const routeWord = dragging?.spec.kind === "route" ? dragging.spec.wordIndex : null;
  const movedOutlines = useMemo(() => {
    if (routeWord === null || result === committed) return [];
    return kufiMovedUnits(committed, result, units, routeWord).flatMap((k) =>
      unitRings(result, k).map((ring) => ring.flatMap(([x, y]) => [x * cell, y * cell]))
    );
  }, [routeWord, result, committed, units, cell]);
  const wordIndices = useMemo(() => [...new Set(units.map((u) => u.wordIndex))], [units]);
  const handles = useMemo((): KufiHandle[] => {
    if (dragging) {
      if (dragging.spec.wordIndex !== null) {
        const h = routeHandleOf(result, units, dragging.spec.wordIndex);
        return h ? [h] : [];
      }
      const d = dragging.spec.end;
      if (!d) return [];
      const same = stretchEnds(result, dragging.spec.unitIndex).filter(
        (e) => e.kind === d.kind && e.stretchIndex === d.stretchIndex && e.dc === d.dc && e.dr === d.dr
      );
      const h = nearestHandle(same, d.col, d.row);
      return h ? [h] : [];
    }
    if (painting) return [];
    if (tool === "stretch") return shownUnit === null ? [] : stretchEnds(result, shownUnit).filter(endShown);
    if (tool === "move")
      return wordIndices.flatMap((w) => {
        const h = routeHandleOf(result, units, w);
        return h ? [h] : [];
      });
    return [];
  }, [result, units, shownUnit, dragging, painting, tool, wordIndices, endShown]);
  // While a stretch is held: a faint mark at the end's place for each length
  // of that slice exploration found to fit (none while the slice is unknown),
  // measured from where the end is drawn now, so the marks follow the letter
  // when a preview moves it.
  const fitMarks = useMemo((): Cell[] => {
    const e = dragging?.spec.kind === "stretch" ? dragging.spec.end : null;
    if (!dragging || !e) return [];
    const counts = optionsOf(e.unitIndex).stretch.get(e.stretchIndex);
    if (!counts) return [];
    const same = stretchEnds(result, e.unitIndex).filter(
      (x) => x.kind === e.kind && x.stretchIndex === e.stretchIndex && x.dc === e.dc && x.dr === e.dr
    );
    const now = nearestHandle(same, e.col, e.row);
    const p = placementOf(result, e.unitIndex);
    const from = now && p ? { end: now, count: p.stretch[e.stretchIndex] ?? 0 } : { end: e, count: dragging.spec.base };
    return counts
      .map((count) => {
        const d = count - from.count;
        return { col: from.end.col + d * e.dc, row: from.end.row + d * e.dr };
      })
      .filter((c) => c.col >= 0 && c.row >= 0 && c.col < result.cols && c.row < result.rows);
  }, [dragging, optionsOf, result]);
  const onHandle = dragging ? null : hover?.on ?? null;
  const sameHandle = (a: KufiHandle, b: KufiHandle | null) =>
    !!b && a.kind === b.kind && a.unitIndex === b.unitIndex && a.col === b.col && a.row === b.row && a.dc === b.dc && a.dr === b.dr;
  const outlinedCell = flash ?? (painting && !dragging ? cellHover : null);

  // The notice beside its letter: only for these inputs, and only while the
  // letter is on the panel drawn.
  const noticeShown = notice && notice.key === fromKey ? notice : null;
  const noticeBox = useMemo(() => {
    if (!noticeShown) return null;
    const p = placementOf(result, noticeShown.unitIndex);
    if (!p) return null;
    const b = placedBox(p);
    return { x: p.col * cell, y: p.row * cell, width: b.w * cell, height: b.h * cell };
  }, [noticeShown, result, cell]);
  const noticeRef = useRef<Konva.Label>(null);
  // The label keeps a constant size on screen (drawn at the inverse of the
  // stage's zoom), so where it fits beside the box is known only once drawn.
  useLayoutEffect(() => {
    const label = noticeRef.current;
    const parent = label?.getParent();
    if (!label || !parent || !noticeBox) return;
    const k = parent.getAbsoluteScale().x || 1;
    label.scale({ x: 1 / k, y: 1 / k });
    const at = kufiNoticeAt(noticeBox, { width, height }, { width: label.width() / k, height: label.height() / k }, cell / 2);
    label.position(at);
    label.getLayer()?.batchDraw();
  }, [noticeBox, noticeShown, width, height, cell]);

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
        forms: unit ? kufiFormsOf(unit, kufiPlaceOf(result, p.unitIndex)).length : 1,
        x: ((at % result.cols) + 0.5) * cell,
        y: (Math.floor(at / result.cols) + 0.5) * cell,
      };
    });
    const ends = result.placements.flatMap((p) =>
      stretchEnds(result, p.unitIndex).filter(endShown).map((e) => ({
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
  }, [result, units, cell, endShown]);

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
          // a gesture starting clears the last notice
          if (notice) onNotice(fromKey, null);
          if (e.evt.altKey || tool === "paint") {
            // painting (the Paint tool, or Alt): claimed, whatever is under the pointer
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
          } else {
            // not claimed: a press that drifts drags the whole panel; a still
            // one on a letter is a click on it, on paper it clears the letter
            const panel = panelNode();
            press.current = { unitIndex: h?.unitIndex ?? null, x: e.evt.clientX, y: e.evt.clientY, panelX: panel?.x() ?? 0, panelY: panel?.y() ?? 0 };
            if (h) lastLetterPress.current = performance.now();
          }
        }}
        onTouchStart={(e) => {
          if (notice) onNotice(fromKey, null);
          const p = pointer();
          const c = p?.cell ?? null;
          if (tool === "paint") {
            // the Paint tool paints under a finger as under the mouse
            e.cancelBubble = true;
            if (c) beginPaint(c, e.target.getStage());
            return;
          }
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
          if (p.unitIndex === null) onSelectLetter?.(null);
          else clickLetter(p.unitIndex);
        }}
        onTap={() => {
          if (tool === "paint") return;
          const h = hoverAt(pointer());
          if (h && !h.on) clickLetter(h.unitIndex);
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
      {movedOutlines.map((points, i) => (
        <Line
          key={`moved-${i}`}
          name="kufi-moved-outline"
          points={points}
          closed
          stroke={MOVED_COLOR}
          strokeWidth={OUTLINE_PX}
          strokeScaleEnabled={false}
          listening={false}
        />
      ))}
      {fitMarks.map((m, i) => (
        <Rect
          key={`fit-${i}`}
          name="kufi-fit-mark"
          x={m.col * cell}
          y={m.row * cell}
          width={cell}
          height={cell}
          stroke={accent}
          strokeWidth={OUTLINE_PX}
          strokeScaleEnabled={false}
          fill={accent}
          opacity={FIT_MARK_OPACITY}
          listening={false}
        />
      ))}
      {handles.map((h, i) => {
        // an end's square sits on the edge the stroke grows across, a slice grip on its
        // cell, a route handle on the word's leading edge (`handleCentre`)
        const side = (h.kind === "route" ? HANDLE : STRETCH_HANDLE) * cell;
        const c = handleCentre(h);
        return (
          <Rect
            key={i}
            name={h.kind === "route" ? "kufi-route-handle" : "kufi-stretch-handle"}
            x={c.x * cell - side / 2}
            y={c.y * cell - side / 2}
            width={side}
            height={side}
            fill={accent}
            opacity={dragging || sameHandle(h, onHandle) ? 1 : IDLE_HANDLE_OPACITY}
            listening={false}
          />
        );
      })}
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
      {noticeShown && noticeBox && (
        <Label ref={noticeRef} name="kufi-notice" listening={false}>
          <Tag fill="rgba(20, 20, 20, 0.88)" cornerRadius={3} />
          <Text text={noticeShown.text} fontSize={NOTICE_FONT_PX} padding={NOTICE_PAD_PX} fill="#ffffff" fontFamily="system-ui, sans-serif" />
        </Label>
      )}
      {targets && (
        <Group name="kufi-edit-targets" listening={false} letters={targets.letters} ends={targets.ends} words={targets.words} grid={targets.grid} cellPx={targets.cell} />
      )}
    </Group>
  );
};
