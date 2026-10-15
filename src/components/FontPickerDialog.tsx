import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./Icons";
import { SAMPLE_FALLBACK, visibleFonts, type FontChoice } from "../lib/fontCatalog";
import { FontGallery } from "./FontGallery";

export type FontPickerDialogProps = {
  /** The block's current text — what every card previews. */
  text: string;
  /** The block's current font, highlighted and scrolled into view on open. */
  value: string;
  /** Built-ins plus uploads, ordered by genre. */
  fonts: FontChoice[];
  onPick: (value: string) => void;
  onClose: () => void;
};

/**
 * The font picker: the selected block's own text written in every font,
 * under genre headings. One click applies the font and closes.
 *
 * **Previews are CSS, not canvas.** Every bundled font has an `@font-face`
 * rule and an uploaded one gets a `FontFace` from its own bytes, and the
 * browser shapes Arabic natively, so a gallery of every style costs no
 * HarfBuzz shaping and no rasterization. It is a picker, not a proof: the
 * canvas remains what the result is judged on.
 *
 * Portaled to `document.body` for the reason every modal here is — the
 * sidebar is an overflow-hidden scrolling column that would clip it, and
 * nothing that is not artwork may live inside the Konva stage.
 */
export const FontPickerDialog: React.FC<FontPickerDialogProps> = ({
  text,
  value,
  fonts,
  onPick,
  onClose,
}) => {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // The gallery focuses the current font's card; with no such card (an upload
  // missing from this browser) focus falls back to the close button.
  useEffect(() => {
    if (!fonts.some((f) => f.value === value)) closeRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      className="confirmDialogOverlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="nameDesignDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fontPickerDialogTitle"
      >
        <div className="nameDesignHeader">
          <div>
            <div id="fontPickerDialogTitle" className="nameDesignTitle">
              Choose a font
            </div>
            <div className="nameDesignSubtitle">Your text in every calligraphic style.</div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="sidebarCircleButton"
            onClick={onClose}
            aria-label="Close font picker"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <FontGallery text={text} value={value} fonts={visibleFonts(fonts, value)} onPick={onPick} />
      </div>
    </div>,
    document.body
  );
};

export type FontPickerFieldProps = Omit<FontPickerDialogProps, "onPick" | "onClose"> & {
  id: string;
  label: string;
  onChange: (value: string) => void;
};

/**
 * The Typography panel's font row: the current font's name, drawn in that
 * font, as a button that opens the picker. Open state stays local, so
 * browsing never reaches `App.tsx`, the undo stack, or a saved layout — only
 * an actual change does, and picking the font the block already has is not
 * one.
 */
export const FontPickerField: React.FC<FontPickerFieldProps> = ({
  id,
  label,
  onChange,
  ...dialogProps
}) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { value, fonts } = dialogProps;
  // A dialog hands focus back to what opened it; without this a keyboard
  // user lands on <body> after every pick and loses their place.
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  // A key the list does not know (an uploaded font missing from this
  // browser) shows the key itself rather than some other family's name.
  const current = fonts.find((f) => f.value === value);

  return (
    <div className="field">
      <span className="fieldTitle" id={`${id}-label`}>
        {label}
      </span>
      <div className="shell fontPickerShell">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          className="select fontPickerTrigger"
          style={{ fontFamily: current?.cssFamily }}
          aria-haspopup="dialog"
          aria-labelledby={`${id}-label ${id}`}
          onClick={() => setOpen(true)}
        >
          <span className="fontPickerTriggerLabel">
            {current?.label ?? value} — {SAMPLE_FALLBACK}
          </span>
          <span className="fontPickerTriggerHint" aria-hidden="true">
            ▸
          </span>
        </button>
      </div>
      {open && (
        <FontPickerDialog
          {...dialogProps}
          onPick={(next) => {
            if (next !== value) onChange(next);
            close();
          }}
          onClose={close}
        />
      )}
    </div>
  );
};
