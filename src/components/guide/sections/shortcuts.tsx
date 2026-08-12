import type { GuideSection } from "../types";

const SHORTCUTS: [string, string][] = [
  ["Double-click a block", "Jump to its text field"],
  ["Double-click a layer name", "Rename it"],
  ["Double-click a layer row", "Zoom to that block"],
  ["Double-click a slider", "Reset it to its default"],
  ["Arrow keys", "Nudge the selected block (Shift for bigger steps)"],
  ["Delete / Backspace", "Delete the selected block"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
  ["Ctrl+C / Ctrl+V", "Copy / paste the selected block"],
  ["Hold Space, or middle-click drag", "Pan the canvas"],
  ["Ctrl (⌘) + scroll, or pinch", "Zoom the canvas"],
  ["Shift-click or Ctrl-click", "Add a block to the selection"],
  ["Esc", "Close this guide"],
];

export const section: GuideSection = {
  id: "shortcuts",
  title: "Keyboard shortcuts",
  order: 100,
  keywords: [
    "shortcut",
    "keyboard",
    "keys",
    "hotkey",
    "ctrl",
    "command",
    "escape",
    "arrow",
    "space",
    "double-click",
  ],
  Body: () => (
    <>
      <p>
        The same list appears in the <strong>Shortcuts</strong> panel at the
        bottom of the sidebar.
      </p>

      <dl className="guideShortcuts">
        {SHORTCUTS.map(([keys, description]) => (
          <div className="guideShortcutRow" key={keys}>
            <dt className="guideShortcutKeys">{keys}</dt>
            <dd className="guideShortcutDesc">{description}</dd>
          </div>
        ))}
      </dl>

      <p>
        Shortcuts stay out of your way while you are typing: keys pressed
        inside a text field always go to the field, never to the canvas.
      </p>
    </>
  ),
};
