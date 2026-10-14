import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { GuideShape } from "../types";
import { GUIDE_DEFAULTS, GUIDE_SHAPE_LABELS, guidePathD } from "../lib/guideShapes";
import { parseSvgPath } from "../lib/svgPath";
import { pathBoundingBox } from "../lib/textPath";
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

/**
 * "Add guide": pick the shape of a construction line to place. Portaled to
 * `document.body` like every modal here (the sidebar clips; the stage exports).
 */
export const GuideDialog: React.FC<{
  onPick: (shape: GuideShape) => void;
  onClose: () => void;
}> = ({ onPick, onClose }) => {
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
              A construction line to set text along. It never appears in an export.
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
        </div>
      </div>
    </div>,
    document.body
  );
};

/** The Add-grid button: a dashed circle that opens the shape picker. */
export const AddGuideButton: React.FC<{ onAdd: (shape: GuideShape) => void }> = ({ onAdd }) => {
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
      {open && <GuideDialog onPick={onAdd} onClose={() => setOpen(false)} />}
    </>
  );
};
