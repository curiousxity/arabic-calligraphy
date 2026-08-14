import React, { useEffect, useRef, useState } from "react";
import { Stage, Layer, Group, Rect, Line, Text } from "react-konva";
import type Konva from "konva";
import { ShapedText } from "./ShapedText";
import { ShapeFillText } from "./ShapeFillText";
import { TextOnPathText } from "./TextOnPathText";
import { TextPathEditOverlay } from "./TextPathEditOverlay";
import { ImageBlockView } from "./ImageBlockView";
import { ZoomInIcon, ZoomOutIcon, FrameIcon, HandIcon } from "./Icons";
import { isTypingTarget } from "../lib/dom";
import {
  MIN_SCALE,
  MAX_SCALE,
  getBlocksBoundingBox,
  padBox,
  unionRect,
  zoomFactorFromWheel,
  ZOOM_STEP,
  DEFAULT_EMPTY_BOUNDS,
} from "../lib/canvasBounds";
import {
  buildSnapTargets,
  computeSnap,
  findEqualGaps,
  type GapBadge,
  type Rect as SnapRect,
  type SnapLine,
  type SnapTarget,
} from "../lib/snapping";
import type { Block, DiacriticOverride, GlyphTransform } from "../types";

const GRID_SIZE = 40;
const SNAP_GUIDE_PX = 6;
const RULER_SIZE = 20;
const RULER_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

// A stable empty-array fallback for `block.glyphTransforms`. ShapedText's
// glyph-metrics memo (which re-walks every glyph's font outline —
// `glyphObj.getPath(...).getBoundingBox()` per glyph, explicitly documented
// there as expensive) has `glyphTransforms` in its dependency array; `?? []`
// inline would hand it a fresh array identity every render and defeat the
// memo on every drag/pan/zoom frame.
const NO_GLYPH_TRANSFORMS: GlyphTransform[] = [];

const chooseRulerStep = (scale: number) => {
  for (const step of RULER_STEPS) {
    if (step * scale >= 60) return step;
  }
  return RULER_STEPS[RULER_STEPS.length - 1];
};

export type CanvasStageProps = {
  blocks: Block[];
  selectedId: number | null;
  selectedIds: number[];
  snapToGrid: boolean;
  showGrid: boolean;
  viewportWidth: number;
  stageViewportHeight: number;
  backgroundColor: string;
  stageRef: React.RefObject<Konva.Stage | null>;
  stageScale: number;
  stagePosition: { x: number; y: number };
  panMode: boolean;
  onTogglePanMode: (value: boolean) => void;
  onUpdateStage: (scale: number, position: { x: number; y: number }) => void;
  onResetView: () => void;
  onZoomToActualSize: () => void;
  onUpdateBlockPosition: (id: number, x: number, y: number) => void;
  onSelectBlock: (id: number, additive?: boolean) => void;
  onEditBlock: (id: number) => void;
  onUpdateTextPathD: (blockId: number, d: string) => void;
  onDragDiacriticOverride: (
    blockId: number,
    glyphIndex: number,
    patch: Partial<DiacriticOverride>
  ) => void;
  onToggleDiacriticHidden: (blockId: number, glyphIndex: number) => void;
  onUpdateGlyphTransform: (
    blockId: number,
    glyphIndex: number,
    patch: Partial<GlyphTransform>
  ) => void;
  onResizeShapeFillBlock: (id: number, scale: number) => void;
  onResizeImageBlock: (id: number, scale: number) => void;
  showRulers: boolean;
  guides: { horizontal: number[]; vertical: number[] };
  onAddGuide: (axis: "horizontal" | "vertical", position: number) => void;
  onMoveGuide: (axis: "horizontal" | "vertical", index: number, position: number) => void;
  onRemoveGuide: (axis: "horizontal" | "vertical", index: number) => void;
  /** A new block awaiting placement — follows the cursor until the user clicks to drop it (see App.tsx's pendingPlacement). */
  ghostBlock?: { x: number; y: number; width: number; height: number; label: string } | null;
  /**
   * Snap a dragged block's visible bounds — its edges and centres — to the
   * other blocks and the artboard, not only its origin. Defaults to on;
   * turning it off restores origin-only snapping exactly.
   */
  snapToBlockEdges?: boolean;
};

