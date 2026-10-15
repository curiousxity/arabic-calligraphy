import React, { useEffect, useMemo, useRef, useState } from "react";
import { Group, Line } from "react-konva";
import type Konva from "konva";
import type { StackPiece, StackJoin, StackBlock } from "../types";
import { chainOf, pieceTransform } from "../lib/stackOutline";
import { splitAtCut, transformCmds, transformFace, transformPt } from "../lib/stackGeometry";
import { flattenContours, findCutZonesSwept, type CutZone, type Pt } from "../lib/strokeCuts";
import type { SvgCmd } from "../lib/svgPath";
import { joinCenterline, joinEdges, joinFloor, joinHandles, solveJoinDrag } from "../lib/stackJoin";
import { cutAtPress, invertTransform, pullSpans, spanProbes, stackDetectOpts, zoneRect } from "../lib/stackZones";
import { complementOf } from "../lib/complementColor";
import { EXPORT_HIDDEN } from "../lib/exportChrome";

/** Keyed on a piece's `cmds` identity (a render-pure cache; refs may not be read in render). */
const sweepCache = new WeakMap<SvgCmd[], CutZone[]>();
/** Screen px: the band just outside a letter's edge that tilts it. */
const RING_PX = 14;
/** Screen px: the outline drawn on whatever the pointer is over. */
const OUTLINE_PX = 1.5;
/** Screen px: the least a join curve's hit band is wide. */
const JOIN_HIT_PX = 14;
/** Screen px added around a cut span's hit area: a thin stroke's span is only
 *  a few px tall, and Chrome rounds mouse positions to whole px. */
const CUT_SLACK_PX = 3;
const TILT_TICK_R = 36;

/** A curved arrow: there is no native rotate cursor. Hotspot at the centre. */
const ROTATE_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'>" +
  "<path d='M5 11a6 6 0 1 1 2.2 4.6' fill='none' stroke='white' stroke-width='4' stroke-linecap='round'/>" +
  "<path d='M5 11a6 6 0 1 1 2.2 4.6' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'/>" +
  "<path d='M3 12.5l4 5.5 3.5-4z' fill='black' stroke='white' stroke-width='1'/></svg>\") 11 11, grab";

/**
 * A hit-only band of constant screen width along a polyline. Drawn on the
 * hit canvas alone (no scene stroke), so it neither shows nor widens the
 * block's client rect — a transparent stroke would do both.
 */
function hitBand(points: number[], closed: boolean, widthPx: number, fillToo = false) {
  return (ctx: Konva.Context, shape: Konva.Shape) => {
    if (points.length < 4) return;
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    if (closed) ctx.closePath();
    if (fillToo) { ctx.fillStyle = shape.colorKey; ctx.fill(); }
    ctx.save();
    const pr = ctx.getCanvas().getPixelRatio();
    ctx.setTransform(pr, 0, 0, pr, 0, 0);   // the path is already in screen space
    ctx.lineWidth = widthPx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = shape.colorKey;
    ctx.stroke();
    ctx.restore();
  };
}

type Hover =
  | { kind: "piece"; id: string }
  | { kind: "ring"; id: string }
  | { kind: "join"; id: string }
  | { kind: "cut"; id: string; pieceId: string }
  | null;

export type StackEditOverlayProps = {
  isSelected: boolean;
  pieces: StackPiece[];
  joins: StackJoin[];
  nib: StackBlock["nib"];
  /** px per font unit. */
  scale: number;
  /** The block's ink; the chrome draws in its complement. */
  color: string;
  /** Dragging a letter carries the letters after it. Off: the letter alone. */
  moveTogether: boolean;
  onBegin?: () => void;
  onSetPieces?: (patches: { id: string; x?: number; y?: number; rotation?: number }[]) => void;
  /** The bend of a join: `bow` (asymmetry) and `depth` (both handles longer). */
  onSetBow?: (joinId: string, bend: { bow: number; depth: number }) => void;
  unitsPerEm: number;
  /** Cut a piece; returns the new end cap, or null if the cut was not legal.
   *  Pushes history itself (the cut and the pull that follows are one step). */
  onSplit?: (pieceId: string, cut: { cutX: number; angle: number }) => { id: string; x: number; y: number } | null;
};

/**
 * Editing chrome for a selected stack block. There are no modes and no
 * handles: whatever the pointer is over gets a thin outline in the ink's
 * complement, and a drag there does the one thing that place means.
 *
 *   ink of a letter or mark    → move (the letters after it come along)
 *   the band just outside ink  → tilt about the letter's pivot
 *   a join curve               → bend (double-click straightens)
 *   the free end of a straight stroke → press cuts there, the drag pulls the tail
 *
 * Z-order is the whole dispatch: rings lowest, then join curves, then the
 * body polygons, then the cut spans of the hovered letter. Everything is in
 * the block group's px space: the overlay Group is an untransformed child of
 * StackView's Group, so its relative pointer is the pointer in the frame
 * `pieces` are drawn in.
 */
