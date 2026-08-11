import ImageTracer from "imagetracerjs";
import { extractSvgPaths } from "./svgImport";

export type TraceResult = { pathData: string; w: number; h: number };

const FOREGROUND = { r: 0, g: 0, b: 0, a: 255 };
const BACKGROUND = { r: 255, g: 255, b: 255, a: 255 };

const TRACE_OPTIONS = {
  ltres: 1,
  qtres: 1,
  pathomit: 4,
  numberofcolors: 2,
  pal: [BACKGROUND, FOREGROUND],
  viewbox: true,
  roundcoords: 2,
  scale: 1,
};

/**
 * Rewrites `imageData` in place to pure black (foreground) / pure white
 * (background) pixels using a luminance threshold, so imagetracerjs's
 * two-color palette trace below produces one clean silhouette instead of a
 * posterized multi-region trace. Darker pixels (luminance at or below
 * `threshold`, expressed as a 0..1 fraction of full white) become
 * foreground — the common case of tracing a dark subject/logo on a lighter
 * background. Always writes full alpha, since the two-color palette trace
 * has no use for partial transparency.
 */
export function binarizeImageData(imageData: ImageData, threshold: number): ImageData {
  const { data } = imageData;
  const cut = threshold * 255;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const v = luminance <= cut ? 0 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return imageData;
}

/**
 * Removes every traced shape except the foreground (black) ones from an
 * imagetracerjs SVG output string. The two-color palette trace above always
 * emits both a background and a foreground path/shape; only the foreground
 * silhouette is wanted here. Returns null if nothing foreground survived
 * (e.g. a blank/all-white source image, or a threshold set to an extreme
 * that classifies every pixel as background).
 */
function keepForegroundOnly(svgString: string): string | null {
  const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  if (doc.querySelector("parsererror")) return null;
  const svgEl = doc.querySelector("svg");
  if (!svgEl) return null;

  const shapeEls = Array.from(svgEl.querySelectorAll("path, rect, polygon, polyline"));
  let kept = 0;
  for (const el of shapeEls) {
    const fill = (el.getAttribute("fill") ?? "").replace(/\s+/g, "").toLowerCase();
    const isForeground = fill === "rgb(0,0,0)" || fill === "#000000" || fill === "black";
    if (isForeground) {
      kept++;
    } else {
      el.remove();
    }
  }
  if (kept === 0) return null;
  return new XMLSerializer().serializeToString(svgEl);
}

/**
 * Traces `imageData`'s silhouette (at the given 0..1 threshold) into an SVG
 * path, in the same `{ pathData, w, h }` shape `extractSvgPaths`
 * (lib/svgImport.ts) already returns for an uploaded SVG — so callers
 * (Sidebar.tsx) can treat both shape sources identically. `imageData` is
 * binarized in place (see `binarizeImageData`); callers that need the
 * original pixels afterward (e.g. to retrace at a different threshold) must
 * pass a fresh clone each call. Returns null if no foreground silhouette
 * survives.
 */
export function traceImageToPath(imageData: ImageData, threshold: number): TraceResult | null {
  const binary = binarizeImageData(imageData, threshold);
  const svgString = ImageTracer.imagedataToSVG(binary, TRACE_OPTIONS);
  const foregroundOnly = keepForegroundOnly(svgString);
  if (!foregroundOnly) return null;
  // preserveAspect: true — unlike the default SVG-upload path (which
  // stretches to a square), a traced photo/logo should keep its natural
  // proportions rather than being squished.
  return extractSvgPaths(foregroundOnly, undefined, true);
}
