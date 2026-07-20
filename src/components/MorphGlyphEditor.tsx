import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Block, GlyphRig, GlyphStretchHandle } from "../types";
import { RangeRow } from "./sidebar/FormControls";
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

          <h4>1. Pick a glyph</h4>
          <p>
            Turn on <strong>Stretch</strong> above, then click a letter on the
            canvas to select it. Stretch needs a selected glyph before it does
            anything.
          </p>

          <h4>Stretch tool</h4>
          <p>
            Elongates or distorts a stroke between two points.
          </p>
          <ol>
            <li>
              Click <strong>Add stretch line</strong> to create a handle: a{" "}
              <strong style={{ color: "#ff4d4f" }}>red anchor</strong> (fixed
              point) and a <strong style={{ color: "#22c55e" }}>green drag
              point</strong> (the point you pull).
            </li>
            <li>
              Drag the red anchor to where the deformation should originate,
              and the green point to where it should pull toward. Everything
              between them stretches proportionally.
            </li>
            <li>
              <strong>Band width</strong> controls how wide a swath around the
              line is affected.
            </li>
            <li>
              <strong>Masking</strong> limits which part of the glyph is
              affected: Whole glyph (default), By stroke (click outline
              contours to include/exclude them, then Done), or Lasso (drag a
              freeform loop around the region).
            </li>
          </ol>
          <p>You can add multiple stretch lines per glyph.</p>

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
  glyphRigs?: GlyphRig[];
  onSetGlyphEditTool?: (tool: "stretch" | null) => void;
  onAddStretchHandle?: () => void;
  onUpdateStretchHandle?: (
    blockId: number,
    glyphIndex: number,
    handleId: string,
    patch: Partial<GlyphStretchHandle>
  ) => void;
  onDeleteStretchHandle?: (blockId: number, glyphIndex: number, handleId: string) => void;
  onSetGlyphMaskEditMode?: (
    blockId: number,
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
  glyphRigs,
  onSetGlyphEditTool,
  onAddStretchHandle,
  onUpdateStretchHandle,
  onDeleteStretchHandle,
  onSetGlyphMaskEditMode,
  onSaveStretchHandleAsRig,
  onSetGlyphRigValue,
  onDeleteGlyphRigAxis,
  isMobile,
  width,
  isCollapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}) => {
  const [rigNameDrafts, setRigNameDrafts] = useState<Record<string, string>>({});
  const [showHelp, setShowHelp] = useState(false);
  const selectedId = selectedBlock?.id ?? "none";

  const eligible = !!selectedBlock && selectedBlock.type !== "image";

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

  const body = !eligible || !selectedBlock ? (
    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
      Select a text, shape-fill, or shape-warp block to morph its glyphs.
    </div>
  ) : (
    <>
      <div>
        <div className="sidebarSectionTitle" style={{ marginBottom: 0 }}>
          Glyph Edit
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
          Click a letter, then Stretch to elongate a stroke between an anchor
          and a drag point.
        </div>

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

        {selectedBlock.glyphEditTool != null && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
            Selected glyph:{" "}
            {selectedBlock.selectedGlyphIndex != null
              ? selectedBlock.selectedGlyphIndex
              : "none"}
          </div>
        )}

        {selectedBlock.glyphEditTool === "stretch" && (
          <>
            <button
              type="button"
              disabled={selectedBlock.selectedGlyphIndex == null}
              onClick={() => onAddStretchHandle?.()}
              className="sidebarSmallAction"
              style={{ marginTop: 8 }}
            >
              Add stretch line
            </button>

            {selectedBlock.selectedGlyphIndex != null &&
              (() => {
                const glyphIndex = selectedBlock.selectedGlyphIndex as number;
                const stretches =
                  selectedBlock.glyphEdits?.find((g) => g.glyphIndex === glyphIndex)
                    ?.stretches ?? [];
                if (stretches.length === 0) return null;

                return (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      marginTop: 8,
                    }}
                  >
                    {stretches.map((h) => (
                      <div
                        key={h.id}
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
                          <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1 }}>
                            Stretch line
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onDeleteStretchHandle?.(selectedBlock.id, glyphIndex, h.id)
                            }
                            className="layerIconBtn"
                            title="Delete stretch line"
                            aria-label="Delete stretch line"
                            style={{ color: "var(--danger)" }}
                          >
                            <CloseIcon size={12} />
                          </button>
                        </div>

                        <RangeRow
                          id={makeId(`handle-band-${h.id}`, selectedId)}
                          name={makeId(`handleBand-${h.id}`, selectedId)}
                          label="Band width"
                          value={h.bandWidth}
                          min={5}
                          max={300}
                          step={5}
                          onChange={(v) =>
                            onUpdateStretchHandle?.(selectedBlock.id, glyphIndex, h.id, {
                              bandWidth: v,
                            })
                          }
                          suffix={`${Math.round(h.bandWidth)}px`}
                        />

                        {(() => {
                          const armedMode =
                            selectedBlock.glyphMaskEdit?.handleId === h.id
                              ? selectedBlock.glyphMaskEdit.mode
                              : null;
                          const activeStyle = {
                            background: "var(--accent)",
                            color: "var(--text-on-accent)",
                          };
                          const statusLabel =
                            h.mask == null
                              ? "Affects the whole glyph"
                              : h.mask.mode === "contours"
                                ? `Affects ${h.mask.contourIndices.length} selected stroke${h.mask.contourIndices.length === 1 ? "" : "s"}`
                                : "Affects a lassoed region";

                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <div style={{ display: "flex", gap: 4 }}>
                                <button
                                  type="button"
                                  className="sidebarPillButton"
                                  style={h.mask == null ? activeStyle : undefined}
                                  onClick={() => {
                                    onUpdateStretchHandle?.(selectedBlock.id, glyphIndex, h.id, {
                                      mask: undefined,
                                    });
                                    onSetGlyphMaskEditMode?.(selectedBlock.id, h.id, null);
                                  }}
                                >
                                  Whole glyph
                                </button>
                                <button
                                  type="button"
                                  className="sidebarPillButton"
                                  style={
                                    armedMode === "contours" || h.mask?.mode === "contours"
                                      ? activeStyle
                                      : undefined
                                  }
                                  onClick={() =>
                                    onSetGlyphMaskEditMode?.(selectedBlock.id, h.id, "contours")
                                  }
                                >
                                  By stroke
                                </button>
                                <button
                                  type="button"
                                  className="sidebarPillButton"
                                  style={
                                    armedMode === "lasso" || h.mask?.mode === "lasso"
                                      ? activeStyle
                                      : undefined
                                  }
                                  onClick={() =>
                                    onSetGlyphMaskEditMode?.(selectedBlock.id, h.id, "lasso")
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
                                      onSetGlyphMaskEditMode?.(selectedBlock.id, h.id, null)
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
                            value={rigNameDrafts[h.id] ?? ""}
                            onChange={(e) =>
                              setRigNameDrafts((prev) => ({
                                ...prev,
                                [h.id]: e.target.value,
                              }))
                            }
                            placeholder="e.g. Tip Length"
                            className="hexInput"
                            style={{ flex: 1 }}
                          />
                          <button
                            type="button"
                            disabled={!rigNameDrafts[h.id]?.trim()}
                            onClick={() => {
                              const name = rigNameDrafts[h.id]?.trim();
                              if (!name) return;
                              onSaveStretchHandleAsRig?.(
                                selectedBlock.id,
                                glyphIndex,
                                h.id,
                                name
                              );
                              setRigNameDrafts((prev) => {
                                const next = { ...prev };
                                delete next[h.id];
                                return next;
                              });
                            }}
                            className="sidebarSmallAction"
                          >
                            Save as Rig…
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
          </>
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
