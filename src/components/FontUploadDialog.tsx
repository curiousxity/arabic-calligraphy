import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { inspectFontFile, type CustomFont } from "../lib/customFonts";
import { CloseIcon, UploadIcon } from "./Icons";

export type FontUploadDialogProps = {
  /** Stores the font. Resolves to `{ error }` rather than throwing, like the export handlers. */
  onAdd?: (file: File, label?: string) => Promise<CustomFont | { error: string }>;
  onClose: () => void;
};

/**
 * Upload your own font.
 *
 * Portaled to `document.body` for the same reason `OrnamentPicker` and
 * `GuideDrawer` are: the sidebar is an overflow-hidden scrolling column that
 * would clip a modal, and nothing that is not artwork may live inside the
 * Konva stage or it risks being baked into an export.
 *
 * The file is parsed on selection rather than on submit, so a file this app
 * cannot shape is rejected before the user names it, and the label field can
 * be prefilled from the font's own `name` table.
 */
export const FontUploadDialog: React.FC<FontUploadDialogProps> = ({ onAdd, onClose }) => {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const chooseFile = async (chosen: File | null) => {
    setFile(null);
    setLabel("");
    setError(null);
    if (!chosen) return;

    const inspected = await inspectFontFile(chosen);
    if ("error" in inspected) {
      setError(inspected.error);
      return;
    }
    setFile(chosen);
    setLabel(inspected.label);
  };

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    const result = await onAdd?.(file, label);
    setBusy(false);
    if (result && "error" in result) {
      setError(result.error);
      return;
    }
    onClose();
  };

  return createPortal(
    <div
      className="confirmDialogOverlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="confirmDialog fontUploadDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fontUploadTitle"
      >
        <div className="fontUploadHeader">
          <div id="fontUploadTitle" className="confirmDialogTitle">
            Upload a font
          </div>
          <button
            ref={closeRef}
            type="button"
            className="sidebarCircleButton"
            onClick={onClose}
            aria-label="Close upload a font"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="confirmDialogMessage">
          Add your own Arabic font from this computer. It stays in this browser
          — it is never uploaded anywhere.
        </div>

        <label className="fontUploadField">
          <span className="fieldTitle">Font file (.ttf or .otf)</span>
          <input
            type="file"
            accept=".ttf,.otf,font/ttf,font/otf"
            className="fontUploadFileInput"
            onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {file && (
          <label className="fontUploadField">
            <span className="fieldTitle">Name it in the font list</span>
            <input
              type="text"
              className="templateWizardInput fontUploadLabelInput"
              dir="auto"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
        )}

        {error && (
          <div className="fontUploadError" role="alert">
            {error}
          </div>
        )}

        {/* Both caveats are real and neither is engineered around, so they are
            printed where the decision is made rather than buried in the guide. */}
        <ul className="fontUploadCaveats">
          <li>
            The <strong>Presets</strong> symbols (ﷺ and the rest) are custom
            glyphs that only exist in the fonts that ship with this app. In an
            uploaded font they will show as empty boxes.
          </li>
          <li>
            Make sure you have the right to use the font. Uploaded fonts stay
            in this browser only — they are not saved into your projects, and
            other people opening a shared project will not have them.
          </li>
        </ul>

        <div className="confirmDialogActions">
          <button type="button" className="sidebarSmallAction" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sidebarSmallAction sidebarSmallAction--accent"
            disabled={!file || busy}
            onClick={() => void submit()}
          >
            {busy ? "Adding…" : "Add font"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export type FontUploadButtonProps = Omit<FontUploadDialogProps, "onClose">;

/**
 * Launcher + dialog as one element, so the mount site needs no open/closed
 * state — the `OrnamentPickerButton` / `GuideLauncher` shape, and for the
 * same reason: opening a dialog is not an edit and must never reach
 * `App.tsx`'s state, the undo stack, or a saved layout.
 */
export const FontUploadButton: React.FC<FontUploadButtonProps> = ({ onAdd }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="sidebarSmallAction fontUploadOpen"
        onClick={() => setOpen(true)}
      >
        <UploadIcon size={13} /> Upload a font…
      </button>

      {open && <FontUploadDialog onAdd={onAdd} onClose={() => setOpen(false)} />}
    </>
  );
};

export default FontUploadDialog;
