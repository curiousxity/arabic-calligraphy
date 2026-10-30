import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Group, Line, Rect } from "react-konva";
import { EXPORT_HIDDEN } from "../lib/exportChrome";
import { complementOf } from "../lib/complementColor";
import type { KufiPackResult, KufiPanelEdits } from "../lib/kufi/kufiPack";
import { hitKufiUnit, hitStretchEnd, kufiFormsOf, kufiGlyphById, placementInk, stretchEnds, unitRings, type KufiStretchEnd } from "../lib/kufi/kufiHit";
import { kufiFormCycle, kufiFormEdits, kufiPinEdits, kufiStretchEdits } from "../lib/kufi/kufiPanelBlock";
import { kufiLayoutKey, previewKufiLayout, type KufiLayoutInputs } from "../lib/kufi/kufiLayoutClient";
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
  onNotice: (text: string) => void;
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

type Hover = { kind: "unit"; unitIndex: number } | { kind: "end"; end: KufiStretchEnd };

type Drag = {
  end: KufiStretchEnd;
  /** The unit's counts when the drag began, and the one being pulled. */
  base: number[];
  min: number;
  /** The pointer's cell at the press. */
  startCol: number;
  startRow: number;
  /** The count last asked for. */
  count: number;
  /** The last preview that packed, with the edits that made it; the press's own panel at first. */
  shown: { count: number; edits: KufiPanelEdits | undefined; result: Ok } | null;
  /** True once some count other than the base was asked for. */
  pulled: boolean;
  ended: boolean;
  release: () => void;
};

/**
 * Editing a Kufi panel on the canvas, with no mode to enter: hover a letter
 * and it outlines in the block's editing colour; click it to cycle its
 * square-Kufi alternates (the ones that pack; a click that finds none says
 * so in the Kufi panel's status line); a small square sits at each end of a
 * stroke the letter may stretch, and dragging one lengthens or shortens that
 * stroke in whole cells while the rest of the panel repacks around it live.
 *
 * **Pointer-resolved**, like Next Shape: one listening `Rect` spans the
 * panel and the cell under the pointer is resolved in arithmetic
 * (`kufiHit.ts`); the outline, handles and the e2e marker are
 * `listening={false}`, so there is no node Konva can retarget hover to and
 * no leave race. A press on a letter is not claimed (the panel still drags
 * from its ink); a press on a handle is, and its drag is a stage listener
 * rather than a node drag, as a Stack tail pull is.
 *
 * **Previews run in the worker.** Each cell the pointer crosses asks
 * `previewKufiLayout` for a repack from the committed panel; the newest
 * request always wins and the panel keeps showing the last preview that
 * packed. Release commits that preview, pinned where the packer put the
 * letter, as one undo step; if nothing the pointer reached packs, nothing is
 * committed and the stroke snaps back.
 */
