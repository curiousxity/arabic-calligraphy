import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type Konva from "konva";
import { DD } from "konva/lib/DragAndDrop";
import { pinchStep } from "../lib/canvasBounds";

type Point = { x: number; y: number };

/**
 * Two-finger pan and pinch-zoom on the canvas.
 *
 * Konva drives its drags from `touchstart` on its content element and from
 * `touchmove`/`touchend` on `window`. These listeners sit on the stage's
 * container in the *capture* phase, so a second finger is seen — and
 * swallowed — before Konva can treat it as a press on whatever block it lands
 * on. A one-finger touch passes straight through untouched: that is a block
 * drag, a tap to select, or the hand tool's pan, exactly as before.
 *
 * When the second finger lands, any drag the first finger started is stopped
 * through Konva itself (so its `dragend` commits the block where it got to,
 * and undo removes it), and the rest of the gesture belongs to the canvas
 * until every finger has lifted — lifting one finger of a pinch must not turn
 * the other into a block drag or a tap.
 */
export function useTouchPinch(
  stageRef: RefObject<Konva.Stage | null>,
  scale: number,
  position: Point,
  onUpdateStage: (scale: number, position: Point) => void
) {
  const latest = useRef({ scale, position, onUpdateStage });
  useLayoutEffect(() => {
    latest.current = { scale, position, onUpdateStage };
  });

  useEffect(() => {
    const el = stageRef.current?.container();
    if (!el) return;

    // The view is carried through the gesture rather than re-read from props,
    // because several touchmoves can arrive before React re-renders.
    let pinch: { ids: [number, number]; points: [Point, Point]; view: { scale: number; position: Point } } | null =
      null;
    let ownsGesture = false;

    const local = (t: Touch): Point => {
      const r = el.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const byId = (list: TouchList, id: number) => Array.from(list).find((t) => t.identifier === id);
    const swallow = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        DD._dragElements.forEach((elem) => elem.node.stopDrag());
        DD._dragElements.clear();
        const [a, b] = [e.touches[0], e.touches[1]];
        const { scale: s, position: p } = latest.current;
        pinch = { ids: [a.identifier, b.identifier], points: [local(a), local(b)], view: { scale: s, position: p } };
        ownsGesture = true;
      }
      if (ownsGesture) swallow(e);
    };

    const onMove = (e: TouchEvent) => {
      if (!ownsGesture) return;
      swallow(e);
      if (!pinch) return;
      const a = byId(e.touches, pinch.ids[0]);
      const b = byId(e.touches, pinch.ids[1]);
      if (!a || !b) return;
      const next: [Point, Point] = [local(a), local(b)];
      pinch.view = pinchStep(pinch.points, next, pinch.view.scale, pinch.view.position);
      pinch.points = next;
      latest.current.onUpdateStage(pinch.view.scale, pinch.view.position);
    };

    const onEnd = (e: TouchEvent) => {
      if (!ownsGesture) return;
      swallow(e);
      if (pinch && !(byId(e.touches, pinch.ids[0]) && byId(e.touches, pinch.ids[1]))) pinch = null;
      if (e.touches.length === 0) ownsGesture = false;
    };

    const opts = { capture: true, passive: false } as const;
    el.addEventListener("touchstart", onStart, opts);
    el.addEventListener("touchmove", onMove, opts);
    el.addEventListener("touchend", onEnd, opts);
    el.addEventListener("touchcancel", onEnd, opts);
    return () => {
      el.removeEventListener("touchstart", onStart, opts);
      el.removeEventListener("touchmove", onMove, opts);
      el.removeEventListener("touchend", onEnd, opts);
      el.removeEventListener("touchcancel", onEnd, opts);
    };
  }, [stageRef]);
}