const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

export const CanvasStage: React.FC<CanvasStageProps> = ({
  blocks,
  selectedId,
  selectedIds,
  snapToGrid,
  showGrid,
  viewportWidth,
  stageViewportHeight,
  backgroundColor,
  stageRef,
  stageScale,
  stagePosition,
  panMode,
  onTogglePanMode,
  onUpdateStage,
  onResetView,
  onZoomToActualSize,
  onUpdateBlockPosition,
  onSelectBlock,
  onEditBlock,
  onUpdateTextPathD,
  onDragDiacriticOverride,
  onToggleDiacriticHidden,
  onUpdateGlyphTransform,
  onResizeShapeFillBlock,
  onResizeImageBlock,
  showRulers,
  guides,
  onAddGuide,
  onMoveGuide,
  onRemoveGuide,
  ghostBlock,
  snapToBlockEdges = true,
}) => {
  const snapCoord = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

  const [snapGuides, setSnapGuides] = useState<SnapLine[]>([]);
  /**
   * Bounds targets, captured once per drag. `getClientRect` walks a block's
   * whole subtree, so rebuilding these every frame visibly stutters a busy
   * canvas at 60fps.
   */
  const snapTargetsRef = useRef<SnapTarget[]>([]);
  /** The same measurement as rectangles, for the equal-spacing markers. */
  const snapRectsRef = useRef<SnapRect[]>([]);
  /** Which block `snapTargetsRef` was measured for, so it is built once a drag. */
  const snapTargetsForRef = useRef<number | null>(null);
  const [gapBadges, setGapBadges] = useState<GapBadge[]>([]);

  const [spacePan, setSpacePan] = useState(false);
  const effectivePanMode = panMode || spacePan;
  const additiveSelectRef = useRef(false);

  const [contentBox, setContentBox] = useState(padBox(DEFAULT_EMPTY_BOUNDS));

  const recomputeContentBox = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const paddedContent = padBox(getBlocksBoundingBox(stage, blocks) ?? DEFAULT_EMPTY_BOUNDS);
    // Never show canvas-container chrome inside the visible viewport — the
    // background/grid always cover at least what's currently in view, and
    // extend further to hug padded content wherever that is.
    const viewRect = {
      x: -stagePosition.x / stageScale,
      y: -stagePosition.y / stageScale,
      width: viewportWidth / stageScale,
      height: stageViewportHeight / stageScale,
    };
    setContentBox(unionRect(paddedContent, viewRect));
  };

  useEffect(() => {
    const raf = requestAnimationFrame(recomputeContentBox);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, stagePosition, stageScale, viewportWidth, stageViewportHeight]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSpacePan(true);
      }
      if (e.shiftKey || e.ctrlKey || e.metaKey) additiveSelectRef.current = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpacePan(false);
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) additiveSelectRef.current = false;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const getCoMovers = (block: Block) =>
    blocks.filter((other) => {
      if (other.id === block.id) return false;
      if (block.groupId != null && other.groupId === block.groupId) return true;
      return selectedIds.length > 1 && selectedIds.includes(block.id) && selectedIds.includes(other.id);
    });

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

  /**
   * Measure the bounds of every block this drag can snap against — once per
   * gesture, on its first move frame. The dragged block and everything that
   * moves with it are excluded; a block cannot align to itself.
   *
   * This belongs in `onDragStart`, but the block renderers forward only
   * `onDragMove`/`onDragEnd` to their Konva groups, so there is no drag-start
   * event to hang it on without editing them. The first move frame is
   * equivalent: nothing but the dragged block has moved by then.
   */
  const ensureSnapTargets = (block: Block, node: Konva.Node) => {
    if (snapTargetsForRef.current === block.id) return;
    snapTargetsForRef.current = block.id;
    snapTargetsRef.current = [];
    snapRectsRef.current = [];
    if (!snapToBlockEdges) return;
    const stage = node.getStage();
    if (!stage) return;

    const moving = new Set([block.id, ...getCoMovers(block).map((b) => b.id)]);
    const others: SnapRect[] = [];
    for (const other of blocks) {
      if (moving.has(other.id)) continue;
      const otherNode = stage.findOne(`#block-${other.id}`);
      if (!otherNode) continue;
      others.push(otherNode.getClientRect({ relativeTo: stage }));
    }
    snapRectsRef.current = others;
    snapTargetsRef.current = buildSnapTargets(others, contentBox, guides);
  };

  const clearSnapTargets = () => {
    snapTargetsRef.current = [];
    snapRectsRef.current = [];
    snapTargetsForRef.current = null;
  };

  /** A full-extent line, as origin-to-origin snapping has always drawn. */
  const originLine = (axis: "x" | "y", position: number): SnapLine =>
    axis === "x"
      ? { axis, position, from: contentBox.y, to: contentBox.y + contentBox.height }
      : { axis, position, from: contentBox.x, to: contentBox.x + contentBox.width };

  /**
   * Where a dragged node should actually sit, and the guide lines that say
   * why.
   *
   * Called from the drag-*end* handler as well as from every drag-move frame,
   * because Konva re-applies the raw pointer position on mouse-up before it
   * fires `dragend` — so a block released mid-snap would otherwise land a
   * fraction off the line it was visibly stuck to.
   */
  const resolveDragPosition = (
    block: Block,
    node: Konva.Node
  ): { x: number; y: number; lines: SnapLine[]; rect: SnapRect | null } => {
      ensureSnapTargets(block, node);
      const threshold = SNAP_GUIDE_PX / stageScale;
      const xTargets = [contentBox.x + contentBox.width / 2, ...guides.vertical];
      const yTargets = [contentBox.y + contentBox.height / 2, ...guides.horizontal];
      for (const other of blocks) {
        if (other.id === block.id) continue;
        xTargets.push(other.x);
        yTargets.push(other.y);
      }

      const { x, y } = node.position();
      const snappedX = findNearest(x, xTargets, threshold);
      const snappedY = findNearest(y, yTargets, threshold);

      // Bounds snapping runs alongside the origin snapping above rather than
      // replacing it. The dragged rect and the node's position differ by a
      // constant offset for the length of a drag, so applying the rect's delta
      // to the position is exact — no need to model each block type's own
      // origin-to-bounds relationship.
      const stage = node.getStage();
      const draggedRect =
        snapToBlockEdges && stage
          ? node.getClientRect({ relativeTo: stage })
          : null;
      const rectSnap = draggedRect
        ? computeSnap(draggedRect, snapTargetsRef.current, threshold)
        : { dx: 0, dy: 0, lines: [] as SnapLine[] };

      const lines: SnapLine[] = [];
      const resolve = (axis: "x" | "y", value: number, origin: number | null) => {
        const rectLine = rectSnap.lines.find((l) => l.axis === axis) ?? null;
        const rectDelta = axis === "x" ? rectSnap.dx : rectSnap.dy;
        // The nearer pull wins the axis; a bounds match ties in its own favour,
        // being the more visually meaningful of the two.
        if (rectLine && (origin === null || Math.abs(rectDelta) <= Math.abs(origin - value))) {
          lines.push(rectLine);
          return value + rectDelta;
        }
        if (origin !== null) {
          lines.push(originLine(axis, origin));
          return origin;
        }
        return value;
      };

      const finalX = resolve("x", x, snappedX);
      const finalY = resolve("y", y, snappedY);
      return {
        x: finalX,
        y: finalY,
        lines,
        // Where the bounds end up, without a second `getClientRect`: the rect
        // and the position move together.
        rect: draggedRect
          ? {
              ...draggedRect,
              x: draggedRect.x + (finalX - x),
              y: draggedRect.y + (finalY - y),
            }
          : null,
      };
  };

  const makeDragMoveHandler =
    (block: Block) => (e: Konva.KonvaEventObject<DragEvent>) => {
      if (block.locked || effectivePanMode) return;

      const { x: finalX, y: finalY, lines, rect } = resolveDragPosition(block, e.target);
      e.target.position({ x: finalX, y: finalY });
      setSnapGuides(lines);
      setGapBadges(
        rect
          ? findEqualGaps(rect, snapRectsRef.current, SNAP_GUIDE_PX / stageScale)
          : []
      );

      const coMovers = getCoMovers(block);
      if (coMovers.length > 0) {
        const deltaX = finalX - block.x;
        const deltaY = finalY - block.y;
        const stage = e.target.getStage();
        if (stage) {
          for (const other of coMovers) {
            const node = stage.findOne(`#block-${other.id}`);
            node?.position({ x: other.x + deltaX, y: other.y + deltaY });
          }
        }
      }

      recomputeContentBox();
    };

  const renderGridLines = () => {
    const lines: React.ReactNode[] = [];

    const startX = Math.floor(contentBox.x / GRID_SIZE) * GRID_SIZE;
    const endX = Math.ceil((contentBox.x + contentBox.width) / GRID_SIZE) * GRID_SIZE;
    const startY = Math.floor(contentBox.y / GRID_SIZE) * GRID_SIZE;
    const endY = Math.ceil((contentBox.y + contentBox.height) / GRID_SIZE) * GRID_SIZE;

    for (let x = startX; x <= endX; x += GRID_SIZE) {
      lines.push(
        <Line
          key={`v-${x}`}
          points={[x, startY, x, endY]}
          stroke="#ddd"
          strokeWidth={1}
          listening={false}
        />
      );
    }

    for (let y = startY; y <= endY; y += GRID_SIZE) {
      lines.push(
        <Line
          key={`h-${y}`}
          points={[startX, y, endX, y]}
          stroke="#ddd"
          strokeWidth={1}
          listening={false}
        />
      );
    }

    return lines;
  };

  const renderTopRulerTicks = () => {
    const step = chooseRulerStep(stageScale);
    const startCanvas = Math.floor(-stagePosition.x / stageScale / step) * step;
    const endCanvas = (viewportWidth - stagePosition.x) / stageScale;
    const ticks: React.ReactNode[] = [];
    for (let v = startCanvas; v <= endCanvas; v += step) {
      const screenX = stagePosition.x + v * stageScale;
      if (screenX < RULER_SIZE || screenX > viewportWidth) continue;
      ticks.push(
        <div
          key={v}
          style={{
            position: "absolute",
            left: screenX,
            top: 0,
            height: "100%",
            borderLeft: "1px solid var(--border)",
            fontSize: 9,
            color: "var(--text-faint)",
            paddingLeft: 2,
            whiteSpace: "nowrap",
          }}
        >
          {Math.round(v)}
        </div>
      );
    }
    return ticks;
  };

  const renderLeftRulerTicks = () => {
    const step = chooseRulerStep(stageScale);
    const startCanvas = Math.floor(-stagePosition.y / stageScale / step) * step;
    const endCanvas = (stageViewportHeight - stagePosition.y) / stageScale;
    const ticks: React.ReactNode[] = [];
    for (let v = startCanvas; v <= endCanvas; v += step) {
      const screenY = stagePosition.y + v * stageScale;
      if (screenY < RULER_SIZE || screenY > stageViewportHeight) continue;
      ticks.push(
        <div
          key={v}
          style={{
            position: "absolute",
            top: screenY,
            left: 0,
            width: "100%",
            borderTop: "1px solid var(--border)",
            fontSize: 9,
            color: "var(--text-faint)",
            writingMode: "vertical-rl",
            overflow: "hidden",
          }}
        >
          {Math.round(v)}
        </div>
      );
    }
    return ticks;
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    // Browsers report a trackpad pinch gesture (and an explicit ctrl/cmd+
    // wheel) as a wheel event with ctrlKey set — that's the only case that
    // should zoom. Plain two-finger scroll or a mouse wheel has no ctrlKey
    // and should pan the canvas instead.
    if (!e.evt.ctrlKey && !e.evt.metaKey) {
      onUpdateStage(stageScale, {
        x: stagePosition.x - e.evt.deltaX,
        y: stagePosition.y - e.evt.deltaY,
      });
      return;
    }

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const oldScale = stageScale;
    // Proportional to how far the wheel actually travelled, not a fixed
    // step per event — a trackpad pinch fires many small-delta events per
    // second, so a per-event step made pinching rocket through the range.
    const newScale = clampScale(oldScale * zoomFactorFromWheel(e.evt.deltaY, e.evt.deltaMode));

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

  const handleZoomOut = () => onUpdateStage(clampScale(stageScale / ZOOM_STEP), stagePosition);
  const handleZoomIn = () => onUpdateStage(clampScale(stageScale * ZOOM_STEP), stagePosition);

  const makeDragEndHandler =
    (block: Block) => (e: Konva.KonvaEventObject<DragEvent>) => {
      setSnapGuides([]);
      setGapBadges([]);
      if (block.locked || effectivePanMode) {
        clearSnapTargets();
        return;
      }
      // Re-snap before committing: Konva's mouse-up sets the node straight to
      // the raw pointer position, discarding the last frame's correction.
      let { x, y } = resolveDragPosition(block, e.target);
      clearSnapTargets();
      if (snapToGrid) {
        x = snapCoord(x);
        y = snapCoord(y);
      }
      e.target.position({ x, y });
      onUpdateBlockPosition(block.id, x, y);

      const coMovers = getCoMovers(block);
      if (coMovers.length > 0) {
        const deltaX = x - block.x;
        const deltaY = y - block.y;
        const stage = e.target.getStage();
        for (const other of coMovers) {
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
            onClick={onZoomToActualSize}
            className="canvasToolbarBtn canvasToolbarZoomLabel"
            title="Zoom to 100%"
            aria-label="Zoom to 100%"
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
            onClick={() => onResetView()}
            className="canvasToolbarBtn"
            title="Reset view (fit content)"
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

        {showRulers && (
          <>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: viewportWidth,
                height: RULER_SIZE,
                background: "var(--bg-panel)",
                borderBottom: "1px solid var(--border)",
                cursor: "crosshair",
                overflow: "hidden",
                zIndex: 15,
              }}
              onMouseDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const screenX = e.clientX - rect.left;
                onAddGuide("vertical", (screenX - stagePosition.x) / stageScale);
              }}
              title="Click to drop a vertical guide"
            >
              {renderTopRulerTicks()}
            </div>

            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: RULER_SIZE,
                height: stageViewportHeight,
                background: "var(--bg-panel)",
                borderRight: "1px solid var(--border)",
                cursor: "crosshair",
                overflow: "hidden",
                zIndex: 16,
              }}
              onMouseDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const screenY = e.clientY - rect.top;
                onAddGuide("horizontal", (screenY - stagePosition.y) / stageScale);
              }}
              title="Click to drop a horizontal guide"
            >
              {renderLeftRulerTicks()}
            </div>
          </>
        )}

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
              x={contentBox.x}
              y={contentBox.y}
              width={contentBox.width}
              height={contentBox.height}
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
                onClick: () => onSelectBlock(block.id, additiveSelectRef.current),
                onTap: () => onSelectBlock(block.id),
                onDblClick: () => onEditBlock(block.id),
                onDragMove,
                onDragEnd,
              };

              if (block.type === "image") {
                return (
                  <ImageBlockView
                    key={block.id}
                    {...commonProps}
                    imageDataUrl={block.imageDataUrl}
                    x={block.x}
                    y={block.y}
                    imageWidth={block.shapeWidth ?? 300}
                    imageHeight={block.shapeHeight ?? 300}
                    imageScale={block.imageScale ?? 1}
                    opacity={block.opacity ?? 1}
                    rotation={block.rotation ?? 0}
                    locked={block.locked}
                    isSelected={block.id === selectedId}
                    onResizeScale={(scale) => onResizeImageBlock(block.id, scale)}
                  />
                );
              }

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
                    stroke={block.stroke}
                    strokeWidth={block.strokeWidth ?? 0}
                    shadowColor={block.shadowColor}
                    shadowBlur={block.shadowBlur ?? 0}
                    shadowOffsetX={block.shadowOffsetX ?? 0}
                    shadowOffsetY={block.shadowOffsetY ?? 0}
                    shadowOpacity={block.shadowOpacity ?? 0.35}
                    rotation={block.rotation ?? 0}
                    locked={block.locked}
                    isSelected={block.id === selectedId}
                    onResizeScale={(scale) => onResizeShapeFillBlock(block.id, scale)}
                    diacriticEditMode={block.diacriticEditMode ?? false}
                    diacriticOverrides={block.diacriticOverrides ?? []}
                    onDragDiacriticOverride={(glyphIndex, patch) =>
                      onDragDiacriticOverride(block.id, glyphIndex, patch)
                    }
                    onToggleDiacriticHidden={(glyphIndex) =>
                      onToggleDiacriticHidden(block.id, glyphIndex)
                    }
                  />
                );
              }

              // Explicit guard for text blocks (TextPath blocks are handled by returning null below)
              if (block.type === "text") {
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
                    stroke={block.stroke}
                    strokeWidth={block.strokeWidth ?? 0}
                    shadowColor={block.shadowColor}
                    shadowBlur={block.shadowBlur ?? 0}
                    shadowOffsetX={block.shadowOffsetX ?? 0}
                    shadowOffsetY={block.shadowOffsetY ?? 0}
                    shadowOpacity={block.shadowOpacity ?? 0.35}
                    rotation={block.rotation ?? 0}
                    warpX={block.warpX ?? 0}
                    warpY={block.warpY ?? 0}
                    isSelected={block.id === selectedId}
                    diacriticOverrides={block.diacriticOverrides ?? []}
                    glyphTransforms={block.glyphTransforms ?? NO_GLYPH_TRANSFORMS}
                    glyphTransformMode={block.glyphTransformMode ?? false}
                    onUpdateGlyphTransform={(glyphIndex, patch) =>
                      onUpdateGlyphTransform(block.id, glyphIndex, patch)
                    }
                    onDragDiacriticOverride={(glyphIndex, patch) =>
                      onDragDiacriticOverride(block.id, glyphIndex, patch)
                    }
                    onToggleDiacriticHidden={(glyphIndex) => onToggleDiacriticHidden(block.id, glyphIndex)}
                    locked={block.locked}
                    debugBounds={false}
                  />
                );
              }

              if (block.type === "textPath") {
                return (
                  <React.Fragment key={block.id}>
                    <TextOnPathText
                      {...commonProps}
                      text={block.text}
                      x={block.x}
                      y={block.y}
                      fontSize={block.fontSize}
                      color={block.color}
                      fontFamily={block.fontFamily}
                      fontStyle={block.fontStyle ?? "normal"}
                      opacity={block.opacity ?? 1}
                      stroke={block.stroke}
                      strokeWidth={block.strokeWidth ?? 0}
                      shadowColor={block.shadowColor}
                      shadowBlur={block.shadowBlur ?? 0}
                      shadowOffsetX={block.shadowOffsetX ?? 0}
                      shadowOffsetY={block.shadowOffsetY ?? 0}
                      shadowOpacity={block.shadowOpacity ?? 0.35}
                      rotation={block.rotation ?? 0}
                      textPathD={block.textPathD}
                      textPathReversed={block.textPathReversed ?? false}
                      textPathBaselineOffset={block.textPathBaselineOffset ?? 0}
                      locked={block.locked}
                    />
                    {block.textPathEditMode && block.id === selectedId && (
                      <TextPathEditOverlay
                        id={`text-path-edit-layer-${block.id}`}
                        x={block.x}
                        y={block.y}
                        rotation={block.rotation ?? 0}
                        textPathD={block.textPathD}
                        onChange={(d) => onUpdateTextPathD(block.id, d)}
                      />
                    )}
                  </React.Fragment>
                );
              }

              // Unreachable for known block types; kept as a safe fallback.
              return null;
            })}

            {guides.vertical.map((gx, i) => (
              <Line
                key={`v-guide-${i}`}
                x={gx}
                y={0}
                points={[0, -100000, 0, 100000]}
                stroke="#00b4d8"
                strokeWidth={1 / stageScale}
                dash={[4 / stageScale, 3 / stageScale]}
                draggable={!effectivePanMode}
                dragBoundFunc={(pos) => ({ x: pos.x, y: 0 })}
                onDragMove={(e) => onMoveGuide("vertical", i, e.target.x())}
                onDragEnd={(e) => onMoveGuide("vertical", i, e.target.x())}
                onDblClick={() => onRemoveGuide("vertical", i)}
                onDblTap={() => onRemoveGuide("vertical", i)}
                hitStrokeWidth={10}
              />
            ))}
            {guides.horizontal.map((gy, i) => (
              <Line
                key={`h-guide-${i}`}
                x={0}
                y={gy}
                points={[-100000, 0, 100000, 0]}
                stroke="#00b4d8"
                strokeWidth={1 / stageScale}
                dash={[4 / stageScale, 3 / stageScale]}
                draggable={!effectivePanMode}
                dragBoundFunc={(pos) => ({ x: 0, y: pos.y })}
                onDragMove={(e) => onMoveGuide("horizontal", i, e.target.y())}
                onDragEnd={(e) => onMoveGuide("horizontal", i, e.target.y())}
                onDblClick={() => onRemoveGuide("horizontal", i)}
                onDblTap={() => onRemoveGuide("horizontal", i)}
                hitStrokeWidth={10}
              />
            ))}

            {/* Equal-spacing markers: a bar across each of two even gaps,
                capped at both ends. Advisory only — nothing snaps to them. */}
            {gapBadges.map((badge) => {
              const cap = 4 / stageScale;
              const strokeWidth = 1 / stageScale;
              const segments =
                badge.axis === "x"
                  ? [
                      [badge.from, badge.cross, badge.to, badge.cross],
                      [badge.from, badge.cross - cap, badge.from, badge.cross + cap],
                      [badge.to, badge.cross - cap, badge.to, badge.cross + cap],
                    ]
                  : [
                      [badge.cross, badge.from, badge.cross, badge.to],
                      [badge.cross - cap, badge.from, badge.cross + cap, badge.from],
                      [badge.cross - cap, badge.to, badge.cross + cap, badge.to],
                    ];
              return segments.map((points, i) => (
                <Line
                  key={`gap-${badge.axis}-${badge.from}-${i}`}
                  points={points}
                  stroke="#ff2d78"
                  strokeWidth={strokeWidth}
                  listening={false}
                />
              ));
            })}

            {snapGuides.map((line) => (
              <Line
                key={`${line.axis}-${line.position}`}
                points={
                  line.axis === "x"
                    ? [line.position, line.from, line.position, line.to]
                    : [line.from, line.position, line.to, line.position]
                }
                stroke="#ff2d78"
                strokeWidth={1 / stageScale}
                dash={[4 / stageScale, 3 / stageScale]}
                listening={false}
              />
            ))}

            {ghostBlock && (
              <Group
                x={ghostBlock.x - ghostBlock.width / 2}
                y={ghostBlock.y - ghostBlock.height / 2}
                listening={false}
                opacity={0.85}
              >
                <Rect
                  width={ghostBlock.width}
                  height={ghostBlock.height}
                  cornerRadius={8}
                  fill="rgba(212, 175, 55, 0.15)"
                  stroke="#d4af37"
                  strokeWidth={1.5 / stageScale}
                  dash={[8 / stageScale, 5 / stageScale]}
                />
                <Text
                  text={ghostBlock.label}
                  width={ghostBlock.width}
                  height={ghostBlock.height}
                  align="center"
                  verticalAlign="middle"
                  fontSize={13 / stageScale}
                  fill="#d4af37"
                  listening={false}
                />
              </Group>
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
};

export default CanvasStage;