import React from "react";
import type { Palette } from "../lib/palettes";

/**
 * A palette picker plus its swatch strip.
 *
 * Deliberately a component of its own rather than an addition to
 * `FormControls.tsx`'s `ColorRow`: that file belongs to no stream this phase,
 * and a palette is a *shared* list across colour controls rather than a
 * property of one row. `ColorRow` keeps its own fixed grid of stock colours;
 * this strip sits above it and offers the palette the user actually chose.
 *
 * Holds no state — the selected palette and the list live in `App.tsx` beside
 * the other local stores, because clicking a swatch has to reach the same
 * `onUpdateSelectedBlock` every colour control uses.
 */
export const PaletteSwatches: React.FC<{
  palettes: Palette[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** The colour the target currently holds, ringed in the strip when it matches. */
  value?: string;
  onPick: (color: string) => void;
  /** Captures the colours in use on the canvas as a new palette. */
  onSaveFromCanvas?: () => void;
  /** Only offered for the user's own palettes — the shipped ones are code, not data. */
  onDelete?: () => void;
  canDelete?: boolean;
}> = ({ palettes, selectedId, onSelect, value, onPick, onSaveFromCanvas, onDelete, canDelete }) => {
  const palette = palettes.find((p) => p.id === selectedId) ?? palettes[0];
  const current = value?.toLowerCase();

  return (
    <div className="field">
      <span className="fieldTitle">Palette</span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <select
          value={palette?.id ?? ""}
          onChange={(e) => onSelect(e.target.value)}
          className="select"
          aria-label="Palette"
          style={{ minWidth: 0, flex: 1 }}
        >
          {palettes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {onSaveFromCanvas && (
          <button
            type="button"
            onClick={onSaveFromCanvas}
            className="sidebarPillButton"
            style={{ flex: "0 0 auto", padding: "0 10px" }}
            title="Save the colours currently used on the canvas as a palette"
          >
            From canvas
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={!canDelete}
            className="sidebarPillButton"
            style={{ flex: "0 0 auto", padding: "0 10px" }}
            title={
              canDelete
                ? "Delete this palette"
                : "Built-in palettes can't be deleted"
            }
          >
            Delete
          </button>
        )}
      </div>
      {palette && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 8,
          }}
          role="group"
          aria-label={`${palette.name} colours`}
        >
          {palette.colors.map((c, i) => (
            <button
              // Colours may legitimately repeat within a palette, so the index
              // is part of the key rather than the colour alone.
              key={`${c}-${i}`}
              type="button"
              onClick={() => onPick(c)}
              title={c}
              aria-label={`Use ${c}`}
              className="paletteSwatch"
              style={{
                background: c,
                boxShadow:
                  current === c.toLowerCase()
                    ? "0 0 0 2px var(--bg-panel), 0 0 0 4px var(--accent)"
                    : "0 1px 2px rgba(0, 0, 0, 0.2)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
