import React, { useMemo, useRef, useState } from "react";
import { Circle, Group, Line } from "react-konva";
import type Konva from "konva";
import type { StackPiece, StackJoin, StackBlock } from "../types";
import { chainOf, pieceTransform } from "../lib/stackOutline";
import { transformCmds, transformFace, transformPt } from "../lib/stackGeometry";
import { flattenContours, findCutZonesSwept, zoneCentre, DEFAULT_DETECT_OPTS, type CutZone } from "../lib/strokeCuts";
import type { SvgCmd } from "../lib/svgPath";
import { joinCenterline, joinHandles, solveJoinDrag } from "../lib/stackJoin";
import { EXPORT_HIDDEN } from "../lib/exportChrome";

const ROTATE_HANDLE_COLOR = "#8b5cf6";
const BOW_HANDLE_COLOR = "#f59e0b";
/** Keyed on a piece's `cmds` identity (a render-pure cache; refs may not be read in render). */
const sweepCache = new WeakMap<SvgCmd[], CutZone[]>();
/** px: while the pointer is this close to the hovered piece's tilt handle,
 *  crossing another letter on the way does not take the handle away. */
const HANDLE_HOLD_PX = 12;
const ROTATE_HANDLE_R = 36;

/** The tilt handle of a piece, in block px: its pivot and the handle point. */
function rotateHandleOf(p: StackPiece, scale: number) {
  const cx = (p.pivot[0] + p.x) * scale, cy = (p.pivot[1] + p.y) * scale;
  return { cx, cy, hx: cx + ROTATE_HANDLE_R * Math.sin(p.rotation), hy: cy - ROTATE_HANDLE_R * Math.cos(p.rotation) };
}

