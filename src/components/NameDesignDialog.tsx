import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_FRAME_COLOR,
  DEFAULT_FRAME_ID,
  NAME_LAYOUTS,
  frameOrnaments,
  type NameDesignSelection,
  type NameLayoutId,
} from "../lib/nameDesign";
import {
  DEFAULT_RADIAL_COUNT,
  RADIAL_COUNT_MAX,
  RADIAL_COUNT_MIN,
  resolveRadialCount,
} from "../lib/mirror";
import type { OrnamentDef } from "../lib/ornaments";
import { OrnamentFillSwatches } from "./OrnamentPicker";
import { CloseIcon } from "./Icons";

/** One entry of the font picker's own list — value, label, and the CSS family to preview in. */
export type FontChoice = { value: string; label: string; cssFamily: string };

export type NameDesignDialogProps = {
  /** The block's current text — the name every preview here renders. */
  text: string;
  /** The block's current font, which the gallery opens on. */
  fontFamily: string;
  /** Built-ins plus uploads, the same list the Typography picker is given. */
  fonts: FontChoice[];
  onApply: (selection: NameDesignSelection) => void;
  onClose: () => void;
};

/**
 * How far a medallion preview's copies sit from its centre, in px. The
 * previews are schematic — they show the *arrangement*, not the measured
 * geometry `lib/nameDesign.ts` computes for the canvas — so this is a fixed
 * radius that keeps the ring inside a small card at any copy count.
 */
const PREVIEW_RADIUS = 30;

/**
 * "Name designs": pick the calligraphic style your name is written in, then
 * the composition it is set into.
 *
 * Portaled to `document.body` for the reason every modal here is — the
 * sidebar is an overflow-hidden scrolling column that would clip it, and
 * nothing that is not artwork may live inside the Konva stage or it risks
 * being baked into an export.
 *
 * **Previews are CSS, not canvas.** Every font here has an `@font-face` rule
 * (an uploaded one gets a `FontFace` registered from its own bytes), and the
 * browser shapes Arabic natively, so a gallery of 17 styles costs no
 * HarfBuzz shaping and no rasterization — the same trick `FontSelectRow`
 * already uses to preview each family in itself. It is a picker, not a proof:
 * the canvas remains what the design is judged on.
 */
