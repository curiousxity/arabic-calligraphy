import React, { useEffect, useRef, useState } from "react";
import { HistoryIcon } from "../Icons";

export type HistoryTimelineEntry = { thumbnail: string; steps: number };

export type HistoryPopoverProps = {
  historyEntries: HistoryTimelineEntry[];
  onJumpTo: (steps: number) => void;
  onCaptureCurrentThumbnail: () => string;
};

const relativeLabel = (steps: number) =>
  steps === -1 ? "1 step back" : `${-steps} steps back`;

/**
 * Popover anchored to a small history-icon button, listing thumbnails for
 * every earlier recorded point (most recent first) plus a live "Current"
 * row at the top. Clicking a thumbnail jumps directly there via
 * `onJumpTo`. Modeled on FontSelectRow's outside-click/Escape-to-close
 * anchored-popover pattern in `sidebar/FormControls.tsx`.
 */
export const HistoryPopover: React.FC<HistoryPopoverProps> = ({
  historyEntries,
  onJumpTo,
  onCaptureCurrentThumbnail,
}) => {
  const [open, setOpen] = useState(false);
  const [currentThumbnail, setCurrentThumbnail] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  const handleToggle = () => {
    setOpen((prevOpen) => {
      const nextOpen = !prevOpen;
      if (nextOpen) setCurrentThumbnail(onCaptureCurrentThumbnail());
      return nextOpen;
    });
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="historyPopoverShell" ref={rootRef}>
      <button
        type="button"
        onClick={handleToggle}
        className="sidebarCircleButton"
        title="History"
        aria-label="History"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <HistoryIcon size={14} />
      </button>

      {open && (
        <div className="historyPopoverList" role="menu" aria-label="Edit history">
          <button type="button" className="historyPopoverItem historyPopoverItem--current" disabled>
            {currentThumbnail ? (
              <img src={currentThumbnail} alt="" className="historyPopoverThumb" />
            ) : (
              <span className="historyPopoverThumbPlaceholder" />
            )}
            <span className="historyPopoverLabel">Current</span>
          </button>

          {historyEntries.map((entry) => (
            <button
              key={entry.steps}
              type="button"
              className="historyPopoverItem"
              title={relativeLabel(entry.steps)}
              onClick={() => {
                onJumpTo(entry.steps);
                setOpen(false);
              }}
            >
              {entry.thumbnail ? (
                <img src={entry.thumbnail} alt="" className="historyPopoverThumb" />
              ) : (
                <span className="historyPopoverThumbPlaceholder" />
              )}
              <span className="historyPopoverLabel">{relativeLabel(entry.steps)}</span>
            </button>
          ))}

          {historyEntries.length === 0 && (
            <div className="historyPopoverEmpty">No earlier steps yet.</div>
          )}
        </div>
      )}
    </div>
  );
};

export default HistoryPopover;
