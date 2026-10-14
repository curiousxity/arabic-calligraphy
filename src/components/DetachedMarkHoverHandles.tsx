import React, { useRef, useState } from "react";
import { Group, Circle, Rect } from "react-konva";
import type { DetachedMarkPlacement } from "../lib/diacriticPlacement";
import type { DetachedMarkOverride } from "../types";

export const DETACHED_MARK_HANDLE_COLOR = "#a855f7";

export type DetachedMarkHoverHandlesProps = {
  isSelected: boolean;
  /** Armed by the "Move dots & marks" checkbox. */
  enabled: boolean;
  placements: DetachedMarkPlacement[];
  /** px per font unit — offsets are stored in font units. */
  fontScale: number;
  fontSize: number;
  onBeginDrag?: () => void;
  onSet?: (o: DetachedMarkOverride) => void;
};

/**
 * One move handle per detached mark (a dot, hamza or kaf stroke), shown
 * only while that mark is hovered. Translate only: no resize, no hide — a
 * dot's size is the nib, and hiding one changes the word.
 *
 * Hover handlers sit on the per-placement Group, not the hit Rect, for the
 * Konva leave race recorded in .claude/rules/diacritics.md. The drag reads
 * a delta from the handle's rest position, in local px, converts it to
 * font units and adds it to the placement's current offset. Double-click
 * resets the mark to its drawn position.
 */
export const DetachedMarkHoverHandles: React.FC<DetachedMarkHoverHandlesProps> = ({
  isSelected, enabled, placements, fontScale, fontSize, onBeginDrag, onSet,
}) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const startRef = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);

  if (!isSelected || !enabled) return null;
  const margin = fontSize * 0.2;

  return (
    <Group>
      {placements.map((p) => {
        const cx = p.box.x + p.box.width / 2;
        const cy = p.box.y + p.box.height / 2;
        const isHovered = hoveredKey === p.key || draggingKey === p.key;
        const corners = [
          p.toCanvas(p.box.x - margin, p.box.y - margin),
          p.toCanvas(p.box.x + p.box.width + margin, p.box.y - margin),
          p.toCanvas(p.box.x - margin, p.box.y + p.box.height + margin),
          p.toCanvas(p.box.x + p.box.width + margin, p.box.y + p.box.height + margin),
        ];
        const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
        const at = p.toCanvas(cx, cy);
        if (![...xs, ...ys, at.x, at.y].every(Number.isFinite)) return null;
        const write = (local: { x: number; y: number }) => {
          const s = startRef.current;
          if (!s) return;
          onSet?.({
            cluster: p.cluster, glyphId: p.glyphId, mark: p.mark,
            dx: s.dx + (local.x - s.x) / fontScale,
            dy: s.dy + (local.y - s.y) / fontScale,
          });
        };
        return (
          <Group
            key={p.key}
            onMouseEnter={() => setHoveredKey(p.key)}
            onMouseLeave={() => setHoveredKey((v) => (v === p.key ? null : v))}
          >
            <Rect
              name="detached-mark-hit"
              x={Math.min(...xs)} y={Math.min(...ys)}
              width={Math.max(...xs) - Math.min(...xs)} height={Math.max(...ys) - Math.min(...ys)}
              fill="transparent"
            />
            {isHovered && (
              <Circle
                x={at.x} y={at.y} radius={5}
                fill={DETACHED_MARK_HANDLE_COLOR} stroke="#ffffff" strokeWidth={1.5}
                draggable
                onMouseDown={(e) => { e.cancelBubble = true; }}
                onDblClick={(e) => {
                  e.cancelBubble = true;
                  onBeginDrag?.();
                  onSet?.({ cluster: p.cluster, glyphId: p.glyphId, mark: p.mark, dx: 0, dy: 0 });
                }}
                onDragStart={(e) => {
                  e.cancelBubble = true;
                  // The handle rests at (cx, cy) before any move. Konva fires
                  // dragstart a few px in, so reading the position here would
                  // leave every drag lagging by that threshold (the stack
                  // join handle needed the same fix).
                  startRef.current = { x: cx, y: cy, dx: p.dx, dy: p.dy };
                  setDraggingKey(p.key);
                  onBeginDrag?.();
                }}
                onDragMove={(e) => {
                  e.cancelBubble = true;
                  const pos = e.target.position();
                  const local = p.toLocal(pos.x, pos.y);
                  if (Number.isFinite(local.x) && Number.isFinite(local.y)) write(local);
                }}
                onDragEnd={(e) => {
                  e.cancelBubble = true;
                  startRef.current = null;
                  setDraggingKey((v) => (v === p.key ? null : v));
                }}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
};

export default DetachedMarkHoverHandles;
