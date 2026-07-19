import React, { useEffect, useState } from "react";
import { Group, Rect, Circle, Image as KonvaImage } from "react-konva";
import type Konva from "konva";

export type ImageBlockViewProps = {
  id?: string;
  imageDataUrl: string;
  x: number;
  y: number;
  imageWidth: number;
  imageHeight: number;
  imageScale?: number;
  opacity?: number;
  rotation?: number;
  locked?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  isSelected?: boolean;
  onResizeScale?: (newScale: number) => void;
};

function useHtmlImage(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) return;
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);

  return src ? image : null;
}

export const ImageBlockView: React.FC<ImageBlockViewProps> = ({
  id,
  imageDataUrl,
  x,
  y,
  imageWidth,
  imageHeight,
  imageScale = 1,
  opacity = 1,
  rotation = 0,
  locked,
  draggable = true,
  onClick,
  onTap,
  onDblClick,
  onDragMove,
  onDragEnd,
  isSelected = false,
  onResizeScale,
}) => {
  const image = useHtmlImage(imageDataUrl);
  const scaledW = Math.max(imageWidth * imageScale, 1);
  const scaledH = Math.max(imageHeight * imageScale, 1);

  return (
    <Group
      id={id}
      x={x}
      y={y}
      rotation={rotation}
      opacity={opacity}
      draggable={draggable && !locked}
      onClick={onClick}
      onTap={onTap}
      onDblClick={onDblClick}
      onDblTap={onDblClick}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      listening
    >
      {image ? (
        <KonvaImage image={image} x={0} y={0} width={scaledW} height={scaledH} />
      ) : (
        <Rect x={0} y={0} width={scaledW} height={scaledH} fill="rgba(0,0,0,0.15)" />
      )}

      {isSelected && !locked && (
        <Circle
          x={scaledW}
          y={scaledH}
          radius={8}
          fill="#d4af37"
          stroke="#ffffff"
          strokeWidth={2}
          draggable
          onMouseDown={(e) => {
            e.cancelBubble = true;
          }}
          onTouchStart={(e) => {
            e.cancelBubble = true;
          }}
          onDragMove={(e) => {
            e.cancelBubble = true;
            const group = e.currentTarget.getParent() as Konva.Group;
            const pos = group.getRelativePointerPosition();
            if (!pos) return;
            const dist = Math.hypot(pos.x, pos.y);
            const baseDist = Math.hypot(imageWidth, imageHeight);
            const newScale = Math.max(0.05, Math.min(10, dist / Math.max(baseDist, 1)));
            onResizeScale?.(newScale);
          }}
          onDragEnd={(e) => {
            e.cancelBubble = true;
          }}
        />
      )}
    </Group>
  );
};

export default ImageBlockView;
