import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_ORNAMENT_FILL,
  ORNAMENT_FILL_SWATCHES,
  listOrnaments,
  ornamentSvgDataUrl,
  ornamentSvgMarkup,
  type OrnamentDef,
} from "../lib/ornaments";
import { extractSvgPaths } from "../lib/svgImport";
import { CloseIcon, FrameIcon, ShapesIcon } from "./Icons";

/** How big, in block units, an inserted ornament's longest side starts out. */
const INSERT_SIZE = 500;

/**
 * The swatch strip that picks an ornament's baked-in colour.
 *
 * Shared rather than restated because both surfaces that insert an ornament
 * offer it — this picker and the name-design wizard's frame step — and the
 * two were byte-identical markup over two copies of one palette.
 */
export const OrnamentFillSwatches: React.FC<{
  value: string;
  onChange: (color: string) => void;
  label?: string;
}> = ({ value, onChange, label }) => (
  <div className="ornamentPickerSwatches">
    {label && <span className="ornamentPickerSwatchLabel">{label}</span>}
    {ORNAMENT_FILL_SWATCHES.map((c) => (
      <button
        key={c}
        type="button"
        className={
          c === value ? "ornamentPickerSwatch ornamentPickerSwatch--active" : "ornamentPickerSwatch"
        }
        style={{ background: c }}
        onClick={() => onChange(c)}
        aria-label={`Frame colour ${c}`}
        aria-pressed={c === value}
      />
    ))}
    <input
      type="color"
      className="ornamentPickerColorInput"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Custom frame colour"
    />
  </div>
);

export type OrnamentPickerProps = {
  onInsertShapeFill?: (pathData: string, w: number, h: number) => void;
  onInsertFrame?: (dataUrl: string, w: number, h: number) => void;
  onClose: () => void;
};

/**
 * The built-in shape library, as a modal grid of thumbnails.
 *
 * Portaled to `document.body` for the same reason `GuideDrawer` is: the
 * sidebar is an overflow-hidden scrolling column that would clip a modal,
 * and nothing that is not artwork may live inside the Konva stage or it
 * risks being baked into an export.
 *
 * Neither action forks block creation: "Fill with text" hands the same
 * `{ pathData, w, h }` triple the SVG-upload flow produces to the same
 * handler, and "Insert as frame" goes through the ordinary image-block path
 * with a data-URL SVG.
 */
export const OrnamentPicker: React.FC<OrnamentPickerProps> = ({
  onInsertShapeFill,
  onInsertFrame,
  onClose,
}) => {
  const [fill, setFill] = useState(DEFAULT_ORNAMENT_FILL);
  const ornaments = listOrnaments();
  const closeRef = useRef<HTMLButtonElement>(null);

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

  const fillWithText = (def: OrnamentDef) => {
    // Round-tripping through the app's own SVG importer rather than
    // synthesizing the triple by hand is what guarantees an ornament and an
    // uploaded file reach Shape Fill in exactly the same state. `true` asks
    // for uniform scaling: the default stretches the source to a square,
    // which is right for a traced silhouette and wrong for a drawn one.
    const result = extractSvgPaths(ornamentSvgMarkup(def, "#000000"), INSERT_SIZE, true);
    if (!result) return;
    onInsertShapeFill?.(result.pathData, result.w, result.h);
    onClose();
  };

  const insertAsFrame = (def: OrnamentDef) => {
    const { w, h } = def.viewBox;
    const scale = INSERT_SIZE / Math.max(w, h);
    onInsertFrame?.(ornamentSvgDataUrl(def, fill), w * scale, h * scale);
    onClose();
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
        className="ornamentPickerDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ornamentPickerTitle"
      >
        <div className="ornamentPickerHeader">
          <div>
            <div id="ornamentPickerTitle" className="ornamentPickerTitle">
              Shapes &amp; frames
            </div>
            <div className="ornamentPickerSubtitle">
              Fill a shape with your text, or drop one in as a decorative frame.
              Click the canvas to place it.
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="sidebarCircleButton"
            onClick={onClose}
            aria-label="Close shapes and frames"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <OrnamentFillSwatches value={fill} onChange={setFill} label="Frame colour" />

        <div className="ornamentPickerGrid">
          {ornaments.map((o) => (
            <div className="ornamentCard" key={o.id} data-ornament-id={o.id}>
              {/* Inline SVG, so a thumbnail costs no rasterization and scales
                  crisply at any sidebar/screen size. */}
              <svg
                className="ornamentThumb"
                viewBox={`0 0 ${o.viewBox.w} ${o.viewBox.h}`}
                role="img"
                aria-label={o.name}
              >
                {o.paths.map((d, i) => (
                  <path key={i} d={d} fill={fill} fillRule="evenodd" />
                ))}
              </svg>

              <div className="ornamentCardName">{o.name}</div>
              <div className="ornamentCardNameAr" dir="rtl" lang="ar">
                {o.nameAr}
              </div>

              <div className="ornamentCardActions">
                <button
                  type="button"
                  className="sidebarSmallAction"
                  onClick={() => fillWithText(o)}
                  aria-label={`Fill with text: ${o.name}`}
                >
                  Fill with text
                </button>
                <button
                  type="button"
                  className="sidebarSmallAction"
                  onClick={() => insertAsFrame(o)}
                  aria-label={`Insert as frame: ${o.name}`}
                >
                  Insert as frame
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};

export type OrnamentPickerButtonProps = Omit<OrnamentPickerProps, "onClose"> & {
  /** `circle` matches the add-block row's icon buttons; `wide` is a labelled row button. */
  variant: "circle" | "wide";
};

/**
 * Launcher + dialog as one element, so a mount site needs no open/closed
 * state of its own — the same shape `GuideLauncher` uses, and for the same
 * reason: opening a picker is not an edit, so it must never reach `App.tsx`'s
 * state, the undo stack, or a saved layout.
 */
export const OrnamentPickerButton: React.FC<OrnamentPickerButtonProps> = ({
  variant,
  onInsertShapeFill,
  onInsertFrame,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {variant === "circle" ? (
        <button
          type="button"
          className="sidebarCircleButton"
          title="Add an ornament or frame…"
          aria-label="Add ornament"
          onClick={() => setOpen(true)}
        >
          {/* Not ShapesIcon: the button right beside this one in the
              add-block row already wears it for "upload your own SVG". */}
          <FrameIcon size={14} />
        </button>
      ) : (
        <button
          type="button"
          className="sidebarSmallAction ornamentPickerOpenWide"
          onClick={() => setOpen(true)}
        >
          <ShapesIcon size={13} /> Shapes &amp; frames…
        </button>
      )}

      {open && (
        <OrnamentPicker
          onInsertShapeFill={onInsertShapeFill}
          onInsertFrame={onInsertFrame}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};

export default OrnamentPicker;
