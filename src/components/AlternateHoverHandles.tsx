import React, { useRef, useState } from "react";
import { Group, Rect } from "react-konva";
import type { GlyphAlternate } from "../types";
import {
  currentChoice,
  cycleAlternate,
  type AlternateChoice,
  type AlternateOption,
} from "../lib/glyphAlternates";

export type AlternateHitTarget = {
  key: string;
  letter: number;
  /** The letter's ink box in the run's local space. */
  box: { x: number; y: number; width: number; height: number };
  options: AlternateOption[];
};

type Props = {
  isSelected: boolean;
  enabled: boolean;
  targets: AlternateHitTarget[];
  alternates: GlyphAlternate[];
  offsetX: number;
  offsetY: number;
  onPick?: (letter: number, choice: AlternateChoice | null) => void;
};

const OUTLINE_COLOR = "#a855f7";
const PAD = 3;
/** How far a press may drift, in screen px, and still count as a click. */
const CLICK_SLOP = 10;

/**
 * Next Shape on the canvas: a letter that has alternate shapes outlines on
 * hover; click steps to the next shape, Shift-click to the previous.
 *
 * Mounted before the stroke-stretch and diacritic overlays: these rects are
 * letter-sized and Konva routes to the topmost listening shape, so the
 * smaller targets must sit above them. Hover handlers live on the per-letter
 * `Group`, never on the `Rect` — the sibling-hover race recorded in
 * e2e-tests.md.
 */
export const AlternateHoverHandles: React.FC<Props> = ({
  isSelected,
  enabled,
  targets,
  alternates,
  offsetX,
  offsetY,
  onPick,
}) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  /** Where the current press started, so a release can be judged a click. */
  const pressRef = useRef<{ key: string; x: number; y: number } | null>(null);
  if (!isSelected || !enabled) return null;

  return (
    <Group>
      {targets.map((t) => {
        const x = t.box.x + offsetX - PAD;
        const y = t.box.y + offsetY - PAD;
        const width = t.box.width + PAD * 2;
        const height = t.box.height + PAD * 2;
        const pick = (shift: boolean) =>
          onPick?.(
            t.letter,
            cycleAlternate(t.options, currentChoice(alternates, t.letter), shift ? -1 : 1)
          );
        return (
          <Group
            key={t.key}
            onMouseEnter={() => setHoveredKey(t.key)}
            onMouseLeave={() => setHoveredKey((v) => (v === t.key ? null : v))}
          >
            <Rect
              name="alternate-hit"
              x={x}
              y={y}
              width={width}
              height={height}
              fill="transparent"
              // A press on an outlined letter belongs to this tool. Bubbling
              // it would let a click that drifts past Konva's drag threshold
              // start a block drag instead of picking a shape; the block is
              // still draggable by any part that is not an outlined letter.
              onMouseDown={(e) => {
                e.cancelBubble = true;
                pressRef.current = { key: t.key, x: e.evt.clientX, y: e.evt.clientY };
              }}
              onTouchStart={(e) => {
                e.cancelBubble = true;
              }}
              // Picked on release rather than on Konva's `click`, which does
              // not fire once the pointer has moved: a press that drifts a
              // few pixels is still a click.
              onMouseUp={(e) => {
                const press = pressRef.current;
                pressRef.current = null;
                if (!press) return;
                if (Math.hypot(e.evt.clientX - press.x, e.evt.clientY - press.y) > CLICK_SLOP) return;
                // The letter that was *pressed*: neighbouring letters' padded
                // boxes overlap, so a release a few pixels over can land on
                // the next one's rect.
                const pressed = targets.find((x) => x.key === press.key);
                if (!pressed) return;
                e.cancelBubble = true;
                onPick?.(
                  pressed.letter,
                  cycleAlternate(
                    pressed.options,
                    currentChoice(alternates, pressed.letter),
                    e.evt.shiftKey ? -1 : 1
                  )
                );
              }}
              onClick={(e) => {
                e.cancelBubble = true;
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                pick(false);
              }}
              // Stepping through shapes invites quick double clicks; let one
              // reach the block and its edit handler focuses the Content
              // textarea with the whole text selected, so the next keystroke
              // would replace it. The two clicks already cycled the shape.
              onDblClick={(e) => {
                e.cancelBubble = true;
              }}
              onDblTap={(e) => {
                e.cancelBubble = true;
              }}
            />
            {hoveredKey === t.key && (
              <Rect
                name="alternate-outline"
                x={x}
                y={y}
                width={width}
                height={height}
                stroke={OUTLINE_COLOR}
                strokeWidth={1.5}
                dash={[4, 3]}
                cornerRadius={3}
                listening={false}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
};
