import { Group, Path } from "react-konva";
import type Konva from "konva";
import { EXPORT_HIDDEN } from "../lib/exportChrome";

/**
 * A guide: a dashed construction line. Named EXPORT_HIDDEN so every export
 * path skips it; a wide transparent hit stroke makes a 1px line clickable.
 * Drawn at `1 / stageScale` so it stays a hairline at any zoom, the same
 * idiom the ruler guides use. See .claude/rules/guides.md.
 */
export const GuideView: React.FC<{
  id: string;
  x: number;
  y: number;
  rotation?: number;
  d: string;
  stageScale: number;
  selected: boolean;
  draggable: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDblTap?: (e: Konva.KonvaEventObject<TouchEvent>) => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
}> = ({ id, x, y, rotation = 0, d, stageScale, selected, ...handlers }) => (
  <Group id={id} name={EXPORT_HIDDEN} x={x} y={y} rotation={rotation} {...handlers}>
    <Path
      data={d}
      stroke={selected ? "#d4af37" : "#00b4d8"}
      strokeWidth={(selected ? 2 : 1) / stageScale}
      dash={[6 / stageScale, 4 / stageScale]}
      hitStrokeWidth={14 / stageScale}
      // Only the line itself is hittable: a closed path would otherwise
      // claim its whole interior, stealing clicks from what sits inside it.
      fillEnabled={false}
      opacity={0.85}
    />
  </Group>
);

export default GuideView;
