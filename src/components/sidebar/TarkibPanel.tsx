import type { Block, TarkibBlock } from "../../types";
import { ColorRow, OpacityRow, RangeRow, RotationRow } from "./FormControls";
import { clampStrokeOpacity, STROKE_OPACITY_MIN } from "../../lib/penLayout";
import { makeId } from "./utils";

/**
 * The Tarkib type panel: the phrase, size, colour, rotation, and the stroke
 * opacity that shows the strokes themselves. Typography hides for a tarkib
 * (it is written with the pen, not set in a font), so size and colour live
 * here, as they do for a mark. See .claude/rules/tarkib.md.
 */
export const TarkibPanel: React.FC<{
  block: TarkibBlock;
  onUpdate: (patch: Partial<Block>) => void;
}> = ({ block, onUpdate }) => {
  const id = block.id;
  const strokeOpacity = clampStrokeOpacity(block.strokeOpacity);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p className="guideEmpty" dir="rtl">{block.text}</p>
      <p className="guideEmpty">Written with the pen from the stroke library.</p>
      <RangeRow
        id={makeId("tarkib-size", id)}
        name={makeId("tarkibSize", id)}
        label="Size"
        value={block.fontSize}
        min={8}
        max={600}
        onChange={(v) => onUpdate({ fontSize: v })}
        suffix={`${Math.round(block.fontSize)}px`}
        fieldKey="fontSize"
      />
      <ColorRow
        id={makeId("tarkib-color", id)}
        name={makeId("tarkibColor", id)}
        label="Color"
        value={block.color}
        onChange={(v) => onUpdate({ color: v })}
      />
      <RangeRow
        id={makeId("tarkib-stroke-opacity", id)}
        name={makeId("tarkibStrokeOpacity", id)}
        label="Stroke opacity"
        value={strokeOpacity}
        min={STROKE_OPACITY_MIN}
        max={1}
        step={0.05}
        onChange={(v) => onUpdate({ strokeOpacity: v })}
        suffix={`${Math.round(strokeOpacity * 100)}%`}
      />
      <OpacityRow selectedId={id} value={block.opacity} onChange={(v) => onUpdate({ opacity: v })} />
      <RotationRow selectedId={id} value={block.rotation} onChange={(v) => onUpdate({ rotation: v })} />
    </div>
  );
};