export const StackEditOverlay: React.FC<StackEditOverlayProps> = ({
  isSelected, pieces, joins, nib, scale, color, moveTogether, onBegin, onSetPieces, onSetBow,
  unitsPerEm, onSplit,
}) => {
  const [hover, setHover] = useState<Hover>(null);
  const groupRef = useRef<Konva.Group>(null);
  const dragStart = useRef<{ ids: string[]; at: Map<string, { x: number; y: number }>; pointer: { x: number; y: number } } | null>(null);
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const rotateStart = useRef<{ id: string; centre: { x: number; y: number }; rotation: number; pressAngle: number } | null>(null);
  const bowStart = useRef<{ id: string; bow: number; depth: number; tA: number; tB: number; chord: number; pointer: { x: number; y: number } } | null>(null);
  // A tail pull is not a Konva drag: the pressed cut span unmounts the moment
  // the split changes the body's commands, and a node drag dies with it.
  const pull = useRef<{ capId: string; cap: { x: number; y: number }; pointer: { x: number; y: number }; end: () => void } | null>(null);

  const accent = useMemo(() => complementOf(color), [color]);

  const contoursPx = useMemo(() =>
    pieces.map((p) => {
      const contours = flattenContours(transformCmds(p.cmds, pieceTransform(p)));
      const all = contours.map((c) => c.flatMap(([x, y]) => [x * scale, y * scale]));
      // The largest contour is the letter body; marks are a single contour anyway.
      const outer = all.reduce((a, b) => (b.length > a.length ? b : a), all[0] ?? []);
      return { id: p.id, outer, all };
    }), [pieces, scale]);
  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);
  const contourById = useMemo(() => new Map(contoursPx.map((c) => [c.id, c])), [contoursPx]);

  // The sweep is fifteen rotations per piece, so it runs for the hovered
  // letter only, and once per `cmds` array: a drag rebuilds `pieces` every
  // frame but never touches a piece's commands.
  const hoveredPieceId = hover && hover.kind !== "join" ? (hover.kind === "cut" ? hover.pieceId : hover.id) : null;
  const cutSpans = useMemo(() => {
    const p = hoveredPieceId ? byId.get(hoveredPieceId) : undefined;
    if (!p || p.role !== "letter") return [];
    const upm = unitsPerEm || 1000;   // as stackScale: a save without it is 1000
    const opts = stackDetectOpts(upm);
    let zones = sweepCache.get(p.cmds);
    if (!zones) {
      zones = findCutZonesSwept(flattenContours(p.cmds), { glyphIndex: 0, cluster: 0 }, opts);
      sweepCache.set(p.cmds, zones);
    }
    const t = pieceTransform(p);
    // Only spans that will actually split: a zone legal for a stroke cut can
    // still cross a counter, which `splitAtCut` refuses.
    const splits = (z: CutZone, span: [number, number]) =>
      spanProbes(z, span).every((cutX) => splitAtCut(p.cmds, { cutX, angle: z.angle }) !== null);
    return zones.flatMap((z, zi) =>
      pullSpans(z).filter((span) => splits(z, span)).map(([from, to], si) => ({
        id: `${p.id}:${zi}:${si}`, pieceId: p.id, zone: z,
        points: zoneRect(z, from, to).flatMap((q) => { const w = transformPt(q, t); return [w[0] * scale, w[1] * scale]; }),
      })));
  }, [hoveredPieceId, byId, unitsPerEm, scale]);

  const joinGeom = useMemo(() => joins.flatMap((j) => {
    const from = byId.get(j.from.pieceId), to = byId.get(j.to.pieceId);
    const fa = from?.faces[j.from.faceIndex], fb = to?.faces[j.to.faceIndex];
    if (!from || !to || !fa || !fb) return [];
    const A = transformFace(fa, pieceTransform(from)), B = transformFace(fb, pieceTransform(to));
    const depth = j.depth ?? 0;
    const cl = joinCenterline(A, B, j.bow, depth);
    const chord = Math.hypot(cl[3][0] - cl[0][0], cl[3][1] - cl[0][1]) * scale;
    if (chord < 4) return [];   // nothing to bend yet
    const centre: number[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, u = 1 - t;
      const x = u * u * u * cl[0][0] + 3 * u * u * t * cl[1][0] + 3 * u * t * t * cl[2][0] + t * t * t * cl[3][0];
      const y = u * u * u * cl[0][1] + 3 * u * u * t * cl[1][1] + 3 * u * t * t * cl[2][1] + t * t * t * cl[3][1];
      centre.push(x * scale, y * scale);
    }
    const { edgeA, edgeB } = joinEdges(A, B, j.bow, joinFloor(A, B, nib.minFraction), 24, depth, j.profile);
    const band = [...edgeA, ...[...edgeB].reverse()].flatMap((q: Pt) => [q[0] * scale, q[1] * scale]);
    const thick = Math.max(Math.hypot(A.b[0] - A.a[0], A.b[1] - A.a[1]), Math.hypot(B.b[0] - B.a[0], B.b[1] - B.a[1])) * scale;
    return [{ j, A, B, depth, chord, centre, band, thick }];
  }), [joins, byId, scale, nib.minFraction]);

  // The cursor says what a drag here will do; cleared with the hover.
  useEffect(() => {
    const stage = groupRef.current?.getStage();
    if (!stage) return;
    const style = stage.container().style;
    const prev = style.cursor;
    style.cursor = !hover ? prev
      : hover.kind === "piece" ? "move"
      : hover.kind === "ring" ? ROTATE_CURSOR
      : hover.kind === "join" ? "grab"
      : "crosshair";
    return () => { style.cursor = prev; };
  }, [hover]);

  useEffect(() => () => { pull.current?.end(); }, []);

  if (!isSelected) return null;

  // Handles sit at different depths, so read the pointer from the overlay
  // Group itself rather than counting parents.
  const pointerIn = () => groupRef.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };
  const enter = (h: Hover) => { if (!pull.current) setHover(h); };

  const beginPull = (span: typeof cutSpans[number], stage: Konva.Stage | null) => {
    const p = byId.get(span.pieceId);
    if (!p || !stage || !onSplit) return;
    const at = pointerIn();
    const local = invertTransform([at.x / scale, at.y / scale], pieceTransform(p));
    const cap = onSplit(p.id, cutAtPress(span.zone, local));
    if (!cap) return;
    const end = () => { pull.current = null; stage.off(".stackpull"); window.removeEventListener("mouseup", end); window.removeEventListener("touchend", end); };
    pull.current = { capId: cap.id, cap: { x: cap.x, y: cap.y }, pointer: at, end };
    setHover({ kind: "piece", id: cap.id });
    stage.on("mousemove.stackpull touchmove.stackpull", () => {
      const s = pull.current; if (!s) return;
      const now = pointerIn();
      onSetPieces?.([{ id: s.capId, x: s.cap.x + (now.x - s.pointer.x) / scale, y: s.cap.y + (now.y - s.pointer.y) / scale }]);
    });
    stage.on("mouseup.stackpull touchend.stackpull", end);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchend", end);
  };

  const chainIds = hover?.kind === "piece" ? chainOf(pieces, hover.id, !moveTogether) : [];
  const outlineOf = (id: string, opacity: number) => contourById.get(id)?.all.map((pts, i) => (
    <Line key={`${id}-${i}`} points={pts} closed stroke={accent} strokeWidth={OUTLINE_PX} strokeScaleEnabled={false}
      opacity={opacity} listening={false} />
  ));

  return (
    <Group ref={groupRef} name={EXPORT_HIDDEN} onMouseLeave={() => { if (!pull.current) setHover(null); }}>
      {/* Tilt rings: the band just outside each letter. Lowest, so ink wins. */}
      {contoursPx.map(({ id, outer }) => byId.get(id)?.role === "letter" && (
        <Line
          key={`ring-${id}`} name="stack-ring" points={outer} closed fillEnabled={false} strokeEnabled={false}
          hitFunc={hitBand(outer, true, RING_PX * 2)}
          draggable
          onMouseEnter={() => enter({ kind: "ring", id })}
          onMouseDown={(e) => { e.cancelBubble = true; pressAt.current = pointerIn(); }}
          onTouchStart={() => { pressAt.current = pointerIn(); }}
          onDragStart={(e) => {
            e.cancelBubble = true;
            const p = byId.get(id)!;
            const centre = { x: (p.pivot[0] + p.x) * scale, y: (p.pivot[1] + p.y) * scale };
            const press = pressAt.current ?? pointerIn();
            rotateStart.current = { id, centre, rotation: p.rotation, pressAngle: Math.atan2(press.y - centre.y, press.x - centre.x) };
            onBegin?.();
          }}
          onDragMove={(e) => {
            e.cancelBubble = true;
            const s = rotateStart.current; if (!s) return;
            const now = pointerIn();
            const angle = s.rotation + Math.atan2(now.y - s.centre.y, now.x - s.centre.x) - s.pressAngle;
            onSetPieces?.([{ id: s.id, rotation: e.evt.shiftKey ? Math.round(angle / (Math.PI / 12)) * (Math.PI / 12) : angle }]);
          }}
          onDragEnd={(e) => { e.cancelBubble = true; rotateStart.current = null; pressAt.current = null; e.target.position({ x: 0, y: 0 }); }}
        />
      ))}

      {/* Join curves: drag to bend. */}
      {joinGeom.map(({ j, A, B, depth, chord, centre, thick }) => (
        <Line
          key={`join-${j.id}`} name="stack-join" points={centre} strokeEnabled={false}
          hitFunc={hitBand(centre, false, Math.max(JOIN_HIT_PX, thick))}
          draggable
          onMouseEnter={() => enter({ kind: "join", id: j.id })}
          // The press, not dragstart, is the baseline: Konva starts a drag a
          // few px into the move, and measuring from there left the curve
          // that far behind the pointer for the whole drag.
          onMouseDown={(e) => { e.cancelBubble = true; pressAt.current = pointerIn(); }}
          onTouchStart={() => { pressAt.current = pointerIn(); }}
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
              tA: A.tangent, tB: B.tangent, chord, pointer: pressAt.current ?? pointerIn(),
            };
            onBegin?.();
          }}
          onDragMove={(e) => {
            e.cancelBubble = true;
            const s = bowStart.current; if (!s) return;
            const now = pointerIn();
            // A 2-D target: both handle lengths move so the curve's midpoint
            // lands as near the pointer as the two tangents allow (block px).
            onSetBow?.(s.id, solveJoinDrag(s, s.tA, s.tB, s.chord, [now.x - s.pointer.x, now.y - s.pointer.y]));
          }}
          onDragEnd={(e) => { e.cancelBubble = true; bowStart.current = null; pressAt.current = null; e.target.position({ x: 0, y: 0 }); }}
        />
      ))}

      {/* Letter and mark bodies: drag to move. Mounted in `pieces` order. */}
      {contoursPx.map(({ id, outer }) => (
        <Line
          key={`piece-${id}`} name="stack-piece" points={outer} closed fill="transparent"
          draggable
          onMouseEnter={() => enter({ kind: "piece", id })}
          onMouseDown={(e) => { e.cancelBubble = true; }}
          onDragStart={(e) => {
            e.cancelBubble = true;
            const ids = chainOf(pieces, id, !moveTogether || e.evt.altKey);
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
      ))}

      {/* The free ends of the hovered letter's straight strokes: press to cut, pull the tail. */}
      {cutSpans.map((s) => (
        <Line
          key={s.id} name="stack-cut" points={s.points} closed fillEnabled={false} strokeEnabled={false}
          hitFunc={hitBand(s.points, true, CUT_SLACK_PX * 2, true)}
          onMouseEnter={() => enter({ kind: "cut", id: s.id, pieceId: s.pieceId })}
          onMouseDown={(e) => { e.cancelBubble = true; beginPull(s, e.target.getStage()); }}
          onTouchStart={(e) => { e.cancelBubble = true; beginPull(s, e.target.getStage()); }}
        />
      ))}

      {/* What the pointer is over, outlined. Nothing is drawn at rest. */}
      {hover?.kind === "piece" && [hover.id, ...chainIds.filter((i) => i !== hover.id)].map((id) => outlineOf(id, id === hover.id ? 1 : 0.4))}
      {hover?.kind === "ring" && (() => {
        const p = byId.get(hover.id); if (!p) return null;
        const cx = (p.pivot[0] + p.x) * scale, cy = (p.pivot[1] + p.y) * scale;
        return (
          <>
            {outlineOf(hover.id, 1)}
            <Line points={[cx, cy, cx + TILT_TICK_R * Math.sin(p.rotation), cy - TILT_TICK_R * Math.cos(p.rotation)]}
              stroke={accent} strokeWidth={1} strokeScaleEnabled={false} dash={[3, 3]} listening={false} />
          </>
        );
      })()}
      {hover?.kind === "join" && (() => {
        const g = joinGeom.find((x) => x.j.id === hover.id); if (!g) return null;
        return <Line points={g.band} closed stroke={accent} strokeWidth={OUTLINE_PX} strokeScaleEnabled={false} listening={false} />;
      })()}
      {hover?.kind === "cut" && (() => {
        const s = cutSpans.find((x) => x.id === hover.id); if (!s) return null;
        return <Line points={s.points} closed stroke={accent} strokeWidth={OUTLINE_PX} strokeScaleEnabled={false} listening={false} />;
      })()}
    </Group>
  );
};
