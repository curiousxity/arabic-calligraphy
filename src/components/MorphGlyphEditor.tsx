import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Block, GlyphRig, GlyphStretchHandle } from "../types";
import type { StretchDefinition } from "../lib/strokeSchema/deriveCatalog";
import { CheckboxRow, RangeRow } from "./sidebar/FormControls";
import { makeId } from "./sidebar/utils";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, HelpIcon } from "./Icons";

const MorphHelpDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="confirmDialogOverlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="confirmDialog morphHelpDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="morphHelpTitle"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <div id="morphHelpTitle" className="confirmDialogTitle" style={{ marginBottom: 0 }}>
            Morph Glyph Editor
          </div>
          <button
            type="button"
            onClick={onClose}
            className="layerIconBtn"
            aria-label="Close help"
            title="Close"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="morphHelpBody">
          <p>
            Distort individual letterforms within a text, Shape Fill, or Shape
            Warp block. Not available for image blocks.
          </p>

          <p>
            On a plain text block, hover a letter on the canvas to reveal its
            stroke handles directly — drag one along its stretch axis instead
            of using a slider. Shape Fill and Shape Warp blocks still use the
            sliders below.
          </p>

          <h4>Stroke controls</h4>
          <p>
            Every letter in the block with an authored stroke schema gets a
            group of controls — one per anatomical stroke (its body, an
            eye/loop, a tooth, etc.), bounded to that stroke's authored safe
            range, with 1.00 always meaning the letter's natural, undistorted
            shape. On a plain text block each stroke is a canvas hover handle
            plus a numeric field here (type a value and press Enter); on Shape
            Fill and Shape Warp blocks it's a slider — either way, nothing
            needs to be clicked or added first. Letters whose schema isn't
            authored yet simply don't appear.
          </p>
          <ol>
            <li>
              A stroke's position on the letter and which part of the glyph it
              affects are derived automatically from the schema and the real
              glyph outline the first time its value changes.
            </li>
            <li>
              The <strong>×</strong> next to an active stroke resets it to its
              natural shape.
            </li>
            <li>
              <strong>Options…</strong> under an active stroke reveals{" "}
              <strong>Band width</strong> (how wide a swath around the stroke
              is affected) and <strong>Masking</strong>, which can override
              the automatic scoping if it picked up the wrong part of the
              glyph: By stroke (click outline contours to include/exclude
              them, then Done), or Lasso (drag a freeform loop around the
              region). Starting a mask edit selects that letter on the canvas
              automatically.
            </li>
          </ol>
          <p>
            On Shape Fill and Shape Warp blocks the <strong>Stretch</strong>{" "}
            canvas tool is optional — turn it on to see a stroke's handle
            points on the canvas by clicking a letter. The sliders work with
            it off.
          </p>
          <p>
            When a block has one or more kashida-eligible schema-backed
            handles, a block-level <strong>Kashida</strong> slider appears —
            it distributes a single 0–100 dial across all of them, weighted by
            each stroke's authored priority.
          </p>

          <h4>Saving a stretch as a reusable "Rig"</h4>
          <p>
            Name a stretch handle and click <strong>Save as Rig…</strong>. It
            becomes a −1 to 1 slider under Rigged Parameters that applies to
            every occurrence of that same letterform (same font + glyph) in
            the block — not just the one you edited. Delete an axis with the
            × next to its slider.
          </p>

          <p style={{ marginBottom: 0 }}>
            All edits are undoable with the normal undo/redo. Turn the tool
            back to Off to see a clean view of the result.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
};

/**
 * Typed-precision factor field for a text block's stroke (text blocks have
 * no slider — their canvas hover handles replace it, so this is the only
 * way to type an exact value).
 *
 * The commit is deliberately deferred to blur/Enter rather than fired on
 * every keystroke: the committing callback (`App.tsx`'s `setStretchFactor`)
 * *creates* the stretch handle on its first call, so an on-change commit
 * turned the first character of "0.9" into a clamped `0.85` handle (visible
 * letter distortion plus a history push) and then rewrote the field from
 * the controlled value, making the rest of the number impossible to type.
 * While `draft` is non-null the field shows exactly what was typed.
 */
