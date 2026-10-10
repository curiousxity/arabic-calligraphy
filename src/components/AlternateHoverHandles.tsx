import React, { useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Group, Line, Rect } from "react-konva";
import type { GlyphAlternate } from "../types";
import {
  currentChoice,
  cycleAlternate,
  type AlternateChoice,
  type AlternateOption,
} from "../lib/glyphAlternates";
import {
  hitTestTargets,
  polygonBounds,
  polygonCentre,
  type Point,
} from "../lib/alternateTargets";

export type AlternateHitTarget = {
  /** Unique per instance — a Shape Fill letter appears once per tile. */
  key: string;
  letter: number;
  /** The letter's ink outline in the renderer's group space, in paint order. */
  polygon: Point[];
  options: AlternateOption[];
};

type Props = {
  isSelected: boolean;
  enabled: boolean;
  targets: AlternateHitTarget[];
  alternates: GlyphAlternate[];
  onPick?: (letter: number, choice: AlternateChoice | null) => void;
};

const OUTLINE_COLOR = "#a855f7";
/** How far a press may drift, in screen px, and still count as a click. */
const CLICK_SLOP = 10;
/**
 * A double click is swallowed if either of its presses was on a letter. The
 * first click changes the shape and so moves the outline, so the second
 * press can land in what is now a gap.
 */
const DOUBLE_CLICK_WINDOW_MS = 600;
/** Target centres published for the e2e harness — enough to address any test's letters. */
const MAX_PUBLISHED_CENTRES = 500;

/**
 * Next Shape on the canvas: a letter that has alternate shapes outlines on
 * hover; click steps to the next shape, Shift-click to the previous.
 *
 * **Pointer-resolved.** One transparent listening `Rect` spans every target,
 * and the letter under the pointer is found in arithmetic
 * (`hitTestTargets`), not by Konva. A Shape Fill silhouette can tile ~23,000
 * letters, and one listening node per letter at that count froze the tab
 * when the removed glyph-transform overlay tried it. Two Konva nodes,
 * whatever the count.
 *
 * Only a press **on a target** belongs to this tool: it cancels bubbling (so
 * a drifting click never starts a block drag), and its `click`/`dblclick`
 * are swallowed (a quick double click must not reach the block's edit
 * handler, which focuses the textarea with the whole text selected). A press
 * in a gap bubbles, so the block still drags and selects as usual.
 *
 * Mounted before the stroke-stretch and diacritic overlays, whose targets
 * are smaller and must sit above this one.
 */
export const AlternateHoverHandles: React.FC<Props> = ({
  isSelected,
  enabled,
  targets,
  alternates,
  onPick,
}) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  /** Where the current press started, and on which target. */
  const pressRef = useRef<{ key: string; x: number; y: number } | null>(null);
  /** Whether the latest press landed on a target — decides click. */
  const pressedOnTargetRef = useRef(false);
  /** When a press last landed on a target — decides dblclick. */
  const lastTargetPressRef = useRef(-Infinity);

  const bounds = useMemo(() => polygonBounds(targets.map((t) => t.polygon)), [targets]);
  const centres = useMemo(
    () => targets.slice(0, MAX_PUBLISHED_CENTRES).map((t) => polygonCentre(t.polygon)),
    [targets]
  );

  if (!isSelected || !enabled || !bounds) return null;

  const targetAt = (e: Konva.KonvaEventObject<Event>) => {
    const pos = e.target.getParent()?.getRelativePointerPosition();
    return pos ? hitTestTargets(targets, pos) : null;
  };
  const cycle = (t: AlternateHitTarget, shift: boolean) =>
    onPick?.(t.letter, cycleAlternate(t.options, currentChoice(alternates, t.letter), shift ? -1 : 1));
  const hovered = hoveredKey === null ? null : targets.find((t) => t.key === hoveredKey) ?? null;

  return (
    <Group>
      <Rect
        name="alternate-hit"
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        fill="transparent"
        onMouseMove={(e) => setHoveredKey(targetAt(e)?.key ?? null)}
        onMouseLeave={() => setHoveredKey(null)}
        onMouseDown={(e) => {
          const t = targetAt(e);
          pressedOnTargetRef.current = t !== null;
          pressRef.current = t ? { key: t.key, x: e.evt.clientX, y: e.evt.clientY } : null;
          if (t) {
            e.cancelBubble = true;
            lastTargetPressRef.current = performance.now();
          }
        }}
        onTouchStart={(e) => {
          const t = targetAt(e);
          pressedOnTargetRef.current = t !== null;
          if (t) {
            e.cancelBubble = true;
            lastTargetPressRef.current = performance.now();
          }
        }}
        // Picked on release rather than on Konva's `click`, which does not
        // fire once the pointer has moved: a press that drifts a few pixels
        // is still a click. The *pressed* letter wins, since a release a
        // few pixels over can land on a neighbour.
        onMouseUp={(e) => {
          const press = pressRef.current;
          pressRef.current = null;
          if (!press) return;
          if (Math.hypot(e.evt.clientX - press.x, e.evt.clientY - press.y) > CLICK_SLOP) return;
          const pressed = targets.find((t) => t.key === press.key);
          if (!pressed) return;
          e.cancelBubble = true;
          cycle(pressed, e.evt.shiftKey);
        }}
        onClick={(e) => {
          if (pressedOnTargetRef.current) e.cancelBubble = true;
        }}
        onTap={(e) => {
          const t = targetAt(e);
          if (!t) return;
          e.cancelBubble = true;
          cycle(t, false);
        }}
        onDblClick={(e) => {
          if (performance.now() - lastTargetPressRef.current < DOUBLE_CLICK_WINDOW_MS) e.cancelBubble = true;
        }}
        onDblTap={(e) => {
          if (performance.now() - lastTargetPressRef.current < DOUBLE_CLICK_WINDOW_MS) e.cancelBubble = true;
        }}
      />
      {hovered && (
        <Line
          name="alternate-outline"
          points={hovered.polygon.flatMap((p) => [p.x, p.y])}
          closed
          stroke={OUTLINE_COLOR}
          strokeWidth={1.5}
          dash={[4, 3]}
          listening={false}
        />
      )}
      {/* Read-only scene data for the e2e harness (`alternateTargetCenters`):
          with one hit node there is no per-letter node a test could find. */}
      <Group name="alternate-targets" listening={false} centers={centres} count={targets.length} />
    </Group>
  );
};
