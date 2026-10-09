import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Block } from "../types";
import {
  DEFAULT_PRACTICE_SHEET_OPTIONS,
  emHeightFromScale,
  type PracticeSheetOptions,
  type PracticeSheetPage,
} from "../lib/practiceSheet";
import { nuqtaUnits } from "../lib/nuqta";
import { buildPracticeSheetPdf, practiceSheetFilename } from "../lib/practiceSheetPdf";
import { CloseIcon, FileTextIcon } from "./Icons";

export type PracticeSheetDialogProps = {
  block: Block;
  onClose: () => void;
};

/**
 * Practice-sheet export. Portaled to `document.body` like `FontUploadDialog`
 * (the sidebar clips modals, and nothing non-artwork may live in the stage).
 * All state is local: nib or em, page, row counts. The live readout is the
 * pure layout's own numbers for the *scale* only — row placement needs the
 * shaped run, which is only fetched on Download.
 */
export const PracticeSheetDialog: React.FC<PracticeSheetDialogProps> = ({ block, onClose }) => {
  const [nibMm, setNibMm] = useState(4);
  const [directEm, setDirectEm] = useState(false);
  const [emMm, setEmMm] = useState(40);
  const [page, setPage] = useState<PracticeSheetPage>("a4");
  const [rows, setRows] = useState(DEFAULT_PRACTICE_SHEET_OPTIONS.rows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  const options: PracticeSheetOptions = useMemo(
    () => ({
      ...DEFAULT_PRACTICE_SHEET_OPTIONS,
      page,
      rows,
      scale: directEm ? { emHeightMm: emMm } : { nibWidthMm: nibMm },
      fontFamily: block.fontFamily,
    }),
    [page, rows, directEm, emMm, nibMm, block.fontFamily]
  );

  const em = emHeightFromScale(options.scale, block.fontFamily);
  const nuqta = em * nuqtaUnits(block.fontFamily, 1);
  const totalRows = rows.model + rows.trace + rows.blank;

  const download = async () => {
    if (busy || empty) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { pdf, layout } = await buildPracticeSheetPdf(text, options);
      pdf.save(practiceSheetFilename(text));
      const notes: string[] = [];
      if (layout.fitScale < 1) {
        notes.push(`Shrunk to fit the page: nuqta is ${layout.nuqtaMm.toFixed(2)} mm.`);
      }
      if (layout.droppedRows > 0) {
        notes.push(`${layout.droppedRows} row${layout.droppedRows === 1 ? "" : "s"} did not fit and were left off.`);
      }
      setNotice(notes.length ? notes.join(" ") : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the sheet.");
    } finally {
      setBusy(false);
    }
  };

  const rowInput = (key: keyof typeof rows, label: string) => (
    <label className="practiceSheetRowField">
      <span className="fieldTitle">{label}</span>
      <input
        type="number"
        min={0}
        max={20}
        step={1}
        className="hexInput"
        value={rows[key]}
        onChange={(e) => {
          const n = Math.max(0, Math.min(20, Math.floor(Number(e.target.value) || 0)));
          setRows((r) => ({ ...r, [key]: n }));
        }}
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
            min={directEm ? 5 : 0.5}
            max={directEm ? 150 : 15}
            step={0.5}
            className="hexInput"
            value={directEm ? emMm : nibMm}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              if (directEm) setEmMm(n);
              else setNibMm(n);
            }}
          />
        </label>
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

        <div className="practiceSheetReadout" aria-live="polite">
          Em {em.toFixed(1)} mm · nuqta {nuqta.toFixed(2)} mm · {totalRows} row
          {totalRows === 1 ? "" : "s"}
        </div>

        {notice ? <div className="practiceSheetNotice">{notice}</div> : null}
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
            disabled={busy || empty || totalRows === 0}
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
