import React from "react";
import { Group, Shape } from "react-konva";
import type Konva from "konva";

type Props = {
  text: string;
  x: number;  // center
  y: number;  // center
  radius: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  startAngle?: number; // degrees
  endAngle?: number;   // degrees
  direction?: "clockwise" | "counterclockwise";
  arcPosition?: "top" | "bottom";
  letterSpacing?: number; // multiplier, 1 = normal
  locked?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
};

export const CircularShapedText: React.FC<Props> = ({
  text,
  x,
  y,
  radius,
  fontSize,
  color,
  fontFamily,
  startAngle = -160,
  endAngle = -20,
  direction = "clockwise",
  arcPosition = "top",
  letterSpacing = 1,
  locked,
  draggable = true,
  onClick,
  onTap,
  onDragEnd,
}) => {
  return (
    <Group
      x={x}
      y={y}
      draggable={draggable && !locked}
      onClick={onClick}
      onTap={onTap}
      onDragEnd={onDragEnd}
      listening
    >
      <Shape
        sceneFunc={(ctx, shape) => {
          const c = ctx as CanvasRenderingContext2D;
          c.save();
          c.fillStyle = color;
          c.font = `${fontSize}px ${fontFamily}`;
          c.textBaseline = "middle";
          c.direction = "rtl";

          const chars = Array.from(text).reverse(); // RTL visual order
          const len = chars.length || 1;

          // Base arc
          let start = startAngle;
          let end = endAngle;

          // Flip top/bottom if needed
          if (arcPosition === "bottom") {
            start = -startAngle;
            end = -endAngle;
          }

          const startRad = (start * Math.PI) / 180;
          const endRad = (end * Math.PI) / 180;
          const clockwise = direction === "clockwise";

          let totalAngle = clockwise ? startRad - endRad : endRad - startRad;

          // Apply letter spacing by scaling total arc
          totalAngle *= letterSpacing;

          const step = totalAngle / Math.max(len - 1, 1);

          for (let i = 0; i < len; i++) {
            const angle = clockwise ? startRad - step * i : startRad + step * i;

            const gx = radius * Math.cos(angle);
            const gy = radius * Math.sin(angle);

            c.save();
            c.translate(gx, gy);
            // keep letters upright
            c.rotate(angle + Math.PI / 2);

            c.fillText(chars[i], 0, 0);

            c.restore();
          }

          c.restore();
          c.fillStrokeShape(shape);
        }}
        hitFunc={(ctx, shape) => {
          ctx.beginPath();
          ctx.arc(0, 0, radius + fontSize, 0, Math.PI * 2);
          ctx.closePath();
          ctx.fillStrokeShape(shape);
        }}
      />
    </Group>
  );
};