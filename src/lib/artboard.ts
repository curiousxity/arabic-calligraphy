/**
 * The page.
 *
 * Before this module there was no page: the background rect, the alignment
 * grid, the "artboard" snap targets and every export crop all came from
 * `CanvasStage`'s `contentBox` — the union of the blocks' padded bounding box
 * *and the current viewport*. Export dimensions were therefore emergent (drag
 * a block, the PNG changes size), page edges did not exist as compositional
 * targets, and snapping quietly depended on the zoom level.
 *
 * An `ArtboardConfig` gives the document a fixed rectangle instead. `null`
 * means freeform and is exactly the old behaviour, which is what every save
 * written before this feature loads as.
 *
 * Everything here is pure geometry and arithmetic — no React, no Konva — so
 * it is unit-testable without a canvas.
 */

export type ArtboardUnit = "px" | "mm" | "in";

export type Rect = { x: number; y: number; width: number; height: number };

export type ArtboardConfig = {
  /** Which entry of `ARTBOARD_PRESETS` this came from; `null` means custom. */
  presetId: string | null;
  /**
   * Page size in pixels **at this config's own `dpi`** — so an A4 page at
   * 300dpi is stored as 2480 × 3508, not as 210 × 297 or as its 96dpi
   * equivalent. Stage space is pixel space, so these are also the page's
   * dimensions on canvas, and rasterising it 1:1 reproduces exactly this
   * many pixels (see `exportPixelRatio`).
   */
  width: number;
  height: number;
  /** Display unit for the size fields only; never affects what is stored. */
  unit: ArtboardUnit;
  /** Pixels per inch. Drives unit conversion and the PDF's real page size. */
  dpi: number;
  /** Uniform inset, in px, for the margin guide. 0 = no margin. */
  margin: number;
  orientation: "portrait" | "landscape";
};

/** Screen dpi — what the PDF export assumed unconditionally before artboards existed. */
export const SCREEN_DPI = 96;

/** Print dpi used by the paper-size presets. */
export const PRINT_DPI = 300;

const MM_PER_INCH = 25.4;

export const mmToPx = (mm: number, dpi: number) => Math.round((mm / MM_PER_INCH) * dpi);
export const inToPx = (inches: number, dpi: number) => Math.round(inches * dpi);
/** px → mm at an arbitrary dpi. The PDF export used to hardcode 96 here. */
export const pxToMm = (px: number, dpi: number) => (px * MM_PER_INCH) / dpi;

export type ArtboardPreset = {
  id: string;
  label: string;
  /** Grouped in the picker: paper sizes first, then screen/social sizes. */
  group: "print" | "screen";
  /** Page size in px at `dpi`, at the preset's natural orientation. */
  width: number;
  height: number;
  dpi: number;
  /** The unit the preset is naturally expressed in, used as the initial display unit. */
  unit: ArtboardUnit;
};

const paper = (
  id: string,
  label: string,
  widthMm: number,
  heightMm: number
): ArtboardPreset => ({
  id,
  label,
  group: "print",
  width: mmToPx(widthMm, PRINT_DPI),
  height: mmToPx(heightMm, PRINT_DPI),
  dpi: PRINT_DPI,
  unit: "mm",
});

const screen = (
  id: string,
  label: string,
  width: number,
  height: number
): ArtboardPreset => ({
  id,
  label,
  group: "screen",
  width,
  height,
  dpi: SCREEN_DPI,
  unit: "px",
});

/**
 * The offered page sizes. Paper sizes are defined in millimetres and
 * converted once at 300dpi, so the familiar pixel counts (A4 → 2480 × 3508)
 * fall out of the definition rather than being typed in beside it.
 */