const StrokeFactorInput: React.FC<{
  value: number;
  min: number;
  max: number;
  label: string;
  onCommit: (factor: number) => void;
}> = ({ value, min, max, label, onCommit }) => {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft == null) return;
    const parsed = parseFloat(draft);
    setDraft(null);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.max(min, Math.min(max, parsed));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      type="number"
      value={draft ?? value.toFixed(2)}
      min={min}
      max={max}
      step={0.01}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setDraft(null);
        }
      }}
      className="hexInput"
      style={{ width: 64 }}
      aria-label={label}
    />
  );
};

type GlyphBox = {
  glyphIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  glyphId?: number;
  gx?: number;
  gy?: number;
};

export type MorphGlyphEditorProps = {
  selectedBlock?: Block;
  selectedGlyphBoxes?: GlyphBox[];
  /** Stroke-schema stretch definitions for every glyph in the selected block, keyed by shaped glyph index (a glyph is simply absent if its letter/form has no authored schema entry). */
  glyphCatalog?: Record<number, StretchDefinition[]>;
  glyphRigs?: GlyphRig[];
  onSetGlyphEditTool?: (tool: "stretch" | null) => void;
  /** Sets a stroke slider's value — creates the schema-backed handle on first movement, updates its factor afterwards. */
  onSetStretchFactor?: (
    blockId: number,
    glyphIndex: number,
    definition: StretchDefinition,
    factor: number
  ) => void;
  onUpdateStretchHandle?: (
    blockId: number,
    glyphIndex: number,
    handleId: string,
    patch: Partial<GlyphStretchHandle>
  ) => void;
  onDeleteStretchHandle?: (blockId: number, glyphIndex: number, handleId: string) => void;
  onSetGlyphMaskEditMode?: (
    blockId: number,
    glyphIndex: number,
    handleId: string,
    mode: "contours" | "lasso" | null
  ) => void;
  onSaveStretchHandleAsRig?: (
    blockId: number,
    glyphIndex: number,
    handleId: string,
    name: string
  ) => void;
  onSetGlyphRigValue?: (blockId: number, axisId: string, value: number) => void;
  onDeleteGlyphRigAxis?: (fontFamily: string, glyphId: number, axisId: string) => void;
  onSetBlockKashidaAmount?: (blockId: number, amount: number) => void;
  onToggleGlyphTransformMode?: (blockId: number) => void;
  onResetGlyphTransforms?: (blockId: number) => void;
  isMobile: boolean;
  width: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

/**
 * The per-glyph deformation feature (Stretch handle authoring + the
 * named-axis "Rigged Parameters" sliders) lives here instead of buried in
 * the left Sidebar's Styling accordion — on desktop as a real third flex
 * column mirroring the left Sidebar's conventions, on mobile as a floating
 * overlay (same createPortal-to-document.body pattern as
 * sidebar/FloatingKeyboard.tsx) since there's no room for a third stacked
 * panel under the 45vh mobile budget.
 */
export const MorphGlyphEditor: React.FC<MorphGlyphEditorProps> = ({
  selectedBlock,
  selectedGlyphBoxes,
  glyphCatalog,
  glyphRigs,
  onSetGlyphEditTool,
  onSetStretchFactor,
  onUpdateStretchHandle,
  onDeleteStretchHandle,
  onSetGlyphMaskEditMode,
  onSaveStretchHandleAsRig,
  onSetGlyphRigValue,
  onDeleteGlyphRigAxis,
  onSetBlockKashidaAmount,
  onToggleGlyphTransformMode,
  onResetGlyphTransforms,
  isMobile,
  width,
  isCollapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}) => {
  const [rigNameDrafts, setRigNameDrafts] = useState<Record<string, string>>({});
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [showHelp, setShowHelp] = useState(false);
  const selectedId = selectedBlock?.id ?? "none";

  const eligible = !!selectedBlock && selectedBlock.type !== "image";

  // One group per glyph occurrence that has any authored schema, in typed
  // (logical) order via each catalog entry's source cluster — the shaped
  // glyph array itself runs in visual order, which for RTL text is reversed.
  const glyphGroups = (() => {
    const entries = Object.entries(glyphCatalog ?? {})
      .map(([key, defs]) => ({ glyphIndex: Number(key), defs }))
      .filter((e) => e.defs.length > 0);
    entries.sort(
      (a, b) => (a.defs[0].cluster ?? a.glyphIndex) - (b.defs[0].cluster ?? b.glyphIndex)
    );
    return entries;
  })();

  const riggedRows = (() => {
    if (!selectedBlock) return [];
    const glyphIds = new Set(
      (selectedGlyphBoxes ?? [])
        .map((b) => b.glyphId)
        .filter((id): id is number => id != null)
    );
    return (glyphRigs ?? [])
      .filter((r) => r.fontFamily === selectedBlock.fontFamily && glyphIds.has(r.glyphId))
      .flatMap((r) => r.axes.map((a) => ({ rig: r, axis: a })));
  })();

  // Handles that no longer correspond to any catalog definition — freehand
  // handles from old saved projects, or schema handles orphaned by a text
  // edit shifting glyph indexes. The slider rows only render catalog-matched
  // handles, so these need their own escape hatch to stay deletable.
  const orphanHandles = (() => {
    if (!selectedBlock || selectedBlock.type === "image") return [];
    const out: { glyphIndex: number; handle: GlyphStretchHandle }[] = [];
    for (const edit of selectedBlock.glyphEdits ?? []) {
      const defs = (glyphCatalog ?? {})[edit.glyphIndex] ?? [];
      for (const h of edit.stretches) {
        const matched =
          h.schemaStrokeId != null &&
          defs.some(
            (d) => d.strokeId === h.schemaStrokeId && d.zoneIndex === (h.schemaZoneIndex ?? 0)
          );
        if (!matched) out.push({ glyphIndex: edit.glyphIndex, handle: h });
      }
    }
    return out;
  })();

  // Every kashida-eligible, schema-backed handle across the whole block (not
  // just the selected glyph) — drives the block-level Kashida dial below.
  const kashidaEligibleCount =
    selectedBlock?.glyphEdits?.reduce(
      (count, edit) =>
        count + edit.stretches.filter((h) => h.kashidaEligible && h.maxFactor != null).length,
      0
    ) ?? 0;

  const body = !eligible || !selectedBlock ? (
    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
      Select a text, shape-fill, or shape-warp block to morph its glyphs.
    </div>
  ) : (
    <>
      <div>
        <div className="sidebarSectionTitle" style={{ marginBottom: 0 }}>
          {selectedBlock.type === "text" ? "Stroke Handles" : "Stroke Sliders"}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
          {selectedBlock.type === "text"
            ? "One handle per stroke of every letter with an authored schema — 1.00 is the letter's natural shape."
            : "One slider per stroke of every letter with an authored schema — 1.00 is the letter's natural shape."}
        </div>

        {selectedBlock.type === "text" ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10 }}>
            Hover a letter on the canvas to drag its stroke handles directly —
            nothing needs to be turned on first. Or type an exact value below
            and press Enter.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {(
                [
                  { value: null, label: "Off" },
                  { value: "stretch", label: "Stretch" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => onSetGlyphEditTool?.(opt.value)}
                  className="sidebarPillButton"
                  style={
                    (selectedBlock.glyphEditTool ?? null) === opt.value
                      ? { background: "var(--accent)", color: "var(--text-on-accent)" }
                      : undefined
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Stretch shows the handles on the canvas (click a letter to inspect);
              the sliders below work either way.
            </div>
          </>
        )}

        {glyphGroups.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10 }}>
            No stroke schema authored yet for any letter in this text.
          </div>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}
          >
            {glyphGroups.map(({ glyphIndex, defs }) => (
              <div
                key={glyphIndex}
                style={{ display: "flex", flexDirection: "column", gap: 6 }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 6,
                    borderBottom: "1px solid var(--border-soft)",
                    paddingBottom: 2,
                  }}
                >
                  <bdi style={{ fontSize: 15, fontWeight: 600 }}>
                    {defs[0].baseLetter || defs[0].glyphName}
                  </bdi>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {defs[0].joiningForm}
                  </span>
                </div>

                {defs.map((def) => {
                  const rowKey = `${glyphIndex}:${def.strokeId}:${def.zoneIndex}`;
                  const handle = selectedBlock.glyphEdits
                    ?.find((g) => g.glyphIndex === glyphIndex)
                    ?.stretches.find(
                      (h) =>
                        h.schemaStrokeId === def.strokeId &&
                        (h.schemaZoneIndex ?? 0) === def.zoneIndex
                    );
                  const value = handle?.factor ?? 1;
                  const expanded = !!expandedRows[rowKey];

                  return (
                    <div
                      key={rowKey}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        background: "var(--row-bg)",
                        borderRadius: 8,
                        padding: "6px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: 1, minWidth: 0 }} title={def.label.ar}>
                          {selectedBlock.type === "text" ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 12, flex: 1, minWidth: 0 }}>
                                {def.label.en ?? def.componentType}
                                {def.kashidaEligible ? " · kashida" : ""}
                              </span>
                              <StrokeFactorInput
                                key={rowKey}
                                value={value}
                                min={def.minFactor}
                                max={def.maxFactor}
                                label={`${def.label.en ?? def.componentType} factor`}
                                onCommit={(factor) =>
                                  onSetStretchFactor?.(
                                    selectedBlock.id,
                                    glyphIndex,
                                    def,
                                    factor
                                  )
                                }
                              />
                            </div>
                          ) : (
                            <RangeRow
                              id={makeId(`stroke-${rowKey}`, selectedId)}
                              name={makeId(`strokeFactor-${rowKey}`, selectedId)}
                              label={`${def.label.en ?? def.componentType}${def.kashidaEligible ? " · kashida" : ""}`}
                              value={value}
                              min={def.minFactor}
                              max={def.maxFactor}
                              step={0.01}
                              onChange={(v) =>
                                onSetStretchFactor?.(selectedBlock.id, glyphIndex, def, v)
                              }
                              suffix={value.toFixed(2)}
                            />
                          )}
                        </div>
                        {handle && (
                          <button
                            type="button"
                            onClick={() =>
                              onDeleteStretchHandle?.(selectedBlock.id, glyphIndex, handle.id)
                            }
                            className="layerIconBtn"
                            title="Reset to natural shape"
                            aria-label="Reset to natural shape"
                            style={{ color: "var(--danger)" }}
                          >
                            <CloseIcon size={12} />
                          </button>
                        )}
                      </div>

                      {handle && (
                        <button
                          type="button"
                          className="sidebarSmallAction"
                          style={{ alignSelf: "flex-start" }}
                          onClick={() =>
                            setExpandedRows((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }))
                          }
                        >
                          {expanded ? "Hide options" : "Options…"}
                        </button>
                      )}

                      {handle && expanded && (
                        <>
                          {def.protectedReasons.length > 0 && (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              ⚠ Schema notes a protected zone on this stroke (
                              {def.protectedReasons.join(", ")}) — avoid stretching past
                              its terminal/join.
                            </span>
                          )}

                          <RangeRow
                            id={makeId(`handle-band-${handle.id}`, selectedId)}
                            name={makeId(`handleBand-${handle.id}`, selectedId)}
                            label="Band width"
                            value={handle.bandWidth}
                            min={5}
                            max={300}
                            step={5}
                            onChange={(v) =>
                              onUpdateStretchHandle?.(selectedBlock.id, glyphIndex, handle.id, {
                                bandWidth: v,
                              })
                            }
                            suffix={`${Math.round(handle.bandWidth)}px`}
                          />

                          {(() => {
                            const armedMode =
                              selectedBlock.glyphMaskEdit?.handleId === handle.id
                                ? selectedBlock.glyphMaskEdit.mode
                                : null;
                            const activeStyle = {
                              background: "var(--accent)",
                              color: "var(--text-on-accent)",
                            };
                            const statusLabel =
                              handle.mask == null
                                ? "Affects the whole glyph"
                                : handle.mask.mode === "contours"
                                  ? `Affects ${handle.mask.contourIndices.length} selected stroke${handle.mask.contourIndices.length === 1 ? "" : "s"}`
                                  : "Affects a lassoed region";

                            return (
                              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                <div style={{ display: "flex", gap: 4 }}>
                                  <button
                                    type="button"
                                    className="sidebarPillButton"
                                    style={
                                      armedMode === "contours" ||
                                      handle.mask?.mode === "contours"
                                        ? activeStyle
                                        : undefined
                                    }
                                    onClick={() =>
                                      onSetGlyphMaskEditMode?.(
                                        selectedBlock.id,
                                        glyphIndex,
                                        handle.id,
                                        "contours"
                                      )
                                    }
                                  >
                                    By stroke
                                  </button>
                                  <button
                                    type="button"
                                    className="sidebarPillButton"
                                    style={
                                      armedMode === "lasso" || handle.mask?.mode === "lasso"
                                        ? activeStyle
                                        : undefined
                                    }
                                    onClick={() =>
                                      onSetGlyphMaskEditMode?.(
                                        selectedBlock.id,
                                        glyphIndex,
                                        handle.id,
                                        "lasso"
                                      )
                                    }
                                  >
                                    Lasso
                                  </button>
                                </div>
                                {armedMode != null ? (
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      gap: 6,
                                    }}
                                  >
                                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                      {armedMode === "contours"
                                        ? "Click strokes on the canvas to include them."
                                        : "Drag a loop on the canvas around the stroke."}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onSetGlyphMaskEditMode?.(
                                          selectedBlock.id,
                                          glyphIndex,
                                          handle.id,
                                          null
                                        )
                                      }
                                      className="sidebarSmallAction"
                                    >
                                      Done
                                    </button>
                                  </div>
                                ) : (
                                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                    {statusLabel}
                                  </span>
                                )}
                              </div>
                            );
                          })()}

                          <div style={{ display: "flex", gap: 6 }}>
                            <input
                              type="text"
                              value={rigNameDrafts[handle.id] ?? ""}
                              onChange={(e) =>
                                setRigNameDrafts((prev) => ({
                                  ...prev,
                                  [handle.id]: e.target.value,
                                }))
                              }
                              placeholder="e.g. Tip Length"
                              className="hexInput"
                              style={{ flex: 1, minWidth: 0 }}
                            />
                            <button
                              type="button"
                              disabled={!rigNameDrafts[handle.id]?.trim()}
                              onClick={() => {
                                const name = rigNameDrafts[handle.id]?.trim();
                                if (!name) return;
                                onSaveStretchHandleAsRig?.(
                                  selectedBlock.id,
                                  glyphIndex,
                                  handle.id,
                                  name
                                );
                                setRigNameDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[handle.id];
                                  return next;
                                });
                              }}
                              className="sidebarSmallAction"
                            >
                              Save as Rig…
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {orphanHandles.length > 0 && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid var(--border-soft)",
            }}
          >
            <div className="sidebarSectionTitle" style={{ marginBottom: 0 }}>
              Other Stretch Lines
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Stretch lines from an older save or a since-edited text that no
              longer match a stroke above — still applied; delete to clear.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {orphanHandles.map(({ glyphIndex, handle }) => (
                <div
                  key={handle.id}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1 }}>
                    Stretch line · glyph {glyphIndex}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onDeleteStretchHandle?.(selectedBlock.id, glyphIndex, handle.id)
                    }
                    className="layerIconBtn"
                    title="Delete stretch line"
                    aria-label="Delete stretch line"
                    style={{ color: "var(--danger)" }}
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedBlock.type === "text" && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid var(--border-soft)",
            }}
          >
            <div className="sidebarSectionTitle" style={{ marginBottom: 0 }}>
              Move &amp; Scale
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Hover a letter on the canvas to move it, or stretch it in x or y.
              Neighbouring letters never shift.
            </div>

            <div style={{ marginTop: 8 }}>
              <CheckboxRow
                id={makeId("glyph-transform-mode", selectedId)}
                label="Move &amp; scale glyph"
                checked={!!selectedBlock.glyphTransformMode}
                onChange={() => onToggleGlyphTransformMode?.(selectedBlock.id)}
              />
            </div>

            {(selectedBlock.glyphTransforms?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => onResetGlyphTransforms?.(selectedBlock.id)}
                className="sidebarSmallAction"
                style={{ background: "var(--bg-input)", marginTop: 8 }}
              >
                Reset glyph transforms
              </button>
            )}
          </div>
        )}

        {kashidaEligibleCount > 0 && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid var(--border-soft)",
            }}
          >
            <div className="sidebarSectionTitle" style={{ marginBottom: 0 }}>
              Kashida
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Distributes one dial across every kashida-eligible handle in
              this block, weighted by each stroke's authored priority.
            </div>
            <div style={{ marginTop: 8 }}>
              <RangeRow
                id={makeId("kashida-amount", selectedId)}
                name={makeId("kashidaAmount", selectedId)}
                label="Extend by"
                value={selectedBlock.kashidaAmount ?? 0}
                min={0}
                max={100}
                step={1}
                onChange={(v) => onSetBlockKashidaAmount?.(selectedBlock.id, v)}
                suffix={`${Math.round(selectedBlock.kashidaAmount ?? 0)}%`}
              />
            </div>
          </div>
        )}
      </div>

      {riggedRows.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
          <div className="sidebarSectionTitle" style={{ marginBottom: 0 }}>
            Rigged Parameters
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            Named axes authored for a letterform in this font — affect every
            occurrence of that letter in this block.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {riggedRows.map(({ rig, axis }) => {
              const val =
                selectedBlock.glyphRigValues?.find((v) => v.axisId === axis.id)?.value ?? 0;
              return (
                <div key={axis.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <RangeRow
                      id={makeId(`rig-${axis.id}`, selectedId)}
                      name={makeId(`rigValue-${axis.id}`, selectedId)}
                      label={axis.name}
                      value={val}
                      min={-1}
                      max={1}
                      step={0.01}
                      onChange={(v) => onSetGlyphRigValue?.(selectedBlock.id, axis.id, v)}
                      suffix={val.toFixed(2)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteGlyphRigAxis?.(rig.fontFamily, rig.glyphId, axis.id)}
                    className="layerIconBtn"
                    title="Delete rigged parameter"
                    aria-label="Delete rigged parameter"
                    style={{ color: "var(--danger)" }}
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );

  if (isMobile) {
    if (!mobileOpen) return null;
    return (
      <>
        {createPortal(
          <div className="morphEditorFloating" role="dialog" aria-label="Morph glyph editor">
            <div className="morphEditorFloatingHeader">
              <span>Morph Glyph Editor</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => setShowHelp(true)}
                  className="layerIconBtn"
                  aria-label="Help"
                  title="Help"
                >
                  <HelpIcon size={12} />
                </button>
                <button
                  type="button"
                  onClick={onCloseMobile}
                  className="layerIconBtn"
                  aria-label="Close morph glyph editor"
                  title="Close"
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{body}</div>
          </div>,
          document.body
        )}
        {showHelp && <MorphHelpDialog onClose={() => setShowHelp(false)} />}
      </>
    );
  }

  if (!eligible) return null;

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        className="morphEditorReopenTab"
        title="Show Morph Glyph Editor"
        aria-label="Show Morph Glyph Editor"
      >
        <ChevronLeftIcon size={14} />
      </button>
    );
  }

  return (
    <div
      style={{
        width,
        height: "100%",
        padding: 0,
        boxSizing: "border-box",
        borderLeft: "1px solid var(--border)",
        background:
          "linear-gradient(180deg, var(--bg-sidebar-start) 0%, var(--bg-sidebar-end) 100%)",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        position: "relative",
        flexShrink: 0,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      <div className="sidebarInner">
        <div className="sidebarPanel" style={{ position: "relative" }}>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="layerIconBtn"
            style={{ position: "absolute", top: 8, insetInlineStart: 8 }}
            title="Hide Morph Glyph Editor"
            aria-label="Hide Morph Glyph Editor"
          >
            <ChevronRightIcon size={14} />
          </button>
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="layerIconBtn"
            style={{ position: "absolute", top: 8, insetInlineEnd: 8 }}
            title="Help"
            aria-label="Help"
          >
            <HelpIcon size={14} />
          </button>
          <div className="sidebarSectionTitle" style={{ textAlign: "center", marginBottom: 0 }}>
            Morph Glyph Editor
          </div>
        </div>

        <div className="sidebarPanel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {body}
        </div>
      </div>

      {showHelp && <MorphHelpDialog onClose={() => setShowHelp(false)} />}
    </div>
  );
};
