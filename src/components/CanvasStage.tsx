import React from "react";
import { Stage, Layer, Rect, Line } from "react-konva";
import type Konva from "konva";
import { ShapedText } from "./ShapedText";
import { ShapeFillText } from "./ShapeFillText";
import { ShapeWarpText } from "./ShapeWarpText";
import type { Block, GlyphHandleMode } from "../types";

const GRID_SIZE = 40;
const MIN_SCALE = 0.05;
const MAX_SCALE = 3;
const STAGE_PADDING = 0;

export type CanvasStageProps = {
  blocks: Block[];
  snapToGrid: boolean;
  showGrid: boolean;
  viewportWidth: number;
  artboardWidth: number;
  artboardHeight: number;
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
  onSelectGlyph: (blockId: number, glyphIndex: number | null) => void;
  onUpdateGlyphHandle: (
    blockId: number,
    glyphIndex: number,
    handleId: string,
    patch: {
      x?: number;
      y?: number;
      radius?: number;
      strength?: number;
      mode?: GlyphHandleMode;
    }
  ) => void;
  onGlyphBoxesChange: (
    blockId: number,
    boxes: { glyphIndex: number; x: number; y: number; width: number; height: number }[]
  ) => void;
};

const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

const computeFit = (
  viewportWidth: number,
  stageViewportHeight: number,
  artboardWidth: number,
  artboardHeight: number
) => {
  const availW = Math.max(1, viewportWidth);
  const availH = Math.max(1, stageViewportHeight);

  const scaleX = availW / artboardWidth;
  const scaleY = availH / artboardHeight;
  const scale = clampScale(Math.min(scaleX, scaleY, 1));

  const scaledW = artboardWidth * scale;
  const scaledH = artboardHeight * scale;

  return {
    scale,
    position: {
      x: (viewportWidth - scaledW) / 2,
      y: (stageViewportHeight - scaledH) / 2,
    },
  };
};

export const CanvasStage: React.FC<CanvasStageProps> = ({
  blocks,
  snapToGrid,
  showGrid,
  viewportWidth,
  artboardWidth,
  artboardHeight,
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
  onSelectGlyph,
  onUpdateGlyphHandle,
  onGlyphBoxesChange,
}) => {
  const snapCoord = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

  const renderGridLines = () => {
    const lines: React.ReactNode[] = [];

    for (let x = 0; x <= artboardWidth; x += GRID_SIZE) {
      lines.push(
        <Line
          key={`v-${x}`}
          points={[x, 0, x, artboardHeight]}
          stroke="#ddd"
          strokeWidth={1}
          listening={false}
        />
      );
    }

    for (let y = 0; y <= artboardHeight; y += GRID_SIZE) {
      lines.push(
        <Line
          key={`h-${y}`}
          points={[0, y, artboardWidth, y]}
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

  const handleZoomOut = () => onUpdateStage(clampScale(stageScale / 1.1), stagePosition);
  const handleZoomIn = () => onUpdateStage(clampScale(stageScale * 1.1), stagePosition);

  const handleReset = () => {
    const scaledW = artboardWidth * 1;
    const scaledH = artboardHeight * 1;
    const position = {
      x: (viewportWidth - scaledW) / 2,
      y: (stageViewportHeight - scaledH) / 2,
    };
    onUpdateStage(1, position);
    onTogglePanMode(false);
  };

  const makeDragEndHandler =
    (block: Block) => (e: Konva.KonvaEventObject<DragEvent>) => {
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
        width: viewportWidth,
        position: "relative",
        overflow: "hidden",
        background: "#e0e0e0",
        cursor: panMode ? "grab" : "default",
      }}
    >
      <div style={{ width: viewportWidth, height: stageViewportHeight }}>
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
          width={viewportWidth}
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
              width={artboardWidth}
              height={artboardHeight}
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
                  />
                );
              }

              if (block.type === "shapeWarp") {
                return (
                  <ShapeWarpText
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
                    warpShapeWidth={block.warpShapeWidth ?? block.shapeWidth ?? 400}
                    warpShapeHeight={block.warpShapeHeight ?? block.shapeHeight ?? 400}
                    warpShapeMode={block.warpShapeMode ?? "envelope"}
                    warpShapePadding={block.warpShapePadding ?? 24}
                    warpShapeStrength={block.warpShapeStrength ?? 1}
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
                    debugBounds={false}
                    glyphEditMode={block.glyphEditMode ?? false}
                    selectedGlyphIndex={block.selectedGlyphIndex ?? null}
                    glyphWarps={block.glyphWarps ?? []}
                    onGlyphSelect={(glyphIndex) => onSelectGlyph(block.id, glyphIndex)}
                    onUpdateGlyphHandle={(glyphIndex, handleId, patch) =>
                      onUpdateGlyphHandle(block.id, glyphIndex, handleId, patch)
                    }
                    onGlyphBoxesChange={(boxes) =>
                      onGlyphBoxesChange(block.id, boxes)
                    }
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
                  warpX={block.warpX ?? 0}
                  warpY={block.warpY ?? 0}
                  locked={block.locked}
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