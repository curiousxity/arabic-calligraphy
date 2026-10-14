import React, { useMemo, useRef, useState } from "react";
import { Circle, Group, Line } from "react-konva";
import type Konva from "konva";
import type { StackPiece, StackJoin, StackBlock } from "../types";
import { chainOf, pieceTransform } from "../lib/stackOutline";
import { transformCmds, transformFace, transformPt } from "../lib/stackGeometry";
import { flattenContours, findCutZonesSwept, zoneCentre, DEFAULT_DETECT_OPTS } from "../lib/strokeCuts";
import { joinCenterline } from "../lib/stackJoin";
import { EXPORT_HIDDEN } from "../lib/exportChrome";

const ROTATE_HANDLE_COLOR = "#8b5cf6";
const BOW_HANDLE_COLOR = "#f59e0b";
const BOW_MIN = -0.3, BOW_MAX = 3;

export type StackEditOverlayProps = {
  isSelected: boolean;
  pieces: StackPiece[];
  joins: StackJoin[];
  nib: StackBlock["nib"];
  /** px per font unit. */
  scale: number;
  onBegin?: () => void;
  onSetPieces?: (patches: { id: string; x?: number; y?: number; rotation?: number }[]) => void;
  onSetBow?: (joinId: string, bow: number) => void;
  unitsPerEm: number;
  /** "Split strokes" armed: show split points on straight strokes. */
  tailMode: boolean;
  onSplit?: (pieceId: string, cut: { cutX: number; angle: number }) => void;
};

/**
 * Editing chrome for a selected stack block. One hit polygon per piece
 * (Konva hit-tests a closed Line by its fill, so a letter's real outline is
 * the drag target), a rotation handle on the hovered piece, and a bow
 * handle on every join. Everything is in the block group's px space: the
 * overlay Group is an untransformed child of StackView's Group, so its
 * relative pointer is the pointer in the frame `pieces` are drawn in.
 */
