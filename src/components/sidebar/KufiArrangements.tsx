import { useEffect, useMemo, useRef, useState } from "react";
import { useSchemeTick } from "../../hooks/useSchemeTick";
import type { KufiPackResult } from "../../lib/kufi/kufiPack";
import {
  pickArrangements,
  type KufiArrangement,
} from "../../lib/kufi/kufiExplore";
import type { KufiExploreState } from "../../lib/kufi/kufiExploreClient";

type Ok = Extract<KufiPackResult, { ok: true }>;

/** Canvas pixels per cell in a thumbnail. */
const CELL_PX = 3;

/** A stable identity for a change, so thumbnails keep their key and hover as picks reorder. */
const changeId = (a: KufiArrangement): string =>
  a.change.kind === "form"
    ? `form:${a.change.unitIndex}:${a.change.glyphId}`
    : `stretch:${a.change.unitIndex}:${a.change.stretchIndex}:${a.change.counts.join(",")}`;

/** One panel's cells, ink in the text colour; with `against`, the cells that differ from it outlined. */
const Thumb: React.FC<{ result: Ok; against?: Ok | null }> = ({
  result,
  against = null,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const scheme = useSchemeTick();
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const { cols, rows, cells } = result;
    // whole device pixels per cell, so cells stay sharp on any screen
    const px = Math.max(1, Math.round(CELL_PX * (window.devicePixelRatio || 1)));
    const canvas = ref.current!;
    canvas.width = cols * px;
    canvas.height = rows * px;
    canvas.style.width = `${(cols * px) / (window.devicePixelRatio || 1)}px`;
    const css = getComputedStyle(canvas);
    ctx.fillStyle = css.getPropertyValue("--text-primary").trim() || "#000";
    for (let i = 0; i < cols * rows; i++)
      if (cells[i])
        ctx.fillRect(
          (i % cols) * px,
          Math.floor(i / cols) * px,
          px,
          px,
        );
    if (against && against.cols === cols && against.rows === rows) {
      ctx.strokeStyle = css.getPropertyValue("--accent").trim() || "#c00";
      const lw = Math.max(1, Math.round(px / CELL_PX));
      ctx.lineWidth = lw;
      for (let i = 0; i < cols * rows; i++)
        if (!!cells[i] !== !!against.cells[i])
          ctx.strokeRect(
            (i % cols) * px + lw / 2,
            Math.floor(i / cols) * px + lw / 2,
            px - lw,
            px - lw,
          );
    }
  }, [result, against, scheme]);
  return (
    <canvas
      ref={ref}
      width={result.cols * CELL_PX}
      height={result.rows * CELL_PX}
      aria-hidden="true"
    />
  );
};

/**
 * Other valid layouts of the panel, one change away from the current one,
 * found by the explore worker. Click applies one (the caller commits it as a
 * single undo step). Nothing shows when the current panel is not packed.
 */
export const KufiArrangements: React.FC<{
  current: Ok;
  state: KufiExploreState | null;
  onApply: (a: KufiArrangement) => void;
}> = ({ current, state, onApply }) => {
  const [hover, setHover] = useState<string | null>(null);
  const finished = !!state && (state.done || state.failed);
  const tries = state?.tries;
  const picks = useMemo(
    () => (tries ? pickArrangements(current, tries) : []),
    [current, tries],
  );

  return (
    <div className="kufiArrangements">
      <h4 className="kufiArrangementsTitle">Arrangements</h4>
      <div className="kufiArrangementsStrip">
        <button
          type="button"
          className="kufiArrangement"
          aria-pressed="true"
          aria-disabled="true"
          aria-label="Current arrangement"
          title="Current arrangement"
          tabIndex={-1}
        >
          <Thumb result={current} />
        </button>
        {picks.map((a, i) => {
          const id = changeId(a);
          return (
            <button
              key={id}
              type="button"
              className="kufiArrangement"
              aria-pressed="false"
              aria-label={`Arrangement ${i + 1}`}
              title={`${a.changedCells} cells differ`}
              onClick={() => onApply(a)}
              onMouseEnter={() => setHover(id)}
              onMouseLeave={() => setHover((h) => (h === id ? null : h))}
              onFocus={() => setHover(id)}
              onBlur={() => setHover((h) => (h === id ? null : h))}
            >
              <Thumb
                result={a.result}
                against={hover === id ? current : null}
              />
            </button>
          );
        })}
      </div>
      {!finished ? (
        <div className="kufiArrangementsNote">Looking…</div>
      ) : picks.length === 0 ? (
        <div className="kufiArrangementsNote">
          No other arrangement fits this box
        </div>
      ) : null}
    </div>
  );
};
