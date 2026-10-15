// src/components/StackEditorDialog.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Stage, Layer, Group, Rect, Line } from "react-konva";
import type Konva from "konva";
import type { StackBlock } from "../types";
import type { FillerShape } from "../lib/stackArrange";
import type { CurveTrace } from "../lib/stackCurve";
import { stackProps } from "../lib/blockRenderProps";
import { stackScale } from "../lib/stackOutline";
import { complementOf } from "../lib/complementColor";
import { setEditorDraft, setEditorStage } from "../lib/testBridge";
import { useUndoRedo } from "../hooks/useUndoRedo";
import {
  arrangeDraft, bendDraft, draftChanged, draftOf, fitTransform, inkBoundsPx, patchPieces, resetDraft,
  setJoinBend, splitDraft, type StackDraft,
} from "../lib/stackDraft";
import { STACK_TEMPLATES, templatePolygon, type StackTemplate } from "../lib/stackTemplates";
import { StackView } from "./StackView";
import { StackEditOverlay } from "./StackEditOverlay";
import { ConfirmDialog, type ConfirmDialogRequest } from "./ConfirmDialog";
import { CloseIcon } from "./Icons";
import { CheckboxRow, RangeRow } from "./sidebar/FormControls";

export type StackEditorGuide = {
  id: number;
  label: string;
  /** The guide's container polygon in px, in the guide's local frame. */
  polygon: Array<[number, number]>;
  x: number;
  y: number;
  rotation: number;
};

export type StackEditorDialogProps = {
  block: StackBlock;
  /** CSS family of the block's font, for the title; App resolves it from the font catalogue. */
  cssFamily: string;
  /** The canvas surface the composition will sit on (paper or freeform). */
  surfaceColor: string;
  closedGuides: StackEditorGuide[];
  moveTogether: boolean;
  onMoveTogether: (v: boolean) => void;
  fillGaps: boolean;
  onFillGaps: (v: boolean) => void;
  /** The font's tashkeel for the gaps (App owns font loading). */
  loadFillers: (block: StackBlock) => Promise<{ fillers: FillerShape[]; note: string }>;
  /** Called only when the draft differs from the block; App makes one history step. */
  onDone: (patch: StackDraft) => void;
  onCancel: () => void;
};

type Choice = { kind: "free" } | { kind: "template"; template: StackTemplate } | { kind: "guide"; id: number };

const FIT_MARGIN = 0.12;
/** Ticks closer than this are one slider drag. */
const SLIDER_SETTLE_MS = 400;
const inkHeight = (d: StackDraft, upm: number) => { const b = inkBoundsPx(d, upm); return b.y2 - b.y1; };
const TEMPLATE_LABELS: Record<StackTemplate, string> = { teardrop: "Teardrop", almond: "Almond" };

/** Card glyphs: schematic, not the formula (the formula is what the arrange uses). */
const TEMPLATE_ICON: Record<StackTemplate, string> = {
  teardrop: "M14 2 C 22 14, 26 22, 26 28 C 26 35, 20 39, 14 39 C 8 39, 2 35, 2 28 C 2 22, 6 14, 14 2 Z",
  almond: "M14 1 C 24 12, 24 29, 14 40 C 4 29, 4 12, 14 1 Z",
};

const GESTURES: Array<[string, string]> = [
  ["Move", "drag a letter; the letters after it come along."],
  ["Tilt", "drag just outside a letter's edge; hold Shift for even steps."],
  ["Bend", "drag a curve between letters; double-click it to straighten."],
  ["Pull a tail", "press the free end of a straight stroke and pull it out."],
  ["One letter alone", "hold Alt, or untick Move letters together."],
];

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * The stack editor window: a proof of the composition on its own stage with
 * the same renderer and the same gesture overlay the canvas used to mount,
 * plus every stack control. Edits are staged on a draft with an editor-local
 * undo stack; Done hands the draft to App, Cancel drops it.
 *
 * Portaled to `document.body` like every modal here: nothing that is not
 * artwork may live in the main stage.
 */