export const StackEditOverlay: React.FC<StackEditOverlayProps> = ({
  isSelected, pieces, joins, scale, onBegin, onSetPieces, onSetBow,
  unitsPerEm, tailMode, onSplit,
}) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const groupRef = useRef<Konva.Group>(null);
  const dragStart = useRef<{ ids: string[]; at: Map<string, { x: number; y: number }>; pointer: { x: number; y: number } } | null>(null);
  const rotateStart = useRef<{ id: string; centre: { x: number; y: number } } | null>(null);
  const bowStart = useRef<{ id: string; bow: number; n: { x: number; y: number }; chord: number; pointer: { x: number; y: number } } | null>(null);

  const polygons = useMemo(() =>
    pieces.map((p) => {
      const contours = flattenContours(transformCmds(p.cmds, pieceTransform(p)));
      // The largest contour is the letter body; marks are a single contour anyway.
      const outer = contours.reduce((a, b) => (b.length > a.length ? b : a), contours[0] ?? []);
      return { id: p.id, points: outer.flatMap(([x, y]) => [x * scale, y * scale]) };
    }), [pieces, scale]);

  // The sweep is fifteen rotations per piece, so it runs only while armed.
  const zones = useMemo(() => {
    if (!tailMode) return [];
    const opts = { ...DEFAULT_DETECT_OPTS, step: unitsPerEm / 100, minZoneWidth: unitsPerEm / 40 };
    return pieces.filter((p) => p.role === "letter").flatMap((p) =>
      findCutZonesSwept(flattenContours(p.cmds), { glyphIndex: 0, cluster: 0 }, opts).map((z, i) => {
        const [lx, ly] = zoneCentre(z);
        const w = transformPt([lx, ly], pieceTransform(p));
        return { key: `${p.id}:${i}`, pieceId: p.id, cut: { cutX: (z.fromX + z.toX) / 2, angle: z.angle }, x: w[0] * scale, y: w[1] * scale };
      })
    );
  }, [tailMode, pieces, scale, unitsPerEm]);

  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);

  if (!isSelected) return null;

  // Handles sit at different depths (piece Group vs the overlay Group), so
  // read the pointer from the overlay Group itself rather than counting parents.
  const pointerIn = () => groupRef.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };

  return (
    <Group ref={groupRef} name={EXPORT_HIDDEN}>
      {polygons.map(({ id, points }) => (
        <Group key={id} onMouseEnter={() => setHovered(id)} onMouseLeave={() => setHovered((h) => (h === id ? null : h))}>
          <Line
            name="stack-piece"
            points={points}
            closed
            fill="transparent"
            draggable
            onMouseDown={(e) => { e.cancelBubble = true; }}
            onDragStart={(e) => {
              e.cancelBubble = true;
              const ids = chainOf(pieces, id, e.evt.altKey);
              dragStart.current = {
                ids,
                at: new Map(ids.map((i) => [i, { x: byId.get(i)!.x, y: byId.get(i)!.y }])),
                pointer: pointerIn(),
              };
              onBegin?.();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const s = dragStart.current;
              if (!s) return;
              const now = pointerIn();
              const dx = (now.x - s.pointer.x) / scale, dy = (now.y - s.pointer.y) / scale;
              onSetPieces?.(s.ids.map((i) => ({ id: i, x: s.at.get(i)!.x + dx, y: s.at.get(i)!.y + dy })));
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              dragStart.current = null;
              e.target.position({ x: 0, y: 0 });   // the polygon re-renders from state
            }}
          />
          {hovered === id && byId.get(id)?.role === "letter" && (() => {
            const p = byId.get(id)!;
            const t = pieceTransform(p);
            const cx = (p.pivot[0] + p.x) * scale, cy = (p.pivot[1] + p.y) * scale;
            const r = 36;
            const hx = cx + r * Math.sin(t.rotation), hy = cy - r * Math.cos(t.rotation);
            return (
              <>
                <Line points={[cx, cy, hx, hy]} stroke={ROTATE_HANDLE_COLOR} strokeWidth={1} dash={[3, 3]} listening={false} />
                <Circle
                  name="stack-rotate"
                  x={hx} y={hy} radius={5} fill={ROTATE_HANDLE_COLOR} stroke="#fff" strokeWidth={1.5}
                  draggable
                  onMouseDown={(e) => { e.cancelBubble = true; }}
                  onDragStart={(e) => { e.cancelBubble = true; rotateStart.current = { id, centre: { x: cx, y: cy } }; onBegin?.(); }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const s = rotateStart.current; if (!s) return;
                    const pos = e.target.position();
                    const angle = Math.atan2(pos.y - s.centre.y, pos.x - s.centre.x) + Math.PI / 2;
                    onSetPieces?.([{ id: s.id, rotation: e.evt.shiftKey ? Math.round(angle / (Math.PI / 12)) * (Math.PI / 12) : angle }]);
                  }}
                  onDragEnd={(e) => { e.cancelBubble = true; rotateStart.current = null; }}
                />
              </>
            );
          })()}
        </Group>
      ))}

      {zones.map((z) => (
        <Circle
          key={z.key} name="stack-split" x={z.x} y={z.y} radius={4} fill="#10b981" stroke="#fff" strokeWidth={1.5}
          onMouseDown={(e) => { e.cancelBubble = true; }}
          onClick={(e) => { e.cancelBubble = true; onSplit?.(z.pieceId, z.cut); }}
          onTap={(e) => { e.cancelBubble = true; onSplit?.(z.pieceId, z.cut); }}
        />
      ))}

      {joins.map((j) => {
        const from = byId.get(j.from.pieceId), to = byId.get(j.to.pieceId);
        const fa = from?.faces[j.from.faceIndex], fb = to?.faces[j.to.faceIndex];
        if (!from || !to || !fa || !fb) return null;
        const A = transformFace(fa, pieceTransform(from)), B = transformFace(fb, pieceTransform(to));
        const [p0, p1, p2, p3] = joinCenterline(A, B, j.bow);
        const m = { x: (p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8 * scale, y: (p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8 * scale };
        const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) * scale;
        if (chord < 4) return null;   // nothing to bend yet
        const n = { x: -(p3[1] - p0[1]) * scale / chord, y: (p3[0] - p0[0]) * scale / chord };
        return (
          <Circle
            key={j.id}
            name="stack-bow"
            x={m.x} y={m.y} radius={4.5} fill={BOW_HANDLE_COLOR} stroke="#fff" strokeWidth={1.5}
            draggable
            onMouseDown={(e) => { e.cancelBubble = true; }}
            onDblClick={(e) => { e.cancelBubble = true; onBegin?.(); onSetBow?.(j.id, 0); }}
            onDragStart={(e) => { e.cancelBubble = true; bowStart.current = { id: j.id, bow: j.bow, n, chord, pointer: pointerIn() }; onBegin?.(); }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const s = bowStart.current; if (!s) return;
              const now = pointerIn();
              const along = ((now.x - s.pointer.x) * s.n.x + (now.y - s.pointer.y) * s.n.y) / s.chord;
              onSetBow?.(s.id, Math.min(BOW_MAX, Math.max(BOW_MIN, s.bow + along * 2)));
            }}
            onDragEnd={(e) => { e.cancelBubble = true; bowStart.current = null; }}
          />
        );
      })}
    </Group>
  );
};
