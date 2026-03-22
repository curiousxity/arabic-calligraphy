import React from "react";
import { Stage, Layer, Text, Rect, Line } from "react-konva";
import type Konva from "konva";
import ArabicKeyboard from "./ArabicKeyboard";

const GRID_SIZE = 40;

type Block = {
  id: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  locked?: boolean;
};

export type CanvasStageProps = {
  blocks: Block[];
  snapToGrid: boolean;
  showGrid: boolean;
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;
  stageRef: React.RefObject<Konva.Stage>;
  stageScale: number;
  stagePosition: { x: number; y: number };
  panMode: boolean;
  onTogglePanMode: (value: boolean) => void;
  onUpdateStage: (scale: number, position: { x: number; y: number }) => void;
  onUpdateBlockPosition: (id: number, x: number, y: number) => void;
  onSelectBlock: (id: number) => void;
  showKeyboard: boolean;
  onKeyFromKeyboard: (k: string) => void;
  onSpaceFromKeyboard: () => void;
  onBackspaceFromKeyboard: () => void;
};

export const CanvasStage: React.FC<CanvasStageProps> = ({
  blocks,
  snapToGrid,
  showGrid,
  canvasWidth,
  canvasHeight,
  backgroundColor,
  stageRef,
  stageScale,
  stagePosition,
  panMode,
  onTogglePanMode,
  onUpdateStage,
  onUpdateBlockPosition,
  onSelectBlock,
  showKeyboard,
  onKeyFromKeyboard,
  onSpaceFromKeyboard,
  onBackspaceFromKeyboard,
}) => {
  const snapCoord = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

  const renderGridLines = () => {
    const lines: React.ReactNode[] = [];

    for (let x = 0; x <= canvasWidth; x += GRID_SIZE) {
      lines.push(<Line key={`v-${x}`} points={[x, 0, x, canvasHeight]} stroke="#ddd" strokeWidth={1} />);
    }

    for (let y = 0; y <= canvasHeight; y += GRID_SIZE) {
      lines.push(<Line key={`h-${y}`} points={[0, y, canvasWidth, y]} stroke="#ddd" strokeWidth={1} />);
    }

    return lines;
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    const stage = stageRef.current;
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const oldScale = stageScale;
    const scaleBy = e.evt.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(3, Math.max(0.25, oldScale * scaleBy));

    const mousePointTo = {
      x: (pointer.x - stagePosition.x) / oldScale,
      y: (pointer.y - stagePosition.y) / oldScale,
    };

    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };

    onUpdateStage(newScale, newPos);
  };

  const handleReset = () => {
    onUpdateStage(1, { x: 0, y: 0 });
    onTogglePanMode(false);
  };

  return (
    <div
      style={{
        flex: 1,
        width: canvasWidth,
        position: "relative",
        overflow: "hidden",
        background: "#e0e0e0",
        cursor: panMode ? "grab" : "default",
      }}
    >
      <div style={{ width: canvasWidth, height: canvasHeight }}>
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            zIndex: 20,
            display: "flex",
            gap: 8,
            background: "rgba(255,255,255,0.9)",
            border: "1px solid #ccc",
            borderRadius: 8,
            padding: "6px 8px",
          }}
        >
          <button onClick={() => onUpdateStage(stageScale * 1.1, stagePosition)}>+</button>
          <button onClick={handleReset}>{Math.round(stageScale * 100)}%</button>
          <button onClick={() => onUpdateStage(stageScale / 1.1, stagePosition)}>−</button>
          <button onClick={handleReset}>Reset</button>
          <button onClick={() => onTogglePanMode(!panMode)}>{panMode ? "Pan: On" : "Pan: Off"}</button>
        </div>

        <Stage
          width={canvasWidth}
          height={canvasHeight}
          ref={stageRef}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePosition.x}
          y={stagePosition.y}
          draggable={panMode}
          dragButtons={[0]}
          onWheel={handleWheel}
          onDragMove={(e) => {
            if (!panMode) return;
            onUpdateStage(stageScale, { x: e.target.x(), y: e.target.y() });
          }}
          onDragEnd={(e) => {
            if (!panMode) return;
            onUpdateStage(stageScale, { x: e.target.x(), y: e.target.y() });
          }}
          onContextMenu={(e) => e.evt.preventDefault()}
          style={{ background: "transparent" }}
        >
          <Layer>
            <Rect x={0} y={0} width={canvasWidth} height={canvasHeight} fill={backgroundColor} />
            {showGrid && renderGridLines()}

            {blocks.map((block) => (
              <Text
                key={block.id}
                id={`block-${block.id}`}
                text={block.text}
                x={block.x}
                y={block.y}
                fontSize={block.fontSize}
                fill={block.color}
                fontFamily={block.fontFamily}
                fontStyle={block.fontStyle ?? "normal"}
                align={block.align ?? "center"}
                lineHeight={block.lineHeight ?? 1.2}
                draggable={!block.locked && !panMode}
                opacity={block.opacity ?? 1}
                stroke={block.stroke}
                strokeWidth={block.strokeWidth ?? 0}
                shadowColor={block.shadowColor}
                shadowBlur={block.shadowBlur ?? 0}
                shadowOffsetX={block.shadowOffsetX ?? 0}
                shadowOffsetY={block.shadowOffsetY ?? 0}
                shadowOpacity={block.shadowOpacity ?? 0.35}
                onClick={() => onSelectBlock(block.id)}
                onTap={() => onSelectBlock(block.id)}
                onDragEnd={(e) => {
                  if (block.locked || panMode) return;

                  let { x, y } = e.target.position();

                  if (snapToGrid) {
                    const node = e.target as Konva.Text;
                    const width = node.width();
                    const height = node.height();
                    const anchorX = x + width;
                    const anchorY = y + (5 / 6) * height;
                    const snappedAnchorX = snapCoord(anchorX);
                    const snappedAnchorY = snapCoord(anchorY);
                    x = snappedAnchorX - width;
                    y = snappedAnchorY - (5 / 6) * height;
                    node.position({ x, y });
                  }

                  onUpdateBlockPosition(block.id, x, y);
                }}
              />
            ))}
          </Layer>
        </Stage>
      </div>

      {showKeyboard && (
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: 12,
            zIndex: 50,
          }}
        >
          <ArabicKeyboard
            onKey={onKeyFromKeyboard}
            onSpace={onSpaceFromKeyboard}
            onBackspace={onBackspaceFromKeyboard}
            style={{ width: "100%" }}
          />
        </div>
      )}
    </div>
  );
};

export default CanvasStage;
