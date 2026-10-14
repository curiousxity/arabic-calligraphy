import type { StackBlock } from "../../types";
import { CheckboxRow, RangeRow } from "./FormControls";

/**
 * The Stack type panel: the baked spelling (read-only), the split-strokes
 * toggle, the nib's thinnest-stroke floor, and Reset layout.
 */
export const StackPanel: React.FC<{
  block: StackBlock;
  onUpdate: (patch: Partial<StackBlock>) => void;
  onReset: () => void;
}> = ({ block, onUpdate, onReset }) => (
  <div className="sectionPanel">
    <p className="guideEmpty" dir="rtl">{block.source.text}</p>
    <p className="guideEmpty">
      Baked from {block.source.fontFamily}. The spelling cannot be edited here — undo the
      conversion, or convert a fresh text block.
    </p>
    <CheckboxRow
      id={`stack-${block.id}-tail`}
      label="Split strokes"
      checked={block.stackTailMode ?? false}
      onChange={(checked) => onUpdate({ stackTailMode: checked })}
    />
    <RangeRow
      id={`stack-${block.id}-minFraction`}
      name="stackMinFraction"
      label="Thinnest stroke"
      value={block.nib.minFraction}
      min={0.05}
      max={0.5}
      step={0.01}
      onChange={(v) => onUpdate({ nib: { ...block.nib, minFraction: v } })}
    />
    <button type="button" className="sidebarSmallAction" aria-label="Reset layout" onClick={onReset}>
      Reset layout
    </button>
  </div>
);
