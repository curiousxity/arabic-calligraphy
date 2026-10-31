import React, { useLayoutEffect, useRef } from "react";
import { Group, Rect, Text } from "react-konva";
import type Konva from "konva";
import { EXPORT_HIDDEN } from "../lib/exportChrome";
import { kufiSizeLabel, type KufiPanelStatus } from "../lib/kufi/kufiPanelStatus";

type Size = { cols: number; rows: number };

const TYPE = 13;
const BUTTON_H = 26;
const BUTTON_GAP = 6;
const MAX_TEXT_W = 260;

/**
 * What a panel draws when its text does not fit the box (or has not been
 * arranged yet): a dashed frame at the box's size, the status line centred,
 * and, on the selected panel, `Fit` and each suggested size as buttons.
 * Editor chrome only: the whole group is `EXPORT_HIDDEN`, so an unpacked panel
 * still exports no ink. The text and buttons are drawn at the inverse of the
 * stage's zoom (13 px type at any zoom); the frame is in panel px.
 */
export const KufiUnfitFrame: React.FC<{
  width: number;
  height: number;
  color: string;
  status: KufiPanelStatus;
  onFit?: () => void;
  onSetSize?: (s: Size) => void;
}> = ({ width, height, color, status, onFit, onSetSize }) => {
  const ui = useRef<Konva.Group>(null);
  const textRef = useRef<Konva.Text>(null);
  // Drawn at the inverse of the stage's zoom, so known only once mounted.
  useLayoutEffect(() => {
    const g = ui.current;
    const k = g?.getParent()?.getAbsoluteScale().x || 1;
    if (!g) return;
    g.scale({ x: 1 / k, y: 1 / k });
    const t = textRef.current;
    if (t) {
      const w = Math.max(60, Math.min(MAX_TEXT_W, width * k - 16));
      t.width(w);
      t.x(-w / 2);
    }
    g.getLayer()?.batchDraw();
  });

  const labels: { label: string; act: () => void; name: string }[] = [];
  if (onFit) labels.push({ label: "Fit", act: onFit, name: "kufi-unfit-fit" });
  if (onSetSize) {
    for (const s of status.suggestions) labels.push({ label: kufiSizeLabel(s), act: () => onSetSize(s), name: "kufi-unfit-size" });
  }
  const buttonW = (l: string) => Math.max(44, l.length * 9 + 18);
  const total = labels.reduce((n, b) => n + buttonW(b.label), 0) + BUTTON_GAP * Math.max(0, labels.length - 1);
  let bx = -total / 2;

  const stop = (e: Konva.KonvaEventObject<Event>) => {
    e.cancelBubble = true;
  };

  return (
    <Group name={EXPORT_HIDDEN} listening={labels.length > 0}>
      <Rect
        name="kufi-unfit-frame"
        width={width}
        height={height}
        stroke={color}
        opacity={0.4}
        strokeWidth={2}
        strokeScaleEnabled={false}
        dash={[8, 6]}
        listening={false}
      />
      <Group ref={ui} x={width / 2} y={height / 2}>
        <Text
          ref={textRef}
          name="kufi-unfit-text"
          x={-MAX_TEXT_W / 2}
          y={labels.length > 0 ? -44 : -TYPE}
          width={MAX_TEXT_W}
          height={labels.length > 0 ? 38 : TYPE * 2}
          verticalAlign={labels.length > 0 ? "bottom" : "top"}
          align="center"
          text={status.text}
          fontSize={TYPE}
          fill={color}
          listening={false}
        />
        {labels.map((b) => {
          const w = buttonW(b.label);
          const x = bx;
          bx += w + BUTTON_GAP;
          return (
            <Group
              key={b.name + b.label}
              name={b.name}
              x={x}
              y={0}
              onMouseDown={stop}
              onTouchStart={stop}
              onClick={(e) => {
                stop(e);
                b.act();
              }}
              onTap={(e) => {
                stop(e);
                b.act();
              }}
              onMouseEnter={(e) => {
                const c = e.target.getStage()?.container();
                if (c) c.style.cursor = "pointer";
              }}
              onMouseLeave={(e) => {
                const c = e.target.getStage()?.container();
                if (c) c.style.cursor = "";
              }}
            >
              <Rect width={w} height={BUTTON_H} cornerRadius={4} fill="#ffffff" stroke={color} strokeWidth={1.5} />
              <Text
                width={w}
                height={BUTTON_H}
                align="center"
                verticalAlign="middle"
                text={b.label}
                fontSize={TYPE}
                fill="#1a1a1a"
                listening={false}
              />
            </Group>
          );
        })}
      </Group>
    </Group>
  );
};
