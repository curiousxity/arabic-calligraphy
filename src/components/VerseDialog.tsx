import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { VerseLayout } from "../types";
import { CloseIcon } from "./Icons";

/**
 * "New verse": type a poem one line per line, choose stacked or bayt, and get
 * one justified text block per line.
 *
 * Portaled to `document.body` for the reason every modal here is — the
 * sidebar is an overflow-hidden scrolling column that would clip it, and
 * nothing that is not artwork may live inside the Konva stage. Reuses the
 * Compositions dialog's classes rather than adding a second modal style.
 */
export const VerseDialog: React.FC<{
  onCreate: (lines: string[], layout: VerseLayout) => void;
  onClose: () => void;
}> = ({ onCreate, onClose }) => {
  const [text, setText] = useState("");
  const [layout, setLayout] = useState<VerseLayout>("stacked");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");

  return createPortal(
    <div
      className="confirmDialogOverlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="nameDesignDialog" role="dialog" aria-modal="true" aria-labelledby="verseDialogTitle">
        <div className="nameDesignHeader">
          <div>
            <div id="verseDialogTitle" className="nameDesignTitle">
              New verse
            </div>
            <div className="nameDesignSubtitle">
              One line of the poem per line. Every line is justified to the same width.
            </div>
          </div>
          <button type="button" className="sidebarCircleButton" onClick={onClose} aria-label="Close new verse">
            <CloseIcon size={14} />
          </button>
        </div>

        <label htmlFor="verse-lines" className="fieldTitle">
          Verse lines
        </label>
        <textarea
          id="verse-lines"
          className="sidebarTextarea"
          dir="rtl"
          lang="ar"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="One line of the poem per line"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />

        <div className="nameDesignOptionRow" role="radiogroup" aria-label="Layout">
          <label>
            <input
              type="radio"
              name="verse-layout"
              checked={layout === "stacked"}
              onChange={() => setLayout("stacked")}
            />{" "}
            Stacked
          </label>
          <label>
            <input
              type="radio"
              name="verse-layout"
              checked={layout === "bayt"}
              onChange={() => setLayout("bayt")}
            />{" "}
            Bayt
          </label>
          <span className="nameDesignHint">
            Bayt sets two half-lines side by side, the first on the right.
          </span>
        </div>

        <div className="nameDesignActions">
          <span className="nameDesignSpacer" />
          <button type="button" className="sidebarSmallAction" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sidebarSmallAction sidebarSmallAction--accent"
            disabled={lines.length === 0}
            onClick={() => {
              onCreate(lines, layout);
              onClose();
            }}
          >
            Create verse
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export const VerseButton: React.FC<{
  onCreate: (lines: string[], layout: VerseLayout) => void;
  disabled?: boolean;
}> = ({ onCreate, disabled }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="sidebarSectionButton"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label="New verse…"
        onClick={() => setOpen(true)}
      >
        <span>New verse…</span>
        <span>Poetry</span>
      </button>
      {open && <VerseDialog onCreate={onCreate} onClose={() => setOpen(false)} />}
    </>
  );
};
