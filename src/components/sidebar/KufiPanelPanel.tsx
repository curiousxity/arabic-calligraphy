import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { KufiPanelBlock } from "../../types";
import { kufiPanelStatus, kufiSizeLabel } from "../../lib/kufi/kufiPanelStatus";
import { useKufiPanelLayout } from "../../hooks/useKufiPanelLayout";
import { cachedKufiLayout, kufiLayoutFailed, kufiLayoutKey, subscribeKufiLayouts } from "../../lib/kufi/kufiLayoutClient";
import { kufiPanelInputs } from "../../lib/kufi/kufiPanelBlock";
import { resolveKufiText } from "../../lib/kufi/kufiWords";

/** Smallest and largest box the size fields accept, in cells. */
export const KUFI_PANEL_MIN_CELLS = 3;
export const KUFI_PANEL_MAX_CELLS = 60;

type Size = { cols: number; rows: number };

/**
 * One size field. Typing is kept as a draft and committed only when it is a
 * whole number in range, so "15" never passes through a 1-cell box on the way.
 */
const CellsField: React.FC<{ id: string; label: string; value: number; onCommit: (v: number) => void }> = ({
  id,
  label,
  value,
  onCommit,
}) => {
  // What is typed, for the value it was typed against: once the block's
  // value moves on (undo, Fit, a suggestion), the field shows the new value.
  const [draft, setDraft] = useState<{ for: number; text: string } | null>(null);
  const shown = draft && draft.for === value ? draft.text : String(value);
  return (
    <label className="field kufiPanelSizeField" htmlFor={id}>
      <span className="fieldTitle">{label}</span>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={KUFI_PANEL_MIN_CELLS}
        max={KUFI_PANEL_MAX_CELLS}
        step={1}
        value={shown}
        className="hexInput artboardNumberInput"
        aria-label={`${label} in cells`}
        onChange={(e) => {
          const text = e.target.value;
          const v = Number(text);
          const valid = text.trim() !== "" && Number.isInteger(v) && v >= KUFI_PANEL_MIN_CELLS && v <= KUFI_PANEL_MAX_CELLS;
          setDraft({ for: valid ? v : value, text });
          if (valid && v !== value) onCommit(v);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
};

/**
 * The Kufi panel type panel: the box in cells, Fit, and one status line that
 * says why nothing is drawn (or what to try). See `lib/kufi/kufiPack.ts`.
 *
 * `onFit` resolves when the new size is applied and rejects with an Error
 * whose message starts "Fit failed" if the packer's worker dies; the panel
 * catches it and says so.
 */
export const KufiPanelPanel: React.FC<{
  block: KufiPanelBlock;
  onSetSize: (size: Size) => void;
  onFit: () => Promise<void>;
}> = ({ block, onSetSize, onFit }) => {
  // Registers this panel as a reader, so the layout is packed even if the
  // canvas has not asked yet; the status reads the exact inputs below.
  useKufiPanelLayout(block);
  const inputs = useMemo(
    () => kufiPanelInputs(block),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the four layout fields, not the block object
    [block.text, block.panelCols, block.panelRows, block.panelEdits]
  );
  const getResult = useCallback(() => cachedKufiLayout(inputs), [inputs]);
  const getFailed = useCallback(() => kufiLayoutFailed(inputs), [inputs]);
  const result = useSyncExternalStore(subscribeKufiLayouts, getResult, getResult);
  const failed = useSyncExternalStore(subscribeKufiLayouts, getFailed, getFailed);

  // A Fit's state, for the inputs it was pressed on: once the text or the
  // box changes, a "Fit failed" from before no longer applies. (The panel is
  // keyed by block id at the call site, so it never carries to another block.)
  const key = kufiLayoutKey(inputs);
  const [fitState, setFit] = useState<{ state: "busy" | "failed"; key: string } | null>(null);
  const fit = fitState?.state === "busy" || fitState?.key === key ? fitState.state : "idle";

  const unsupported = useMemo(() => [...new Set(resolveKufiText(block.text).unsupported)], [block.text]);
  const size = { cols: block.panelCols, rows: block.panelRows };
  const status = kufiPanelStatus(result, failed, size);
  const idBase = `kufi-panel-${block.id}`;

  const runFit = () => {
    setFit({ state: "busy", key });
    onFit().then(
      () => setFit(null),
      (err: unknown) => {
        console.warn(err);
        setFit({ state: "failed", key });
      }
    );
  };

  return (
    <div className="sectionPanel" data-testid="kufi-panel">
      <div className="kufiPanelSizeRow">
        <CellsField
          id={`${idBase}-cols`}
          label="Width"
          value={block.panelCols}
          onCommit={(cols) => onSetSize({ cols, rows: block.panelRows })}
        />
        <CellsField
          id={`${idBase}-rows`}
          label="Height"
          value={block.panelRows}
          onCommit={(rows) => onSetSize({ cols: block.panelCols, rows })}
        />
        <button
          type="button"
          className="sidebarPillButton kufiPanelFit"
          onClick={runFit}
          disabled={fit === "busy"}
          title="Find the smallest square box this text fills"
        >
          Fit
        </button>
      </div>

      <div className="kufiPanelStatus" role="status">
        {fit === "busy" ? (
          <div>Finding a size…</div>
        ) : fit === "failed" ? (
          <div>Fit failed. Try again.</div>
        ) : status ? (
          <div>
            {status.text}
            {status.suggestions.map((s, i) => (
              <span key={kufiSizeLabel(s)}>
                {i > 0 ? " or " : " "}
                <button type="button" className="kufiPanelSuggestion" onClick={() => onSetSize(s)}>
                  {kufiSizeLabel(s)}
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {unsupported.length > 0 && <div>Not drawn: {unsupported.join(" ")}</div>}
        {(block.strokeWidth ?? 0) > 0 && <div>The outline exports as a separate path.</div>}
      </div>
    </div>
  );
};
