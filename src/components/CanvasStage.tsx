import React, { useEffect, useState } from "react";
import { Stage, Layer, Group, Rect, Line } from "react-konva";
import type Konva from "konva";
import { ShapedText } from "./ShapedText";
import { ShapeFillText } from "./ShapeFillText";
import { ShapeWarpText } from "./ShapeWarpText";
import { ZoomInIcon, ZoomOutIcon, FrameIcon, HandIcon } from "./Icons";
import { isTypingTarget } from "../lib/dom";
import type { Block, GlyphHandleMode } from "../types";

const GRID_SIZE = 40;
const MIN_SCALE = 0.05;
const MAX_SCALE = 3;
const SNAP_GUIDE_PX = 6;

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
  onEditBlock: (id: number) => void;
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
  onEditBlock,
  onSelectGlyph,
  onUpdateGlyphHandle,
  onGlyphBoxesChange,
}) => {
  const snapCoord = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });

  const [spacePan, setSpacePan] = useState(false);
  const effectivePanMode = panMode || spacePan;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSpacePan(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpacePan(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const findNearest = (value: number, targets: number[], threshold: number) => {
    let best: number | null = null;
    let bestDist = threshold;
    for (const t of targets) {
      const dist = Math.abs(value - t);
      if (dist <= bestDist) {
        best = t;
        bestDist = dist;
      }
    }
    return best;
  };

  const makeDragMoveHandler =
    (block: Block) => (e: Konva.KonvaEventObject<DragEvent>) => {
      if (block.locked || effectivePanMode) return;

      const threshold = SNAP_GUIDE_PX / stageScale;
      const xTargets = [artboardWidth / 2];
      const yTargets = [artboardHeight / 2];
      for (const other of blocks) {
        if (other.id === block.id) continue;
        xTargets.push(other.x);
        yTargets.push(other.y);
      }

      const { x, y } = e.target.position();
      const snappedX = findNearest(x, xTargets, threshold);
      const snappedY = findNearest(y, yTargets, threshold);

      const finalX = snappedX ?? x;
      const finalY = snappedY ?? y;
      e.target.position({ x: finalX, y: finalY });
      setSnapGuides({ x: snappedX, y: snappedY });

      if (block.groupId != null) {
        const deltaX = finalX - block.x;
        const deltaY = finalY - block.y;
        const stage = e.target.getStage();
        if (stage) {
          for (const other of blocks) {
            if (other.id === block.id || other.groupId !== block.groupId) continue;
            const node = stage.findOne(`#block-${other.id}`);
            node?.position({ x: other.x + deltaX, y: other.y + deltaY });
          }
        }
      }
    };

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
      setSnapGuides({ x: null, y: null });
      if (block.locked || effectivePanMode) return;
      let { x, y } = e.target.position();
      if (snapToGrid) {
        x = snapCoord(x);
        y = snapCoord(y);
        e.target.position({ x, y });
      }
      onUpdateBlockPosition(block.id, x, y);

      if (block.groupId != null) {
        const deltaX = x - block.x;
        const deltaY = y - block.y;
        const stage = e.target.getStage();
        for (const other of blocks) {
          if (other.id === block.id || other.groupId !== block.groupId) continue;
          const newX = other.x + deltaX;
          const newY = other.y + deltaY;
          stage?.findOne(`#block-${other.id}`)?.position({ x: newX, y: newY });
          onUpdateBlockPosition(other.id, newX, newY);
        }
      }
    };

  return (
    <div
      style={{
        flex: 1,
        width: viewportWidth,
        position: "relative",
        overflow: "hidden",
        background: "var(--bg-canvas-area)",
        cursor: effectivePanMode ? "grab" : "default",
      }}
    >
      <div style={{ width: viewportWidth, height: stageViewportHeight }}>
        <div className="canvasToolbar">
          <button
            type="button"
            onClick={handleZoomOut}
            className="canvasToolbarBtn"
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOutIcon size={15} />
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="canvasToolbarBtn canvasToolbarZoomLabel"
            title="Reset zoom to 100%"
            aria-label="Reset zoom"
          >
            {Math.round(stageScale * 100)}%
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            className="canvasToolbarBtn"
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomInIcon size={15} />
          </button>

          <div className="canvasToolbarDivider" />

          <button
            type="button"
            onClick={handleReset}
            className="canvasToolbarBtn"
            title="Reset view"
            aria-label="Reset view"
          >
            <FrameIcon size={15} />
          </button>
          <button
            type="button"
            onClick={() => onTogglePanMode(!panMode)}
            className={
              panMode ? "canvasToolbarBtn canvasToolbarBtn--active" : "canvasToolbarBtn"
            }
            title={
              panMode
                ? "Pan mode on (drag to pan)"
                : "Enable pan mode (or hold Space / drag with middle mouse button)"
            }
            aria-label="Toggle pan mode"
            aria-pressed={panMode}
          >
            <HandIcon size={15} />
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
          draggable
          dragButtons={effectivePanMode ? [0, 1] : [1]}
          onWheel={handleWheel}
          onDragMove={(e) => {
            if (e.target !== e.target.getStage()) return;
            onUpdateStage(stageScale, { x: e.target.x(), y: e.target.y() });
          }}
          onDragEnd={(e) => {
            if (e.target !== e.target.getStage()) return;
            onUpdateStage(stageScale, { x: e.target.x(), y: e.target.y() });
          }}
          onContextMenu={(e) => e.evt.preventDefault()}
          style={{ background: "transparent" }}
        >
          <Layer>
            <Rect
              id="artboard-background"
              x={0}
              y={0}
              width={artboardWidth}
              height={artboardHeight}
              fill={backgroundColor}
              listening={false}
            />

            {showGrid && (
              <Group id="grid-lines" listening={false}>
                {renderGridLines()}
              </Group>
            )}

            {blocks.map((block) => {
              const onDragEnd = makeDragEndHandler(block);
              const onDragMove = makeDragMoveHandler(block);
              const commonProps = {
                id: `block-${block.id}`,
                draggable: !block.locked && !effectivePanMode,
                onClick: () => onSelectBlock(block.id),
                onTap: () => onSelectBlock(block.id),
                onDblClick: () => onEditBlock(block.id),
                onDragMove,
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

            {snapGuides.x != null && (
              <Line
                points={[snapGuides.x, -1000, snapGuides.x, artboardHeight + 1000]}
                stroke="#ff2d78"
                strokeWidth={1 / stageScale}
                dash={[4 / stageScale, 3 / stageScale]}
                listening={false}
              />
            )}
            {snapGuides.y != null && (
              <Line
                points={[-1000, snapGuides.y, artboardWidth + 1000, snapGuides.y]}
                stroke="#ff2d78"
                strokeWidth={1 / stageScale}
                dash={[4 / stageScale, 3 / stageScale]}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
};

export default CanvasStage;