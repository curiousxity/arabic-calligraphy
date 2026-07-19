import { useEffect, useState } from "react";
import { loadOverrideGlyph, type OverrideGlyph } from "../lib/glyphOverrides";

/** Loads the custom override glyph SVG once and re-renders callers when it's ready. */
export function useOverrideGlyph(): OverrideGlyph | null {
  const [glyph, setGlyph] = useState<OverrideGlyph | null>(null);

  useEffect(() => {
    let alive = true;
    loadOverrideGlyph().then((g) => {
      if (alive) setGlyph(g);
    });
    return () => {
      alive = false;
    };
  }, []);

  return glyph;
}
