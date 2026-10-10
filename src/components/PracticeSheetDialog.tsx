import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Block } from "../types";
import {
  DEFAULT_EM_HEIGHT_MM,
  DEFAULT_NIB_MM,
  DEFAULT_PRACTICE_SHEET_OPTIONS,
  layoutPracticeSheet,
  type MeasuredRun,
  type PracticeSheetOptions,
  type PracticeSheetPage,
} from "../lib/practiceSheet";
import {
  buildPracticeSheetPdf,
  measurePracticeRun,
  practiceSheetFilename,
} from "../lib/practiceSheetPdf";
import { isFontUnavailable } from "../lib/customFonts";
import { FONT_URLS } from "../hooks/useShapedGlyphs";
import { CloseIcon, FileTextIcon } from "./Icons";

export type PracticeSheetDialogProps = {
  block: Block;
  onClose: () => void;
};

const NIB_RANGE = { min: 0.5, max: 15 };
const EM_RANGE = { min: 5, max: 150 };
const ROW_RANGE = { min: 0, max: 20 };

/** Parses a draft field; empty, non-numeric or out-of-range gives null. */
function parseInRange(draft: string, range: { min: number; max: number }): number | null {
  if (draft.trim() === "") return null;
  const n = Number(draft);
  return Number.isFinite(n) && n >= range.min && n <= range.max ? n : null;
}

type RunState = { run: MeasuredRun | null; error: string | null; key: string };

const FONT_UNAVAILABLE_MESSAGE = "This block's font isn't available in this browser.";

const DEFAULT_SCALE = DEFAULT_PRACTICE_SHEET_OPTIONS.scale;
const DEFAULT_NIB_DRAFT = String(
  "nibWidthMm" in DEFAULT_SCALE ? DEFAULT_SCALE.nibWidthMm : DEFAULT_NIB_MM
);
const DEFAULT_EM_DRAFT = String(
  "emHeightMm" in DEFAULT_SCALE ? DEFAULT_SCALE.emHeightMm : DEFAULT_EM_HEIGHT_MM
);

/**
 * Practice-sheet export. Portaled to `document.body` like `FontUploadDialog`
 * (the sidebar clips modals, and nothing non-artwork may live in the stage).
 * The text is shaped and measured on open (and when it changes), so the
 * readout and the warnings are the pure layout's own numbers for the sheet
 * that will actually print. Numeric fields are kept as draft strings so a
 * cleared field stays empty instead of snapping to a number.
 */
