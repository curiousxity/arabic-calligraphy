import React, { useMemo } from "react";
import { Group, Circle, Line, Rect } from "react-konva";
import type Konva from "konva";
import { parseSvgPath } from "../lib/svgPath";
import { anchorsToD, dToAnchors, type CurveAnchor } from "../lib/textPath";

export type TextPathEditOverlayProps = {
  id?: string;
  x: number;
  y: number;
  rotation?: number;
  textPathD: string;
  onChange: (d: string) => void;
};

const HANDLE_COLOR = "#38bdf8";
const ANCHOR_COLOR = "#d4af37";
const LINE_COLOR = "rgba(212, 175, 55, 0.6)";

/**
 * The on-canvas pen-tool for editing a text-path block's curve — click
 * empty space to append a new anchor, drag an anchor or its single
 * (mirrored) handle to reshape. Kept separate from TextOnPathText so the
 * renderer's only job is drawing final glyph output.
 */
export const TextPathEditOverlay: React.FC<TextPathEditOverlayProps> = ({
  id,
  x,
  y,
  rotation = 0,
  textPathD,
  onChange,
}) => {
  const anchors = useMemo(
    () => dToAnchors(parseSvgPath(textPathD || "")),
    [textPathD]
  );

  const commit = (next: CurveAnchor[]) => onChange(anchorsToD(next));

  const relativePos = (e: Konva.KonvaEventObject<Event>) => {
    const group = e.target.getParent() as Konva.Group;
    return group.getRelativePointerPosition();
  };

  const handleAddAnchor = (e: Konva.KonvaEventObject<Event>) => {
    e.cancelBubble = true;
    const pos = relativePos(e);
    if (!pos) return;
    commit([...anchors, { x: pos.x, y: pos.y, handleX: pos.x, handleY: pos.y }]);
  };

  return (
    <Group id={id} x={x} y={y} rotation={rotation}>
      <Rect
        x={-2000}
        y={-2000}
        width={4000}
        height={4000}
        fill="transparent"
        onClick={handleAddAnchor}
        onTap={handleAddAnchor}
      />

      {anchors.length > 1 && (
        <Line
          points={anchors.flatMap((a) => [a.x, a.y])}
          stroke={LINE_COLOR}
          strokeWidth={1.5}
          dash={[6, 4]}
          listening={false}
        />
      )}

      {anchors.map((a, i) => (
        <React.Fragment key={i}>
          <Line
            points={[a.x, a.y, a.handleX, a.handleY]}
            stroke={LINE_COLOR}
            strokeWidth={1}
            listening={false}
          />
          <Circle
            x={a.handleX}
            y={a.handleY}
            radius={5}
            fill={HANDLE_COLOR}
            stroke="#ffffff"
            strokeWidth={1.5}
            draggable
            onMouseDown={(e) => {
              e.cancelBubble = true;
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const pos = relativePos(e);
              if (!pos) return;
              commit(
                anchors.map((anchor, idx) =>
                  idx === i ? { ...anchor, handleX: pos.x, handleY: pos.y } : anchor
                )
              );
            }}
          />
          <Circle
            x={a.x}
            y={a.y}
            radius={7}
            fill={ANCHOR_COLOR}
            stroke="#ffffff"
            strokeWidth={2}
            draggable
            onMouseDown={(e) => {
              e.cancelBubble = true;
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const pos = relativePos(e);
              if (!pos) return;
              const dx = pos.x - anchors[i].x;
              const dy = pos.y - anchors[i].y;
              commit(
                anchors.map((anchor, idx) =>
                  idx === i
                    ? {
                        ...anchor,
                        x: pos.x,
                        y: pos.y,
                        handleX: anchor.handleX + dx,
                        handleY: anchor.handleY + dy,
                      }
                    : anchor
                )
              );
            }}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              e.cancelBubble = true;
              if (anchors.length <= 2) return;
              commit(anchors.filter((_, idx) => idx !== i));
            }}
          />
        </React.Fragment>
      ))}
    </Group>
  );
};

export default TextPathEditOverlay;
