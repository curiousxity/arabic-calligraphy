import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "../Icons";
import { guideSections, filterGuideSections } from "./registry";

export type GuideDrawerProps = {
  /** Rendered only while true — mounting is what arms the focus trap-lite. */
  open: boolean;
  onClose: () => void;
  /** Matches App.tsx's own breakpoint; collapses the two panes into one column. */
  isMobile: boolean;
};

/**
 * The in-app user guide: a right-side slide-over listing every section the
 * registry found, with a filter over titles and keywords.
 *
 * Portalled to `document.body` for the same reason `MorphGlyphEditor` is —
 * the sidebar is a scrolling, overflow-hidden column, and a slide-over that
 * lives inside it gets clipped. It is deliberately plain DOM and never part
 * of the Konva stage, so it cannot leak into an export.
 *
 * Open/closed state belongs to the caller and is intentionally *not* app
 * state: reading the guide is not an edit, so it must not enter undo history
 * or a saved project.
 */
export const GuideDrawer: React.FC<GuideDrawerProps> = ({
  open,
  onClose,
  isMobile,
}) => {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(
    () => filterGuideSections(guideSections, query),
    [query]
  );

  // The filter can hide whatever was selected, so the active section is
  // derived rather than stored — falling back to the first visible one keeps
  // the body pane in step with the list without a second state update.
  const active = filtered.find((s) => s.id === selectedId) ?? filtered[0] ?? null;

  // Focus moves into the drawer on open and back to whatever opened it (the
  // "?" button) on close. Capturing the element at mount rather than taking a
  // ref keeps the drawer independent of where it is mounted from.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Switching sections should start the reader at the top of the new page,
  // not wherever the previous one was scrolled to.
  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [active?.id]);

  if (!open) return null;

  const Body = active?.Body;

  return createPortal(
    <div
      className="guideBackdrop"
      // Deliberately `click`, not `pointerdown`: a press on the backdrop moves
      // focus to the body as its default action, and closing on the earlier
      // event lets that land *after* the drawer has restored focus to the "?"
      // button, leaving focus nowhere.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className={isMobile ? "guideDrawer guideDrawer--mobile" : "guideDrawer"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guideDrawerTitle"
      >
        <header className="guideDrawerHeader">
          <h2 className="guideDrawerTitle" id="guideDrawerTitle">
            User Guide
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="layerIconBtn"
            title="Close the guide"
            aria-label="Close the guide"
          >
            <CloseIcon size={14} />
          </button>
        </header>

        <div className="guideDrawerSearch">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the guide…"
            aria-label="Search the guide"
            className="hexInput"
            style={{ fontFamily: "inherit", letterSpacing: 0, width: "100%" }}
          />
        </div>

        <div
          className={
            isMobile ? "guideDrawerBody guideDrawerBody--mobile" : "guideDrawerBody"
          }
        >
          <nav className="guideSectionList" aria-label="Guide sections">
            {filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                aria-current={active?.id === s.id}
                className={
                  active?.id === s.id
                    ? "guideSectionListItem guideSectionListItem--active"
                    : "guideSectionListItem"
                }
              >
                {s.title}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="guideEmpty">Nothing matches “{query.trim()}”.</div>
            )}
          </nav>

          <div className="guidePane" ref={paneRef}>
            {Body && active ? (
              <>
                <h3 className="guidePaneTitle">{active.title}</h3>
                <Body />
              </>
            ) : (
              <p className="guideEmpty">
                Try a different word — the guide also matches on related terms,
                so “tashkeel” finds the page on marks.
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>,
    document.body
  );
};

export default GuideDrawer;
