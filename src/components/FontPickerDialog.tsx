import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./Icons";

/** One entry of the font picker's list — value, label, and the CSS family to preview in. */
export type FontChoice = {
  value: string;
  label: string;
  cssFamily: string;
  /** Calligraphic genre (Naskh, Kufi…) — the picker heads a group with it. */
  genre?: string;
  /**
   * No longer offered. Kept in the list so a saved block on it still renders
   * and the trigger can still name it; the gallery shows it only when it is
   * the selected block's current font.
   */
  retired?: boolean;
};

/** Shown when the block has no text yet, so every card still has letters. */
const SAMPLE_FALLBACK = "أبجد";

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

/** Consecutive runs of the same genre, in list order. */
const groupByGenre = (fonts: FontChoice[]) => {
  const groups: { genre: string; fonts: FontChoice[] }[] = [];
  for (const font of fonts) {
    const genre = font.genre ?? "Other";
    const last = groups[groups.length - 1];
    if (last && last.genre === genre) last.fonts.push(font);
    else groups.push({ genre, fonts: [font] });
  }
  return groups;
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
  const activeRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sample = text.trim() || SAMPLE_FALLBACK;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Open on the current font, so the choice starts from where the block is.
  useEffect(() => {
    const active = activeRef.current;
    if (active) {
      active.scrollIntoView({ block: "center" });
      active.focus({ preventScroll: true });
    } else {
      closeRef.current?.focus();
    }
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

        <div className="fontPickerBody" data-testid="font-picker">
          {groupByGenre(fonts.filter((f) => !f.retired || f.value === value)).map((group) => (
            <section key={group.genre} aria-label={group.genre}>
              <h3 className="fontPickerGenre">{group.genre}</h3>
              <div className="fontPickerGrid">
                {group.fonts.map((font) => {
                  const active = font.value === value;
                  return (
                    <button
                      key={font.value}
                      ref={active ? activeRef : undefined}
                      type="button"
                      className={active ? "fontPickerCard fontPickerCard--active" : "fontPickerCard"}
                      data-font-key={font.value}
                      aria-pressed={active}
                      onClick={() => onPick(font.value)}
                    >
                      <span
                        className="fontPickerSample"
                        style={{ fontFamily: font.cssFamily }}
                        dir="rtl"
                        lang="ar"
                      >
                        {sample}
                      </span>
                      <span className="fontPickerLabel">{font.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
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
