---
paths:
  - "src/lib/studioStrokes*"
  - "src/components/sidebar/StudioLettersPanel.tsx"
  - "src/hooks/useStudioLibrary.ts"
  - "scripts/pen/studiolib.py"
  - "public/pen/**"
---

# Studio stroke library

Every stroke of the studio's Thuluth letters, recreated with the pen and reviewed stroke by stroke
(`docs/calligraphy/studioledger.md`), as data the app can draw: `public/pen/studio-strokes.json`, built by
`scripts/pen/studiolib.py` from the fitting work folder. **Never edit the JSON by hand; rebuild it.** It is fetched
at run time (`loadStudioLibrary`), not bundled: 3 MB.

## What a stroke is

- One or more pen paths in the stamp's own units (`ppn` 25.9 to the nuqta, y down), each node `[x, y, angle]` or
  `[x, y, angle, width]` (width 1 left out). The pen is `pen` units wide (`ppn / 1.65`).
- The cubic handles are **not stored**: `penPathOf` rebuilds them by the fitter's rule (Catmull-Rom tangents, a
  third of the chord; `studiolib.controls` is the reference, and the test pins the TS to it on a real path). The rule
  is unchanged by a move or a scale, so the handles can be built in stamp units though the fitter built them in
  nuqta. Change the rule in one place and the app draws a different curve from the one that was scored.
- Angle and width ease linearly between nodes and the nib is centred, exactly as `penSweep.ts` sweeps. So
  `sweepPath(penPathOf(nodes), pen)` is the ink that was fitted (checked on 139 strokes: the outlines differ by one
  raster pixel, 0.02 nuqta, the two rasters' edge rule).
- `recipe`: `pen` (one nib angle), `turning`, `fill` (the nib tip), `split` (written in pieces). A split stroke's
  pens are its pieces and its nib-tip joint fills, plus `patches` (gaps wholly inside its ink, filled: the user,
  2026-10-29; and studio ink its joint left bare) and `erase` (its pieces' nib corners past the studio edge within
  1.5 nibs of the cut: decision 54).
- `strokeInk` = union of the pens, less `erase`, plus `patches`, then crumbs dropped: holes and detached specks
  under `CRUMB` (0.05 nuqta squared). The rings were traced on a 0.0025-nuqta grid against true curves, so they
  leave specks and pinholes at the joint; a counter (which must stay open) is forty times a crumb. The stroke's
  largest piece always stays (741.s0 is a speck of a stroke). On the built library every one of the 4,166 strokes
  comes out one solid piece with no hole.
- `twin`: the stroke copies another shape's fit of the same outline, moved by the difference of their corners.

## Shapes

`shapes` is keyed by the studio's shape id with `group`, `form`, `variant`, and for the halves of the studio's
letter pairs (`020g`, `028r`) `pairOf`/`pairRole`. The registry the fitter started from lists 781 shapes; the pair
halves were fitted later, so `studiolib.py` adds every shape the review holds and copies a pair half's stroke from
the stroke of the same outline (the registry's outline hash) where it has no fit of its own. It prints any stroke
still without a fit.

Word shapes (`W01`…, db status `word`) are letters the studio reshapes inside a word, such as الله's لله (`W05`).
One goes in only when every one of its strokes is `accepted` in the review, which records the user's approval
(`STUDIOLIB_WORDS=1` builds them all, for trials only).

## Rebuilding

`python -I -X utf8 scripts/pen/studiolib.py SCRATCH` with SCRATCH the fitting folder (studio/registry.json,
studio/catalog.py, me/penreview.json, me/twins.json, me/gaps.json, me/trims.json and the batch folders). Run
`twins.py` first if fits came in since it last ran: a twin's source must be in the review.

## The Studio letters panel

`src/components/sidebar/StudioLettersPanel.tsx`, in the sidebar's canvas tier after Marks: one fold per letter
(`studioGroups`: the studio's order of letters by each one's first shape that is not a pair; a letter's shapes by
form, then variant, pair halves last), each shape a thumbnail; clicking one shows it large with its strokes in two
alternating inks and each stroke's recipe and match. View only for now. The library loads when the section first
opens (`useStudioLibrary`), and a shape is swept only when its fold opens, once (a module-level cache): sweeping
takes a few milliseconds a stroke, about 20 s for the whole library.
