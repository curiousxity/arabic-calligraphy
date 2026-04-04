import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type FloatingKeyboardState = {
  show: boolean;
  docked: boolean;
  pos: { x: number; y: number };
  width: number;
  openDocked: () => void;
  openFloating: () => void;
  close: () => void;
  startDrag: React.MouseEventHandler<HTMLDivElement>;
  startResize: React.MouseEventHandler<HTMLDivElement>;
};

const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 420;
const MAX_WIDTH = 920;
const MIN_LEFT = 12;
const MIN_TOP = 12;
const DEFAULT_TOP = 280;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const useFloatingKeyboard = (canvasWidth: number): FloatingKeyboardState => {
  const [show, setShow] = useState(false);
  const [docked, setDocked] = useState(true);
  const [pos, setPos] = useState({ x: 360, y: DEFAULT_TOP });
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  const dragRef = useRef<{
    offsetX: number;
    offsetY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  const resizeRef = useRef<{ startX: number; baseWidth: number } | null>(null);

  const boundsRef = useRef({
    width: canvasWidth,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  });

  useEffect(() => {
    boundsRef.current.width = canvasWidth;
    if (docked) return;

    setPos((p) => ({
      x: clamp(p.x, MIN_LEFT, Math.max(MIN_LEFT, canvasWidth - MIN_WIDTH - MIN_LEFT)),
      y: clamp(p.y, MIN_TOP, Math.max(MIN_TOP, boundsRef.current.height - 120)),
    }));
  }, [canvasWidth, docked]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const { offsetX, offsetY } = dragRef.current;
        const w = boundsRef.current.width;
        const h = boundsRef.current.height;
        const nextX = e.clientX - offsetX;
        const nextY = e.clientY - offsetY;
        const maxX = Math.max(MIN_LEFT, w - width - MIN_LEFT);
        const maxY = Math.max(MIN_TOP, h - 120);

        setPos({
          x: clamp(nextX, MIN_LEFT, maxX),
          y: clamp(nextY, MIN_TOP, maxY),
        });
      }

      if (resizeRef.current) {
        const { startX, baseWidth } = resizeRef.current;
        const nextWidth = clamp(baseWidth + (e.clientX - startX), MIN_WIDTH, MAX_WIDTH);
        setWidth(nextWidth);
      }
    };

    const onUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [width]);

  const openDocked = useCallback(() => {
    setShow(true);
    setDocked(true);
    dragRef.current = null;
    resizeRef.current = null;
  }, []);

  const openFloating = useCallback(() => {
    setShow(true);
    setDocked(false);
    setWidth((w) => clamp(w, MIN_WIDTH, MAX_WIDTH));
    setPos({
      x: clamp(360, MIN_LEFT, Math.max(MIN_LEFT, canvasWidth - MIN_WIDTH - MIN_LEFT)),
      y: clamp(DEFAULT_TOP, MIN_TOP, Math.max(MIN_TOP, boundsRef.current.height - 120)),
    });
    dragRef.current = null;
    resizeRef.current = null;
  }, [canvasWidth]);

  const close = useCallback(() => {
    setShow(false);
    dragRef.current = null;
    resizeRef.current = null;
  }, []);

  const startDrag = useCallback<React.MouseEventHandler<HTMLDivElement>>(
    (e) => {
      if (docked) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        offsetX: e.clientX - pos.x,
        offsetY: e.clientY - pos.y,
        baseX: pos.x,
        baseY: pos.y,
      };
    },
    [docked, pos.x, pos.y]
  );

  const startResize = useCallback<React.MouseEventHandler<HTMLDivElement>>(
    (e) => {
      if (docked) return;
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { startX: e.clientX, baseWidth: width };
    },
    [docked, width]
  );

  return useMemo(
    () => ({
      show,
      docked,
      pos,
      width,
      openDocked,
      openFloating,
      close,
      startDrag,
      startResize,
    }),
    [show, docked, pos, width, openDocked, openFloating, close, startDrag, startResize]
  );
};
