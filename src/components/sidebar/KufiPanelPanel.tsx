import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { KufiPanelBlock } from "../../types";
import { kufiPanelStatus, kufiSizeLabel } from "../../lib/kufi/kufiPanelStatus";
import { useKufiPanelLayout } from "../../hooks/useKufiPanelLayout";
import { cachedKufiLayout, kufiLayoutFailed, kufiLayoutKey, subscribeKufiLayouts } from "../../lib/kufi/kufiLayoutClient";
import { kufiPanelInputs } from "../../lib/kufi/kufiPanelBlock";
import { resolveKufiText } from "../../lib/kufi/kufiWords";

/**
 * Smallest box the size fields accept, in cells. There is no largest: Fit and
 * the suggestions can answer any size, and typing must be able to reach it.
 */
export const KUFI_PANEL_MIN_CELLS = 3;

type Size = { cols: number; rows: number };

const parseCells = (text: string): number | null => {
  const v = Number(text);
  return text.trim() !== "" && Number.isInteger(v) && v >= KUFI_PANEL_MIN_CELLS ? v : null;
};

/**
 * One size field. Typed digits are a draft, applied on Enter or when the
 * field loses focus, so "75" never passes through a 7-cell box and costs one
 * undo step. The spinner arrows (and arrow keys) apply at once: each is a
 * whole size of its own.
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
  const commit = (text: string) => {
    const v = parseCells(text);
    if (v !== null && v !== value) onCommit(v);
  };
  return (
    <label className="field kufiPanelSizeField" htmlFor={id}>
      <span className="fieldTitle">{label}</span>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={KUFI_PANEL_MIN_CELLS}
        step={1}
        value={shown}
        className="hexInput artboardNumberInput"
        aria-label={`${label} in cells`}
        onChange={(e) => {
          const text = e.target.value;
          // A stepper click or arrow key carries no inputType; typing does.
          const stepped = !(e.nativeEvent as InputEvent).inputType;
          if (stepped) {
            setDraft(null);
            commit(text);
          } else setDraft({ for: value, text });
        }}
        onBlur={(e) => {
          commit(e.currentTarget.value);
          setDraft(null);
        }}
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
 *
 * `notice` is why the last canvas edit (a click on a letter, a stretch)
 * changed nothing; it is shown only while the block and its layout inputs
 * are the ones it was made on.
 *
 * **Release hand edits** shows whenever the panel has pins (every committed
 * canvas gesture pins its letter at an absolute cell), on the same line as
 * the `pinConflict` status when there is one: pins are what a size change
 * cannot honour, and undo would also take back whatever was done since.
 * `onReleasePins` drops the pins and the routes they held, keeping forms,
 * stretch counts and painted cells, as one undo step.
 */
export const KufiPanelPanel: React.FC<{
  block: KufiPanelBlock;
  onSetSize: (size: Size) => void;
  onFit: () => Promise<void>;
  onReleasePins?: () => void;
  notice?: { blockId: number; key: string; text: string } | null;
}> = ({ block, onSetSize, onFit, onReleasePins, notice = null }) => {
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

  // A Fit's state, for the inputs it was pressed on: once the text, box or
  // edits change, neither "Finding a size…" nor "Fit failed" applies (App
  // drops a Fit answer for changed inputs), so a Fit whose answer never comes
  // cannot leave the button disabled. Only the latest press may settle it.
  // (The panel is keyed by block id at the call site, so it never carries to
  // another block.)
  const key = kufiLayoutKey(inputs);
  const [fitState, setFit] = useState<{ state: "busy" | "failed"; key: string; press: number } | null>(null);
  const pressRef = useRef(0);
  const fit = fitState && fitState.key === key ? fitState.state : "idle";

  const unsupported = useMemo(() => [...new Set(resolveKufiText(block.text).unsupported)], [block.text]);
  const size = { cols: block.panelCols, rows: block.panelRows };
  const status = kufiPanelStatus(result, failed, size);
  const idBase = `kufi-panel-${block.id}`;
  const hasPins = !!block.panelEdits?.pinned && Object.keys(block.panelEdits.pinned).length > 0;
  const pinConflict = !!result && !result.ok && result.reason === "pinConflict";
  const release = hasPins && onReleasePins && (
    <button
      type="button"
      className="kufiPanelSuggestion"
      onClick={onReleasePins}
      title="Let the letters you stretched, swapped or moved find new places; their shapes and stroke lengths are kept"
    >
      Release hand edits
    </button>
  );

  const runFit = () => {
    const press = ++pressRef.current;
    setFit({ state: "busy", key, press });
    const settle = (next: typeof fitState) => setFit((cur) => (cur?.press === press ? next : cur));
    onFit().then(
      () => settle(null),
      (err: unknown) => {
        console.warn(err);
        settle({ state: "failed", key, press });
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
            {pinConflict && release && <> — {release}</>}
          </div>
        ) : null}
        {!pinConflict && release && <div>{release}</div>}
        {notice && notice.blockId === block.id && notice.key === key && <div>{notice.text}</div>}
        {unsupported.length > 0 && <div>Not drawn: {unsupported.join(" ")}</div>}
        {(block.strokeWidth ?? 0) > 0 && <div>The outline exports as a separate path.</div>}
      </div>
    </div>
  );
};
