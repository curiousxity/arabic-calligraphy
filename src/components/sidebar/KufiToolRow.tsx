import React from "react";
import type { KufiTool } from "../../lib/kufi/kufiPanelBlock";

const TOOLS: Array<{ tool: KufiTool; label: string; title: string }> = [
  { tool: "select", label: "Select", title: "Click a letter to pick it and swap it to its next form that fits" },
  { tool: "stretch", label: "Stretch", title: "Drag a square at a stroke's end to lengthen or shorten it" },
  { tool: "move", label: "Move word", title: "Drag the square on a word's first letter to slide the word along its line" },
  { tool: "paint", label: "Paint", title: "Click or drag over cells to fill or clear them (Alt does this from any tool)" },
];

/**
 * The Kufi panel's canvas tools, one pressed at a time: which handles the
 * canvas shows on the selected panel and what a press there does. See
 * `KufiPanelEditOverlay`.
 */
export const KufiToolRow: React.FC<{ tool: KufiTool; onSetTool: (tool: KufiTool) => void }> = ({ tool, onSetTool }) => (
  <div className="kufiToolRow" role="group" aria-label="Canvas tool">
    {TOOLS.map((t) => (
      <button
        key={t.tool}
        type="button"
        className={`sidebarPillButton${t.tool === tool ? " sidebarPillButton--active" : ""}`}
        aria-pressed={t.tool === tool}
        title={t.title}
        onClick={() => onSetTool(t.tool)}
      >
        {t.label}
      </button>
    ))}
  </div>
);
