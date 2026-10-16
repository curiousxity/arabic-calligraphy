import type { Block, MarkBlock } from "../../types";
import { CheckboxRow, ColorRow, OpacityRow, RangeRow, RotationRow } from "./FormControls";
import { MarkPicker } from "./MarkPicker";
import { makeId } from "./utils";

/**
 * The Mark type panel: size, colour, rotation, flip, and the library to swap
 * the shape. Typography hides for a mark (nothing in it but size and colour
 * applies), so those two rows live here, as Rotation does for a guide.
 * See .claude/rules/marks.md.
 */
export const MarkPanel: React.FC<{
  block: MarkBlock;
  onUpdate: (patch: Partial<Block>) => void;
}> = ({ block, onUpdate }) => {
  const id = block.id;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <RangeRow
        id={makeId("mark-size", id)}
        name={makeId("markSize", id)}
        label="Size"
        value={block.fontSize}
        min={8}
        max={600}
        onChange={(v) => onUpdate({ fontSize: v })}
        suffix={`${Math.round(block.fontSize)}px`}
        fieldKey="fontSize"
      />
      <ColorRow
        id={makeId("mark-color", id)}
        name={makeId("markColor", id)}
        label="Color"
        value={block.color}
        onChange={(v) => onUpdate({ color: v })}
      />
      <OpacityRow selectedId={id} value={block.opacity} onChange={(v) => onUpdate({ opacity: v })} />
      <RotationRow selectedId={id} value={block.rotation} onChange={(v) => onUpdate({ rotation: v })} />
      <CheckboxRow
        id={makeId("mark-flip", id)}
        label="Flip left–right"
        checked={block.markFlipX ?? false}
        onChange={(v) => onUpdate({ markFlipX: v })}
      />
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Change shape</div>
      <MarkPicker
        currentId={block.markId}
        onPick={(it) => onUpdate({ markId: it.id, markD: it.d } as Partial<Block>)}
      />
    </div>
  );
};
