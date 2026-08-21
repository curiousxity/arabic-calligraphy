import React, { useRef, useState } from "react";
import { Group, Circle, Rect, Line } from "react-konva";
import { projectOntoAxis } from "../lib/dragAxis";
import { zoneCentre, type CutZone } from "../lib/strokeCuts";
import type { StrokeCut } from "../types";

/** A detected zone plus where the glyph carrying it sits in the run. */
export type StrokeCutZone = CutZone & {
  /** The glyph's pen origin in run space, px. */
  gx: number;
  gy: number;
  /** Shaped glyph id, stamped onto every cut written from this zone. */
  glyphId: number;
};

export type StrokeCutHoverHandlesProps = {
  isSelected: boolean;
  /** Armed by Typography's "Stretch strokes" checkbox. */
  enabled: boolean;
  zones: StrokeCutZone[];
  cuts: StrokeCut[];
  /** fontSize / unitsPerEm — zones are detected in font units and drawn in px. */
  scale: number;
  /** One nuqta in px, i.e. `nuqtaUnits(fontFamily, fontSize)`. */
  nuqtaPx: number;
  /** The block's own canvas-space origin — zones are in glyph-run space. */
  offsetX: number;
  offsetY: number;
  onSetCut?: (cut: StrokeCut) => void;
};

const HANDLE_COLOR = "#f97316";
const RAIL_COLOR = "#f9731655";

/** Stretches land on half-nuqta steps unless Alt is held. The nuqta is the
 *  unit classical proportion is written in, so free-dragging by default
 *  would make every stretch an arbitrary number. */
const SNAP_NUQTA = 0.5;

/** Longest stretch a single drag will write, in nuqta. Past this a stroke
 *  reads as a rule rather than a letter. */
const MAX_NUQTA = 12;

function snap(nuqta: number, free: boolean): number {
  if (free) return Math.round(nuqta * 100) / 100;
  return Math.round(nuqta / SNAP_NUQTA) * SNAP_NUQTA;
}

/**
 * On-canvas hover overlay for lengthening a letter's own straight strokes.
 *
 * One handle per detected zone, shown only while that zone is hovered — the
 * same rule that keeps the diacritic and move/scale overlays from turning a
 * word into a field of dots.
 *
 * The handle travels along the **stroke's own axis**, not horizontally,
 * because that is the direction the outline actually opens in (see
 * `applyCutsToCommands`). `projectOntoAxis` already accepts an arbitrary
 * two-point rail, so the inclined rail needs no new primitive — but its
 * contract is *absolute* stage coordinates, so the rail is captured through
 * the parent's absolute transform at drag start, the technique
 * `DiacriticHoverHandles` established after mixing the two spaces teleported
 * its handle under pan and zoom.
 */
