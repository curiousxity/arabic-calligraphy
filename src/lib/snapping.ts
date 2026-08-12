/**
 * Bounds-aware snapping maths.
 *
 * Everything here works on plain rectangles in stage space — no React, no
 * Konva — so the geometry can be unit-tested without a canvas. `CanvasStage`
 * supplies the rectangles from `getClientRect` and applies the resulting
 * delta to the dragged node's position.
 *
 * The distinction that motivates the module: the drag handler used to snap a
 * block's *origin* to another block's *origin*, but a block's origin is not
 * its visual edge (a centred text block's box starts at `-width / 2`), so two
 * aligned origins can look unaligned and "right edge against that image's
 * left edge" was not expressible at all.
 */

export type Rect = { x: number; y: number; width: number; height: number };

/** A candidate line a dragged rect can snap to, in stage space. */
export type SnapTarget = {
  axis: "x" | "y";
  position: number;
  /** Which edge of the source produced it — drives the rendered line's extent. */
  kind: "edge" | "center" | "guide" | "artboard";
  /** Stage-space extent of the source, used to draw a line only as long as it needs to be. */
  span?: { from: number; to: number };
};

export type SnapLine = {
  axis: "x" | "y";
  position: number;
  from: number;
  to: number;
};

export type SnapResult = {
  dx: number;
  dy: number;
  lines: SnapLine[];
};

/**
 * Precedence for equidistant targets: a user who deliberately dropped a ruler
 * guide means it, so a guide outranks the artboard, which outranks another
 * block's edge, which outranks that block's centre. Lower wins.
 */
const KIND_PRIORITY: Record<SnapTarget["kind"], number> = {
  guide: 0,
  artboard: 1,
  edge: 2,
  center: 3,
};

/** The three snappable coordinates on each axis: near edge, centre, far edge. */
export function rectEdges(r: Rect): {
  x: [number, number, number];
  y: [number, number, number];
} {
  return {
    x: [r.x, r.x + r.width / 2, r.x + r.width],
    y: [r.y, r.y + r.height / 2, r.y + r.height],
  };
}

/** The extent a rect occupies along the axis *perpendicular* to `axis`. */
const spanOf = (r: Rect, axis: "x" | "y") =>
  axis === "x"
    ? { from: r.y, to: r.y + r.height }
    : { from: r.x, to: r.x + r.width };

function rectTargets(r: Rect, kind: "edge" | "artboard"): SnapTarget[] {
  const { x, y } = rectEdges(r);
  const centerKind = kind === "artboard" ? "artboard" : "center";
  return [
    { axis: "x", position: x[0], kind, span: spanOf(r, "x") },
    { axis: "x", position: x[1], kind: centerKind, span: spanOf(r, "x") },
    { axis: "x", position: x[2], kind, span: spanOf(r, "x") },
    { axis: "y", position: y[0], kind, span: spanOf(r, "y") },
    { axis: "y", position: y[1], kind: centerKind, span: spanOf(r, "y") },
    { axis: "y", position: y[2], kind, span: spanOf(r, "y") },
  ];
}

/**
 * Every line a dragged rect may snap to: the other blocks' edges and centres,
 * the artboard's own edges and centres, and the user's ruler guides.
 *
 * Guides carry no span — they are already drawn full-length on the canvas, so
 * a snap line against one only needs to cover the dragged rect itself.
 */
export function buildSnapTargets(
  others: Rect[],
  artboard: Rect,
  guides: { horizontal: number[]; vertical: number[] }
): SnapTarget[] {
  const targets: SnapTarget[] = [];
  for (const g of guides.vertical) targets.push({ axis: "x", position: g, kind: "guide" });
  for (const g of guides.horizontal) targets.push({ axis: "y", position: g, kind: "guide" });
  targets.push(...rectTargets(artboard, "artboard"));
  for (const other of others) targets.push(...rectTargets(other, "edge"));
  return targets;
}

type Match = { target: SnapTarget; delta: number; distance: number };

/** Closest target on one axis, ties broken by `KIND_PRIORITY`. */
function bestMatch(
  edges: readonly number[],
  targets: SnapTarget[],
  axis: "x" | "y",
  threshold: number
): Match | null {
  let best: Match | null = null;
  for (const target of targets) {
    if (target.axis !== axis) continue;
    for (const edge of edges) {
      const distance = Math.abs(target.position - edge);
      if (distance > threshold) continue;
      if (best) {
        const closer = distance < best.distance - 1e-9;
        const tied = Math.abs(distance - best.distance) <= 1e-9;
        const outranks =
          tied && KIND_PRIORITY[target.kind] < KIND_PRIORITY[best.target.kind];
        if (!closer && !outranks) continue;
      }
      best = { target, delta: target.position - edge, distance };
    }
  }
  return best;
}

const lineFor = (match: Match, dragged: Rect, axis: "x" | "y"): SnapLine => {
  const own = spanOf(dragged, axis);
  const other = match.target.span;
  return {
    axis,
    position: match.target.position,
    from: other ? Math.min(own.from, other.from) : own.from,
    to: other ? Math.max(own.to, other.to) : own.to,
  };
};

/**
 * The delta that snaps `dragged` to its nearest target on each axis.
 *
 * At most one snap per axis — considering several would let a block be pulled
 * two directions at once along the same axis.
 */
export function computeSnap(
  dragged: Rect,
  targets: SnapTarget[],
  threshold: number
): SnapResult {
  const edges = rectEdges(dragged);
  const matchX = bestMatch(edges.x, targets, "x", threshold);
  const matchY = bestMatch(edges.y, targets, "y", threshold);

  const lines: SnapLine[] = [];
  if (matchX) lines.push(lineFor(matchX, dragged, "x"));
  if (matchY) lines.push(lineFor(matchY, dragged, "y"));

  return { dx: matchX?.delta ?? 0, dy: matchY?.delta ?? 0, lines };
}
