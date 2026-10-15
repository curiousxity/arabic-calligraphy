import type { StackBlock } from "../../types";
import { CheckboxRow, RangeRow, SelectRow } from "./FormControls";

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
  /** The closed guides on the canvas the letters can be arranged inside. */
  closedGuides?: { id: number; label: string }[];
  onArrangeInGuide?: (guideId: number) => void;
}> = ({ block, onUpdate, onReset, moveTogether, onMoveTogether, closedGuides = [], onArrangeInGuide }) => (
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
    {onArrangeInGuide && closedGuides.length > 0 ? (
      <SelectRow
        id={`stack-${block.id}-fill-guide`}
        name="stackFillGuide"
        label="Fill a guide shape"
        value=""
        onChange={(v) => {
          if (v !== "") onArrangeInGuide(Number(v));
        }}
      >
        <option value="">Choose a guide…</option>
        {closedGuides.map((g) => (
          <option key={g.id} value={String(g.id)}>
            {g.label}
          </option>
        ))}
      </SelectRow>
    ) : (
      <p className="guideEmpty">
        To arrange the letters inside a shape, add a closed guide (a teardrop, an almond, or an
        uploaded SVG outline), then choose it here.
      </p>
    )}
    <p className="guideEmpty">
      Filling a guide lays the letters in rows from the bottom up, in reading order, and sizes the
      composition to the shape. You can still drag, tilt and bend afterwards.
    </p>
    <button type="button" className="sidebarSmallAction" aria-label="Reset layout" onClick={onReset}>
      Reset layout
    </button>
  </div>
);