export const StrokeCutHoverHandles: React.FC<StrokeCutHoverHandlesProps> = ({
  isSelected,
  enabled,
  zones,
  cuts,
  scale,
  nuqtaPx,
  offsetX,
  offsetY,
  onSetCut,
}) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const railRef = useRef<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(
    null
  );
  const originRef = useRef<{ x: number; y: number } | null>(null);

  if (!isSelected || !enabled || nuqtaPx <= 0) return null;

  return (
    <Group>
      {zones.map((zone) => {
        const key = `${zone.glyphIndex}:${Math.round(zone.fromX)}`;
        const isActive = hoveredKey === key || draggingKey === key;

        // The cut this zone writes: its position is the zone's midpoint
        // along the stroke, in font units, so it survives a font-size change.
        const localX = (zone.fromX + zone.toX) / 2;
        const cut = cuts.find(
          (c) => c.cluster === zone.cluster && c.localX === localX
        );
        const nuqta = cut?.nuqta ?? 0;

        // Rest position: the zone's centre on the glyph, in px.
        const [czx, czy] = zoneCentre(zone);
        const originX = zone.gx + czx * scale;
        const originY = zone.gy + czy * scale;

        const dirX = Math.cos(zone.angle);
        const dirY = Math.sin(zone.angle);
        const d = nuqta * nuqtaPx;
        const handleX = originX + dirX * d;
        const handleY = originY + dirY * d;

        // The hit rect spans the zone and the handle's whole travel, so a
        // handle dragged outward cannot leave the rect, fire mouseleave and
        // unmount itself mid-gesture.
        const reach = MAX_NUQTA * nuqtaPx;
        const pad = Math.max(zone.thickness * scale, 12) / 2 + 8;
        const x1 = Math.min(originX, originX + dirX * reach) - pad;
        const x2 = Math.max(originX, originX + dirX * reach) + pad;
        const y1 = Math.min(originY, originY + dirY * reach) - pad;
        const y2 = Math.max(originY, originY + dirY * reach) + pad;

        const write = (next: number, free: boolean) => {
          const clamped = Math.min(Math.max(snap(next, free), 0), MAX_NUQTA);
          onSetCut?.({
            cluster: zone.cluster,
            localX,
            angle: zone.angle,
            glyphId: zone.glyphId,
            nuqta: clamped,
          });
        };

        return (
          // Hover handlers belong on this Group, never on the Rect below.
          // Konva suppresses `mouseleave` only at an *ancestor* of the newly
          // entered shape, so with them here a Rect->Circle move fires no
          // leave at all; on the Rect, the moment the handle mounted under
          // the pointer the next mousemove would clear hover and unmount it,
          // giving both the every-other-frame flicker and the death of any
          // drag whose first step was small. Both were measured — CLAUDE.md,
          // "End-to-end tests".
          <Group
            key={key}
            onMouseEnter={() => setHoveredKey(key)}
            onMouseLeave={() => setHoveredKey((v) => (v === key ? null : v))}
          >
            <Rect
              x={x1 + offsetX}
              y={y1 + offsetY}
              width={x2 - x1}
              height={y2 - y1}
              fill="transparent"
              // Konva routes only to the topmost listening shape and these
              // rects are deliberately long. Switching the others off while
              // one is hovered or dragging stops them stealing hover from
              // each other mid-gesture.
              listening={(hoveredKey === null && draggingKey === null) || isActive}
            />

            {isActive && (
              <>
                {/* The rail the stretch runs along, so the direction the
                    stroke will open in is visible before committing. */}
                <Line
                  points={[
                    originX + offsetX,
                    originY + offsetY,
                    handleX + offsetX,
                    handleY + offsetY,
                  ]}
                  stroke={RAIL_COLOR}
                  strokeWidth={Math.max(zone.thickness * scale, 2)}
                  listening={false}
                />
                <Circle
                  x={handleX + offsetX}
                  y={handleY + offsetY}
                  radius={5}
                  fill={HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  dragBoundFunc={(pos) => {
                    const rail = railRef.current;
                    return rail ? projectOntoAxis(rail.a, rail.b, pos) : pos;
                  }}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    const parent = e.target.getParent();
                    if (parent) {
                      const tr = parent.getAbsoluteTransform();
                      railRef.current = {
                        a: tr.point({ x: originX + offsetX, y: originY + offsetY }),
                        b: tr.point({
                          x: originX + offsetX + dirX * 100,
                          y: originY + offsetY + dirY * 100,
                        }),
                      };
                    }
                    originRef.current = { x: originX, y: originY };
                    setDraggingKey(key);
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const origin = originRef.current;
                    if (!origin) return;
                    const pos = e.target.position();
                    // Distance along the stroke axis. Projecting rather than
                    // taking the raw x keeps an inclined stroke's stretch
                    // equal to the pointer's travel *along the stroke*.
                    const along =
                      (pos.x - offsetX - origin.x) * dirX +
                      (pos.y - offsetY - origin.y) * dirY;
                    write(along / nuqtaPx, e.evt.altKey);
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    railRef.current = null;
                    originRef.current = null;
                    setDraggingKey((v) => (v === key ? null : v));
                  }}
                />
              </>
            )}
          </Group>
        );
      })}
    </Group>
  );
};
