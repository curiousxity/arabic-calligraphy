import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { GuideShape } from "../types";
import { GUIDE_DEFAULTS, GUIDE_SHAPE_LABELS, guidePathD } from "../lib/guideShapes";
import { parseSvgPath } from "../lib/svgPath";
import { pathBoundingBox } from "../lib/textPath";
import { extractSvgPaths } from "../lib/svgImport";
import { CloseIcon } from "./Icons";

const SHAPES: GuideShape[] = ["circle", "ellipse", "arc", "wave", "line", "pen", "teardrop", "almond"];

/** A small dashed preview of a shape, drawn from the same path the guide gets. */
const ShapePreview: React.FC<{ shape: GuideShape }> = ({ shape }) => {
  const { d, viewBox } = useMemo(() => {
    const path = guidePathD(shape, GUIDE_DEFAULTS[shape]);
    const b = pathBoundingBox(parseSvgPath(path));
    const pad = Math.max(b.width, b.height) * 0.08;
    return { d: path, viewBox: `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}` };
  }, [shape]);
  return (
    <svg width={56} height={40} viewBox={viewBox} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2%" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

/** The uploaded outline, read the way Shape Fill reads its SVG but kept at
 *  its own proportions: a guide is the user's shape, not a tile to stretch. */
function pickSvgFile(onLoaded: (pathData: string) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".svg,image/svg+xml";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = extractSvgPaths(e.target?.result as string, 400, true);
      if (!result) {
        alert("No supported shape elements found in SVG (path, rect, circle, ellipse, polygon, polyline).");
        return;
      }
      onLoaded(result.pathData);
    };
    reader.readAsText(file);
  };
  input.click();
}

/**
 * "Add guide": pick the shape of a construction line to place, or upload an
 * SVG outline of your own. Portaled to `document.body` like every modal here
 * (the sidebar clips; the stage exports).
 */
export const GuideDialog: React.FC<{
  onPick: (shape: GuideShape) => void;
  /** An uploaded outline, as `extractSvgPaths` gives it (one `d`, aspect kept). */
  onPickSvg?: (pathData: string) => void;
  onClose: () => void;
}> = ({ onPick, onPickSvg, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="confirmDialogOverlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="nameDesignDialog" role="dialog" aria-modal="true" aria-labelledby="guideDialogTitle">
        <div className="nameDesignHeader">
          <div>
            <div id="guideDialogTitle" className="nameDesignTitle">
              Add guide
            </div>
            <div className="nameDesignSubtitle">
              A construction line to set text along, or a shape to arrange a stacked composition
              inside. It never appears in an export.
            </div>
          </div>
          <button type="button" className="sidebarCircleButton" onClick={onClose} aria-label="Close add guide">
            <CloseIcon size={14} />
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {SHAPES.map((s) => (
            <button
              key={s}
              type="button"
              className="sidebarSmallAction"
              aria-label={`${GUIDE_SHAPE_LABELS[s]} guide`}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}
              onClick={() => {
                onPick(s);
                onClose();
              }}
            >
              <ShapePreview shape={s} />
              <span>{GUIDE_SHAPE_LABELS[s]}</span>
            </button>
          ))}
          {onPickSvg && (
            <button
              type="button"
              className="sidebarSmallAction"
              aria-label="Upload SVG guide"
              title="Use an outline of your own from an SVG file…"
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}
              onClick={() =>
                pickSvgFile((pathData) => {
                  onPickSvg(pathData);
                  onClose();
                })
              }
            >
              <svg width={56} height={40} viewBox="0 0 56 40" aria-hidden="true">
                <path
                  d="M 12 30 L 28 6 L 44 30 Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
                <path d="M 28 36 V 22 M 23 27 L 28 22 L 33 27" fill="none" stroke="currentColor" strokeWidth={1.5} />
              </svg>
              <span>Upload SVG</span>
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

/** The Add-grid button: a dashed circle that opens the shape picker. */
export const AddGuideButton: React.FC<{
  onAdd: (shape: GuideShape) => void;
  onAddSvg?: (pathData: string) => void;
}> = ({ onAdd, onAddSvg }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="sidebarCircleButton"
        aria-label="Add guide"
        aria-haspopup="dialog"
        title="Add a guide shape…"
        onClick={() => setOpen(true)}
      >
        <svg width={15} height={15} viewBox="0 0 16 16" aria-hidden="true">
          <circle cx={8} cy={8} r={6} fill="none" stroke="currentColor" strokeWidth={1.3} strokeDasharray="2.4 1.8" />
        </svg>
      </button>
      {open && <GuideDialog onPick={onAdd} onPickSvg={onAddSvg} onClose={() => setOpen(false)} />}
    </>
  );
};
