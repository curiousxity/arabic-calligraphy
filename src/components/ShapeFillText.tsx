/**
 * ShapeFillText v5
 *
 * Key fix: Konva's sceneFunc context wrapper does NOT support Path2D or the
 * two-argument isPointInPath(path, x, y) form. All path operations must use
 * the standard beginPath() / moveTo / lineTo / bezierCurveTo / clip() API
 * that Konva forwards to the underlying canvas context.
 *
 * Strategy:
 *  - Parse the SVG path string into an array of command objects once (memoized).
 *  - Replay those commands via ctx.beginPath() + individual draw calls for clipping.
 *  - For scanline hit-testing, use a simple ray-casting polygon approximation
 *    (sample the path outline into a polygon, then test each scanline point).
 *  - shapeScale, emboss, stroke all preserved.
 */

import React, { useEffect, useMemo, useRef } from "react";
import { Group, Shape, Rect, Circle } from "react-konva";
import type Konva from "konva";
import {
  parseSvgPath,
  pathToPolygon,
  pointInPolygon,
  type SvgCmd,
} from "../lib/svgPath";
import { useShapedGlyphs } from "../hooks/useShapedGlyphs";
import {
  applyGlyphEdit,
  applyGlyphRig,
  MOVE_HANDLE_COLOR,
  STRETCH_ANCHOR_COLOR,
  STRETCH_DRAG_COLOR,
} from "../lib/glyphEdits";
import type { GlyphEdit, GlyphStretchHandle, GlyphRig, GlyphRigValue } from "../types";

export type ShapeFillTextProps = {
  id?: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  shapeSvgPath: string;
  shapeWidth: number;
  shapeHeight: number;
  shapeScale?: number;
  shapeFillSpacing?: number;
  shapeFillScaleX?: number;
  shapeFillScaleY?: number;
  shapeFillTextRotation?: number;
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  embossStrength?: number;
  embossHighlightColor?: string;
  embossShadowColor?: string;
  rotation?: number;
  glyphEditTool?: "move" | "stretch" | null;
  selectedGlyphIndex?: number | null;
  glyphEdits?: GlyphEdit[];
  glyphRigs?: GlyphRig[];
  glyphRigValues?: GlyphRigValue[];
  onGlyphSelect?: (glyphIndex: number | null) => void;
  onGlyphBoxesChange?: (
    boxes: {
      glyphIndex: number;
      x: number;
      y: number;
      width: number;
      height: number;
      glyphId: number;
    }[]
  ) => void;
  onUpdateStretchHandle?: (
    glyphIndex: number,
    handleId: string,
    patch: Partial<GlyphStretchHandle>
  ) => void;
  onSetGlyphMoveOffset?: (
    glyphIndex: number,
    offsetX: number,
    offsetY: number
  ) => void;
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

type GlyphInstance = {
  glyphIndex: number;
  gx: number;
  gy: number;
  scX: number;
  scY: number;
};

// ─── SVG path parser ──────────────────────────────────────────────────────────

/** Replay parsed SVG commands onto a canvas context (no Path2D needed). */
function replayPath(ctx: CanvasRenderingContext2D, cmds: SvgCmd[]) {
  ctx.beginPath();
  for (const c of cmds) {
    switch (c.type) {
      case "M": ctx.moveTo(c.x, c.y); break;
      case "L": ctx.lineTo(c.x, c.y); break;
      case "C": ctx.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y); break;
      case "Q": ctx.quadraticCurveTo(c.x1, c.y1, c.x, c.y); break;
      case "Z": ctx.closePath(); break;
    }
  }
}

/**
 * Applies a point-transform to a glyph's raw outline commands (in the
 * glyph's own local coordinate space, same frame the tile-loop's own
 * translate/rotate/scale positions afterward) — this is what lets a single
 * edit or rig axis affect every tiled repetition of that letter identically.
 */
