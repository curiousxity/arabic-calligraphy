import { useEffect, useMemo, useRef } from "react";
import { useSchemeTick } from "../../hooks/useSchemeTick";
import type { KufiPackResult } from "../../lib/kufi/kufiPack";
import { kufiGlyphById } from "../../lib/kufi/kufiHit";
import { kufiLetterOptions, type KufiTry } from "../../lib/kufi/kufiExplore";
import type { KufiExploreState } from "../../lib/kufi/kufiExploreClient";

type Ok = Extract<KufiPackResult, { ok: true }>;

/** Canvas pixels per cell in a form preview. */
const CELL_PX = 4;

/** One form's rows of `#` and `.`, ink in the text colour. */
const GlyphPreview: React.FC<{ rows: string[] }> = ({ rows }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const scheme = useSchemeTick();
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cols * CELL_PX, rows.length * CELL_PX);
    ctx.fillStyle = getComputedStyle(ref.current!).getPropertyValue("--text-primary").trim() || "#000";
    rows.forEach((line, r) => {
      for (let c = 0; c < line.length; c++) if (line[c] === "#") ctx.fillRect(c * CELL_PX, r * CELL_PX, CELL_PX, CELL_PX);
    });
  }, [rows, cols, scheme]);
  return <canvas ref={ref} width={cols * CELL_PX} height={rows.length * CELL_PX} aria-hidden="true" />;
};

/**
 * The forms of the letter clicked on the canvas, from what exploring the
 * panel has found: a form that fits here applies on click (its explored try,
 * one undo step through the caller), the drawn one is pressed, one not tried
 * yet says "Checking…", and the rest are disabled.
 */
export const KufiLetterOptions: React.FC<{
  text: string;
  current: Ok;
  state: KufiExploreState | null;
  unitIndex: number;
  onApply: (t: KufiTry) => void;
}> = ({ text, current, state, unitIndex, onApply }) => {
  const options = useMemo(() => kufiLetterOptions(text, current, state, unitIndex), [text, current, state, unitIndex]);
  // a failed exploration tries no more: an untried form is then unknown, not pending
  const finished = !!state && state.done;
  if (options.forms.length === 0) return null;

  return (
    <div className="kufiArrangements" data-testid="kufi-letter-options">
      <h4 className="kufiArrangementsTitle">Letter forms</h4>
      {options.forms.length === 1 ? (
        <div className="kufiArrangementsNote">That letter has one form</div>
      ) : (
        <div className="kufiArrangementsStrip">
          {options.forms.map((f, i) => {
            const rows = kufiGlyphById(f.glyphId)?.rows ?? [];
            const isCurrent = f.fits === true && f.try === null;
            const pending = f.fits === null;
            const title = isCurrent
              ? "The form drawn now"
              : f.fits
                ? "Fits here"
                : pending
                  ? finished
                    ? "Not checked"
                    : "Checking…"
                  : "Doesn't fit here";
            return (
              <button
                key={f.glyphId}
                type="button"
                className="kufiArrangement kufiLetterForm"
                data-glyph-id={f.glyphId}
                aria-pressed={isCurrent}
                aria-label={`Form ${i + 1}`}
                title={title}
                disabled={f.fits !== true}
                onClick={() => {
                  if (!isCurrent && f.try) onApply(f.try);
                }}
              >
                <GlyphPreview rows={rows} />
                {pending && !finished && <span className="kufiLetterFormNote">Checking…</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
