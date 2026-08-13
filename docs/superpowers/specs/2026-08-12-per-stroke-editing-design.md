# Per-stroke editing that preserves letter joining

**Status:** design approved 2026-08-12. No code written yet. Next step is an
implementation plan.

**Goal (user's words):** "I want every stroke to be able to be modified
separately but I still want the glyphs/letters to join to each other
seamlessly."

## Scope

**In:** every font in `public/fonts/` except the two named below.

**Out for now (user's decision, 2026-08-12):** Diwani and Ruq'ah —
`HarfCanvasDiwani.ttf` and `Ruqaa.ttf`.

Deferring these two removes the design's biggest risk. Every stroke schema
declares `calligraphicModel: "naskh"`, and Diwani's steeply sloped,
long-sweeping letterforms are the worst fit in the library for Naskh-authored
proportions — it was the case most likely to break the schema→real-glyph
mapping that changes 2 and 4 rest on. Ruq'ah merges dot pairs into strokes,
which also makes its measured nuqta the least reliable figure we have.

Note this is a *risk* reduction, not an elimination: Kufi, Urdu, Yekan and
Qahiri are not Naskh either, and Thuluth's proportions differ from Naskh's
noticeably. Phase C exists precisely to measure how far that mismatch
actually goes, and it should sample across those faces rather than only the
Naskh ones.

Consequences: the per-style schema override layer (below) is **not needed
yet** and should not be built speculatively. `HarfCanvasDiwani.ttf` and
`Ruqaa.ttf` remain selectable in the app and simply do not gain the improved
stroke editing in this phase.

**Also out:** parametric letterform rendering. Considered as the route to
Kaleam-style editing and rejected — the schemas carry no joining geometry at
all, so drawing from skeletons would forfeit the seamless joining this whole
feature exists to protect. See CLAUDE.md's deferred-features entry.

## Diagnosis — confirmed live in the browser

Two symptoms, both reproduced at 275% zoom on the default `حرف` text in
Naskh.

### The engine ignores three layers of authored data

Verified by grep across `src/`:

- `protectedZones` survives only as `protectedReasons`, a string list used
  for display. The zones never scope an edit.
- `preserveCurvature`, `preserveThickness`, and each zone's own `axis` field
  (`"x"` / `"path"`) are read **nowhere**.
- `lengthDots`, `styleProfile.measurementSystem.dotUnit` and
  `verticalLevels` appear **only in test fixtures**.

The engine is not missing information. It has it and discards it.

### Symptom 1 — a cleft opens at a join

Reproduce: default `حرف`, stretch the ra down-and-left. A hairline gap opens
at the hah/ra junction, **on the side being dragged toward**.

`ra-final.json` has one stroke whose stretch zone spans the *entire* stroke
(`fromNode 0` → `toNode 2`), and `connectsRight: true` means node 0 **is**
the connection point:

```
S_HEAD_1  nodes = (2.8,1.0) → (2.0,0.7) → (0.8,-0.9)
  zone:      0 → 2,  axis: "path",  preserveCurvature: true
  protected: (1,2) terminal-shape,  (2,2) left-tail-terminal
```

Two causes compound:

- `applyAxisDisplacement`'s `tAlong = along / axisLen` (`src/lib/glyphEdits.ts:63`)
  is **unbounded and signed**, with falloff only *perpendicular* to the axis
  and none along it. Points past the drag origin travel further than the drag
  itself; points behind the anchor travel backwards.
- The anchor is a **proportional guess** — `anchorNorm` mapped from the
  schema's idealized bounding box onto the real glyph's box — so it never
  lands exactly on the true connection point. Any nonzero displacement there
  tears the seam, and nothing pins it, because `join-integrity` is never read.

### Symptom 2 — strokes deform rather than extend

`fa-medial.json`'s eye loop asks for `axis: "path"` and
`preserveCurvature: true`; the catalog collapses the zone to a straight
chord, so the loop shears sideways and its counter pinches shut instead of
growing around its curve.

Separately, `ra-final.json` protects nodes 1→2 while its stretch axis runs
0→2 — displacement is **maximum exactly where the schema says do not
deform.** The protection is inverted.

## The five changes

### 1. Pin the connection point, found from real ink

Displacement is multiplied by a guard that is 0 at the connection point and
ramps smoothly to 1 beyond a pin radius, so the join cannot move and there is
no crease where the guard releases.

**The connection point is derived from the actual overlap between adjacent
glyphs**, not from a per-glyph geometric guess. After shaping, two connected
letters' outlines physically overlap; the connection is wherever that overlap
is. Computing that region and pinning its centroid assumes nothing about
baselines, slopes or letterform style, so it is correct per font by
construction. `ShapedText` already has the whole glyph run, so the neighbour
is available.

An earlier draft proposed scanning a vertical line near the joining edge and
taking the midpoint of ink crossing the baseline. **Rejected**: it assumes
joins happen at the baseline, which is Naskh-shaped thinking and false for
sloped styles. Do not reintroduce it.

Pin radius: derive from the measured nuqta (below) rather than a fixed
fraction of em.

### 2. A real spine instead of a chord

Map the schema stroke's nodes `fromNode..toNode` through the existing
`normalizePoint`/`mapNormToRealBox` into a *polyline* in real-glyph space. An
outline point projects onto its nearest spine segment and is displaced along
**that segment's tangent**, scaled by arc-length position. Two-node strokes
degrade to exactly today's straight chord, so nothing regresses; feh's
four-node eye grows around its loop instead of shearing across it.

This is `axis: "path"` actually implemented.

### 3. Clamp and taper along the axis

Clamp `tAlong` to `[0, 1]` and add a falloff approaching the far end. Kills
the overshoot that lets points past the drag origin travel further than the
drag itself.

### 4. Enforce `protectedZones`

Map each protected node span onto the same spine; outline points projecting
into a protected span get displacement zeroed with the same smooth ramp.
Fixes the ra's deforming tail terminal.

### 5. Quantize stretch to nuqta / half-nuqta increments

Traditional Arabic calligraphy measures stroke length in whole and half
nuqta, and the schemas are authored that way. No new schema data is needed: a
stroke's stretched length is `lengthDots × factor`, so half-nuqta steps mean
snapping the factor to multiples of `0.5 / lengthDots`. Beh's body
(`lengthDots 4.2`, zone 0.85–1.8) gets steps of ≈0.119 — about 28 discrete
positions. The UI reads in calligraphers' units ("+1½ nuqta") instead of
abstract factors, and the block-level Kashida dial quantizes with it.

**Advisory, not compulsory** (user's decision): snap by default with a
modifier to override, mirroring the grid snapping `CanvasStage.tsx` already
establishes as this app's idiom. Off-grid values must stay expressible and
must round-trip through save/load unchanged — a quantizer that silently
re-snaps on load would destroy deliberate off-grid work.

**The nuqta must be measured per font, not derived.** The intuitive rule that
the alif's stem is one nuqta wide **fails**: `alif/dot` ranges 0.53 (Urdu) to
1.68 (Kufi2), a 3.2× spread, where the rule predicts 1.00. `dot/em` itself
varies ~2× across the library, so no global constant works either. Use a
per-font table seeded by `scripts/measureNuqta.py` and human-confirmed.

Measured table (2026-08-12), in-scope fonts:

| font | upem | nuqta w×h | dot/em | confidence |
|---|---:|---:|---:|---|
| AlFatemi.otf | 925 | 90×90 | 0.0973 | high |
| Amiri.ttf | 1000 | 135×132 | 0.1350 | high |
| FatemiMaqala.ttf | 2048 | 233×226 | 0.1138 | high |
| Kufi.ttf | 1000 | 121×115 | 0.1210 | high |
| Kufi2.ttf | 1000 | 116×116 | 0.1160 | high |
| Lateef.ttf | 2048 | 208×208 | 0.1016 | high |
| NotoSans.ttf | 1000 | 99×99 | 0.0990 | high |
| Qahiri.ttf | 750 | 80×72 | 0.1067 | medium (modal only) |
| Scheherazade.ttf | 2048 | 229×239 | 0.1118 | high |
| TahaNaskhRegular.ttf | 2048 | 237×238 | 0.1157 | high |
| Thuluth.ttf | 2048 | 188×219 | 0.0918 | high |
| ThuluthDeco.ttf | 2048 | 188×219 | 0.0918 | high |
| Urdu.ttf | 2048 | 315×283 | 0.1538 | high |
| Wessam.ttf | 2048 | 156×177 | 0.0762 | high |
| Yekan.ttf | 2048 | 276×248 | 0.1348 | **medium — methods disagree** |

Two methods cross-checked (beh dot contour; modal-contour sweep over every
glyph). They agree within ~2% on all of the above except Yekan (276×248 vs
260×220), which needs a human eye before it is relied on.

## Sequencing

Deliberately ordered by confidence, so the uncertain work is informed by the
certain work rather than gambling on it.

**Phase A — changes 3 and 5.** Highest confidence, no dependency on the
schema→real-glyph mapping. Change 3 alone measurably reduces the cleft by
removing the overshoot; change 5 is additive and independently useful.

**Phase B — change 1**, with overlap-based join detection. This is what makes
the join guarantee structural rather than incidental.

**Phase C — measure before building.** Map the schema spine onto real glyphs
for ~12 letters and quantify how far the mapped points land from actual ink.
Sample deliberately across the in-scope styles — Naskh (TahaNaskh, Amiri),
Thuluth, Kufi and Urdu — not just the Naskh faces, since the mapping's error
is expected to grow with distance from Naskh proportions and Phase D's
viability depends on the worst case, not the average. This is investigation,
not implementation.

**Phase D — changes 2 and 4**, *if and only if* Phase C shows the mapping is
accurate enough. If the error is large they need re-anchoring (snapping the
mapped spine to nearest ink, or to a medial axis), which is a different
design and should come back here first.

**Why C gates D.** Changes 2 and 4 are the only two built on the proportional
mapping — the exact mechanism that caused the cleft. Change 4 is the riskier
of the pair: a protected zone that lands in the wrong place does not merely
fail to protect, it freezes the wrong part of the letter, which is a *new*
failure mode rather than a fixed one.

## Success criteria

Falsifiable, not a matter of taste:

1. **Join invariance** — for every kashida-eligible letter pair, the
   connection point moves **0px** at every factor from `minFactor` to
   `maxFactor`. Automatable across all 105 schemas × the in-scope fonts.
   This is the reported bug turned into pass/fail.
2. **No overshoot** — no outline point displaces further than the axis extent.
3. **Protected spans do not move** — 0px displacement for points inside one.
4. **Regression bar** — at `factor = 1`, rendering is byte-identical to today.

## Testing

- Changes 2–5 are pure functions over point sets — unit-testable in the style
  of `snapping.test.ts`.
- Change 1 needs a real font; `diacritics.test.ts` is the precedent (real
  harfbuzzjs, real fonts from `public/fonts/`, no hand-written fixtures).
  A fabricated-fixture version of that suite is exactly what let a bug ship
  unnoticed once before.

## Open questions

- Yekan's nuqta (276×248 vs 260×220) needs a human decision before change 5
  relies on it.
- Phase C's outcome decides whether Phase D proceeds as designed.
- Pin radius as a multiple of the nuqta: exact factor to be tuned once
  change 1 is testable.

## Deferred, not forgotten

- **Diwani and Ruq'ah support**, and with them the per-style schema override
  layer: one base schema per letter-form plus a thin per-style layer carrying
  only the numbers that differ (`minFactor`/`maxFactor`, `priority`), rather
  than 105 × N hand-authored files. Full geometry overrides remain possible
  where a style genuinely is a different letterform. The registry hook for
  this — keying `registry.ts` by `(unicode, joiningForm, styleId?)` with
  fallback to the base — is small but painful to retrofit; revisit when these
  styles come back in scope.
- **Parametric nib-sweep rendering.** Needs numeric stroke widths (only
  qualitative profiles exist), finer skeletons (current ones are 2–4 nodes),
  per-style profiles, and joining geometry that does not exist. Note that
  `public/fonts/` already ships Thuluth and Ruqaa, so those proportions do not
  require it.

## Repro notes

- `npm run dev`, default text `حرف` at 275% zoom.
- Cleft: select block → Morph Glyph Editor → ra → stretch handle → drag
  down-left. Gap appears at the hah/ra junction.
- Konva's hover-mounted handles do not take scripted drags reliably — drive
  by hand.
