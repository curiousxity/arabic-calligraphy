import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  COMPOSITION_LAYOUTS,
  type CompositionSelection,
  type CompositionLayoutId,
} from "../lib/composition";
import {
  DEFAULT_RADIAL_COUNT,
  RADIAL_COUNT_MAX,
  RADIAL_COUNT_MIN,
  resolveRadialCount,
} from "../lib/mirror";
import { CloseIcon } from "./Icons";

export type CompositionDialogProps = {
  /** The block's current text — what every preview here renders. */
  text: string;
  /** CSS family of the block's current font, which the previews are set in. */
  cssFamily: string;
  onApply: (selection: CompositionSelection) => void;
  onClose: () => void;
};

/**
 * How far a medallion preview's copies sit from its centre, in px. The
 * previews are schematic — they show the *arrangement*, not the measured
 * geometry `lib/composition.ts` computes for the canvas — so this is a fixed
 * radius that keeps the ring inside a small card at any copy count.
 */
const PREVIEW_RADIUS = 30;

/**
 * Compositions: set the block's text into a muthanna pair or a medallion, in
 * the font the block already has. (Choosing the font is the font
 * picker's job — this wizard was once "Name designs" and opened on a style
 * gallery, which now lives in `FontPickerDialog`.)
 *
 * Portaled to `document.body` for the reason every modal here is — the
 * sidebar is an overflow-hidden scrolling column that would clip it, and
 * nothing that is not artwork may live inside the Konva stage or it risks
 * being baked into an export. Previews are CSS, not canvas: a picker, not a
 * proof.
 */
export const CompositionDialog: React.FC<CompositionDialogProps> = ({
  text,
  cssFamily,
  onApply,
  onClose,
}) => {
  const [layout, setLayout] = useState<CompositionLayoutId>("muthanna");
  const [radialCount, setRadialCount] = useState(DEFAULT_RADIAL_COUNT);
  const closeRef = useRef<HTMLButtonElement>(null);

  const name = text.trim();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const apply = () => {
    onApply({ layout, radialCount });
  };

  return createPortal(
    <div
      className="confirmDialogOverlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="nameDesignDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compositionDialogTitle"
      >
        <div className="nameDesignHeader">
          <div>
            <div id="compositionDialogTitle" className="nameDesignTitle">
              Compositions
            </div>
            <div className="nameDesignSubtitle">
              Choose how the text is composed on the canvas.
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="sidebarCircleButton"
            onClick={onClose}
            aria-label="Close compositions"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        {name === "" && (
          <div className="nameDesignEmpty" role="status">
            This block has no text yet. Type something in the Content panel
            first.
          </div>
        )}

        <div className="nameDesignGrid nameDesignGrid--layouts">
          {COMPOSITION_LAYOUTS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={
                option.id === layout
                  ? "nameLayoutCard nameLayoutCard--active"
                  : "nameLayoutCard"
              }
              data-layout-id={option.id}
              aria-pressed={option.id === layout}
              onClick={() => setLayout(option.id)}
            >
              <LayoutPreview
                layout={option.id}
                name={name || "أبجد"}
                cssFamily={cssFamily}
                radialCount={radialCount}
              />
              <span className="nameLayoutName">
                {option.name}
                <span className="nameLayoutNameAr" dir="rtl" lang="ar">
                  {option.nameAr}
                </span>
              </span>
              <span className="nameLayoutDescription">{option.description}</span>
            </button>
          ))}
        </div>

        {layout === "medallion" && (
          <div className="nameDesignOptionRow">
            <label htmlFor="composition-radial-count">Copies</label>
            <input
              id="composition-radial-count"
              type="number"
              className="nameDesignNumber"
              min={RADIAL_COUNT_MIN}
              max={RADIAL_COUNT_MAX}
              value={radialCount}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next)) setRadialCount(next);
              }}
            />
            <span className="nameDesignHint">
              The ring opens out as you add copies, so they never overlap.
            </span>
          </div>
        )}

        <div className="nameDesignActions">
          <span className="nameDesignSpacer" />
          <button type="button" className="sidebarSmallAction" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sidebarSmallAction sidebarSmallAction--accent"
            onClick={apply}
            disabled={name === ""}
          >
            Create composition
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

type LayoutPreviewProps = {
  layout: CompositionLayoutId;
  name: string;
  cssFamily: string;
  radialCount: number;
};

/**
 * A schematic of one composition, drawn with the real text in the chosen
 * style. The medallion's `rotate(θ) translateX(r)` is the same order
 * `radialCopyTransforms` applies on canvas — turn the copy, then push it out
 * along its own spoke — so the preview and the result agree about which way
 * the name faces.
 */
const LayoutPreview: React.FC<LayoutPreviewProps> = ({
  layout,
  name,
  cssFamily,
  radialCount,
}) => {
  const sample = (
    <span className="namePreviewText" style={{ fontFamily: cssFamily }} dir="rtl" lang="ar">
      {name}
    </span>
  );

  if (layout === "muthanna") {
    return (
      <span className="namePreview namePreview--row">
        {sample}
        <span className="namePreviewMirror">{sample}</span>
      </span>
    );
  }

  if (layout === "medallion") {
    // The canvas's own clamp, so the preview and the block it creates can
    // never disagree about how many copies a ring has.
    const count = resolveRadialCount(radialCount);
    return (
      <span className="namePreview">
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className="namePreviewSpoke"
            style={{ transform: `rotate(${(i * 360) / count}deg) translateX(${PREVIEW_RADIUS}px)` }}
          >
            {sample}
          </span>
        ))}
      </span>
    );
  }

  return <span className="namePreview">{sample}</span>;
};

export type CompositionButtonProps = Omit<CompositionDialogProps, "onClose">;

/**
 * Launcher plus dialog as one element, the way `GuideLauncher` is: the open state stays local, so opening the wizard
 * never reaches `App.tsx`, the undo stack, or a saved layout.
 */
export const CompositionButton: React.FC<CompositionButtonProps> = ({
  onApply,
  ...dialogProps
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="sidebarSectionButton"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-testid="composition-open"
      >
        <span>Compositions</span>
        <span>Browse</span>
      </button>
      {open && (
        <CompositionDialog
          {...dialogProps}
          onApply={(selection) => {
            onApply(selection);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};

export default CompositionDialog;
