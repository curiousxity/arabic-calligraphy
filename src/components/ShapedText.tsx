import React, { useEffect, useMemo, useState } from "react";
import { Group, Shape } from "react-konva";
import type Konva from "konva";
import { shapeText } from "../lib/harfbuzz";

type Props = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  locked?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
};

const FONT_URLS: Record<string, string> = {
  TahaNaskhRegular: "/fonts/TahaNaskhRegular.ttf",
  Kufi: "/fonts/Kufi.ttf",
  Kufi2: "/fonts/Kufi2.ttf",
  Thuluth: "/fonts/Thuluth.ttf",
  Wessam: "/fonts/Wessam.ttf",
  Yekan: "/fonts/Yekan.ttf",
  NotoSans: "/fonts/NotoSans.ttf",
  Lateef: "/fonts/Lateef.ttf",
  Amiri: "/fonts/Amiri.ttf",
  Ruqaa: "/fonts/Ruqaa.ttf",
  Qahiri: "/fonts/Qahiri.ttf",
};

type Glyph = {
  g: number;
  ax?: number;
  ay?: number;
  dx?: number;
  dy?: number;
};

export const ShapedText: React.FC<Props> = ({
  text,
  x,
  y,
  fontSize,
  color,
  fontFamily,
  align = "center",
  lineHeight = 1.2,
  locked,
  draggable = true,
  onClick,
  onTap,
  onDragEnd,
}) => {
  const [glyphs, setGlyphs] = useState<Glyph[]>([]);
  const fontUrl = FONT_URLS[fontFamily] ?? FONT_URLS.NotoSans;

  useEffect(() => {
    let alive = true;
    shapeText(text || "", fontUrl)
      .then((result) => {
        if (alive) setGlyphs(result as Glyph[]);
      })
      .catch(() => {
        if (alive) setGlyphs([]);
      });
    return () => {
      alive = false;
    };
  }, [text, fontUrl]);

  const metrics = useMemo(() => {
    const width =
      glyphs.reduce((sum, g) => sum + Math.max(0, (g.ax ?? 0) / 64), 0) ||
      Math.max(text.length * fontSize * 0.55, 20);

    const height = Math.max(fontSize * lineHeight, fontSize * 1.35, 24);

    return { width, height };
  }, [glyphs, text, fontSize, lineHeight]);

  const offsetX = align === "left" ? 0 : align === "right" ? metrics.width : metrics.width / 2;
  const offsetY = metrics.height * 0.78;

  return (
    <Group
      x={x}
      y={y}
      draggable={draggable && !locked}
      offsetX={offsetX}
      offsetY={offsetY}
      onClick={onClick}
      onTap={onTap}
      onDragEnd={onDragEnd}
      listening
    >
      <Shape
        x={0}
        y={0}
        width={metrics.width}
        height={metrics.height}
        sceneFunc={(context, shape) => {
          const ctx = context as any;
          canvas.save();

          canvas.beginPath();
          canvas.rect(0, 0, metrics.width, metrics.height);

          canvas.fillStyle = color;
          canvas.font = `${fontSize}px ${fontFamily}`;
          canvas.direction = "rtl";
          canvas.textBaseline = "alphabetic";

          const baseline = metrics.height * 0.78;
          const startX =
            align === "left"
              ? 0
              : align === "right"
                ? metrics.width
                : metrics.width / 2;

          canvas.fillText(text, startX, baseline);

          canvas.restore();
          canvas.fillStrokeShape(shape);
        }}
        hitFunc={(context, shape) => {
          context.beginPath();
          context.rect(0, 0, metrics.width, metrics.height);
          context.closePath();
          context.fillStrokeShape(shape);
        }}
      />
    </Group>
  );
};
