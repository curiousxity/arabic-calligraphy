import React, { useId, useMemo, useState } from "react";
import type { KufiStarBlock } from "../../types";
import { CheckboxRow } from "./FormControls";
import { defaultStarK, STAR_KS, type StarFold } from "../../lib/kufi/kufiStarGeometry";
import { kufiStarBox, kufiStarLayoutPath } from "../../lib/kufi/kufiStarPath";
import { kufiStarInputs, octagonSideText, octagonSizeFor, type KufiStarLayoutKind } from "../../lib/kufi/kufiStarLayout";
import { OCTAGON_MAX_SIZE, OCTAGON_MIN_SIZE } from "../../lib/kufi/kufiOctagon";
import type { KufiStarEvaluation, KufiStarOffer } from "../../lib/kufi/kufiStarEvaluate";
import { requestKufiStarOffers, seedKufiStarLayout } from "../../lib/kufi/kufiLayoutClient";

const KUFI_STAR_MIN_SIZE = 12;
const KUFI_STAR_MAX_SIZE = 60;
const FOLDS: StarFold[] = [4, 5, 6];
const K_LABELS = ["Classic", "Alternative"];
const LAYOUTS: Array<{ kind: KufiStarLayoutKind; label: string; title: string }> = [
  { kind: "octagon", label: "Octagon", title: "The text round the four sides of a square, its tall strokes lengthened to an octagon at the centre" },
  { kind: "wedges", label: "Wedges", title: "A star construction: a centre star, a ring of wedges and corners, each holding its own text" },
];

/** A fold's blank region list: the centre, 2n wedges and n corners, `1 + 3n` in all. */
const emptyStarRegions = (fold: StarFold): string[] => Array.from({ length: 1 + 3 * fold }, () => "");

/** Preview width in px; the height follows the star's outline. */
const PREVIEW_PX = 76;

/** One offer drawn small: its layout, one path, as the canvas draws it (unpacked regions empty). */
const OfferPreview: React.FC<{ offer: KufiStarOffer; lines: boolean }> = ({ offer, lines }) => {
  const { d, w, h } = useMemo(() => {
    const box = kufiStarBox(offer.inputs);
    return { d: kufiStarLayoutPath(offer.inputs, offer.layout, lines, 1), w: box.width, h: box.height };
  }, [offer, lines]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={PREVIEW_PX} height={(PREVIEW_PX * h) / w} aria-hidden="true">
      <path d={d} fill="currentColor" />
    </svg>
  );
};

/**
 * Find layouts: evaluates the block's text in the worker and lists the
 * offers, the octagon squares first, then the star constructions, fitting
 * ones first, each a small preview with its note. A click approves one
 * (layout, fold, star, size and every region's text in one `onPatch`, so
 * one undo step). Offers made for another text are kept but marked stale.
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
    onPatch({
      starLayout: o.inputs.layout,
      starFold: o.inputs.fold,
      starK: o.inputs.k,
      starSize: o.inputs.size,
      starRegions: [...o.inputs.regions],
    });
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
 * The Kufi star type panel: the layout (octagon or wedges), and for the
 * wedges its fold and star; the size and the construction lines. Every
 * change is one `onPatch` call, so one undo step. Changing the layout or
 * the fold resets the regions, since region indices mean something else in
 * another construction: a switch to the octagon puts the block's text (else
 * الله) once along each side at the size that line takes, a switch to the
 * wedges starts them blank on the classic 4-fold star. Find layouts
 * (`KufiStarOffers`) is the way text gets into the regions.
 */
export const KufiStarPanel: React.FC<{
  block: KufiStarBlock;
  onPatch: (patch: Partial<KufiStarBlock>) => void;
}> = ({ block, onPatch }) => {
  const id = useId();
  const layout = kufiStarInputs(block).layout;
  const octagon = layout === "octagon";
  const minSize = octagon ? OCTAGON_MIN_SIZE : KUFI_STAR_MIN_SIZE;
  const maxSize = octagon ? OCTAGON_MAX_SIZE : KUFI_STAR_MAX_SIZE;
  const [draft, setDraft] = useState<{ for: number; text: string } | null>(null);
  const shown = draft && draft.for === block.starSize ? draft.text : String(block.starSize);

  const commit = (text: string) => {
    const v = Number(text);
    if (text.trim() === "" || !Number.isFinite(v)) return;
    const size = Math.min(maxSize, Math.max(minSize, Math.round(v)));
    if (size !== block.starSize) onPatch({ starSize: size });
  };

  const setLayout = (kind: KufiStarLayoutKind) => {
    if (kind === layout) return;
    if (kind === "octagon") {
      const side = block.text.trim() === "" ? "الله" : block.text.trim();
      onPatch({ starLayout: "octagon", starFold: 4, starK: defaultStarK(4), starSize: octagonSizeFor(side), starRegions: [side] });
    } else {
      onPatch({ starLayout: "wedges", starFold: 4, starK: defaultStarK(4), starSize: 24, starRegions: emptyStarRegions(4) });
    }
  };

  return (
    <div className="sectionPanel" data-testid="kufi-star-panel">
      <div className="field">
        <span className="fieldTitle">Layout</span>
        <div className="kufiToolRow" role="group" aria-label="Layout">
          {LAYOUTS.map((l) => (
            <button
              key={l.kind}
              type="button"
              className={`sidebarPillButton${l.kind === layout ? " sidebarPillButton--active" : ""}`}
              aria-pressed={l.kind === layout}
              title={l.title}
              onClick={() => setLayout(l.kind)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
      {octagon && (
        <div className="kufiArrangementsNote" dir="auto">
          Along each side: {octagonSideText({ regions: block.starRegions }) || "nothing yet"}
        </div>
      )}
      {!octagon && (
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
                  if (f !== block.starFold) onPatch({ starFold: f, starK: defaultStarK(f), starRegions: emptyStarRegions(f) });
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}
      {!octagon && (
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
      )}
      <label className="field" htmlFor={`${id}-size`}>
        <span className="fieldTitle">Size</span>
        <input
          id={`${id}-size`}
          type="number"
          inputMode="numeric"
          min={minSize}
          max={maxSize}
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