function warpSvgCommands(
  commands: SvgCmd[],
  transform: (x: number, y: number) => { x: number; y: number }
): SvgCmd[] {
  return commands.map((c): SvgCmd => {
    switch (c.type) {
      case "M":
      case "L": {
        const p = transform(c.x, c.y);
        return { type: c.type, x: p.x, y: p.y };
      }
      case "C": {
        const p1 = transform(c.x1, c.y1);
        const p2 = transform(c.x2, c.y2);
        const p = transform(c.x, c.y);
        return { type: "C", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
      }
      case "Q": {
        const p1 = transform(c.x1, c.y1);
        const p = transform(c.x, c.y);
        return { type: "Q", x1: p1.x, y1: p1.y, x: p.x, y: p.y };
      }
      case "Z":
        return c;
    }
  });
}

function drawCommandsToCtx(ctx: CanvasRenderingContext2D, commands: SvgCmd[]) {
  ctx.beginPath();
  for (const cmd of commands) {
    switch (cmd.type) {
      case "M": ctx.moveTo(cmd.x, cmd.y); break;
      case "L": ctx.lineTo(cmd.x, cmd.y); break;
      case "C": ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y); break;
      case "Q": ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y); break;
      case "Z": ctx.closePath(); break;
    }
  }
}

export const ShapeFillText: React.FC<ShapeFillTextProps> = ({
  id,
  text,
  x, y,
  fontSize,
  color,
  fontFamily,
  fontStyle = "normal",
  shapeSvgPath,
  shapeWidth,
  shapeHeight,
  shapeScale = 1,
  shapeFillSpacing = 1.3,
  shapeFillScaleX = 1,
  shapeFillScaleY = 1,
  shapeFillTextRotation = 0,
  opacity = 1,
  stroke = "#000000",
  strokeWidth = 0,
  shadowColor = "#000000",
  shadowBlur = 0,
  shadowOffsetX = 0,
  shadowOffsetY = 0,
  shadowOpacity = 0.35,
  embossStrength = 0,
  embossHighlightColor = "#ffffff",
  embossShadowColor = "#000000",
  rotation = 0,
  glyphEditTool = null,
  selectedGlyphIndex = null,
  glyphEdits = [],
  glyphRigs = [],
  glyphRigValues = [],
  onGlyphSelect,
  onGlyphBoxesChange,
  onUpdateStretchHandle,
  onSetGlyphMoveOffset,
  locked,
  draggable = true,
  onClick, onTap, onDblClick, onDragMove, onDragEnd,
  isSelected = false,
  onResizeScale,
}) => {
  const shapeData = useShapedGlyphs(text, fontFamily);
  const moveDragOriginRef = useRef<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  // Parse SVG path once
  const parsedCmds = useMemo(() => parseSvgPath(shapeSvgPath || ""), [shapeSvgPath]);

  // Build polygon for hit-testing once
  const polygon = useMemo(() => pathToPolygon(parsedCmds, 12), [parsedCmds]);

  // Pre-compute glyph path commands + advances
  const glyphCache = useMemo(() => {
    const { glyphs, font, unitsPerEm } = shapeData;
    if (!font) return [];
    const scale = fontSize / unitsPerEm;
    let penX = 0;
    return glyphs.map((g) => {
      const obj = font.glyphs.get(g.g);
      const dx = (g.dx ?? 0) * scale;
      const dy = (g.dy ?? 0) * scale;
      const advance = (g.ax ?? 0) * scale;
      const commands: SvgCmd[] = obj ? obj.getPath(0, 0, fontSize).commands : [];
      const result = { obj, penX, dx, dy, advance, commands, glyphId: g.g };
      penX += advance;
      return result;
    });
  }, [shapeData, fontSize]);

  const totalAdvance = glyphCache.reduce((s, g) => s + g.advance, 0);

  const isBold = fontStyle === "bold" || fontStyle === "bold italic";
  const isItalic = fontStyle === "italic" || fontStyle === "bold italic";
  const fauxBoldWidth = isBold ? Math.max(fontSize * 0.035, 0.6) : 0;

  const scaledW = shapeWidth * shapeScale;
  const scaledH = shapeHeight * shapeScale;

  // Per-glyph outline bounds (glyph-local space) — reported so "Add handle"
  // can size/center a new handle on whichever glyph is selected.
  const glyphLocalBoxes = useMemo(() => {
    const boxes: {
      glyphIndex: number;
      x: number;
      y: number;
      width: number;
      height: number;
      glyphId: number;
    }[] = [];
    for (let i = 0; i < glyphCache.length; i++) {
      const g = glyphCache[i];
      if (!g.obj) continue;
      const box = g.obj.getPath(0, 0, fontSize).getBoundingBox();
      if (isFinite(box.x1) && isFinite(box.x2) && isFinite(box.y1) && isFinite(box.y2)) {
        boxes.push({
          glyphIndex: i,
          x: box.x1,
          y: box.y1,
          width: Math.max(box.x2 - box.x1, 1),
          height: Math.max(box.y2 - box.y1, 1),
          glyphId: g.glyphId,
        });
      }
    }
    return boxes;
  }, [glyphCache, fontSize]);

  useEffect(() => {
    onGlyphBoxesChange?.(glyphLocalBoxes);
  }, [glyphLocalBoxes, onGlyphBoxesChange]);

  // Mirrors the sceneFunc's own scanline-tiling loop in plain JS (no canvas
  // needed — `pointInPolygon` is pure) so glyph-edit click hit-testing and
  // handle placement can know where every tiled repetition actually lands.
  // Only computed while glyph edit mode is on (it's a real amount of work).
  const glyphInstances = useMemo<GlyphInstance[]>(() => {
    if (!glyphEditTool) return [];
    if (!shapeSvgPath || parsedCmds.length === 0) return [];
    if (!shapeData.font || glyphCache.length === 0 || totalAdvance <= 0) return [];

    const lineH = fontSize * shapeFillSpacing;
    const sampleStep = Math.max(2, Math.round(fontSize / 8));
    let lineY = fontSize * 0.85;
    const inShape = (px: number, py: number) => pointInPolygon(px, py, polygon);
    const instances: GlyphInstance[] = [];

    while (lineY < shapeHeight) {
      let lx = -1, rx = -1;
      for (let sx = 0; sx <= shapeWidth; sx += sampleStep) {
        if (inShape(sx, lineY)) {
          if (lx < 0) lx = sx;
          rx = sx;
        }
      }
      if (lx > 0) {
        for (let sx = lx - sampleStep; sx <= lx; sx++) {
          if (inShape(sx, lineY)) { lx = sx; break; }
        }
      }
      if (rx > 0) {
        for (let sx = rx; sx <= rx + sampleStep; sx++) {
          if (inShape(sx, lineY)) { rx = sx; } else { break; }
        }
      }

      if (lx >= 0 && rx > lx + 2) {
        const lineWidth = rx - lx;
        const effectiveAdvance = totalAdvance * shapeFillScaleX;
        const reps = Math.max(1, Math.floor(lineWidth / effectiveAdvance));
        const fitScaleX = lineWidth / (reps * effectiveAdvance);
        const scX = shapeFillScaleX * fitScaleX;
        const scY = shapeFillScaleY;

        for (let r = 0; r < reps; r++) {
          const startPenX = lx + r * effectiveAdvance * fitScaleX;
          for (let gi = 0; gi < glyphCache.length; gi++) {
            const g = glyphCache[gi];
            if (!g.obj || g.commands.length === 0) continue;
            instances.push({
              glyphIndex: gi,
              gx: startPenX + g.penX * scX + g.dx * scX,
              gy: lineY + g.dy * scY,
              scX,
              scY,
            });
          }
        }
      }

      lineY += lineH;
    }

    return instances;
  }, [
    glyphEditTool,
    shapeSvgPath,
    parsedCmds,
    shapeData.font,
    glyphCache,
    totalAdvance,
    fontSize,
    shapeFillSpacing,
    shapeWidth,
    shapeHeight,
    shapeFillScaleX,
    shapeFillScaleY,
    polygon,
  ]);

  const selectedInstance = useMemo(
    () =>
      selectedGlyphIndex != null
        ? glyphInstances.find((inst) => inst.glyphIndex === selectedGlyphIndex) ?? null
        : null,
    [glyphInstances, selectedGlyphIndex]
  );

  const selectedEdit =
    glyphEditTool != null && selectedGlyphIndex != null
      ? glyphEdits.find((w) => w.glyphIndex === selectedGlyphIndex)
      : undefined;
  const selectedStretches = selectedEdit?.stretches ?? [];
  const selectedMoveOffset = selectedEdit?.move ?? { offsetX: 0, offsetY: 0 };
  const selectedGlyphBox =
    selectedGlyphIndex != null
      ? glyphLocalBoxes.find((b) => b.glyphIndex === selectedGlyphIndex)
      : undefined;

  return (
    <Group
      id={id}
      x={x} y={y}
      rotation={rotation}
      opacity={opacity}
      draggable={draggable && !locked}
      dragBoundFunc={glyphEditTool != null ? () => ({ x, y }) : undefined}
      onClick={(e) => {
        onClick?.();

        if (glyphEditTool == null) return;

        const group = e.currentTarget;
        const pos = group.getRelativePointerPosition();
        if (!pos) return;

        const localX = pos.x / Math.max(shapeScale, 0.0001);
        const localY = pos.y / Math.max(shapeScale, 0.0001);

        let best: GlyphInstance | null = null;
        let bestDist = fontSize * 0.7;
        for (const inst of glyphInstances) {
          const d = Math.hypot(inst.gx - localX, inst.gy - localY);
          if (d < bestDist) {
            bestDist = d;
            best = inst;
          }
        }

        onGlyphSelect?.(best?.glyphIndex ?? null);
      }}
      onTap={onTap} onDblClick={onDblClick} onDblTap={onDblClick} onDragMove={glyphEditTool == null ? onDragMove : undefined} onDragEnd={glyphEditTool == null ? onDragEnd : undefined}
      listening
    >
      <Rect x={0} y={0} width={scaledW} height={scaledH} fill="transparent" strokeEnabled={false} listening />

      <Shape
        listening={false}
        shadowColor={shadowBlur > 0 ? shadowColor : undefined}
        shadowBlur={shadowBlur}
        shadowOffsetX={shadowOffsetX}
        shadowOffsetY={shadowOffsetY}
        shadowOpacity={shadowOpacity}
        sceneFunc={(ctx) => {
          if (!shapeSvgPath || parsedCmds.length === 0) return;

          const lineH = fontSize * shapeFillSpacing;
          const rotRad = (shapeFillTextRotation * Math.PI) / 180;

          // If no text data yet, draw a semi-transparent placeholder fill (once,
          // regardless of emboss — there's nothing shaped yet to emboss).
          if (!shapeData.font || glyphCache.length === 0 || totalAdvance <= 0) {
            ctx.save();
            ctx.scale(shapeScale, shapeScale);
            replayPath(ctx as unknown as CanvasRenderingContext2D, parsedCmds);
            ctx.fillStyle = color + "33"; // 20% opacity hint
            ctx.fill();
            ctx.restore();
            return;
          }

          // Draws the whole shape-filled glyph run once, in `fillColor`, offset
          // by (offsetX, offsetY) — called once normally, and twice more (offset
          // opposite directions, no stroke/fauxBold) when emboss is active.
          const drawPass = (
            fillColor: string,
            offsetX: number,
            offsetY: number,
            includeExtras: boolean
          ) => {
            ctx.save();
            ctx.translate(offsetX, offsetY);
            ctx.scale(shapeScale, shapeScale);

            // Clip to shape using replayed path commands (Konva-safe, no Path2D)
            replayPath(ctx as unknown as CanvasRenderingContext2D, parsedCmds);
            ctx.clip();

            ctx.fillStyle = fillColor;

            const drawGlyphRow = (startPenX: number, sy: number, scX: number, scY: number) => {
              for (let gi = 0; gi < glyphCache.length; gi++) {
                const g = glyphCache[gi];
                if (!g.obj || g.commands.length === 0) continue;
                const gx = startPenX + g.penX * scX + g.dx * scX;
                const gy = sy + g.dy * scY;
                const edit = glyphEdits.find((w) => w.glyphIndex === gi);
                const commands =
                  edit || glyphRigValues.length > 0
                    ? warpSvgCommands(g.commands, (px, py) => {
                        const edited = applyGlyphEdit(px, py, edit);
                        return applyGlyphRig(
                          edited.x,
                          edited.y,
                          fontFamily,
                          g.glyphId,
                          fontSize,
                          glyphRigs,
                          glyphRigValues
                        );
                      })
                    : g.commands;

                ctx.save();
                ctx.translate(gx, gy);
                if (shapeFillTextRotation !== 0) ctx.rotate(rotRad);
                ctx.scale(scX, scY);
                if (isItalic) ctx.transform(1, 0, -0.25, 1, 0, 0);
                drawCommandsToCtx(ctx as unknown as CanvasRenderingContext2D, commands);
                ctx.fill();
                if (includeExtras && fauxBoldWidth > 0) {
                  ctx.strokeStyle = fillColor;
                  ctx.lineWidth = fauxBoldWidth / scX;
                  ctx.stroke();
                }
                if (includeExtras && strokeWidth > 0) {
                  ctx.strokeStyle = stroke;
                  ctx.lineWidth = strokeWidth / scX;
                  ctx.stroke();
                }
                ctx.restore();
              }
            };

            // Scanline fill — use ray-casting polygon test (no Path2D / isPointInPath)
            const sampleStep = Math.max(2, Math.round(fontSize / 8));
            let lineY = fontSize * 0.85;

            // The polygon is in original (pre-scale) path coordinates, matching lineY
            const inShape = (px: number, py: number) => pointInPolygon(px, py, polygon);

            while (lineY < shapeHeight) {
              let lx = -1, rx = -1;
              for (let sx = 0; sx <= shapeWidth; sx += sampleStep) {
                if (inShape(sx, lineY)) {
                  if (lx < 0) lx = sx;
                  rx = sx;
                }
              }
              // Refine left edge
              if (lx > 0) {
                for (let sx = lx - sampleStep; sx <= lx; sx++) {
                  if (inShape(sx, lineY)) { lx = sx; break; }
                }
              }
              // Refine right edge
              if (rx > 0) {
                for (let sx = rx; sx <= rx + sampleStep; sx++) {
                  if (inShape(sx, lineY)) { rx = sx; } else { break; }
                }
              }

              if (lx >= 0 && rx > lx + 2) {
                const lineWidth = rx - lx;
                const effectiveAdvance = totalAdvance * shapeFillScaleX;
                const reps = Math.max(1, Math.floor(lineWidth / effectiveAdvance));
                const fitScaleX = lineWidth / (reps * effectiveAdvance);
                const scX = shapeFillScaleX * fitScaleX;
                const scY = shapeFillScaleY;

                for (let r = 0; r < reps; r++) {
                  drawGlyphRow(lx + r * effectiveAdvance * fitScaleX, lineY, scX, scY);
                }
              }

              lineY += lineH;
            }

            ctx.restore();
          };

          if (embossStrength > 0) {
            drawPass(embossShadowColor, embossStrength, embossStrength, false);
            drawPass(embossHighlightColor, -embossStrength, -embossStrength, false);
          }
          drawPass(color, 0, 0, true);
        }}
      />

      {isSelected && !locked && (
        <Circle
          x={scaledW}
          y={scaledH}
          radius={8}
          fill="#d4af37"
          stroke="#ffffff"
          strokeWidth={2}
          draggable
          onMouseDown={(e) => { e.cancelBubble = true; }}
          onTouchStart={(e) => { e.cancelBubble = true; }}
          onDragMove={(e) => {
            e.cancelBubble = true;
            const group = e.currentTarget.getParent() as Konva.Group;
            const pos = group.getRelativePointerPosition();
            if (!pos) return;
            const dist = Math.hypot(pos.x, pos.y);
            const baseDist = Math.hypot(shapeWidth, shapeHeight);
            const newScale = Math.max(0.2, Math.min(3, dist / Math.max(baseDist, 1)));
            onResizeScale?.(newScale);
          }}
          onDragEnd={(e) => { e.cancelBubble = true; }}
        />
      )}

      {glyphEditTool != null && selectedGlyphIndex != null && selectedInstance && (
        <Group
          x={shapeScale * selectedInstance.gx}
          y={shapeScale * selectedInstance.gy}
          scaleX={shapeScale * selectedInstance.scX}
          scaleY={shapeScale * selectedInstance.scY}
          listening
        >
          {glyphEditTool === "stretch" &&
            selectedStretches.map((h) => {
              const effScale = Math.max(shapeScale * selectedInstance.scX, 0.05);
              const r = Math.max(4, Math.min(20, 7 / effScale));
              return (
                <React.Fragment key={h.id}>
                  <Circle
                    x={h.anchorX}
                    y={h.anchorY}
                    radius={r}
                    fill={STRETCH_ANCHOR_COLOR}
                    stroke="#ffffff"
                    strokeWidth={2 / effScale}
                    draggable
                    onMouseDown={(e) => {
                      e.cancelBubble = true;
                    }}
                    onTouchStart={(e) => {
                      e.cancelBubble = true;
                    }}
                    onDragMove={(e) => {
                      e.cancelBubble = true;
                      const grp = e.currentTarget.getParent() as Konva.Group;
                      const pos = grp.getRelativePointerPosition();
                      if (!pos || !onUpdateStretchHandle) return;
                      onUpdateStretchHandle(selectedGlyphIndex, h.id, {
                        anchorX: pos.x,
                        anchorY: pos.y,
                      });
                    }}
                    onDragEnd={(e) => {
                      e.cancelBubble = true;
                    }}
                  />
                  <Circle
                    x={h.dragX}
                    y={h.dragY}
                    radius={r}
                    fill={STRETCH_DRAG_COLOR}
                    stroke="#ffffff"
                    strokeWidth={2 / effScale}
                    draggable
                    onMouseDown={(e) => {
                      e.cancelBubble = true;
                    }}
                    onTouchStart={(e) => {
                      e.cancelBubble = true;
                    }}
                    onDragMove={(e) => {
                      e.cancelBubble = true;
                      const grp = e.currentTarget.getParent() as Konva.Group;
                      const pos = grp.getRelativePointerPosition();
                      if (!pos || !onUpdateStretchHandle) return;
                      onUpdateStretchHandle(selectedGlyphIndex, h.id, {
                        dragX: pos.x,
                        dragY: pos.y,
                      });
                    }}
                    onDragEnd={(e) => {
                      e.cancelBubble = true;
                    }}
                  />
                </React.Fragment>
              );
            })}

          {glyphEditTool === "move" &&
            selectedGlyphBox &&
            (() => {
              const effScale = Math.max(shapeScale * selectedInstance.scX, 0.05);
              return (
                <Rect
                  x={selectedGlyphBox.x + selectedMoveOffset.offsetX}
                  y={selectedGlyphBox.y + selectedMoveOffset.offsetY}
                  width={selectedGlyphBox.width}
                  height={selectedGlyphBox.height}
                  fill="transparent"
                  stroke={MOVE_HANDLE_COLOR}
                  strokeWidth={2 / effScale}
                  dash={[6 / effScale, 4 / effScale]}
                  draggable
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onTouchStart={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    const grp = e.currentTarget.getParent() as Konva.Group;
                    const pos = grp.getRelativePointerPosition();
                    if (!pos) return;
                    moveDragOriginRef.current = {
                      x: pos.x,
                      y: pos.y,
                      offsetX: selectedMoveOffset.offsetX,
                      offsetY: selectedMoveOffset.offsetY,
                    };
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const origin = moveDragOriginRef.current;
                    const grp = e.currentTarget.getParent() as Konva.Group;
                    const pos = grp.getRelativePointerPosition();
                    if (!origin || !pos || !onSetGlyphMoveOffset) return;
                    onSetGlyphMoveOffset(
                      selectedGlyphIndex,
                      origin.offsetX + (pos.x - origin.x),
                      origin.offsetY + (pos.y - origin.y)
                    );
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    moveDragOriginRef.current = null;
                  }}
                />
              );
            })()}
        </Group>
      )}
    </Group>
  );
};

export default ShapeFillText;