export const ARTBOARD_PRESETS: ArtboardPreset[] = [
  paper("a5", "A5 (148 × 210 mm)", 148, 210),
  paper("a4", "A4 (210 × 297 mm)", 210, 297),
  paper("a3", "A3 (297 × 420 mm)", 297, 420),
  {
    id: "us-letter",
    label: "US Letter (8.5 × 11 in)",
    group: "print",
    width: inToPx(8.5, PRINT_DPI),
    height: inToPx(11, PRINT_DPI),
    dpi: PRINT_DPI,
    unit: "in",
  },
  screen("ig-square", "Instagram square (1080 × 1080)", 1080, 1080),
  screen("ig-portrait", "Instagram portrait (1080 × 1350)", 1080, 1350),
  screen("story", "Story (1080 × 1920)", 1080, 1920),
  screen("x-header", "X header (1500 × 500)", 1500, 500),
];

export function findArtboardPreset(id: string | null): ArtboardPreset | null {
  if (!id) return null;
  return ARTBOARD_PRESETS.find((p) => p.id === id) ?? null;
}

/** The preset a size corresponds to in *either* orientation, or null if it is custom. */
export function matchArtboardPreset(
  cfg: Pick<ArtboardConfig, "width" | "height" | "dpi">
): ArtboardPreset | null {
  const long = Math.max(cfg.width, cfg.height);
  const short = Math.min(cfg.width, cfg.height);
  return (
    ARTBOARD_PRESETS.find(
      (p) =>
        p.dpi === cfg.dpi &&
        Math.max(p.width, p.height) === long &&
        Math.min(p.width, p.height) === short
    ) ?? null
  );
}

const orientationOf = (width: number, height: number) =>
  width > height ? ("landscape" as const) : ("portrait" as const);

/**
 * A fresh config for a preset. `margin` carries over from whatever was
 * configured before, so switching page size does not silently discard it.
 */
export function configFromPreset(preset: ArtboardPreset, margin = 0): ArtboardConfig {
  const cfg: ArtboardConfig = {
    presetId: preset.id,
    width: preset.width,
    height: preset.height,
    unit: preset.unit,
    dpi: preset.dpi,
    margin: 0,
    orientation: orientationOf(preset.width, preset.height),
  };
  return { ...cfg, margin: clampMargin(margin, cfg) };
}

/** The starting point for "Custom" when there is no existing page to keep. */
export const DEFAULT_CUSTOM_ARTBOARD: ArtboardConfig = {
  presetId: null,
  width: 1000,
  height: 1000,
  unit: "px",
  dpi: SCREEN_DPI,
  margin: 0,
  orientation: "portrait",
};

/**
 * Largest fraction of the shorter side a margin may take. Kept below half so
 * the margin guide always encloses a visible area — a margin that met itself
 * in the middle would draw a degenerate rectangle and, worse, contribute two
 * coincident snap lines through the page centre.
 */
const MAX_MARGIN_FRACTION = 0.45;

export function clampMargin(
  margin: number,
  cfg: Pick<ArtboardConfig, "width" | "height">
): number {
  if (!Number.isFinite(margin) || margin <= 0) return 0;
  const limit = Math.min(cfg.width, cfg.height) * MAX_MARGIN_FRACTION;
  return Math.min(margin, Math.max(0, limit));
}

/** The page rectangle in stage space, centred on the origin (where blocks start). */
export function artboardRect(cfg: ArtboardConfig): Rect {
  return {
    x: -cfg.width / 2,
    y: -cfg.height / 2,
    width: cfg.width,
    height: cfg.height,
  };
}

/** The margin guide's rectangle, or null when there is no usable margin. */
export function marginRect(cfg: ArtboardConfig): Rect | null {
  const m = clampMargin(cfg.margin, cfg);
  if (m <= 0) return null;
  const width = cfg.width - m * 2;
  const height = cfg.height - m * 2;
  if (width <= 0 || height <= 0) return null;
  return { x: -cfg.width / 2 + m, y: -cfg.height / 2 + m, width, height };
}

