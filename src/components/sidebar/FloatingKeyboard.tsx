import { createPortal } from "react-dom";
import { ArabicKeyboard } from "./ArabicKeyboard";

/**
 * Renders the Arabic keyboard as a fixed-position overlay (portaled to
 * document.body) instead of inline in the sidebar's scrollable accordion.
 * Keeps it on screen even when focusing the block-text textarea scrolls
 * the sidebar's own scroll container to bring the textarea into view.
 */
export const FloatingArabicKeyboard = ({
  open,
  onClose,
  onInsert,
  onBackspace,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (value: string) => void;
  onBackspace: () => void;
}) => {
  if (!open) return null;

  return createPortal(
    <div className="floatingKeyboard" role="dialog" aria-label="Arabic keyboard">
      <div className="floatingKeyboardHeader">
        <span>Arabic Keyboard</span>
        <button
          type="button"
          onClick={onClose}
          className="layerIconBtn"
          aria-label="Close keyboard"
          title="Close keyboard"
        >
          ✕
        </button>
      </div>
      <ArabicKeyboard onInsert={onInsert} onBackspace={onBackspace} />
    </div>,
    document.body
  );
};