export const StackEditorDialog: React.FC<StackEditorDialogProps> = ({
  block, cssFamily, surfaceColor, closedGuides, moveTogether, onMoveTogether, fillGaps, onFillGaps, loadFillers, onDone, onCancel,
}) => {
  // Captured once: `draftChanged` compares arrays by reference, so the opening
  // draft must hold the block's own arrays, not a copy made on a later render.
  const [opening] = useState<StackDraft>(() => draftOf(block));
  const [draft, setDraft] = useState<StackDraft>(opening);
  // Handlers read the latest draft at event time (split/bend return values
  // the overlay uses in the same gesture); synced after every render.
  const draftRef = useRef(draft);
  useLayoutEffect(() => { draftRef.current = draft; }, [draft]);

  const [choice, setChoice] = useState<Choice>({ kind: "free" });
  const [sizeFactor, setSizeFactor] = useState(1);
  const [outline, setOutline] = useState<Array<[number, number]> | null>(null);
  const [status, setStatus] = useState("");
  const [confirm, setConfirm] = useState<ConfirmDialogRequest | null>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const proofRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const arrangeToken = useRef(0);
  // Templates are sized from the composition as opened (or as last Reset),
  // never from the last arrange: sizing from the current ink would feed each
  // arrange into the next, so re-clicking a card shrank the letters by a
  // third every time and 100% on the slider was never where you started.
  const baseInkHeight = useRef(0);
  // A slider fires a change per tick; one undo step per drag, not per tick.
  const lastSliderPushAt = useRef(0);
  const sizeTimer = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Editor-local undo: the draft is the snapshot; there is no thumbnail.
  const getSnapshot = useCallback(() => draftRef.current, []);
  const noThumb = useCallback(() => "", []);
  // No coalescing: the canvas hook merges pushes within 300 ms for keystrokes
  // and slider ticks, but here every push is one deliberate gesture (a press
  // that frees a curve, then a double-click that rests it), and two of those
  // in quick succession must stay two steps.
  const applySnapshot = useCallback((s: StackDraft) => setDraft(s), []);
  const { pushHistory, handleUndo, handleRedo, canUndo, canRedo } = useUndoRedo(getSnapshot, applySnapshot, noThumb, { coalesceMs: 0 });

  // The proof's size, kept current as the window resizes.
  useLayoutEffect(() => {
    const el = proofRef.current;
    if (!el) return;
    const measure = () => setFrame({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The fitted extent is the ink plus the template outline (when one is
  // shown), so a shape taller than the letters is not clipped by the frame.
  const fitTo = useCallback((d: StackDraft, shape: Array<[number, number]> | null) => {
    if (frame.width === 0 || frame.height === 0) return;
    const b = { ...inkBoundsPx(d, block.unitsPerEm) };
    for (const [x, y] of shape ?? []) {
      b.x1 = Math.min(b.x1, x); b.y1 = Math.min(b.y1, y); b.x2 = Math.max(b.x2, x); b.y2 = Math.max(b.y2, y);
    }
    setView(fitTransform(b, d.rotation, frame, FIT_MARGIN));
  }, [frame, block.unitsPerEm]);
  const outlineRef = useRef(outline);
  useLayoutEffect(() => { outlineRef.current = outline; }, [outline]);
  const fitView = useCallback(() => fitTo(draftRef.current, outlineRef.current), [fitTo]);
  // Fit on open and whenever the frame changes size.
  useEffect(() => { fitView(); }, [fitView]);

  // The e2e bridge's view of this stage, while mounted.
  useEffect(() => {
    setEditorStage(stageRef.current);
    setEditorDraft(draft);
    return () => { setEditorStage(null); setEditorDraft(null); };
  });

  const requestCancel = useCallback(() => {
    if (!draftChanged(opening, draftRef.current)) { onCancel(); return; }
    setConfirm({
      title: "Discard changes?",
      message: "Discard the changes to this composition? The canvas keeps the version you opened.",
      confirmLabel: "Discard",
      onConfirm: () => { setConfirm(null); onCancel(); },
    });
  }, [opening, onCancel]);

  const done = useCallback(() => {
    if (draftChanged(opening, draftRef.current)) onDone(draftRef.current);
    else onCancel();
  }, [opening, onDone, onCancel]);

  // Keys: Escape cancels (the confirm's own Escape handler closes only the
  // confirm, since it mounts after this one and both listen on window — so
  // ignore Escape here while the confirm is up); Ctrl/Cmd+Z and Shift+Z / Y
  // drive the editor's stack. App's global handler is suppressed while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (!confirm) requestCancel(); return; }
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (e.key === "z" || e.key === "Z") { e.preventDefault(); if (e.shiftKey) handleRedo(); else handleUndo(); }
      else if (e.key === "y") { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, requestCancel, handleUndo, handleRedo]);

  // ---- overlay callbacks, rewired to the draft ----
  const onSetPieces = useCallback((patches: Parameters<typeof patchPieces>[1]) => {
    setDraft((d) => patchPieces(d, patches));
  }, []);
  const onSetBow = useCallback((joinId: string, bend: { bow: number; depth: number }) => {
    setDraft((d) => setJoinBend(d, joinId, bend));
  }, []);
  const onSplit = useCallback((pieceId: string, cut: { cutX: number; angle: number }) => {
    const r = splitDraft(draftRef.current, pieceId, cut);
    if (!r) return null;
    pushHistory();                 // the cut and the pull that follows are one step
    draftRef.current = r.draft;    // the overlay reads the cap from the return value; keep the ref current for the next frame
    setDraft(r.draft);
    return r.cap;
  }, [pushHistory]);
  const onBend = useCallback((pieceId: string, trace: CurveTrace) => {
    const r = bendDraft(draftRef.current, pieceId, trace);
    if (!r) { setStatus("That curve could not be freed cleanly."); return null; }
    pushHistory();
    draftRef.current = r.draft;
    setDraft(r.draft);
    setStatus("Curve freed; drag to bend, double-click to restore.");
    return r.joinId;
  }, [pushHistory]);

  // ---- arranging ----
  const arrange = useCallback(async (c: Choice, factor: number, fill: boolean) => {
    // Free, Reset and unmount also bump the token, so a font load that is
    // still running cannot land its arrange after the user moved on.
    if (c.kind === "free") { ++arrangeToken.current; setOutline(null); return; }
    const token = ++arrangeToken.current;
    let fillers: FillerShape[] = [], note = "";
    if (fill) ({ fillers, note } = await loadFillers(block));
    if (token !== arrangeToken.current) return;   // a later pick wins
    const d = draftRef.current;
    let shapePx: Array<[number, number]>;
    let placement: { x: number; y: number; rotation: number } | undefined;
    if (c.kind === "template") {
      shapePx = templatePolygon(c.template, baseInkHeight.current, factor);
    } else {
      const g = closedGuides.find((x) => x.id === c.id);
      if (!g) { setStatus("That guide is gone; nothing was arranged."); return; }
      shapePx = g.polygon;
      placement = { x: g.x, y: g.y, rotation: g.rotation };
    }
    let r: ReturnType<typeof arrangeDraft>;
    try {
      r = arrangeDraft(d, block.unitsPerEm, shapePx, fillers, placement);
    } catch (err) {
      setStatus(`Could not arrange the letters: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!r) { setStatus("Could not fit the letters inside that shape."); return; }
    pushHistory();
    draftRef.current = r.draft;
    setDraft(r.draft);
    setOutline(shapePx);
    const letters = r.result.pieces.filter((p) => p.role === "letter" && p.parentId === undefined).length;
    setStatus(
      `Arranged ${plural(letters, "letter")} in ${plural(r.result.rows, "row")}` +
      (r.result.fillers > 0 ? `, ${plural(r.result.fillers, "ornament")} added` : "") +
      (r.result.stems > 0 ? `, ${plural(r.result.stems, "stem")} lengthened` : "") + note + "."
    );
    // The size changed; refit on the next frame so the new draft is measured.
    requestAnimationFrame(() => fitTo(r!.draft, shapePx));
  }, [block, closedGuides, loadFillers, pushHistory, fitTo]);

  const pick = (c: Choice) => { setChoice(c); void arrange(c, sizeFactor, fillGaps); };
  /** The size slider arranges once the ticks settle, so a drag is one arrange and one undo step. */
  const changeSize = (v: number) => {
    setSizeFactor(v);
    if (choice.kind !== "template") return;
    if (sizeTimer.current !== null) window.clearTimeout(sizeTimer.current);
    sizeTimer.current = window.setTimeout(() => { sizeTimer.current = null; void arrange(choice, v, fillGaps); }, SLIDER_SETTLE_MS);
  };
  const changeFillGaps = (v: boolean) => { onFillGaps(v); if (choice.kind !== "free") void arrange(choice, sizeFactor, v); };
  const reset = () => {
    ++arrangeToken.current;
    pushHistory();
    const r = resetDraft(draftRef.current);
    draftRef.current = r;
    setDraft(r);
    baseInkHeight.current = inkHeight(r, block.unitsPerEm);
    setChoice({ kind: "free" });
    setOutline(null);
    setStatus("Layout reset.");
    requestAnimationFrame(fitView);
  };
  /** Join thickness: push once per run of ticks (the generic hook's 300 ms
   *  coalescing is off here because gestures must never merge). */
  const setMinFraction = (v: number) => {
    const now = Date.now();
    if (now - lastSliderPushAt.current > SLIDER_SETTLE_MS) pushHistory();
    lastSliderPushAt.current = now;
    setDraft((d) => ({ ...d, nib: { ...d.nib, minFraction: v } }));
  };
  // Baseline on open; cancel a pending size arrange and any in-flight load on close.
  useEffect(() => {
    baseInkHeight.current = inkHeight(opening, block.unitsPerEm);
    closeRef.current?.focus();
    return () => {
      ++arrangeToken.current;
      if (sizeTimer.current !== null) window.clearTimeout(sizeTimer.current);
    };
  }, [opening, block.unitsPerEm]);

  const accent = useMemo(() => complementOf(block.color), [block.color]);
  const scale = stackScale(draft.fontSize, block.unitsPerEm);
  const renderBlock = useMemo<StackBlock>(
    () => ({ ...block, pieces: draft.pieces, joins: draft.joins, fontSize: draft.fontSize, nib: draft.nib }),
    [block, draft]
  );
  const isActive = (c: Choice) =>
    c.kind === choice.kind && (c.kind === "free" || (c.kind === "template" && choice.kind === "template" && c.template === choice.template) ||
      (c.kind === "guide" && choice.kind === "guide" && c.id === choice.id));

  return createPortal(
    <div className="confirmDialogOverlay" role="presentation" data-testid="stack-editor">
      <div className="stackEditorDialog" role="dialog" aria-modal="true" aria-labelledby="stackEditorTitle">
        <div className="nameDesignHeader">
          <div>
            <div id="stackEditorTitle" className="stackEditorTitle">
              Edit composition · <bdi dir="rtl" style={{ fontFamily: cssFamily }}>{block.source.text}</bdi>
            </div>
            <div className="nameDesignSubtitle">What you see here is what the canvas will show when you press Done.</div>
          </div>
          <button ref={closeRef} type="button" className="sidebarCircleButton" onClick={requestCancel} aria-label="Close composition editor">
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="stackEditorBody">
          <div className="stackEditorProof" ref={proofRef}>
            {frame.width > 0 && (
              <Stage ref={stageRef} width={frame.width} height={frame.height}>
                <Layer>
                  <Rect x={0} y={0} width={frame.width} height={frame.height} fill={surfaceColor} listening={false} />
                  <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale} rotation={draft.rotation}>
                    <StackView
                      {...stackProps(renderBlock)}
                      id="stack-editor-block"
                      rotation={0}
                      x={0}
                      y={0}
                      opacity={block.opacity ?? 1}
                      isSelected
                      editing={
                        <StackEditOverlay
                          isSelected
                          pieces={draft.pieces}
                          joins={draft.joins}
                          nib={draft.nib}
                          scale={scale}
                          color={block.color}
                          moveTogether={moveTogether}
                          unitsPerEm={block.unitsPerEm}
                          onBegin={pushHistory}
                          onSetPieces={onSetPieces}
                          onSetBow={onSetBow}
                          onSplit={onSplit}
                          onBend={onBend}
                        />
                      }
                    />
                    {outline && (
                      <Line
                        name="stack-template-outline"
                        points={outline.flat()}
                        closed
                        stroke={accent}
                        strokeWidth={1}
                        strokeScaleEnabled={false}
                        dash={[6, 4]}
                        listening={false}
                      />
                    )}
                  </Group>
                </Layer>
              </Stage>
            )}
          </div>

          <div className="stackEditorSide">
            <h4>Gestures</h4>
            <ul className="stackEditorGestures">
              {GESTURES.map(([k, v]) => (<li key={k}><strong>{k}</strong> — {v}</li>))}
            </ul>

            <h4>Templates</h4>
            <div className="stackEditorTemplates" role="group" aria-label="Templates">
              <button type="button" className={`stackEditorTemplate${isActive({ kind: "free" }) ? " stackEditorTemplate--active" : ""}`}
                aria-pressed={isActive({ kind: "free" })} onClick={() => pick({ kind: "free" })}>
                <svg viewBox="0 0 28 42" aria-hidden="true"><rect x="3" y="3" width="22" height="36" rx="4" fill="none" stroke="currentColor" strokeDasharray="3 3" /></svg>
                Free
              </button>
              {STACK_TEMPLATES.map((t) => (
                <button key={t} type="button"
                  className={`stackEditorTemplate${isActive({ kind: "template", template: t }) ? " stackEditorTemplate--active" : ""}`}
                  aria-pressed={isActive({ kind: "template", template: t })} onClick={() => pick({ kind: "template", template: t })}>
                  <svg viewBox="0 0 28 42" aria-hidden="true"><path d={TEMPLATE_ICON[t]} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
                  {TEMPLATE_LABELS[t]}
                </button>
              ))}
              {closedGuides.map((g) => (
                <button key={g.id} type="button"
                  className={`stackEditorTemplate${isActive({ kind: "guide", id: g.id }) ? " stackEditorTemplate--active" : ""}`}
                  aria-pressed={isActive({ kind: "guide", id: g.id })} onClick={() => pick({ kind: "guide", id: g.id })}>
                  <svg viewBox="0 0 28 42" aria-hidden="true"><ellipse cx="14" cy="21" rx="11" ry="18" fill="none" stroke="currentColor" strokeDasharray="3 3" /></svg>
                  {g.label}
                </button>
              ))}
            </div>
            <RangeRow
              id="stack-editor-size"
              name="stackTemplateSize"
              label="Template size"
              value={sizeFactor}
              min={0.5}
              max={2}
              step={0.05}
              suffix={`${Math.round(sizeFactor * 100)}%`}
              disabled={choice.kind !== "template"}
              onChange={changeSize}
            />
            <CheckboxRow id="stack-editor-fill-gaps" label="Fill gaps with tashkeel" checked={fillGaps} onChange={changeFillGaps} />

            <h4>Strokes</h4>
            <RangeRow
              id="stack-editor-minFraction"
              name="stackMinFraction"
              label="Join thickness"
              value={draft.nib.minFraction}
              min={0.05}
              max={1}
              step={0.01}
              suffix={draft.nib.minFraction.toFixed(2)}
              onChange={setMinFraction}
            />
            <CheckboxRow id="stack-editor-together" label="Move letters together" checked={moveTogether} onChange={onMoveTogether} />
            <button type="button" className="sidebarSmallAction" aria-label="Reset layout" onClick={reset}>Reset layout</button>
            <button type="button" className="sidebarSmallAction" aria-label="Fit view" onClick={fitView}>Fit view</button>
          </div>
        </div>

        <div className="stackEditorFooter">
          <button type="button" className="sidebarSmallAction" aria-label="Undo" disabled={!canUndo} onClick={handleUndo}>Undo</button>
          <button type="button" className="sidebarSmallAction" aria-label="Redo" disabled={!canRedo} onClick={handleRedo}>Redo</button>
          <div className="stackEditorStatus" role="status">{status}</div>
          <button type="button" className="sidebarSmallAction" aria-label="Cancel" onClick={requestCancel}>Cancel</button>
          <button type="button" className="sidebarSmallAction" aria-label="Done" onClick={done}>Done</button>
        </div>
      </div>
      <ConfirmDialog request={confirm} onCancel={() => setConfirm(null)} />
    </div>,
    document.body
  );
};