/** Stored px → the config's display unit. */
export function toDisplayUnit(px: number, cfg: Pick<ArtboardConfig, "unit" | "dpi">): number {
  if (cfg.unit === "px") return px;
  if (cfg.unit === "in") return px / cfg.dpi;
  return pxToMm(px, cfg.dpi);
}

/** The config's display unit → stored px. Inverse of `toDisplayUnit`. */
export function fromDisplayUnit(
  value: number,
  cfg: Pick<ArtboardConfig, "unit" | "dpi">
): number {
  if (cfg.unit === "px") return value;
  if (cfg.unit === "in") return inToPx(value, cfg.dpi);
  return mmToPx(value, cfg.dpi);
}

/**
 * Swap the page's two dimensions. A no-op when it already has the requested
 * orientation, so calling it repeatedly cannot keep flipping the page.
 */
export function withOrientation(
  cfg: ArtboardConfig,
  orientation: ArtboardConfig["orientation"]
): ArtboardConfig {
  if (cfg.orientation === orientation) return cfg;
  return { ...cfg, orientation, width: cfg.height, height: cfg.width };
}

/**
 * A resized page. The size may still land on a known preset — typing 1080 ×
 * 1080 is the square preset — so the id is re-derived rather than blanked,
 * which keeps the picker showing the name of the size that is actually set.
 */
export function withSize(cfg: ArtboardConfig, width: number, height: number): ArtboardConfig {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const next: ArtboardConfig = {
    ...cfg,
    width: w,
    height: h,
    orientation: orientationOf(w, h),
    presetId: matchArtboardPreset({ width: w, height: h, dpi: cfg.dpi })?.id ?? null,
  };
  return { ...next, margin: clampMargin(next.margin, next) };
}

/**
 * Changing dpi keeps the *physical* size and rescales the stored pixels — the
 * whole point of the field is "how many pixels is this much paper", so moving
 * a 210mm-wide page from 96 to 300dpi must widen it in px, not reinterpret
 * the same pixels as a smaller page.
 */
export function withDpi(cfg: ArtboardConfig, dpi: number): ArtboardConfig {
  const next = Math.max(1, Math.round(dpi));
  if (next === cfg.dpi) return cfg;
  const factor = next / cfg.dpi;
  return withSize(
    { ...cfg, dpi: next, margin: cfg.margin * factor },
    cfg.width * factor,
    cfg.height * factor
  );
}

/**
 * The `pixelRatio` an export should rasterise with.
 *
 * With a page set, the answer is always 1: the page is *already* stored in
 * output pixels, so a 1:1 raster of it is exactly `width × height`. That is
 * the point of choosing a page — an A4@300dpi document exports at 2480 × 3508
 * whatever the on-screen scale slider says, and the square social preset
 * exports at exactly 1080 × 1080. Without a page there is no intrinsic pixel
 * size, so the requested oversampling is honoured exactly as before.
 */
export function exportPixelRatio(
  cfg: ArtboardConfig | null,
  requestedScale: number
): number {
  return cfg ? 1 : requestedScale;
}

/** The pixel dimensions an export will produce, for the sidebar's readout. */
export function exportPixelSize(cfg: ArtboardConfig): { width: number; height: number } {
  return { width: Math.round(cfg.width), height: Math.round(cfg.height) };
}

const UNITS: ArtboardUnit[] = ["px", "mm", "in"];

/**
 * Validates an `artboard` field read back out of a saved project. Saves are
 * user-editable JSON and predate this field entirely, so anything that is not
 * a well-formed config is treated as freeform rather than trusted.
 */
export function isArtboardConfig(value: unknown): value is ArtboardConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const positive = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;
  return (
    (v.presetId === null || typeof v.presetId === "string") &&
    positive(v.width) &&
    positive(v.height) &&
    positive(v.dpi) &&
    typeof v.margin === "number" &&
    Number.isFinite(v.margin) &&
    UNITS.includes(v.unit as ArtboardUnit) &&
    (v.orientation === "portrait" || v.orientation === "landscape")
  );
}
