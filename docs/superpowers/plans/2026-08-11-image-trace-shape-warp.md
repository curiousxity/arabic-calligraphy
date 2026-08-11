# Image-Trace Shape Warp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second way to define a Shape Warp block's shape — upload a raster image and auto-trace its silhouette into an SVG path — alongside the existing "Upload SVG" and hand-draw options, which stay unchanged.

**Architecture:** A new pure module `src/lib/imageTrace.ts` wraps the `imagetracerjs` npm package: it binarizes an `ImageData` at a threshold, traces it to a two-color SVG via `imagetracerjs`, strips the background shape, and hands the remaining foreground silhouette through the *existing* `extractSvgPaths` (`src/lib/svgImport.ts`) so it returns the exact same `{ pathData, w, h }` shape an SVG upload already produces. A new `ImageTraceDialog.tsx` modal (modeled on `ConfirmDialog.tsx`) lets the user preview the trace and adjust a threshold slider before confirming. `Sidebar.tsx` gets a new "Trace image" button next to the existing Shape Warp "Upload SVG" button; confirming the dialog calls the same existing `onAddShapeWarpBlock(pathData, w, h)` handler the SVG path already uses, so nothing in `ShapeWarpText.tsx`'s rendering/warp-mode engine changes at all.

**Tech Stack:** React 19, TypeScript, Vite/Rolldown, Vitest, `imagetracerjs` (new dependency).

## Global Constraints

- This adds a new **input source** only. `ShapeWarpText.tsx`'s envelope/topBottom/stretch/radial remap math and glyph-handle system are untouched, and the existing "Upload SVG" / hand-draw shape inputs stay exactly as they are.
- Scope is Shape Warp only — do not add the trace button to Shape Fill.
- No server/backend — tracing runs entirely client-side.
- After each task: run `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, in that order, and fix anything that fails before moving on. Run `npm run build` at the end of the plan (Task 4).
- `imagetracerjs`'s `package.json` has no `exports` field (only `main`), the same class of package that broke Rolldown resolution for `opentype.js` (see `vite.config.ts`'s existing alias and the comment above it). Task 1 adds an analogous alias pre-emptively rather than waiting to hit the failure.

---

### Task 1: `src/lib/imageTrace.ts` — pure trace logic, dependency, and tests

**Files:**
- Modify: `package.json` (add `imagetracerjs` dependency)
- Modify: `vite.config.ts` (add resolve alias)
- Modify: `src/shims.d.ts` (add ambient module declaration)
- Create: `src/lib/imageTrace.ts`
- Test: `src/lib/imageTrace.test.ts`

**Interfaces:**
- Produces: `TraceResult = { pathData: string; w: number; h: number }`, `binarizeImageData(imageData: ImageData, threshold: number): ImageData`, `traceImageToPath(imageData: ImageData, threshold: number): TraceResult | null` — both consumed by Task 2's `ImageTraceDialog.tsx`.
- Consumes: `extractSvgPaths` (`src/lib/svgImport.ts`, already exists, unchanged).

- [ ] **Step 1: Install the dependency**

```bash
npm install imagetracerjs
```

- [ ] **Step 2: Add the Vite alias**

In `vite.config.ts`, change:

```ts
  resolve: {
    alias: {
      // opentype.js has no "exports" field, which causes Rolldown (Vite 8) to
      // fail resolution. Point directly to its pre-built ESM module file.
      'opentype.js': path.resolve(
        __dirname,
        'node_modules/opentype.js/dist/opentype.module.js'
      ),
    },
  },
```

to:

```ts
  resolve: {
    alias: {
      // opentype.js has no "exports" field, which causes Rolldown (Vite 8) to
      // fail resolution. Point directly to its pre-built ESM module file.
      'opentype.js': path.resolve(
        __dirname,
        'node_modules/opentype.js/dist/opentype.module.js'
      ),
      // Same problem, same fix: imagetracerjs's package.json only has "main",
      // no "exports" field.
      'imagetracerjs': path.resolve(
        __dirname,
        'node_modules/imagetracerjs/imagetracer_v1.2.6.js'
      ),
    },
  },
```

- [ ] **Step 3: Declare the module's types**

In `src/shims.d.ts`, add after the existing `declare module 'harfbuzzjs';` line:

```ts
declare module 'imagetracerjs' {
  interface ImageTracerPaletteColor {
    r: number;
    g: number;
    b: number;
    a: number;
  }
  interface ImageTracerOptions {
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    numberofcolors?: number;
    pal?: ImageTracerPaletteColor[];
    viewbox?: boolean;
    roundcoords?: number;
    scale?: number;
  }
  interface ImageTracerAPI {
    imagedataToSVG(imageData: ImageData, options?: ImageTracerOptions): string;
  }
  const ImageTracer: ImageTracerAPI;
  export default ImageTracer;
}
```

- [ ] **Step 4: Write the failing tests**

Create `src/lib/imageTrace.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { binarizeImageData, traceImageToPath } from "./imageTrace";

