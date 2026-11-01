import React, { useId, useState } from "react";
import type { KufiStarBlock } from "../../types";
import { CheckboxRow } from "./FormControls";
import { STAR_KS, type StarFold } from "../../lib/kufi/kufiStarGeometry";

const KUFI_STAR_MIN_SIZE = 12;
const KUFI_STAR_MAX_SIZE = 60;
const FOLDS: StarFold[] = [4, 5, 6];
const K_LABELS = ["Classic", "Alternative"];

/** A fold's blank region list: the centre, 2n wedges and n corners, `1 + 3n` in all. */
const emptyStarRegions = (fold: StarFold): string[] => Array.from({ length: 1 + 3 * fold }, () => "");

/**
 * The Kufi star type panel: fold, which star, the ring's size and the
 * construction lines. Every change is one `onPatch` call, so one undo step.
 * Changing the fold resets the star to the classic one and the regions to
 * blank, since region indices mean something else in another fold.
 */
export const KufiStarPanel: React.FC<{
  block: KufiStarBlock;
  onPatch: (patch: Partial<KufiStarBlock>) => void;
}> = ({ block, onPatch }) => {
  const id = useId();
  const [draft, setDraft] = useState<{ for: number; text: string } | null>(null);
  const shown = draft && draft.for === block.starSize ? draft.text : String(block.starSize);

  const commit = (text: string) => {
    const v = Number(text);
    if (text.trim() === "" || !Number.isFinite(v)) return;
    const size = Math.min(KUFI_STAR_MAX_SIZE, Math.max(KUFI_STAR_MIN_SIZE, Math.round(v)));
    if (size !== block.starSize) onPatch({ starSize: size });
  };

  return (
    <div className="sectionPanel" data-testid="kufi-star-panel">
      <div className="field">
        <span className="fieldTitle">Fold</span>
        <div className="kufiToolRow" role="group" aria-label="Fold">
          {FOLDS.map((f) => (
            <button
              key={f}
              type="button"
              className={`sidebarPillButton${f === block.starFold ? " sidebarPillButton--active" : ""}`}
              aria-pressed={f === block.starFold}
              onClick={() => {
                if (f !== block.starFold) onPatch({ starFold: f, starK: STAR_KS[f][0], starRegions: emptyStarRegions(f) });
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="fieldTitle">Star</span>
        <div className="kufiToolRow" role="group" aria-label="Star">
          {STAR_KS[block.starFold].map((k, i) => (
            <button
              key={k}
              type="button"
              className={`sidebarPillButton${k === block.starK ? " sidebarPillButton--active" : ""}`}
              aria-pressed={k === block.starK}
              onClick={() => k !== block.starK && onPatch({ starK: k })}
            >
              {K_LABELS[i] ?? `{${2 * block.starFold}/${k}}`}
            </button>
          ))}
        </div>
      </div>
      <label className="field" htmlFor={`${id}-size`}>
        <span className="fieldTitle">Size</span>
        <input
          id={`${id}-size`}
          type="number"
          inputMode="numeric"
          min={KUFI_STAR_MIN_SIZE}
          max={KUFI_STAR_MAX_SIZE}
          step={1}
          value={shown}
          className="hexInput artboardNumberInput"
          aria-label="Size in cells"
          onChange={(e) => {
            const text = e.target.value;
            // A stepper click or arrow key carries no inputType; typing does.
            if (!(e.nativeEvent as InputEvent).inputType) {
              setDraft(null);
              commit(text);
            } else setDraft({ for: block.starSize, text });
          }}
          onBlur={(e) => {
            commit(e.currentTarget.value);
            setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </label>
      <CheckboxRow
        id={`${id}-lines`}
        label="Show construction lines"
        checked={block.starLines}
        onChange={(starLines) => onPatch({ starLines })}
      />
    </div>
  );
};
