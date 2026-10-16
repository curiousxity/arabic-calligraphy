import { useState } from "react";
import type { VerseSettings, VerseTag } from "../../types";

/**
 * A number field that commits on blur or Enter rather than per keystroke —
 * every commit is a full async re-justify and one undo step.
 */
const CommitNumber: React.FC<{
  id: string;
  label: string;
  value: number | undefined;
  placeholder?: string;
  step: number;
  min: number;
  onCommit: (v: number | undefined) => void;
}> = ({ id, label, value, placeholder, step, min, onCommit }) => {
  const shown = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  // Re-sync when the committed value changes underneath (undo, another line).
  const [synced, setSynced] = useState(shown);
  if (synced !== shown) {
    setSynced(shown);
    setDraft(shown);
  }
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (value !== undefined) onCommit(undefined);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < min) {
      setDraft(shown);
      return;
    }
    if (n !== value) onCommit(n);
  };
  return (
    <label className="field" htmlFor={id}>
      <span className="fieldTitle">{label}</span>
      <input
        id={id}
        type="number"
        step={step}
        min={min}
        className="hexInput artboardNumberInput"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </label>
  );
};

/**
 * Settings for the verse the selected line belongs to. Every change re-runs
 * Justify across all its lines as one undo step; editing a line's own text
 * does not — press Justify after typing.
 */
export const VersePanel: React.FC<{
  verse: VerseTag;
  busy: boolean;
  onJustify: (overrides?: Partial<VerseSettings>) => void;
}> = ({ verse, busy, onJustify }) => (
  <div className="sectionPanel">
    <div className="field" role="radiogroup" aria-label="Verse layout">
      <span className="fieldTitle">Layout</span>
      <div style={{ display: "flex", gap: 12 }}>
        {(["stacked", "bayt"] as const).map((layout) => (
          <label key={layout}>
            <input
              type="radio"
              name={`verse-${verse.id}-layout`}
              checked={verse.layout === layout}
              disabled={busy}
              onChange={() => onJustify({ layout })}
            />{" "}
            {layout === "stacked" ? "Stacked" : "Bayt"}
          </label>
        ))}
      </div>
    </div>
    <CommitNumber
      id={`verse-${verse.id}-width`}
      label="Verse width"
      value={verse.width}
      placeholder="Widest line"
      step={1}
      min={1}
      onCommit={(width) => onJustify({ width })}
    />
    <CommitNumber
      id={`verse-${verse.id}-line-gap`}
      label="Line gap"
      value={verse.lineGap}
      step={0.1}
      min={0}
      onCommit={(v) => {
        if (v !== undefined) onJustify({ lineGap: v });
      }}
    />
    {verse.layout === "bayt" && (
      <CommitNumber
        id={`verse-${verse.id}-column-gap`}
        label="Column gap"
        value={verse.columnGap}
        step={0.1}
        min={0}
        onCommit={(v) => {
          if (v !== undefined) onJustify({ columnGap: v });
        }}
      />
    )}
    <button
      type="button"
      className="sidebarSectionButton"
      disabled={busy}
      onClick={() => onJustify()}
      title="Stretch the lines with kashida so they all end up the same width"
    >
      <span>{busy ? "Justifying…" : "Justify"}</span>
    </button>
  </div>
);