export const NameDesignDialog: React.FC<NameDesignDialogProps> = ({
  text,
  fontFamily,
  fonts,
  onApply,
  onClose,
}) => {
  const [step, setStep] = useState<"style" | "layout">("style");
  const [selectedFont, setSelectedFont] = useState(fontFamily);
  const [layout, setLayout] = useState<NameLayoutId>("single");
  const [radialCount, setRadialCount] = useState(DEFAULT_RADIAL_COUNT);
  const [frameId, setFrameId] = useState(DEFAULT_FRAME_ID);
  const [frameColor, setFrameColor] = useState(DEFAULT_FRAME_COLOR);
  const closeRef = useRef<HTMLButtonElement>(null);

  const frames = useMemo(() => frameOrnaments(), []);
  const frame = frames.find((f) => f.id === frameId) ?? frames[0];
  const name = text.trim();
  const cssFamily =
    fonts.find((f) => f.value === selectedFont)?.cssFamily ?? `'${selectedFont}'`;

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
    onApply({ fontFamily: selectedFont, layout, radialCount, frameId, frameColor });
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
        aria-labelledby="nameDesignDialogTitle"
      >
        <div className="nameDesignHeader">
          <div>
            <div id="nameDesignDialogTitle" className="nameDesignTitle">
              Name designs
            </div>
            <div className="nameDesignSubtitle">
              {step === "style"
                ? "See your text in every calligraphic style, then pick one."
                : "Choose how the name is composed on the canvas."}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="sidebarCircleButton"
            onClick={onClose}
            aria-label="Close name designs"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        {name === "" && (
          <div className="nameDesignEmpty" role="status">
            This block has no text yet. Type a name in the Content panel and the
            styles will appear here.
          </div>
        )}

        {step === "style" ? (
          <div className="nameDesignGrid" data-testid="name-design-styles">
            {fonts.map((font) => (
              <button
                key={font.value}
                type="button"
                className={
                  font.value === selectedFont
                    ? "nameStyleCard nameStyleCard--active"
                    : "nameStyleCard"
                }
                data-font-key={font.value}
                aria-pressed={font.value === selectedFont}
                onClick={() => setSelectedFont(font.value)}
                onDoubleClick={() => {
                  setSelectedFont(font.value);
                  setStep("layout");
                }}
              >
                <span
                  className="nameStyleSample"
                  style={{ fontFamily: font.cssFamily }}
                  dir="rtl"
                  lang="ar"
                >
                  {name || "أبجد"}
                </span>
                <span className="nameStyleLabel">{font.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="nameDesignGrid nameDesignGrid--layouts">
              {NAME_LAYOUTS.map((option) => (
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
                    frame={frame}
                    frameColor={frameColor}
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
                <label htmlFor="name-design-radial-count">Copies</label>
                <input
                  id="name-design-radial-count"
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

            {layout === "framed" && (
              <div className="nameDesignOptionRow nameDesignOptionRow--wrap">
                <label htmlFor="name-design-frame">Frame</label>
                <select
                  id="name-design-frame"
                  className="nameDesignSelect"
                  value={frame?.id ?? ""}
                  onChange={(e) => setFrameId(e.target.value)}
                >
                  {frames.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <OrnamentFillSwatches value={frameColor} onChange={setFrameColor} />
                {/* A frame is inserted as a rasterized image, so its colour is
                    baked in at insert time — hence choosing it here rather
                    than leaving the user to discover the limitation. */}
                <span className="nameDesignHint">
                  A frame's colour is fixed when it is inserted.
                </span>
              </div>
            )}
          </>
        )}

        <div className="nameDesignActions">
          {step === "layout" && (
            <button
              type="button"
              className="sidebarSmallAction"
              onClick={() => setStep("style")}
            >
              Back to styles
            </button>
          )}
          <span className="nameDesignSpacer" />
          <button type="button" className="sidebarSmallAction" onClick={onClose}>
            Cancel
          </button>
          {step === "style" ? (
            <button
              type="button"
              className="sidebarSmallAction sidebarSmallAction--accent"
              onClick={() => setStep("layout")}
            >
              Choose a layout
            </button>
          ) : (
            <button
              type="button"
              className="sidebarSmallAction sidebarSmallAction--accent"
              onClick={apply}
              disabled={name === ""}
            >
              Create design
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

type LayoutPreviewProps = {
  layout: NameLayoutId;
  name: string;
  cssFamily: string;
  radialCount: number;
  frame?: OrnamentDef;
  frameColor: string;
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
  frame,
  frameColor,
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

  if (layout === "framed" && frame) {
    return (
      <span className="namePreview">
        <svg
          className="namePreviewFrame"
          viewBox={`0 0 ${frame.viewBox.w} ${frame.viewBox.h}`}
          aria-hidden="true"
        >
          {frame.paths.map((d, i) => (
            <path key={i} d={d} fill={frameColor} fillRule="evenodd" />
          ))}
        </svg>
        <span className="namePreviewOverlay">{sample}</span>
      </span>
    );
  }

  return <span className="namePreview">{sample}</span>;
};

export type NameDesignButtonProps = Omit<NameDesignDialogProps, "onClose">;

/**
 * Launcher plus dialog as one element, the way `OrnamentPickerButton` and
 * `GuideLauncher` are: the open state stays local, so opening the wizard
 * never reaches `App.tsx`, the undo stack, or a saved layout.
 */
export const NameDesignButton: React.FC<NameDesignButtonProps> = ({
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
        data-testid="name-design-open"
      >
        <span>Name designs</span>
        <span>Browse</span>
      </button>
      {open && (
        <NameDesignDialog
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

export default NameDesignDialog;