function makeImageData(
  width: number,
  height: number,
  fill: (x: number, y: number) => number
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = fill(x, y);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

describe("binarizeImageData", () => {
  it("turns pixels darker than the threshold black, others white", () => {
    // 2x2: top-left dark (30), top-right light (220), bottom row mid-gray (128)
    const img = makeImageData(2, 2, (x, y) => (y === 0 ? (x === 0 ? 30 : 220) : 128));
    const out = binarizeImageData(img, 0.5); // cut = 127.5
    expect(out.data[0]).toBe(0); // top-left (30) -> foreground (black)
    expect(out.data[4]).toBe(255); // top-right (220) -> background (white)
    expect(out.data[8]).toBe(255); // bottom-left (128, just above cut) -> background (white)
  });

  it("always writes full alpha regardless of input alpha", () => {
    const img = makeImageData(1, 1, () => 10);
    img.data[3] = 0; // fully transparent input pixel
    const out = binarizeImageData(img, 0.5);
    expect(out.data[3]).toBe(255);
  });
});

describe("traceImageToPath", () => {
  it("traces a filled square into a non-null path", () => {
    const size = 20;
    const img = makeImageData(size, size, (x, y) =>
      x > 4 && x < 15 && y > 4 && y < 15 ? 0 : 255
    );
    const result = traceImageToPath(img, 0.5);
    expect(result).not.toBeNull();
    expect(result?.pathData).toMatch(/M/);
    expect(result?.w).toBeGreaterThan(0);
    expect(result?.h).toBeGreaterThan(0);
  });

  it("returns null for a blank (all-white) image", () => {
    const img = makeImageData(10, 10, () => 255);
    const result = traceImageToPath(img, 0.5);
    expect(result).toBeNull();
  });

  it("does not mutate the ImageData passed in by the caller's original reference expectations", () => {
    // binarizeImageData legitimately mutates in place (documented behavior) —
    // this test just documents/locks that contract so a future refactor
    // doesn't silently change it to a copy without updating ImageTraceDialog,
    // which relies on cloning before each retrace itself.
    const img = makeImageData(4, 4, () => 10);
    const out = binarizeImageData(img, 0.5);
    expect(out).toBe(img);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run src/lib/imageTrace.test.ts`
Expected: FAIL — `imageTrace.ts` doesn't exist yet (module not found).

- [ ] **Step 6: Write the implementation**

Create `src/lib/imageTrace.ts`:

```ts
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
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/lib/imageTrace.test.ts`
Expected: PASS (5 tests). If the "traces a filled square" test fails with `result` being `null` even though the square is clearly non-blank, `keepForegroundOnly`'s fill-string match (`rgb(0,0,0)` / `#000000` / `black`) likely doesn't match this installed version of `imagetracerjs`'s actual output format — add a `console.log(svgString)` right before the `keepForegroundOnly(svgString)` call in `traceImageToPath` temporarily, run the test again, inspect the real `fill="..."` attribute values imagetracerjs produced for the two palette colors, and adjust the match condition in `keepForegroundOnly` accordingly (remove the `console.log` once fixed).

- [ ] **Step 8: Verify and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: all green. If `npx tsc` reports the `imagetracerjs` import can't find a default export, double check `src/shims.d.ts`'s declaration was saved correctly — it must declare `export default ImageTracer;` inside the `declare module 'imagetracerjs'` block exactly as written in Step 3.

```bash
git add package.json package-lock.json vite.config.ts src/shims.d.ts src/lib/imageTrace.ts src/lib/imageTrace.test.ts
git commit -m "Add imagetracerjs-based image-to-silhouette tracing"
```

---

### Task 2: `ImageTraceDialog.tsx` — preview modal with threshold slider

**Files:**
- Create: `src/components/ImageTraceDialog.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `traceImageToPath`, `TraceResult` (Task 1).
- Produces: `ImageTraceDialogProps = { file: File; onConfirm: (pathData: string, w: number, h: number) => void; onCancel: () => void }` and the `ImageTraceDialog` component, consumed by Task 3's `Sidebar.tsx`.

- [ ] **Step 1: Add CSS for the dialog**

In `src/index.css`, right after the existing `.morphHelpBody h4:first-child { margin-top: 0; }` line, add:

```css
.imageTraceDialog { width: min(460px, 100%); }
.imageTraceDialogPreview { display: flex; justify-content: center; margin-bottom: 14px; border: 1px solid var(--border-soft); border-radius: 8px; overflow: hidden; background: var(--bg-panel); }
.imageTraceDialogControls { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.imageTraceDialogControls input[type="range"] { flex: 1; }
.imageTraceDialogError { font-size: 12px; color: var(--danger); margin-bottom: 10px; }
.imageTraceDialogConfirm { background: var(--accent); color: var(--text-on-accent); }
.imageTraceDialogConfirm:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 2: Create the component**

Create `src/components/ImageTraceDialog.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
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
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const debounceRef = useRef<number | null>(null);

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
    const url = URL.createObjectURL(file);
    setImgUrl(url);
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
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

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
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: all green. (No new tests in this task — this component has no unit tests, matching this project's existing convention of not unit-testing Konva/canvas/modal UI components; see `ConfirmDialog.tsx`, `DiacriticHoverHandles.tsx`.)

- [ ] **Step 4: Commit**

```bash
git add src/components/ImageTraceDialog.tsx src/index.css
git commit -m "Add ImageTraceDialog preview/threshold modal"
```

---

### Task 3: Wire "Trace image" into `Sidebar.tsx`

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `ImageTraceDialog`, `ImageTraceDialogProps` (Task 2); `onAddShapeWarpBlock` (existing `SidebarProps` field, unchanged signature: `(svgPathData: string, w: number, h: number) => void`).
- No new `SidebarProps` fields — this task is entirely internal to `Sidebar.tsx`.

- [ ] **Step 1: Add the import and local state**

In `src/components/Sidebar.tsx`, add the import near the other component imports (after the `FloatingArabicKeyboard` import, around line 26):

```ts
import { ImageTraceDialog } from "./ImageTraceDialog";
```

Find the component's existing `useState` declarations near the top of the function body (where other local UI state like collapsed-section flags live) and add:

```ts
  const [imageTraceFile, setImageTraceFile] = useState<File | null>(null);
```

- [ ] **Step 2: Add the file-picker handler**

Right after the existing `handleSvgUpload` function (around line 368, after its closing `};`), add:

```ts
  const handleImageTraceUpload = () => {
    if (!onAddShapeWarpBlock) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        alert("Please choose an image file (PNG, JPG, etc.).");
        return;
      }
      setImageTraceFile(file);
    };

    input.click();
  };
```

- [ ] **Step 3: Add the "Trace image" button**

In the button row, right after the existing Shape Warp SVG-upload button (the `{onAddShapeWarpBlock && (...)}` block, around lines 609-618), add a new sibling block:

```tsx
            {onAddShapeWarpBlock && (
              <button
                type="button"
                className="sidebarCircleButton"
                title="Trace image for Shape Warp"
                onClick={handleImageTraceUpload}
              >
                <ImageIcon size={14} />
              </button>
            )}
```

- [ ] **Step 4: Render the dialog**

Right after that same button block (still inside the same parent container), add:

```tsx
            {imageTraceFile && (
              <ImageTraceDialog
                file={imageTraceFile}
                onCancel={() => setImageTraceFile(null)}
                onConfirm={(pathData, w, h) => {
                  onAddShapeWarpBlock?.(pathData, w, h);
                  setImageTraceFile(null);
                }}
              />
            )}
```

(`ImageTraceDialog` renders via `createPortal` to `document.body`, so its exact position inside `Sidebar.tsx`'s returned JSX doesn't affect layout — this placement keeps it next to the button that triggers it for readability.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: all green.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`, open the app. In the block-actions row, click the new "Trace image" button (image icon, next to the existing Shape Warp circle-dashed icon), pick a PNG/JPG with a clear subject on a plain background. Confirm: the dialog opens showing the image with a green-tinted traced outline overlaid; dragging the threshold slider updates the outline live; clicking Confirm closes the dialog and adds a new Shape Warp block using the traced shape (same placement/selection behavior as an SVG-uploaded Shape Warp block); clicking Cancel or the Escape key closes the dialog without adding a block. Then confirm the existing "Upload SVG" button for both Shape Fill and Shape Warp still works unmodified.

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "Wire image-trace Shape Warp input into Sidebar"
```

---

### Task 4: CLAUDE.md documentation and final verification

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** None — documentation and verification only.

- [ ] **Step 1: Update `CLAUDE.md`**

In the "Rendering: one Konva component per block type" section, right after the existing bullet:

```markdown
- **`ShapeWarpText.tsx`** — draws the text *once* and remaps every glyph point into the shape's bounding envelope (`envelope`/`topBottom`/`stretch`/`radial` modes), with an additional per-glyph handle system (`glyphWarps`, pinch/move/scaleX/scaleY) for manual distortion in "glyph edit mode". Has its own inline warp-point math, independent of `lib/warp.ts`.
```

add a new bullet immediately after it:

```markdown
- Shape Warp blocks have a second shape input alongside "Upload SVG"/hand-draw: **"Trace image"** uploads a raster photo/logo and auto-traces its silhouette client-side into the same `{ pathData, w, h }` shape `extractSvgPaths` already produces — `src/lib/imageTrace.ts` (`imagetracerjs`, aliased in `vite.config.ts` the same way `opentype.js` is, since it also has no `package.json` "exports" field) binarizes the image at a user-adjustable threshold (`ImageTraceDialog.tsx`, live preview) and hands the resulting silhouette through the *existing* `extractSvgPaths`, so `ShapeWarpText.tsx`'s envelope/topBottom/stretch/radial engine has no idea whether a shape came from an SVG upload or a traced image. Shape Fill does not have this button — YAGNI until asked for.
```

- [ ] **Step 2: Full verification loop**

Run, in order:

```bash
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npm test
npm run build
```

Expected: all four succeed.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Document image-trace Shape Warp input in CLAUDE.md"
```
