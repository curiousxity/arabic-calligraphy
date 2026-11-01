import React, { useId, useMemo, useState } from "react";
import type { KufiStarBlock } from "../../types";
import { CheckboxRow } from "./FormControls";
import { STAR_KS, starConstruction, type StarFold } from "../../lib/kufi/kufiStarGeometry";
import { kufiStarPath, starOutlineBox } from "../../lib/kufi/kufiStarPath";
import type { KufiStarEvaluation, KufiStarOffer } from "../../lib/kufi/kufiStarEvaluate";
import { requestKufiStarOffers, seedKufiStarLayout } from "../../lib/kufi/kufiLayoutClient";

const KUFI_STAR_MIN_SIZE = 12;
const KUFI_STAR_MAX_SIZE = 60;
const FOLDS: StarFold[] = [4, 5, 6];
const K_LABELS = ["Classic", "Alternative"];

/** A fold's blank region list: the centre, 2n wedges and n corners, `1 + 3n` in all. */
const emptyStarRegions = (fold: StarFold): string[] => Array.from({ length: 1 + 3 * fold }, () => "");

/** Preview width in px; the height follows the star's outline. */
const PREVIEW_PX = 76;

/** One offer drawn small: its construction and the regions that packed, one path, as the canvas draws it. */
const OfferPreview: React.FC<{ offer: KufiStarOffer; lines: boolean }> = ({ offer, lines }) => {
  const { d, w, h } = useMemo(() => {
    const c = starConstruction(offer.inputs.fold, offer.inputs.k, offer.inputs.size);
    const cells = c.regions.map((r) => {
      const res = offer.layout.regions[r.index]?.result;
      return res?.ok ? res.cells : null;
    });
    const box = starOutlineBox(c);
    return { d: kufiStarPath(c, cells, lines, 1), w: box.width, h: box.height };
  }, [offer, lines]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={PREVIEW_PX} height={(PREVIEW_PX * h) / w} aria-hidden="true">
      <path d={d} fill="currentColor" />
    </svg>
  );
};

/**
 * Find layouts: evaluates the block's text in the worker and lists the
 * offers, fitting ones first, each a small preview with its note. A click
 * approves one (fold, star, size and every region's text in one `onPatch`,
 * so one undo step). Offers made for another text are kept but marked stale.
 */
const KufiStarOffers: React.FC<{ block: KufiStarBlock; onPatch: (patch: Partial<KufiStarBlock>) => void }> = ({
  block,
  onPatch,
}) => {
  const [found, setFound] = useState<{ text: string; evaluation: KufiStarEvaluation } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = block.text;

  const find = () => {
    setPending(true);
    setError(null);
    requestKufiStarOffers(text).then(
      (evaluation) => {
        setFound({ text, evaluation });
        setPending(false);
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setPending(false);
      }
    );
  };

  const approve = (o: KufiStarOffer) => {
    seedKufiStarLayout(o.inputs, o.layout);
    onPatch({ starFold: o.inputs.fold, starK: o.inputs.k, starSize: o.inputs.size, starRegions: [...o.inputs.regions] });
  };

  const stale = found !== null && found.text !== text;
  const unread = found?.evaluation.words.filter((w) => !w.drawable).map((w) => w.text) ?? [];
  return (
    <div className="kufiArrangements" data-testid="kufi-star-offers">
      <button type="button" className="sidebarSectionButton" onClick={find} disabled={pending || text.trim() === ""}>
        <span>{pending ? "Finding layouts…" : "Find layouts"}</span>
      </button>
      {text.trim() === "" && !found && <div className="kufiArrangementsNote">Type the text in Content first.</div>}
      {error && <div className="kufiArrangementsNote">{error}</div>}
      {stale && <div className="kufiArrangementsNote">The text changed: find layouts again</div>}
      {found && !stale && (
        <>
          {unread.length > 0 && <div className="kufiArrangementsNote">Not drawn: {unread.join(" ")}</div>}
          {found.evaluation.offers.length === 0 && (
            <div className="kufiArrangementsNote">No layout to offer for this text.</div>
          )}
          <div className="kufiStarOfferList">
            {found.evaluation.offers.map((o, i) => (
              <button
                key={i}
                type="button"
                className={`kufiArrangement kufiStarOffer${o.fits ? "" : " kufiStarOffer--misfit"}`}
                data-testid="kufi-star-offer"
                onClick={() => approve(o)}
                title={o.fits ? "Use this layout" : "Use this layout; the parts named do not fit and stay empty"}
              >
                <OfferPreview offer={o} lines={block.starLines} />
                <span className="kufiStarOfferNote" dir="auto">
                  {o.fits ? "Fits: " : "Does not fit: "}
                  {o.note}
                </span>
              </button>
            ))}
          </div>
          {found.evaluation.notes.map((n) => (
            <div key={n} className="kufiArrangementsNote">
              {n}
            </div>
          ))}
          {!found.evaluation.complete && (
            <div className="kufiArrangementsNote">Not every layout was tried in the time allowed.</div>
          )}
        </>
      )}
    </div>
  );
};

/**
 * The Kufi star type panel: fold, which star, the ring's size and the
 * construction lines. Every change is one `onPatch` call, so one undo step.
 * Changing the fold resets the star to the classic one and the regions to
 * blank, since region indices mean something else in another fold.
 * Find layouts (`KufiStarOffers`) is the way text gets into the regions.
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
      <KufiStarOffers block={block} onPatch={onPatch} />
    </div>
  );
};
