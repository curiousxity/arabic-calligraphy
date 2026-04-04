import React from "react";
import { Stage, Layer, Rect, Line } from "react-konva";
import type Konva from "konva";
// ArabicKeyboard removed from canvas — keyboard lives only in the sidebar
import { ShapedText } from "./ShapedText";
import { ShapeFillText } from "./ShapeFillText";
import type { Block } from "../types";

const GRID_SIZE = 40;
const MIN_SCALE = 0.25;
const MAX_SCALE = 3;

export type CanvasStageProps = {
  blocks: Block[];
  snapToGrid: boolean;
  showGrid: boolean;
  canvasWidth: number;
  canvasHeight: number;
  /** Pixel height of the Stage DOM element (viewport height, not artboard height). */
  stageViewportHeight: number;
  backgroundColor: string;
  stageRef: React.RefObject<Konva.Stage | null>;
  stageScale: number;
  stagePosition: { x: number; y: number };
  panMode: boolean;
  onTogglePanMode: (value: boolean) => void;
  onUpdateStage: (scale: number, position: { x: number; y: number }) => void;
  onUpdateBlockPosition: (id: number, x: number, y: number) => void;
  onSelectBlock: (id: number) => void;
};

export const CanvasStage: React.FC<CanvasStageProps> = ({
  blocks,
  snapToGrid,
  showGrid,
  canvasWidth,
  canvasHeight,
  stageViewportHeight,
  backgroundColor,
  stageRef,
  stageScale,
  stagePosition,
  panMode,
  onTogglePanMode,
  onUpdateStage,
  onUpdateBlockPosition,
  onSelectBlock,
}) => {
  const snapCoord = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

  const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

  const renderGridLines = () => {
    const lines: React.ReactNode[] = [];

    for (let x = 0; x <= canvasWidth; x += GRID_SIZE) {
      lines.push(
        <Line
          key={`v-${x}`}
          points={[x, 0, x, canvasHeight]}
          stroke="#ddd"
          strokeWidth={1}
          listening={false}
        />
      );
    }

    for (let y = 0; y <= canvasHeight; y += GRID_SIZE) {
      lines.push(
        <Line
          key={`h-${y}`}
          points={[0, y, canvasWidth, y]}
          stroke="#ddd"
          strokeWidth={1}
          listening={false}
        />
      );
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
    const newScale = clampScale(oldScale * scaleBy);

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

  const handleZoomOut = () => {
    onUpdateStage(clampScale(stageScale / 1.1), stagePosition);
  };

  const handleZoomIn = () => {
    onUpdateStage(clampScale(stageScale * 1.1), stagePosition);
  };

  const handleReset = () => {
    onUpdateStage(1, { x: 0, y: 0 });
    onTogglePanMode(false);
  };

  const makeDragEndHandler = (block: Block) => (e: Konva.KonvaEventObject<DragEvent>) => {
    if (block.locked || panMode) return;

    let { x, y } = e.target.position();

    if (snapToGrid) {
      x = snapCoord(x);
      y = snapCoord(y);
      e.target.position({ x, y });
    }

    onUpdateBlockPosition(block.id, x, y);
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
      <div style={{ width: canvasWidth, height: stageViewportHeight }}>
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
          <button type="button" onClick={handleZoomOut}>
            −
          </button>
          <button type="button" onClick={handleReset}>
            {Math.round(stageScale * 100)}%
          </button>
          <button type="button" onClick={handleZoomIn}>
            +
          </button>
          <button type="button" onClick={handleReset}>
            Reset
          </button>
          <button type="button" onClick={() => onTogglePanMode(!panMode)}>
            {panMode ? "Pan: On" : "Pan: Off"}
          </button>
        </div>

        <Stage
          width={canvasWidth}
          height={stageViewportHeight}
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
            <Rect
              x={0}
              y={0}
              width={canvasWidth}
              height={canvasHeight}
              fill={backgroundColor}
              listening={false}
            />

            {showGrid && renderGridLines()}

            {blocks.map((block) => {
              const onDragEnd = makeDragEndHandler(block);
              const commonProps = {
                id: `block-${block.id}`,
                draggable: !block.locked && !panMode,
                onClick: () => onSelectBlock(block.id),
                onTap: () => onSelectBlock(block.id),
                onDragEnd,
              };

              if (block.type === "shapeFill") {
                return (
                  <ShapeFillText
                    key={block.id}
                    {...commonProps}
                    text={block.text}
                    x={block.x}
                    y={block.y}
                    fontSize={block.fontSize}
                    color={block.color}
                    fontFamily={block.fontFamily}
                    fontStyle={block.fontStyle ?? "normal"}
                    shapeSvgPath={block.shapeSvgPath ?? ""}
                    shapeWidth={block.shapeWidth ?? 400}
                    shapeHeight={block.shapeHeight ?? 400}
                    shapeScale={block.shapeScale ?? 1}
                    shapeFillSpacing={block.shapeFillSpacing ?? 1.3}
                    shapeFillScaleX={block.shapeFillScaleX ?? 1}
                    shapeFillScaleY={block.shapeFillScaleY ?? 1}
                    shapeFillTextRotation={block.shapeFillTextRotation ?? 0}
                    opacity={block.opacity ?? 1}
                    stroke={block.stroke ?? "#000000"}
                    strokeWidth={block.strokeWidth ?? 0}
                    shadowColor={block.shadowColor ?? "#000000"}
                    shadowBlur={block.shadowBlur ?? 0}
                    shadowOffsetX={block.shadowOffsetX ?? 0}
                    shadowOffsetY={block.shadowOffsetY ?? 0}
                    shadowOpacity={block.shadowOpacity ?? 0.35}
                    rotation={block.rotation ?? 0}
                    locked={block.locked}
                    embossStrength={block.embossStrength ?? 0}
                  />
                );
              }

              return (
                <ShapedText
                  key={block.id}
                  {...commonProps}
                  text={block.text}
                  x={block.x}
                  y={block.y}
                  fontSize={block.fontSize}
                  color={block.color}
                  fontFamily={block.fontFamily}
                  fontStyle={block.fontStyle ?? "normal"}
                  align={block.align ?? "center"}
                  lineHeight={block.lineHeight ?? 1.2}
                  opacity={block.opacity ?? 1}
                  stroke={block.stroke ?? "#000000"}
                  strokeWidth={block.strokeWidth ?? 0}
                  shadowColor={block.shadowColor ?? "#000000"}
                  shadowBlur={block.shadowBlur ?? 0}
                  shadowOffsetX={block.shadowOffsetX ?? 0}
                  shadowOffsetY={block.shadowOffsetY ?? 0}
                  shadowOpacity={block.shadowOpacity ?? 0.35}
                  rotation={block.rotation ?? 0}
                  locked={block.locked}
                  embossStrength={block.embossStrength ?? 0}
                  debugBounds={false}
                />
              );
            })}
          </Layer>
        </Stage>
      </div>

    </div>
  );
};

export default CanvasStage;