export const PracticeSheetDialog: React.FC<PracticeSheetDialogProps> = ({ block, onClose }) => {
  const [nibDraft, setNibDraft] = useState(DEFAULT_NIB_DRAFT);
  const [directEm, setDirectEm] = useState(false);
  const [emDraft, setEmDraft] = useState(DEFAULT_EM_DRAFT);
  const [page, setPage] = useState<PracticeSheetPage>(DEFAULT_PRACTICE_SHEET_OPTIONS.page);
  const [rowDrafts, setRowDrafts] = useState({
    model: String(DEFAULT_PRACTICE_SHEET_OPTIONS.rows.model),
    trace: String(DEFAULT_PRACTICE_SHEET_OPTIONS.rows.trace),
    blank: String(DEFAULT_PRACTICE_SHEET_OPTIONS.rows.blank),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runState, setRunState] = useState<RunState>({ run: null, error: null, key: "" });
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const text = block.text ?? "";
  const empty = text.trim().length === 0;
  // An uploaded font this browser does not have would silently shape in the
  // Noto Sans fallback (`pickFontUrl`). Re-checked every render: when
  // `primeCustomFonts` registers it, App re-renders down to here, the key
  // changes, and the run is measured again in the real face.
  const fontUnavailable = isFontUnavailable(block.fontFamily, FONT_URLS);
  const runKey = `${block.fontFamily}|${fontUnavailable ? "missing" : "ok"}|${text}`;

  // Shape and measure on mount and whenever the text, font or font
  // availability changes; a late result for an older key is ignored.
  useEffect(() => {
    if (text.trim().length === 0 || fontUnavailable) return;
    let cancelled = false;
    measurePracticeRun(text, block.fontFamily).then(
      (run) => {
        if (!cancelled) setRunState({ run, error: null, key: runKey });
      },
      (e) => {
        if (!cancelled) {
          setRunState({
            run: null,
            error: e instanceof Error ? e.message : "Could not measure the text.",
            key: runKey,
          });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [text, block.fontFamily, fontUnavailable, runKey]);

  const current = runState.key === runKey;
  const run = current && !fontUnavailable ? runState.run : null;
  const runError = fontUnavailable ? FONT_UNAVAILABLE_MESSAGE : current ? runState.error : null;
  const loading = !empty && !fontUnavailable && !current;

  const nibMm = parseInRange(nibDraft, NIB_RANGE);
  const emMm = parseInRange(emDraft, EM_RANGE);
  const scaleValue = directEm ? emMm : nibMm;
  const scaleHint = directEm
    ? `Enter a letter size from ${EM_RANGE.min} to ${EM_RANGE.max} mm.`
    : `Enter a nib width from ${NIB_RANGE.min} to ${NIB_RANGE.max} mm.`;

  const rows = useMemo(() => {
    const parse = (d: string) => {
      const n = parseInRange(d, ROW_RANGE);
      return n !== null && Number.isInteger(n) ? n : null;
    };
    const model = parse(rowDrafts.model);
    const trace = parse(rowDrafts.trace);
    const blank = parse(rowDrafts.blank);
    const invalid = (
      [
        ["Model rows", model],
        ["Trace rows", trace],
        ["Blank rows", blank],
      ] as const
    )
      .filter(([, v]) => v === null)
      .map(([name]) => name);
    if (model === null || trace === null || blank === null) return { value: null, invalid };
    return { value: { model, trace, blank }, invalid };
  }, [rowDrafts]);
  const totalRows = rows.value ? rows.value.model + rows.value.trace + rows.value.blank : 0;

  const options: PracticeSheetOptions | null = useMemo(
    () =>
      scaleValue === null || rows.value === null
        ? null
        : {
            ...DEFAULT_PRACTICE_SHEET_OPTIONS,
            page,
            rows: rows.value,
            scale: directEm ? { emHeightMm: scaleValue } : { nibWidthMm: scaleValue },
            fontFamily: block.fontFamily,
          },
    [page, rows.value, directEm, scaleValue, block.fontFamily]
  );

  const layout = useMemo(
    () => (options && run ? layoutPracticeSheet(options, run) : null),
    [options, run]
  );

  const notes: string[] = [];
  if (layout) {
    if (layout.fitScale < 1) {
      notes.push(`Shrunk to fit the page: nuqta is ${layout.nuqtaMm.toFixed(2)} mm.`);
    }
    if (layout.gridEveryNuqta > 1) {
      notes.push(`Grid squares are ${layout.gridEveryNuqta} nuqta wide so the lines stay printable.`);
    }
    if (layout.droppedRows > 0) {
      notes.push(
        `${layout.droppedRows} row${layout.droppedRows === 1 ? "" : "s"} did not fit and will be left off.`
      );
    }
  }

  const canDownload = !busy && !empty && !loading && !runError && !!layout && totalRows > 0;

  const download = async () => {
    if (!canDownload || !options) return;
    setBusy(true);
    setError(null);
    try {
      const { pdf } = await buildPracticeSheetPdf(text, options);
      pdf.save(practiceSheetFilename(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the sheet.");
    } finally {
      setBusy(false);
    }
  };

  const rowInput = (key: keyof typeof rowDrafts, label: string) => (
    <label className="practiceSheetRowField">
      <span className="fieldTitle">{label}</span>
      <input
        type="number"
        min={0}
        max={20}
        step={1}
        className="hexInput"
        value={rowDrafts[key]}
        onChange={(e) => setRowDrafts((r) => ({ ...r, [key]: e.target.value }))}
      />
    </label>
  );

  return createPortal(
    <div
      className="confirmDialogOverlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="confirmDialog fontUploadDialog practiceSheetDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="practiceSheetTitle"
        onKeyDown={(e) => {
          // App's shortcuts listen on window: Delete/Backspace would delete the
          // block behind the modal and arrows would nudge it. Stopping the
          // event here also stops it reaching this dialog's own window Escape
          // listener, so Escape is handled here too. No preventDefault: the
          // fields still need their keys.
          e.stopPropagation();
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="fontUploadHeader">
          <div id="practiceSheetTitle" className="confirmDialogTitle">
            Practice sheet
          </div>
          <button
            ref={closeRef}
            type="button"
            className="sidebarCircleButton"
            onClick={onClose}
            aria-label="Close practice sheet"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="confirmDialogMessage">
          Prints the selected text as a model row to study, faint rows to trace,
          and ruled rows to write on your own. One square of the grid is one
          nuqta — the dot your pen makes.
        </div>

        {empty ? (
          <div className="fontUploadError" role="alert">
            The selected block has no text to practise.
          </div>
        ) : null}

        <label className="fontUploadField">
          <span className="fieldTitle">
            {directEm ? "Letter size (em height, mm)" : "Pen nib width (mm)"}
          </span>
          <input
            type="number"
            min={directEm ? EM_RANGE.min : NIB_RANGE.min}
            max={directEm ? EM_RANGE.max : NIB_RANGE.max}
            step={0.5}
            className="hexInput"
            value={directEm ? emDraft : nibDraft}
            onChange={(e) => (directEm ? setEmDraft(e.target.value) : setNibDraft(e.target.value))}
          />
        </label>
        {scaleValue === null ? (
          <div className="practiceSheetHint" role="alert">
            {scaleHint}
          </div>
        ) : null}
        <label className="practiceSheetToggle">
          <input
            type="checkbox"
            checked={directEm}
            onChange={(e) => setDirectEm(e.target.checked)}
          />{" "}
          Set letter size directly instead of from the pen
        </label>

        <label className="fontUploadField">
          <span className="fieldTitle">Page</span>
          <select
            className="hexInput"
            value={page}
            onChange={(e) => setPage(e.target.value as PracticeSheetPage)}
          >
            <option value="a4">A4 (210 × 297 mm)</option>
            <option value="letter">US Letter (8.5 × 11 in)</option>
          </select>
        </label>

        <div className="practiceSheetRows">
          {rowInput("model", "Model rows")}
          {rowInput("trace", "Trace rows")}
          {rowInput("blank", "Blank rows")}
        </div>
        {rows.invalid.length > 0 ? (
          <div className="practiceSheetHint" role="alert">
            {rows.invalid.join(", ")}: enter a whole number from {ROW_RANGE.min} to {ROW_RANGE.max}.
          </div>
        ) : null}

        <div className="practiceSheetReadout" aria-live="polite">
          {loading
            ? "Measuring the text…"
            : layout
              ? `Em ${layout.emHeightMm.toFixed(1)} mm · nuqta ${layout.nuqtaMm.toFixed(2)} mm · ${layout.rows.length} row${layout.rows.length === 1 ? "" : "s"} will print`
              : ""}
        </div>

        {notes.length > 0 ? <div className="practiceSheetNotice">{notes.join(" ")}</div> : null}
        {runError ? (
          <div className="fontUploadError" role="alert">
            {runError}
          </div>
        ) : null}
        {error ? (
          <div className="fontUploadError" role="alert">
            {error}
          </div>
        ) : null}

        <div className="confirmDialogActions">
          <button type="button" className="sidebarSmallAction" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sidebarSmallAction sidebarSmallAction--accent"
            disabled={!canDownload}
            onClick={() => void download()}
          >
            {busy ? "Building…" : "Download PDF"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export type PracticeSheetButtonProps = { block: Block | undefined };

/** Launcher + dialog as one element, so the Export panel needs no open/closed state. */
export const PracticeSheetButton: React.FC<PracticeSheetButtonProps> = ({ block }) => {
  const [open, setOpen] = useState(false);
  const textBlock = block && block.type === "text" ? block : null;
  // Losing the text selection closes the dialog for good; re-selecting must
  // not pop it back up.
  if (open && !textBlock) setOpen(false);
  return (
    <>
      <button
        type="button"
        className="sidebarPillButton"
        disabled={!textBlock}
        onClick={() => setOpen(true)}
        title={
          textBlock
            ? "Print a tracing and writing sheet of this text"
            : "Select a single plain text block to make a practice sheet"
        }
        aria-label="Practice sheet"
        style={{ minWidth: 0 }}
      >
        <FileTextIcon size={13} /> Practice sheet…
      </button>
      {open && textBlock && (
        <PracticeSheetDialog block={textBlock} onClose={() => setOpen(false)} />
      )}
    </>
  );
};

export default PracticeSheetDialog;