export type StackEditOverlayProps = {
  isSelected: boolean;
  pieces: StackPiece[];
  joins: StackJoin[];
  nib: StackBlock["nib"];
  /** px per font unit. */
  scale: number;
  onBegin?: () => void;
  onSetPieces?: (patches: { id: string; x?: number; y?: number; rotation?: number }[]) => void;
  /** The bend of a join: `bow` (asymmetry) and `depth` (both handles longer). */
  onSetBow?: (joinId: string, bend: { bow: number; depth: number }) => void;
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
  const bowDownAt = useRef<{ x: number; y: number } | null>(null);
  const bowStart = useRef<{ id: string; bow: number; depth: number; tA: number; tB: number; chord: number; pointer: { x: number; y: number } } | null>(null);

  const polygons = useMemo(() =>
    pieces.map((p) => {
      const contours = flattenContours(transformCmds(p.cmds, pieceTransform(p)));
      // The largest contour is the letter body; marks are a single contour anyway.
      const outer = contours.reduce((a, b) => (b.length > a.length ? b : a), contours[0] ?? []);
      return { id: p.id, points: outer.flatMap(([x, y]) => [x * scale, y * scale]) };
    }), [pieces, scale]);

  // The sweep is fifteen rotations per piece, so it runs only while armed, and
  // only once per `cmds` array: a drag rebuilds `pieces` every frame but never
  // touches a piece's commands. The transform is applied outside the cache so
  // the dots still follow a moved piece.
  const zones = useMemo(() => {
    if (!tailMode) return [];
    const upm = unitsPerEm || 1000;   // as stackScale: a save without it is 1000
    const opts = { ...DEFAULT_DETECT_OPTS, step: upm / 100, minZoneWidth: upm / 40 };
    return pieces.filter((p) => p.role === "letter").flatMap((p) => {
      let found = sweepCache.get(p.cmds);
      if (!found) {
        found = findCutZonesSwept(flattenContours(p.cmds), { glyphIndex: 0, cluster: 0 }, opts);
        sweepCache.set(p.cmds, found);
      }
      return found.map((z, i) => {
        const [lx, ly] = zoneCentre(z);
        const w = transformPt([lx, ly], pieceTransform(p));
        return { key: `${p.id}:${i}`, pieceId: p.id, cut: { cutX: (z.fromX + z.toX) / 2, angle: z.angle }, x: w[0] * scale, y: w[1] * scale };
      });
    });
  }, [tailMode, pieces, scale, unitsPerEm]);

  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);

  if (!isSelected) return null;

  // Handles sit at different depths (piece Group vs the overlay Group), so
  // read the pointer from the overlay Group itself rather than counting parents.
  const pointerIn = () => groupRef.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };

  // Letters overlap in a stack, so the way to a tilt handle often crosses a
  // neighbour: hold the current hover while the pointer is near its handle.
  const hover = (id: string) => {
    if (id === hovered) return;
    const cur = hovered ? byId.get(hovered) : undefined;
    if (cur && cur.role === "letter") {
      const { hx, hy } = rotateHandleOf(cur, scale);
      const at = pointerIn();
      if (Math.hypot(at.x - hx, at.y - hy) <= HANDLE_HOLD_PX) return;
    }
    setHovered(id);
  };

  return (
    <Group ref={groupRef} name={EXPORT_HIDDEN}>
      {polygons.map(({ id, points }) => (
        // No mouseleave: the last-hovered piece keeps its tilt handle until another is hovered.
        <Group key={id} onMouseEnter={() => hover(id)} onMouseMove={() => hover(id)}>
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
        </Group>
      ))}

      {hovered && byId.get(hovered)?.role === "letter" && (() => {
        const id = hovered;
        const { cx, cy, hx, hy } = rotateHandleOf(byId.get(id)!, scale);
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
              onDragEnd={(e) => { e.cancelBubble = true; rotateStart.current = null; e.target.position({ x: hx, y: hy }); }}
            />
          </>
        );
      })()}

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
        const depth = j.depth ?? 0;
        const [p0, p1, p2, p3] = joinCenterline(A, B, j.bow, depth);
        const m = { x: (p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8 * scale, y: (p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8 * scale };
        const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) * scale;
        if (chord < 4) return null;   // nothing to bend yet
        return (
          <Circle
            key={j.id}
            name="stack-bow"
            x={m.x} y={m.y} radius={4.5} fill={BOW_HANDLE_COLOR} stroke="#fff" strokeWidth={1.5}
            draggable
            // The press, not dragstart, is the baseline: Konva starts a drag a
            // few px into the move, and measuring from there left the handle
            // that far behind the pointer for the whole drag.
            onMouseDown={(e) => { e.cancelBubble = true; bowDownAt.current = pointerIn(); }}
            onTouchStart={() => { bowDownAt.current = pointerIn(); }}
            onDblClick={(e) => {
              e.cancelBubble = true;
              if (j.bow === 0 && depth === 0) return;
              onBegin?.();
              onSetBow?.(j.id, { bow: 0, depth: 0 });
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;
              // The bow and depth the clamped handles actually draw, so the
              // first drag frame does not jump.
              const [h0, h1] = joinHandles(chord, j.bow, depth);
              const k = chord / 3;
              bowStart.current = {
                id: j.id, bow: (h0 - h1) / (2 * k), depth: (h0 + h1) / (2 * k) - 1,
                tA: A.tangent, tB: B.tangent, chord, pointer: bowDownAt.current ?? pointerIn(),
              };
              onBegin?.();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const s = bowStart.current; if (!s) return;
              const now = pointerIn();
              // A 2-D target: both handle lengths move so the midpoint lands
              // as near the pointer as the two tangents allow (block px).
              onSetBow?.(s.id, solveJoinDrag(s, s.tA, s.tB, s.chord, [now.x - s.pointer.x, now.y - s.pointer.y]));
            }}
            onDragEnd={(e) => { e.cancelBubble = true; bowStart.current = null; bowDownAt.current = null; e.target.position({ x: m.x, y: m.y }); }}
          />
        );
      })}
    </Group>
  );
};
