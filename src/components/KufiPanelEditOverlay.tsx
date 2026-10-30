import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Group, Line, Rect } from "react-konva";
import { EXPORT_HIDDEN } from "../lib/exportChrome";
import { complementOf } from "../lib/complementColor";
import type { KufiPackResult, KufiPanelEdits } from "../lib/kufi/kufiPack";
import {
  hitKufiUnit,
  hitStretchEnd,
  kufiFormsOf,
  kufiGlyphById,
  nearestStretchEnd,
  placementInk,
  placementOf,
  stretchEnds,
  unitRings,
  type KufiStretchEnd,
} from "../lib/kufi/kufiHit";
import { kufiFormCycle, kufiFormEdits, kufiPinEdits, kufiStretchEdits } from "../lib/kufi/kufiPanelBlock";
import { kufiLayoutKey, previewKufiLayout, type KufiLayoutInputs } from "../lib/kufi/kufiLayoutClient";
import { PULL_REST_MS, pullAnswer, pullMove, pullRelease, pullRest, pullStart, type KufiPull } from "../lib/kufi/kufiPull";
import { resolveKufiText } from "../lib/kufi/kufiWords";

type Ok = Extract<KufiPackResult, { ok: true }>;

type Props = {
  /** The panel as drawn now: the committed layout, or the live preview while a stretch is dragged. */
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
/** The furthest a stroke may be pulled past its current length in one drag, in cells. */
const MAX_PULL = 12;
const OUTLINE_PX = 1.5;
/** The stretch handle's side, as a fraction of a cell. */
const HANDLE = 0.7;

export const NO_ROOM_TO_STRETCH = "No room to stretch that here";
export const NO_OTHER_FORM_FITS = "No other form of that letter fits here";
export const SINGLE_FORM = "That letter has one form";

/** What is under the pointer: the letter, the handle it is on (if any), and the handle nearest to it. */
type Hover = { unitIndex: number; on: KufiStretchEnd | null; nearest: KufiStretchEnd | null };

const sameHover = (a: Hover | null, b: Hover | null) =>
  a === b || (!!a && !!b && a.unitIndex === b.unitIndex && a.on === b.on && a.nearest === b.nearest);

type Drag = {
  end: KufiStretchEnd;
  /** The unit's counts when the drag began. */
  base: number[];
  /** The pointer's cell at the press. */
  startCol: number;
  startRow: number;
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
 * **Pointer-resolved**, like Next Shape: one listening `Rect` spans the
 * panel and the cell under the pointer is resolved in arithmetic
 * (`kufiHit.ts`); the outline, the handle and the e2e marker are
 * `listening={false}`, so there is no node Konva can retarget hover to and
 * no leave race. A press on a letter is not claimed (the panel still drags
 * from its ink); a press on a handle is, and its drag is a stage listener
 * rather than a node drag, as a Stack tail pull is.
 *
 * **Previews run in the worker.** Each cell the pointer crosses asks
 * `previewKufiLayout` for a repack from the committed panel; the newest
 * request always wins and the panel keeps showing the last preview that
 * packed (`kufiPull.ts` holds the policy: a refused count is asked for once
 * more when the pointer rests, since the repack budget is a clock). Release
 * commits that preview, pinned where the packer put the letter, as one undo
 * step; if nothing the pointer reached packs, nothing is committed and the
 * stroke snaps back.
 */
export const KufiPanelEditOverlay: React.FC<Props> = ({ result, committed, inputs, cell, color, onPreview, onCommit, onNotice }) => {
  const [hover, setHover] = useState<Hover | null>(null);
  const [dragging, setDragging] = useState<Drag | null>(null);
  const groupRef = useRef<Konva.Group>(null);
  const drag = useRef<Drag | null>(null);
  /** A press on a letter: where, and where the panel was, so a press that moved it is not a click. */
  const press = useRef<{ unitIndex: number; x: number; y: number; panelX: number; panelY: number } | null>(null);
  const lastLetterPress = useRef(-Infinity);
  const cycling = useRef(false);
  const accent = useMemo(() => complementOf(color), [color]);
  const fromKey = kufiLayoutKey(inputs);

  const width = result.cols * cell;
  const height = result.rows * cell;

  // The cursor says what a press here does; cleared with the hover.
  const cursor = hover ? (hover.on ? (hover.on.dc !== 0 ? "ew-resize" : "ns-resize") : "pointer") : null;
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

  // A drag outliving the overlay (the panel deselected mid-gesture) commits nothing.
  useEffect(
    () => () => {
      drag.current?.release(true);
    },
    []
  );

  const panelNode = () => groupRef.current?.getParent() ?? null;
  const pointerCell = () => {
    const pos = groupRef.current?.getRelativePointerPosition();
    return pos ? { col: Math.floor(pos.x / cell), row: Math.floor(pos.y / cell) } : null;
  };
  const hoverAt = (c: { col: number; row: number } | null): Hover | null => {
    if (!c) return null;
    const on = hitStretchEnd(result, c.col, c.row);
    const unitIndex = on ? on.unitIndex : hitKufiUnit(result, c.col, c.row);
    if (unitIndex === null) return null;
    return { unitIndex, on, nearest: on ?? nearestStretchEnd(stretchEnds(result, unitIndex), c.col, c.row) };
  };
  const updateHover = () => {
    const next = hoverAt(pointerCell());
    setHover((cur) => (sameHover(cur, next) ? cur : next));
  };

  /** Click: the next alternate of this letter that packs, tried in table order; one undo step. */
  const cycleForm = useCallback(
    async (unitIndex: number) => {
      if (cycling.current || drag.current) return;
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

  const beginStretch = (end: KufiStretchEnd, start: { col: number; row: number }, stage: Konva.Stage | null) => {
    if (!stage || drag.current || cycling.current) return;
    const p = placementOf(committed, end.unitIndex);
    const g = p ? kufiGlyphById(p.glyphId) : null;
    if (!p || !g) return;
    const base = g.stretch.map((_, i) => p.stretch[i] ?? 0);
    const at = base[end.stretchIndex];
    const pressed = stage.getPointerPosition() ?? { x: 0, y: 0 };
    const state: Drag = {
      end,
      base,
      startCol: start.col,
      startRow: start.row,
      pressX: pressed.x,
      pressY: pressed.y,
      moved: false,
      pull: pullStart(at, -(g.stretch[end.stretchIndex].min ?? 0), at + MAX_PULL),
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
      const counts = base.slice();
      counts[end.stretchIndex] = count;
      const edits = kufiStretchEdits(inputs.edits, end.unitIndex, counts);
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
      const delta = (c.col - state.startCol) * end.dc + (c.row - state.startRow) * end.dr;
      const m = pullMove(state.pull, delta);
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
      stage.off(".kufistretch");
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
      drag.current = null;
      // Whatever ends the drag, the panel goes back to drawing its own
      // layout: an uncommitted preview must never stay on a deselected
      // panel (it would draw, and export, a layout that was never saved).
      onPreview(null);
      if (abort) return;
      setDragging(null);
      const r = pullRelease(state.pull);
      if (r.kind === "commit" && state.shown?.count === r.count)
        onCommit(fromKey, kufiPinEdits(state.shown.edits, state.shown.result, end.unitIndex), state.shown.result);
      else if (r.kind === "refused") onNotice(fromKey, NO_ROOM_TO_STRETCH);
      // A press and release that never moved is a click on the letter, as it
      // is anywhere else on the letter: a handle is not a dead spot.
      else if (r.kind === "cancel" && !state.moved) void cycleForm(end.unitIndex);
    };
    const onUp = () => release();
    state.release = release;
    drag.current = state;
    setDragging(state);
    setHover(null);
    stage.on("mousemove.kufistretch touchmove.kufistretch", move);
    stage.on("mouseup.kufistretch touchend.kufistretch", onUp);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
  };

  // What the chrome draws: while dragging, the pulled letter's outline and
  // its handle on the previewed panel; otherwise the hovered letter's and
  // the handle nearest the pointer.
  const shownUnit = dragging ? dragging.end.unitIndex : hover?.unitIndex ?? null;
  const outlines = useMemo(
    () => (shownUnit === null ? [] : unitRings(result, shownUnit).map((ring) => ring.flatMap(([x, y]) => [x * cell, y * cell]))),
    [result, shownUnit, cell]
  );
  const handle = useMemo(() => {
    if (shownUnit === null) return null;
    if (!dragging) return hover?.nearest ?? null;
    const d = dragging.end;
    const same = stretchEnds(result, shownUnit).filter((e) => e.kind === d.kind && e.stretchIndex === d.stretchIndex && e.dc === d.dc && e.dr === d.dr);
    return nearestStretchEnd(same, d.col, d.row);
  }, [result, shownUnit, dragging, hover]);

  // Read-only scene data for the e2e harness, in dev builds only (like the
  // `__HARF__` bridge): with one hit node there is no per-letter node a test
  // could find. Group-space px of a cell of each letter (the ink cell nearest
  // its centroid) and of every handle.
  const targets = useMemo(() => {
    if (!import.meta.env.DEV) return null;
    const units = resolveKufiText(inputs.text).units;
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
    return { letters: letters.filter((l) => l !== null), ends };
  }, [result, inputs.text, cell]);

  return (
    <Group ref={groupRef} name={EXPORT_HIDDEN}>
      <Rect
        name="kufi-edit-hit"
        width={width}
        height={height}
        fill="transparent"
        onMouseMove={() => {
          if (!drag.current) updateHover();
        }}
        onMouseLeave={() => {
          if (!drag.current) setHover(null);
        }}
        onMouseDown={(e) => {
          if (e.evt.button !== 0) return;
          const c = pointerCell();
          const h = hoverAt(c);
          press.current = null;
          if (h?.on && c) {
            // the handle's drag is this tool's, never the block's
            e.cancelBubble = true;
            lastLetterPress.current = performance.now();
            beginStretch(h.on, c, e.target.getStage());
          } else if (h) {
            // not claimed: a press that drifts drags the whole panel
            const panel = panelNode();
            press.current = { unitIndex: h.unitIndex, x: e.evt.clientX, y: e.evt.clientY, panelX: panel?.x() ?? 0, panelY: panel?.y() ?? 0 };
            lastLetterPress.current = performance.now();
          }
        }}
        onTouchStart={(e) => {
          const c = pointerCell();
          const h = hoverAt(c);
          if (h?.on && c) {
            e.cancelBubble = true;
            beginStretch(h.on, c, e.target.getStage());
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
          const h = hoverAt(pointerCell());
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
          name="kufi-stretch-handle"
          // an end's square sits on the edge the stroke grows across; a slice grip on its cell
          x={(handle.col + 0.5 + (handle.kind === "end" ? handle.dc * 0.5 : 0)) * cell - (HANDLE * cell) / 2}
          y={(handle.row + 0.5 + (handle.kind === "end" ? handle.dr * 0.5 : 0)) * cell - (HANDLE * cell) / 2}
          width={HANDLE * cell}
          height={HANDLE * cell}
          fill={accent}
          listening={false}
        />
      )}
      {targets && <Group name="kufi-edit-targets" listening={false} letters={targets.letters} ends={targets.ends} />}
    </Group>
  );
};
