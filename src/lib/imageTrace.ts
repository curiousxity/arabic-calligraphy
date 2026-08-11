import ImageTracer from "imagetracerjs";
import { extractSvgPaths } from "./svgImport";

export type TraceResult = { pathData: string; w: number; h: number };

const FOREGROUND = { r: 0, g: 0, b: 0, a: 255 };
const BACKGROUND = { r: 255, g: 255, b: 255, a: 255 };

// imagetracerjs mutates the options object it is handed (notably it
// reassigns entries of `pal` in place while quantizing), so build a fresh
// copy per call rather than sharing one module-level constant.
function makeTraceOptions() {
  return {
    ltres: 1,
    qtres: 1,
    pathomit: 4,
    numberofcolors: 2,
    pal: [{ ...BACKGROUND }, { ...FOREGROUND }],
    viewbox: true,
    roundcoords: 2,
    scale: 1,
  };
}

// A pixel with alpha below this is treated as background no matter what its
// RGB channels say. Source images are drawn onto a fresh (transparent)
// canvas, so every untouched pixel of a transparent PNG reads back as
// rgba(0,0,0,0) — luminance 0, i.e. "as dark as possible". Without this
// check those pixels always classify as foreground and the whole image
// traces to a solid rectangle at every threshold.
const ALPHA_CUT = 128;

/**
 * Rewrites `imageData` in place to pure black (foreground) / pure white
 * (background) pixels using an alpha + luminance threshold, so
 * imagetracerjs's two-color palette trace below produces one clean
 * silhouette instead of a posterized multi-region trace. A pixel is
 * foreground when it is sufficiently opaque (alpha >= 128) *and* its
 * luminance is at or below `threshold` (a 0..1 fraction of full white) —
 * the common case of tracing a dark subject/logo on a lighter or
 * transparent background. Always writes full alpha out, since the
 * two-color palette trace has no use for partial transparency.
 */
export function binarizeImageData(imageData: ImageData, threshold: number): ImageData {
  const { data } = imageData;
  const cut = threshold * 255;
  for (let i = 0; i < data.length; i += 4) {
    const opaque = data[i + 3] >= ALPHA_CUT;
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const v = opaque && luminance <= cut ? 0 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return imageData;
}

/**
 * Draws `source` onto an offscreen canvas, scaled down so neither dimension
 * exceeds `maxDimension` (never scaled up), and returns the resulting
 * `ImageData` ready for `traceImageToPath`. Throws if a 2D context cannot be
 * obtained.
 *
 * Kept here rather than inline in ImageTraceDialog.tsx so all of this
 * feature's canvas-touching code lives in one module. It is deliberately
 * *not* unit-tested: jsdom has no real canvas rasterizer, so `drawImage` is
 * a no-op there and `getImageData` would only ever return a blank buffer —
 * a test of this function would assert nothing about real behavior.
 */
export function imageElementToImageData(
  source: HTMLImageElement,
  maxDimension: number
): ImageData {
  const naturalW = source.naturalWidth || source.width;
  const naturalH = source.naturalHeight || source.height;
  const scale = Math.min(1, maxDimension / Math.max(naturalW, naturalH));
  const w = Math.max(1, Math.round(naturalW * scale));
  const h = Math.max(1, Math.round(naturalH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context for tracing.");
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
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
  const svgString = ImageTracer.imagedataToSVG(binary, makeTraceOptions());
  const foregroundOnly = keepForegroundOnly(svgString);
  if (!foregroundOnly) return null;
  // preserveAspect: true — unlike the default SVG-upload path (which
  // stretches to a square), a traced photo/logo should keep its natural
  // proportions rather than being squished.
  return extractSvgPaths(foregroundOnly, undefined, true);
}
