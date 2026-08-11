import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { traceImageToPath, type TraceResult } from "../lib/imageTrace";

export type ImageTraceDialogProps = {
  file: File;
  onConfirm: (pathData: string, w: number, h: number) => void;
  onCancel: () => void;
};

// Caps both the resolution the trace runs at and the size the preview is
// shown at (kept as one value — this is a warp-shape silhouette, not a
// fine-art trace, so a modest resolution is both fast and plenty accurate,
// and it keeps the dialog a reasonable size without extra scaling math).
const MAX_TRACE_DIMENSION = 420;
const DEFAULT_THRESHOLD = 0.5;
const DEBOUNCE_MS = 120;

/**
 * Modal for the Shape Warp "Trace image" flow: shows the uploaded image with
 * its auto-traced silhouette overlaid, and a threshold slider that re-traces
 * live. Modeled on ConfirmDialog.tsx's portaled-overlay pattern. Confirming
 * hands the final `{ pathData, w, h }` back to the caller — the same shape
 * an SVG upload already produces — and this component has no knowledge of
 * what block type or App.tsx handler consumes it.
 */
export const ImageTraceDialog: React.FC<ImageTraceDialogProps> = ({
  file,
  onConfirm,
  onCancel,
}) => {
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const debounceRef = useRef<number | null>(null);

  const imgUrl = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    return () => URL.revokeObjectURL(imgUrl);
  }, [imgUrl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  // Load the file, draw it to an offscreen canvas capped at
  // MAX_TRACE_DIMENSION, and stash the resulting ImageData for re-tracing on
  // every threshold change.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(
        1,
        MAX_TRACE_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight)
      );
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError("Could not read this image.");
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      imageDataRef.current = ctx.getImageData(0, 0, w, h);
      setDisplaySize({ w, h });
    };
    img.onerror = () => setError("Could not load this image.");
    img.src = imgUrl;
  }, [file, imgUrl]);

  const retrace = useCallback((nextThreshold: number) => {
    const original = imageDataRef.current;
    if (!original) return;
    // traceImageToPath binarizes in place, so pass a fresh clone of the
    // original grayscale pixels each time rather than the cached source —
    // otherwise the second retrace would binarize an already-binarized
    // (pure black/white) image instead of the real source data.
    const clone = new ImageData(
      new Uint8ClampedArray(original.data),
      original.width,
      original.height
    );
    const traced = traceImageToPath(clone, nextThreshold);
    setResult(traced);
    setError(traced ? null : "No shape detected — try adjusting the threshold.");
  }, []);

  useEffect(() => {
    if (!displaySize) return;
    retrace(DEFAULT_THRESHOLD);
  }, [displaySize, retrace]);

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, []);

  const handleThresholdChange = (value: number) => {
    setThreshold(value);
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => retrace(value), DEBOUNCE_MS);
  };

  const overlayScale = result && displaySize ? displaySize.w / result.w : 1;

  return createPortal(
    <div
      className="confirmDialogOverlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="confirmDialog imageTraceDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="imageTraceDialogTitle"
      >
        <div id="imageTraceDialogTitle" className="confirmDialogTitle">
          Trace image
        </div>

        <div className="imageTraceDialogPreview">
          {imgUrl && displaySize && (
            <div style={{ position: "relative", width: displaySize.w, height: displaySize.h }}>
              <img
                src={imgUrl}
                alt=""
                width={displaySize.w}
                height={displaySize.h}
                style={{ display: "block", width: displaySize.w, height: displaySize.h }}
              />
              {result && (
                <svg
                  width={displaySize.w}
                  height={displaySize.h}
                  style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                >
                  <path
                    d={result.pathData}
                    transform={`scale(${overlayScale})`}
                    fill="rgba(34, 197, 94, 0.35)"
                    stroke="#22c55e"
                    strokeWidth={2 / overlayScale}
                  />
                </svg>
              )}
            </div>
          )}
        </div>

        <div className="imageTraceDialogControls">
          <label htmlFor="imageTraceThreshold" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Threshold
          </label>
          <input
            id="imageTraceThreshold"
            type="range"
            min={0.05}
            max={0.95}
            step={0.01}
            value={threshold}
            onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
          />
        </div>

        {error && <div className="imageTraceDialogError">{error}</div>}

        <div className="confirmDialogActions">
          <button type="button" className="sidebarSmallAction" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="sidebarSmallAction imageTraceDialogConfirm"
            disabled={!result}
            onClick={() => {
              if (result) onConfirm(result.pathData, result.w, result.h);
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ImageTraceDialog;