export const KufiPanelEditOverlay: React.FC<Props> = ({ result, committed, inputs, cell, color, onPreview, onCommit, onNotice }) => {
  const [hover, setHover] = useState<Hover | null>(null);
  const [dragging, setDragging] = useState<Drag | null>(null);
  const groupRef = useRef<Konva.Group>(null);
  const drag = useRef<Drag | null>(null);
  const press = useRef<{ unitIndex: number; x: number; y: number } | null>(null);
  const lastLetterPress = useRef(-Infinity);
  const cycling = useRef(false);
  const accent = useMemo(() => complementOf(color), [color]);
  const fromKey = kufiLayoutKey(inputs);

  const width = result.cols * cell;
  const height = result.rows * cell;

  // The cursor says what a press here does; cleared with the hover.
  useEffect(() => {
    const stage = groupRef.current?.getStage();
    if (!stage || !hover) return;
    const style = stage.container().style;
    const prev = style.cursor;
    style.cursor = hover.kind === "unit" ? "pointer" : hover.end.dc !== 0 ? "ew-resize" : "ns-resize";
    return () => {
      style.cursor = prev;
    };
  }, [hover]);

  // A drag outliving the overlay (the panel deselected mid-gesture) commits nothing.
  useEffect(
    () => () => {
      drag.current?.release();
    },
    []
  );

  const cellAt = (pos: { x: number; y: number }) => ({ col: Math.floor(pos.x / cell), row: Math.floor(pos.y / cell) });
  const pointerCell = () => {
    const pos = groupRef.current?.getRelativePointerPosition();
    return pos ? cellAt(pos) : null;
  };
  const hoverAt = (c: { col: number; row: number } | null): Hover | null => {
    if (!c) return null;
    const end = hitStretchEnd(result, c.col, c.row);
    if (end) return { kind: "end", end };
    const unitIndex = hitKufiUnit(result, c.col, c.row);
    return unitIndex === null ? null : { kind: "unit", unitIndex };
  };

  /** Click: the next alternate of this letter that packs, tried in table order; one undo step. */
  const cycleForm = useCallback(
    async (unitIndex: number) => {
      if (cycling.current) return;
      const p = committed.placements[unitIndex];
      if (!p) return;
      const ids = kufiFormCycle(inputs.text, unitIndex, p.glyphId);
      if (ids.length === 0) {
        onNotice(SINGLE_FORM);
        return;
      }
      cycling.current = true;
      try {
        for (const id of ids) {
          const edits = kufiFormEdits(inputs.edits, unitIndex, id);
          const r = await previewKufiLayout({ ...inputs, edits }, committed);
          if (r?.ok) {
            onCommit(fromKey, kufiPinEdits(edits, r, unitIndex), r);
            return;
          }
        }
        onNotice(NO_OTHER_FORM_FITS);
      } finally {
        cycling.current = false;
      }
    },
    [committed, inputs, fromKey, onCommit, onNotice]
  );

  const beginStretch = (end: KufiStretchEnd, start: { col: number; row: number }, stage: Konva.Stage | null) => {
    if (!stage || drag.current) return;
    const p = committed.placements[end.unitIndex];
    const g = kufiGlyphById(p.glyphId);
    if (!g) return;
    const base = g.stretch.map((_, i) => p.stretch[i] ?? 0);
    const state: Drag = {
      end,
      base,
      min: -(g.stretch[end.stretchIndex].min ?? 0),
      startCol: start.col,
      startRow: start.row,
      count: base[end.stretchIndex],
      shown: null,
      pulled: false,
      ended: false,
      release: () => {},
    };
    const request = (count: number) => {
      state.count = count;
      if (count === base[end.stretchIndex]) {
        state.shown = null;
        onPreview(null);
        return;
      }
      state.pulled = true;
      const counts = base.slice();
      counts[end.stretchIndex] = count;
      const edits = kufiStretchEdits(inputs.edits, end.unitIndex, counts);
      previewKufiLayout({ ...inputs, edits }, committed).then(
        (r) => {
          // superseded, stale (an older count answered after a newer one), or over
          if (!r || state.ended || state.count !== count) return;
          if (r.ok) {
            state.shown = { count, edits, result: r };
            onPreview(r);
          }
        },
        (err: unknown) => console.warn(err)
      );
    };
    const move = () => {
      const c = pointerCell();
      if (!c) return;
      const delta = (c.col - state.startCol) * end.dc + (c.row - state.startRow) * end.dr;
      const count = Math.max(state.min, Math.min(base[end.stretchIndex] + MAX_PULL, base[end.stretchIndex] + delta));
      if (count !== state.count) request(count);
    };
    const release = () => {
      if (state.ended) return;
      state.ended = true;
      stage.off(".kufistretch");
      window.removeEventListener("mouseup", release);
      window.removeEventListener("touchend", release);
      drag.current = null;
      setDragging(null);
      if (state.shown) onCommit(fromKey, kufiPinEdits(state.shown.edits ?? {}, state.shown.result, end.unitIndex), state.shown.result);
      else if (state.pulled) onNotice(NO_ROOM_TO_STRETCH);
      onPreview(null);
    };
    state.release = release;
    drag.current = state;
    setDragging(state);
    setHover(null);
    stage.on("mousemove.kufistretch touchmove.kufistretch", move);
    stage.on("mouseup.kufistretch touchend.kufistretch", release);
    window.addEventListener("mouseup", release);
    window.addEventListener("touchend", release);
  };

  // What the chrome draws: while dragging, the pulled letter's outline and
  // its handle on the previewed panel; otherwise the hovered letter's.
  const shownUnit = dragging ? dragging.end.unitIndex : hover?.kind === "unit" ? hover.unitIndex : hover?.kind === "end" ? hover.end.unitIndex : null;
  const rings = useMemo(() => (shownUnit === null ? [] : unitRings(result, shownUnit)), [result, shownUnit]);
  const handles = useMemo(() => {
    if (shownUnit === null) return [];
    const ends = stretchEnds(result, shownUnit);
    if (!dragging) return ends;
    const d = dragging.end;
    const same = ends.filter((e) => e.stretchIndex === d.stretchIndex && e.dc === d.dc && e.dr === d.dr);
    if (same.length === 0) return [];
    return [same.reduce((best, e) => (Math.hypot(e.col - d.col, e.row - d.row) < Math.hypot(best.col - d.col, best.row - d.row) ? e : best))];
  }, [result, shownUnit, dragging]);

  // Read-only scene data for the e2e harness: with one hit node there is no
  // per-letter node a test could find. Group-space px of a cell of each
  // letter (the ink cell nearest its centroid) and of every stretch end.
  const targets = useMemo(() => {
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
      const at = ink.reduce((best, i) => {
        const d = Math.hypot((i % result.cols) - cx, Math.floor(i / result.cols) - cy);
        return d < best.d ? { i, d } : best;
      }, { i: ink[0], d: Infinity }).i;
      const unit = units[p.unitIndex];
      return {
        unit: p.unitIndex,
        glyphId: p.glyphId,
        forms: unit ? kufiFormsOf(unit).length : 1,
        x: ((at % result.cols) + 0.5) * cell,
        y: (Math.floor(at / result.cols) + 0.5) * cell,
      };
    });
    const ends = result.placements.flatMap((_, k) =>
      stretchEnds(result, k).map((e) => ({ unit: k, si: e.stretchIndex, dc: e.dc, dr: e.dr, x: (e.col + 0.5) * cell, y: (e.row + 0.5) * cell }))
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
          if (drag.current) return;
          setHover(hoverAt(pointerCell()));
        }}
        onMouseLeave={() => {
          if (!drag.current) setHover(null);
        }}
        onMouseDown={(e) => {
          if (e.evt.button !== 0) return;
          const c = pointerCell();
          const h = hoverAt(c);
          press.current = null;
          if (h?.kind === "end" && c) {
            // the handle's drag is this tool's, never the block's
            e.cancelBubble = true;
            beginStretch(h.end, c, e.target.getStage());
          } else if (h?.kind === "unit") {
            // not claimed: a press that drifts drags the whole panel
            press.current = { unitIndex: h.unitIndex, x: e.evt.clientX, y: e.evt.clientY };
            lastLetterPress.current = performance.now();
          }
        }}
        onTouchStart={(e) => {
          const c = pointerCell();
          const h = hoverAt(c);
          if (h?.kind === "end" && c) {
            e.cancelBubble = true;
            beginStretch(h.end, c, e.target.getStage());
          } else if (h?.kind === "unit") lastLetterPress.current = performance.now();
        }}
        // A click is read on release within a small slop, for the pressed
        // letter: Konva's `click` does not fire once the pointer has moved.
        onMouseUp={(e) => {
          const p = press.current;
          press.current = null;
          if (!p || Math.hypot(e.evt.clientX - p.x, e.evt.clientY - p.y) > CLICK_SLOP) return;
          void cycleForm(p.unitIndex);
        }}
        onTap={() => {
          const h = hoverAt(pointerCell());
          if (h?.kind === "unit") void cycleForm(h.unitIndex);
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
      {rings.map((ring, i) => (
        <Line
          key={i}
          name="kufi-hover-outline"
          points={ring.flatMap(([x, y]) => [x * cell, y * cell])}
          closed
          stroke={accent}
          strokeWidth={OUTLINE_PX}
          strokeScaleEnabled={false}
          listening={false}
        />
      ))}
      {handles.map((e) => (
        <Rect
          key={`${e.stretchIndex}:${e.col},${e.row}`}
          name="kufi-stretch-handle"
          // centred on the edge the stroke would grow across
          x={(e.col + 0.5 + e.dc * 0.5) * cell - (HANDLE * cell) / 2}
          y={(e.row + 0.5 + e.dr * 0.5) * cell - (HANDLE * cell) / 2}
          width={HANDLE * cell}
          height={HANDLE * cell}
          fill={accent}
          listening={false}
        />
      ))}
      <Group name="kufi-edit-targets" listening={false} letters={targets.letters} ends={targets.ends} />
    </Group>
  );
};
