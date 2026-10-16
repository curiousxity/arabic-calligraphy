import { useEffect, useState } from "react";
import { fontSupportsKashida } from "../lib/harfbuzz";
import { resolveFontUrl } from "./useShapedGlyphs";

/**
 * Whether the block's font can stretch a join with kashida: `null` while the
 * one-off probe runs (callers show their controls meanwhile), then the
 * cached answer. See `fontSupportsKashida`.
 */
export function useKashidaSupport(fontFamily: string): boolean | null {
  const [answer, setAnswer] = useState<{ font: string; ok: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    fontSupportsKashida(resolveFontUrl(fontFamily)).then((ok) => {
      if (live) setAnswer({ font: fontFamily, ok });
    });
    return () => {
      live = false;
    };
  }, [fontFamily]);
  return answer?.font === fontFamily ? answer.ok : null;
}
