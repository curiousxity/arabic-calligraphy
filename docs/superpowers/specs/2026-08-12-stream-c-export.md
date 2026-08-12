# Stream C — Export upgrades

**Read `PARALLEL.md` first.** Branch: `stream/c-export`.

## Goal

Three additions to export: copy a PNG straight to the clipboard, write all
four formats in one action, and save reusable scale/background presets.

## What exists today

`src/hooks/useExport.ts` (177 lines, **exclusively yours for this stream**)
has four handlers — PNG, JPEG, SVG, PDF — all funnelling through
`withExportAdjustments`, which hides the grid, optionally hides
`#artboard-background`, hides every `text-path-edit-layer-*` overlay, and
resets the stage to a 1:1 untransformed state for the duration of the export
before restoring all of it in a `finally`. Every handler hardcodes
`pixelRatio: 2` and a `calligraphy.*` filename, and each one runs its own
`withExportAdjustments` pass.

That helper is correct and subtle — the stage-transform reset in particular
exists because both the bounding box and `toDataURL`'s crop are computed in
the stage's *current* transformed space, so exporting while zoomed would
capture the viewport instead of the artwork. **Extend it; do not rewrite it.**

## Design

### 1. Parameterise scale and filename

Give each handler an options object — `{ scale?: number; transparent?: boolean;
baseName?: string }` — defaulting to today's behaviour (`scale: 2`,
`baseName: "calligraphy"`) so every existing call site keeps working
unchanged. `pixelRatio` becomes `scale`. JPEG quality stays `0.92`; PDF keeps
its px→mm conversion at 96dpi.

### 2. `handleCopyPNG(opts)`

Render to a data URL exactly as `handleExportPNG` does, convert to a `Blob`,
and write it:

```ts
await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
```

Two things to get right:

- **Feature-detect.** `navigator.clipboard?.write` and `window.ClipboardItem`
  are both absent in some browsers and in every non-secure context. Return a
  `{ ok: false, reason }` result and let the sidebar say so; do not throw and
  do not fail silently — a copy button that does nothing is worse than one
  that is disabled.
- **Safari needs the promise form.** Safari requires the `ClipboardItem` value
  to be a promise created synchronously within the user-gesture task, i.e.
  `new ClipboardItem({ "image/png": blobPromise })`. Build it that way; it is
  equally valid in Chrome and Firefox.

Returning a result object rather than throwing keeps this consistent with how
the rest of the hook already handles "no stage" and "no blocks" by returning
early.

### 3. `handleExportAll(opts)`

One `withExportAdjustments` pass producing all four files, rather than four
passes each toggling node visibility and stage transform. The SVG path needs
its `await import("react-konva-to-svg")`, and the PDF path its
`await import("jspdf")` — both already lazy, keep them lazy, and make sure
both dynamic imports are awaited *inside* the single adjustment pass so the
stage is still in export state when they run.

Sequence the four `triggerDownload` calls; browsers throttle simultaneous
downloads. A short `await` between them is acceptable and preferable to a zip
dependency.

### 4. `src/lib/exportPresets.ts` (new, exclusively owned)

```ts
export type ExportPreset = {
  id: string;
  name: string;
  scale: number;
  transparent: boolean;
  formats: ("png" | "jpeg" | "svg" | "pdf")[];
};

export const DEFAULT_PRESETS: ExportPreset[];
export function loadPresets(): ExportPreset[];
export function savePresets(presets: ExportPreset[]): void;
export function upsertPreset(presets: ExportPreset[], preset: ExportPreset): ExportPreset[];
export function removePreset(presets: ExportPreset[], id: string): ExportPreset[];
```

Seed `DEFAULT_PRESETS` with three: **Web @1x** (scale 1, PNG), **Print @3x**
(scale 3, PNG), **Print PDF** (scale 3, PDF).

Persist under the key `harfcanvas-export-presets-v1`, matching the existing
naming convention (`harfcanvas-named-projects-v1`,
`harfcanvas-glyph-rigs-v1`). Follow the same best-effort pattern the other
stores use: wrap reads and writes in try/catch and fall back to defaults —
`localStorage` throws in privacy mode and on quota, and `App.tsx` already
swallows those deliberately.

`upsertPreset` and `removePreset` are pure list functions so they can be
tested without touching storage.

### 5. Sidebar — Project & Export panel only

Add: a "Copy PNG" button, an "Export all" button, and a preset row — a select
of saved presets, a run button, and small add/delete controls. Preset state
lives in `App.tsx` between the `STREAM-C` anchors and is threaded down as
props, matching how every other piece of state in this app reaches the
sidebar. Touch nothing else in `Sidebar.tsx`.

## Constraints

- `useExport.ts` is yours alone this cycle — but the existing four handlers'
  default behaviour must be byte-identical to today's for existing callers.
- Do not add a zip dependency, a server round-trip, or a new export format.
- Do not touch `src/types.ts`. `ExportPreset` lives in `exportPresets.ts`.
- Presets are local-only. Do not wire them into the Supabase cloud store; that
  store is for named projects.

## Tests (`src/lib/exportPresets.test.ts`)

Pure functions only: `upsertPreset` replaces by id and appends when new,
`removePreset` removes by id and leaves others intact, `loadPresets` returns
`DEFAULT_PRESETS` on empty/corrupt storage, and a save→load round-trip
preserves every field. Stub `localStorage` rather than relying on jsdom
specifics. The canvas-touching handlers are not unit-testable here — jsdom
cannot rasterize — which is exactly why the pure preset logic must be.

## Guide section

`src/components/guide/sections/export.tsx`, `id: "export"`, `order: 80`,
title "Saving and exporting". Cover the four formats and when each is right
(SVG and PDF stay sharp at any size; PNG carries transparency; JPEG does
not), the transparent-background checkbox, copy-to-clipboard, export-all, and
presets.

## Done when

The four verification commands pass, and by hand: "Copy PNG" puts an image on
the clipboard that pastes into another app; "Export all" downloads four files
from one click; a preset saved at scale 3 survives a page reload and produces
a visibly larger PNG than scale 1.
