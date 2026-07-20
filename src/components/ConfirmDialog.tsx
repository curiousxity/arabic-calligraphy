import { useEffect } from "react";
import { createPortal } from "react-dom";

export type ConfirmDialogRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
};

/**
 * Portaled confirmation modal for actions that can't be undone with Ctrl+Z
 * (or that are easy to trigger by accident and expensive to redo by hand) —
 * see App.tsx's requestDeleteNamedProject / requestApplyStarterTemplate.
 * Not used for ordinary block/layer delete, which stays a single click
 * since it's a frequent, undo-covered action; those just get danger styling.
 */
export const ConfirmDialog: React.FC<{
  request: ConfirmDialogRequest | null;
  onCancel: () => void;
}> = ({ request, onCancel }) => {
  useEffect(() => {
    if (!request) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [request, onCancel]);

  if (!request) return null;

  return createPortal(
    <div
      className="confirmDialogOverlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="confirmDialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmDialogTitle"
        aria-describedby="confirmDialogMessage"
      >
        <div id="confirmDialogTitle" className="confirmDialogTitle">
          {request.title}
        </div>
        <div id="confirmDialogMessage" className="confirmDialogMessage">
          {request.message}
        </div>
        <div className="confirmDialogActions">
          <button type="button" className="sidebarSmallAction" onClick={onCancel}>
            {request.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className="sidebarSmallAction sidebarSmallAction--danger"
            autoFocus
            onClick={() => {
              request.onConfirm();
            }}
          >
            {request.confirmLabel ?? "Delete"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
