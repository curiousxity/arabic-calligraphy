import { useEffect, useState } from "react";

/** Bumps when the colour scheme changes, so canvas thumbnails (which read CSS variables once per draw) repaint. */
export function useSchemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const bump = () => setTick((t) => t + 1);
    mq.addEventListener("change", bump);
    return () => mq.removeEventListener("change", bump);
  }, []);
  return tick;
}
