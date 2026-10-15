import type { StackBlock } from "../../types";
import { CheckboxRow, RangeRow } from "./FormControls";

/**
 * The Stack type panel: the baked spelling (read-only), how a drag on the
 * canvas is read, the join thickness floor, and Reset layout. The editing
 * itself has no modes — every gesture is a drag on the ink (see
 * StackEditOverlay) — so this panel only explains them.
 */
export const StackPanel: React.FC<{
  block: StackBlock;
  onUpdate: (patch: Partial<StackBlock>) => void;
  onReset: () => void;
  moveTogether: boolean;
  onMoveTogether: (v: boolean) => void;
}> = ({ block, onUpdate, onReset, moveTogether, onMoveTogether }) => (
  <div className="sectionPanel">
    <p className="guideEmpty" dir="rtl">{block.source.text}</p>
    <p className="guideEmpty">
      Baked from {block.source.fontFamily}. The spelling cannot be edited here — undo the
      conversion, or convert a fresh text block.
    </p>
    <p className="guideEmpty">
      Drag a letter to move it. Drag just outside its edge to tilt it. Drag a curve to bend
      it, double-click to straighten. Press near the end of a straight stroke and pull to
      draw out a tail.
    </p>
    <CheckboxRow
      id={`stack-${block.id}-together`}
      label="Move letters together"
      checked={moveTogether}
      onChange={onMoveTogether}
    />
    <RangeRow
      id={`stack-${block.id}-minFraction`}
      name="stackMinFraction"
      label="Join thickness"
      value={block.nib.minFraction}
      min={0.05}
      max={1}
      step={0.01}
      // A fraction of each join's own thinner face; per-font defaults reach 1.
      suffix={block.nib.minFraction.toFixed(2)}
      onChange={(v) => onUpdate({ nib: { ...block.nib, minFraction: v } })}
    />
    <button type="button" className="sidebarSmallAction" aria-label="Reset layout" onClick={onReset}>
      Reset layout
    </button>
  </div>
);
