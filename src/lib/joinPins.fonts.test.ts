/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll } from "vitest";
import * as opentype from "opentype.js";
import { computeJoinPins, PIN_RADIUS_NUQTA } from "./joinPins";
import { applyGlyphEdit } from "./glyphEdits";
import { nuqtaPx } from "./nuqta";
import { normalizeGlyphs } from "./normalizeGlyphs";
import { findDiacriticGlyphIndices } from "./diacritics";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import type { GlyphEdit } from "../types";

// harfbuzzjs's package entrypoint (`index.js`) is CommonJS whose
// `module.exports` is itself `new Promise(...)` — Node's ESM/CJS interop
// treats a thenable default export as "auto-awaitable" during static
// `import`, which throws before any of this file's own code runs. This is
// also why this file cannot import `shapeText` from `./harfbuzz` directly
// (verified: doing so throws the same error immediately, since harfbuzz.ts
// itself statically imports harfbuzzjs) — the same constraint documented in
// `diacritics.test.ts` and `justify.test.ts`, whose `shapeReal` helper this
// mirrors verbatim rather than inventing a second mechanism.
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");

type HbModule = {
  createBlob: (data: ArrayBuffer | Uint8Array) => { destroy?: () => void };
  createFace: (blob: unknown, index: number) => { destroy?: () => void };
  createFont: (face: unknown) => {
    setScale?: (x: number, y: number) => void;
    destroy?: () => void;
  };
  createBuffer: () => {
    addText: (text: string) => void;
    guessSegmentProperties?: () => void;
    setDirection?: (direction: string) => void;
    setScript?: (script: string) => void;
    setLanguage?: (language: string) => void;
    json?: (font?: unknown) => unknown[];
    destroy?: () => void;
  };
  shape: (font: unknown, buffer: unknown, features?: string) => void;
};

function resolveHbLoader(mod: unknown): Promise<HbModule> {
  let m: unknown = mod;
  let rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;

  if (typeof m === "function") {
    return (m as () => Promise<HbModule> | HbModule)() as Promise<HbModule>;
  }
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec && typeof rec.then === "function") return m as Promise<HbModule>;

  throw new Error("Unable to resolve harfbuzzjs loader in test");
}

const hbPromise = resolveHbLoader(hbjsModule);

/**
 * Shapes `text` with a real font via real harfbuzzjs, mirroring `shapeText`
 * in `harfbuzz.ts` (RTL, `arab` script, `ar` language) — the font bytes come
 * from `public/fonts/` via `fs` instead of `fetch`, which is the only
 * difference from the app's own shaping path. Identical to the helper in
 * `justify.test.ts`, which itself follows `diacritics.test.ts`'s precedent.
 */
async function shapeReal(
  text: string,
  fontFile: string
): Promise<{ glyphs: HarfBuzzGlyph[]; font: opentype.Font; unitsPerEm: number }> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const fontPath = path.resolve(dir, "../../public/fonts", fontFile);
  const fontData = fs.readFileSync(fontPath);
  const arrayBuffer = fontData.buffer.slice(
    fontData.byteOffset,
    fontData.byteOffset + fontData.byteLength
  );
  const parsedFont = opentype.parse(arrayBuffer);
  const upm = parsedFont.unitsPerEm || 1000;

  const hb = await hbPromise;
  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();

  try {
    if (typeof font.setScale === "function") font.setScale(upm, upm);
    buffer.addText(text);
    if (typeof buffer.guessSegmentProperties === "function") {
      buffer.guessSegmentProperties();
    }
    if (typeof buffer.setDirection === "function") buffer.setDirection("rtl");
    if (typeof buffer.setScript === "function") buffer.setScript("arab");
    if (typeof buffer.setLanguage === "function") buffer.setLanguage("ar");

    hb.shape(font, buffer);

    let raw: unknown[] = [];
    if (typeof buffer.json === "function") {
      try {
        raw = buffer.json(font);
      } catch {
        raw = buffer.json();
      }
    }

    return { glyphs: normalizeGlyphs(raw as never), font: parsedFont, unitsPerEm: upm };
  } finally {
    buffer.destroy?.();
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

// Deliberately spread across styles, not only the Naskh faces the schemas
// were authored against — the mapping's error is expected to grow with
// distance from Naskh proportions.
//
// `FatemiMaqala` and `Kufi2` were added after the first five, because both
// decompose glyphs in ways the original matrix never exercised and each
// exposed something the others could not: FatemiMaqala emits a unit or two
// of `dx` rounding noise on ordinary *letters* (which the mark detector
// misreads — see `computeJoinPins`'s advance guard and category (d) below),
// and Kufi2 decomposes its nuqat into separately positioned GPOS mark
// glyphs, which is exactly the shape of run that pairing base letters was
// introduced to handle.
const FONTS = [
  "TahaNaskhRegular.ttf",
  "Amiri.ttf",
  "Thuluth.ttf",
  "Kufi.ttf",
  "Urdu.ttf",
  "FatemiMaqala.ttf",
  "Kufi2.ttf",
];

const FONT_FAMILY_BY_FILE: Record<string, string> = {
  "TahaNaskhRegular.ttf": "TahaNaskhRegular",
  "Amiri.ttf": "Amiri",
  "Thuluth.ttf": "Thuluth",
  "Kufi.ttf": "Kufi",
  "Urdu.ttf": "Urdu",
  "FatemiMaqala.ttf": "FatemiMaqala",
  "Kufi2.ttf": "Kufi2",
};

// Connected words, each exercising several joining forms. The last two are
// vocalized: HarfBuzz emits every tashkeel mark as its own glyph between the
// base letters, so these are what prove `computeJoinPins` pairs base letters
// rather than raw run neighbours (before that fix every vocalized entry
// below detected zero joins).
const WORDS = ["حرف", "بسم", "كتب", "سلام", "حَرْف", "مُحَمَّد"];
const FONT_SIZE = 200;

/**
 * Detection coverage as verified against real shaping, one entry per
 * FONTS × WORDS pair (42 total). This is today's *observed reality*, not an
 * aspiration — see the coverage `describe` block below for the full
 * (a)/(b)/(c)/(d) classification of every `pins: false` entry and the glyph
 * counts that back it up. 33 of the 42 pairs detect a join; the 9 that do
 * not are all Thuluth or Urdu, and every one of them was measured and
 * classified rather than assumed.
 */
const EXPECTED_COVERAGE: Record<string, Record<string, boolean>> = {
  TahaNaskhRegular: { حرف: true, بسم: true, كتب: true, سلام: true, حَرْف: true, مُحَمَّد: true },
  Amiri: { حرف: true, بسم: true, كتب: true, سلام: true, حَرْف: true, مُحَمَّد: true },
  Thuluth: { حرف: true, بسم: true, كتب: true, سلام: false, حَرْف: false, مُحَمَّد: false },
  Kufi: { حرف: true, بسم: true, كتب: true, سلام: true, حَرْف: true, مُحَمَّد: true },
  Urdu: { حرف: false, بسم: false, كتب: false, سلام: false, حَرْف: false, مُحَمَّد: false },
  FatemiMaqala: { حرف: true, بسم: true, كتب: true, سلام: true, حَرْف: true, مُحَمَّد: true },
  Kufi2: { حرف: true, بسم: true, كتب: true, سلام: true, حَرْف: true, مُحَمَّد: true },
};

describe("join invariance against real fonts", () => {
  // Sanity check that the real shaping helper above actually loads
  // harfbuzzjs's WASM in this Vitest/Node environment before trusting any
  // assertions built on top of it.
  beforeAll(async () => {
    const hb = await hbPromise;
    expect(typeof hb.shape).toBe("function");
  });

  for (const fontFile of FONTS) {
    const fontFamily = FONT_FAMILY_BY_FILE[fontFile];

    for (const word of WORDS) {
      it(
        `${fontFamily} / ${word}: every pinned join (if any) does not move at any factor`,
        async () => {
          const { glyphs, font, unitsPerEm } = await shapeReal(word, fontFile);
          expect(font).toBeTruthy();

          const nuqta = nuqtaPx(fontFamily, FONT_SIZE)!;
          expect(nuqta).toBeGreaterThan(0);

          const pins = computeJoinPins({
            glyphs,
            font: font!,
            fontSize: FONT_SIZE,
            unitsPerEm,
            pinRadius: nuqta * PIN_RADIUS_NUQTA,
          });

          // Whether a join is detected at all is a separate concern,
          // checked exhaustively (and explained) by the "join detection
          // coverage" describe block below — this test's only job is: for
          // every join that IS detected, the connection point must not
          // move, at any factor. Where no join is detected, this loop is
          // vacuously empty and the test still passes; that is correct,
          // not a hole, because there is nothing to prove invariant.
          for (const [glyphIndex, glyphPins] of pins) {
            for (const pin of glyphPins) {
              for (const factor of [0.85, 1, 1.2, 1.5, 1.8]) {
                const edit: GlyphEdit = {
                  glyphIndex,
                  stretches: [
                    {
                      id: "h1",
                      // A deliberately brutal axis: anchored far from the pin,
                      // aimed straight through it, with a band wide enough to
                      // cover the whole glyph. Nothing a real schema handle
                      // produces is harsher than this.
                      anchorX: pin.x - 400,
                      anchorY: pin.y,
                      dragOriginX: pin.x,
                      dragOriginY: pin.y,
                      dragX: pin.x + 400,
                      dragY: pin.y,
                      bandWidth: 4000,
                      minFactor: 0.85,
                      maxFactor: 1.8,
                      factor,
                    },
                  ],
                };

                const moved = applyGlyphEdit(pin.x, pin.y, edit, -1, [pin]);
                expect(
                  Math.hypot(moved.x - pin.x, moved.y - pin.y),
                  `${fontFamily} ${word} glyph ${glyphIndex} factor ${factor}`
                ).toBeLessThan(1e-9);

                // Exactly at the pin, `joinGuard` returns 0 by construction,
                // so the assertion above proves the guard function and not
                // much about where the pin was placed. The ring below is the
                // part that exercises the pin's neighbourhood: points that
                // sit *inside* the radius — i.e. the ink actually forming
                // the seam — must move strictly less than the same points
                // would with no pins at all. (At factor 1 the handle is
                // neutral and nothing moves either way; that is asserted
                // rather than skipped.)
                for (const fraction of [0.25, 0.5, 0.75]) {
                  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
                    const rx = pin.x + Math.cos(angle) * pin.radius * fraction;
                    const ry = pin.y + Math.sin(angle) * pin.radius * fraction;

                    const free = applyGlyphEdit(rx, ry, edit, -1);
                    const pinned = applyGlyphEdit(rx, ry, edit, -1, [pin]);
                    const freeDist = Math.hypot(free.x - rx, free.y - ry);
                    const pinnedDist = Math.hypot(pinned.x - rx, pinned.y - ry);
                    const label = `${fontFamily} ${word} glyph ${glyphIndex} factor ${factor} ring ${fraction}@${angle.toFixed(2)}`;

                    if (freeDist > 1e-9) {
                      expect(pinnedDist, label).toBeLessThan(freeDist);
                    } else {
                      expect(pinnedDist, label).toBeLessThan(1e-9);
                    }
                  }
                }
              }
            }
          }
        },
        20000
      );
    }
  }

  it("gives an out-of-scope font no pins at all", () => {
    expect(nuqtaPx("Ruqaa", FONT_SIZE)).toBeNull();
    expect(nuqtaPx("HarfCanvasDiwani", FONT_SIZE)).toBeNull();
  });
});

/**
 * Join detection coverage — a characterization test, deliberately separate
 * from invariance above. Its job is not to assert the design's aspiration
 * ("every connected word produces a join"); it is to pin down *today's*
 * verified reality per font/word pair, so a future regression (a pair that
 * detects a join today silently detecting none tomorrow) shows up as a
 * failing assertion here instead of being invisible.
 *
 * Every `false` entry in EXPECTED_COVERAGE was investigated by hand (see
 * `task-10-report.md` for the full walkthrough with per-pair glyph counts,
 * and `second-fix-report.md` for the two fonts added afterwards) and falls
 * into one of four structurally different cases:
 *
 * (a) THE WORD SHAPED TO A SINGLE GLYPH — the font's own GSUB fused the
 *     whole word into one glyph, so there is no glyph *boundary* and
 *     therefore nothing to tear. "No pin" is the CORRECT outcome here, not
 *     a coverage gap:
 *       - Urdu.ttf / بسم  → 1 glyph (whole word ligated)
 *       - Urdu.ttf / كتب  → 1 glyph (whole word ligated)
 *
 * (b) THE WORD SHAPED TO MULTIPLE GLYPHS WHOSE INK GENUINELY DOES NOT
 *     OVERLAP — the letters abut or sit apart rather than overlapping, so
 *     `overlapCentroid` correctly finds nothing to pin. This is a real gap
 *     in the design's premise ("connected letters physically overlap"),
 *     and the feature is simply inert there: stroke stretching keeps
 *     whatever tearing behaviour predates this branch. It is not a
 *     regression introduced by join pins — those cases are exactly as they
 *     were before this feature existed:
 *       - Urdu.ttf / حرف   → 2 glyphs; adjacent bounding boxes have a
 *         negative X overlap margin (~-7.3px at FONT_SIZE 200) — they do
 *         not touch at all, let alone overlap in ink.
 *       - Urdu.ttf / سلام  → 2 glyphs; same shape of gap (~-11.0px).
 *       - Thuluth.ttf / سلام → 3 glyphs; the first adjacent pair's boxes
 *         intersect only in a ~5.9px-wide sliver in which the sampled grid
 *         (checked at both 24 and 48 samples/axis) never lands a point
 *         inside both glyphs' actual ink; the second adjacent pair's boxes
 *         touch at a single, zero-width coordinate.
 *
 * (c) THE FONT'S MARKS ARE INVISIBLE TO THE MARK DETECTOR — pairing base
 *     letters (see `computeJoinPins`) depends on `lib/diacritics.ts`'s
 *     `findDiacriticGlyphIndices`, which is a heuristic over two signals:
 *     a mark's own cmap codepoint, and a nonzero GPOS attachment offset
 *     within a shared cluster. `Thuluth.ttf` defeats both — its shaped
 *     mark glyphs are mapped to *Private Use Area* codepoints (U+E012,
 *     U+E016 observed for fatha and sukun) rather than U+064B..U+065F, and
 *     they carry `dx === dy === 0` because the font positions marks by
 *     advance rather than GPOS. So its marks read as base letters, break
 *     the pairing exactly as before this fix, and:
 *       - Thuluth.ttf / حَرْف    → 5 glyphs, 0 marks detected, no pins
 *       - Thuluth.ttf / مُحَمَّد  → 7 glyphs, 0 marks detected, no pins
 *     while its *unvocalized* words are unaffected. This is the same
 *     limitation that already stops the per-mark diacritic overlay working
 *     on that font; the fix belongs in the detector (one module, several
 *     features), not in a second detector here.
 *
 * (d) THE MARK DETECTOR FLAGS A REAL LETTER — the mirror image of (c), and
 *     the reason `computeJoinPins` pairs on `markIndices.has(i) && ax === 0`
 *     rather than on the detector alone. `FatemiMaqala.ttf` emits `dx`
 *     values of 1–4 units out of an upem of 2048 — shaper rounding noise —
 *     on ordinary letters, and the detector's cluster-plus-nonzero-`dx`
 *     fallback reads those as mark attachment. Measured on unvocalized
 *     `كتب` in that font: glyph 2 (gid1549, dx=1, ax=263) and glyph 3
 *     (U+FEDB kaf initial, dx=4, ax=584) are both flagged, and dropping
 *     them from the base list cost the pins on 2 and 3 outright; `مُحَمَّد`
 *     lost *every* pin the same way. The advance is what separates the two
 *     cases — a genuine mark has `ax === 0`, a letter always advances the
 *     pen. No `false` entry in the table above is of this class any more;
 *     it is documented because the regression block at the bottom of this
 *     file exists to keep it that way.
 *
 * Do not "fix" a `false` entry here by widening detection (polygon
 * dilation, a proximity fallback, a baseline scan) — that is new design
 * work with its own failure mode (dilate enough to catch abutting letters
 * and you start manufacturing false joins between letters that merely pass
 * near each other) and belongs in the spec as deferred work, not in this
 * test.
 */
describe("join detection coverage (characterization, not aspiration)", () => {
  for (const fontFile of FONTS) {
    const fontFamily = FONT_FAMILY_BY_FILE[fontFile];

    for (const word of WORDS) {
      const expectPins = EXPECTED_COVERAGE[fontFamily][word];

      it(`${fontFamily} / ${word}: ${expectPins ? "detects" : "does not detect"} a join today`, async () => {
        const { glyphs, font, unitsPerEm } = await shapeReal(word, fontFile);
        const nuqta = nuqtaPx(fontFamily, FONT_SIZE)!;

        const pins = computeJoinPins({
          glyphs,
          font: font!,
          fontSize: FONT_SIZE,
          unitsPerEm,
          pinRadius: nuqta * PIN_RADIUS_NUQTA,
        });

        if (expectPins) {
          expect(pins.size, `${fontFamily} ${word} expected at least one join`).toBeGreaterThan(0);
        } else {
          expect(pins.size, `${fontFamily} ${word} expected no join (see class (a)/(b)/(c) comment above)`).toBe(0);
        }
      });
    }
  }
});

/**
 * Vocalized text — the regression this block exists to hold.
 *
 * HarfBuzz interleaves each tashkeel mark as its own glyph between the base
 * letters, so pairing raw run neighbours (`i`, `i+1`) found no join at all
 * the moment a word carried a single harakah: every case below produced
 * **zero** pins before `computeJoinPins` started skipping marks. Since this
 * app has an إعراب keyboard, a diacritics subsystem and a per-mark canvas
 * overlay, vocalized Arabic is a core use case, not an edge one.
 *
 * The pinned glyph indices are asserted exactly (not just "> 0") so that a
 * future change which starts pinning a mark, or drops a join, fails here
 * rather than quietly changing what the stretch tool protects.
 */
describe("vocalized text still detects joins (marks are skipped when pairing)", () => {
  const CASES: Array<{
    fontFile: string;
    fontFamily: string;
    word: string;
    /** Glyph indices expected to carry at least one pin. */
    pinnedGlyphs: number[];
  }> = [
    // حَرْف — hah + fatha, ra + sukun, feh: 5 glyphs, marks at 1 and 3.
    { fontFile: "Amiri.ttf", fontFamily: "Amiri", word: "حَرْف", pinnedGlyphs: [2, 4] },
    {
      fontFile: "TahaNaskhRegular.ttf",
      fontFamily: "TahaNaskhRegular",
      word: "حَرْف",
      pinnedGlyphs: [2, 4],
    },
    // مُحَمَّد — 8 glyphs in Amiri, four of them marks.
    { fontFile: "Amiri.ttf", fontFamily: "Amiri", word: "مُحَمَّد", pinnedGlyphs: [0, 3, 5, 7] },
  ];

  for (const { fontFile, fontFamily, word, pinnedGlyphs } of CASES) {
    it(
      `${fontFamily} / ${word}: pins the base letters and never a mark`,
      async () => {
        const { glyphs, font, unitsPerEm } = await shapeReal(word, fontFile);
        const nuqta = nuqtaPx(fontFamily, FONT_SIZE)!;

        const pins = computeJoinPins({
          glyphs,
          font: font!,
          fontSize: FONT_SIZE,
          unitsPerEm,
          pinRadius: nuqta * PIN_RADIUS_NUQTA,
        });

        // The premise: this run really is mark-interleaved, so the test is
        // not a vacuous pass on a font that dropped the marks entirely.
        const marks = findDiacriticGlyphIndices(glyphs, font!);
        expect(marks.size, `${fontFamily} ${word} expected marks in the run`).toBeGreaterThan(0);

        expect([...pins.keys()].sort((a, b) => a - b)).toEqual(pinnedGlyphs);

        for (const markIndex of marks) {
          expect(pins.has(markIndex), `${fontFamily} ${word} pinned mark glyph ${markIndex}`).toBe(
            false
          );
        }
      },
      20000
    );
  }
});

/**
 * Detector false positives — the regression this block exists to hold.
 *
 * `lib/diacritics.ts`'s fallback signal treats any glyph carrying a nonzero
 * HarfBuzz `dx`/`dy` inside a shared cluster as a mark attached to its base.
 * `FatemiMaqala.ttf` emits `dx` values of 1–4 units out of an upem of 2048 —
 * shaper rounding noise — on ordinary letters, so the detector flags real
 * letters there. Once `computeJoinPins` started skipping marks when pairing,
 * those false positives silently deleted joins that had been detected before:
 * unvocalized `كتب` dropped from four pinned glyphs to two, and `مُحَمَّد`
 * from three to none.
 *
 * The guard is `markIndices.has(i) && (g.ax ?? 0) === 0` — a genuine mark
 * takes no horizontal space and so cannot participate in a join, while a
 * letter always advances the pen. These cases assert the *exact* pinned
 * glyph sets, and each first asserts the premise (the detector really does
 * flag an advancing glyph in this run), so removing the guard fails here
 * loudly rather than quietly narrowing what the stretch tool protects.
 */
describe("mark detector false positives do not delete joins (advance guard)", () => {
  const CASES: Array<{
    word: string;
    /** Glyph indices the detector wrongly flags — real letters, nonzero `ax`. */
    falsePositives: number[];
    /** Glyph indices expected to carry at least one pin. */
    pinnedGlyphs: number[];
  }> = [
    // كتب — beh final, teh medial, an uncmapped component glyph, kaf initial.
    // Glyphs 2 (dx=1, ax=263) and 3 (dx=4, ax=584) are the false positives.
    { word: "كتب", falsePositives: [2, 3], pinnedGlyphs: [0, 1, 2, 3] },
    // مُحَمَّد — four genuine marks (ax=0) plus two flagged letters: glyph 3
    // (meem, dx=1, ax=586) and glyph 6 (U+FCCF, dx=-3, ax=1296). Without the
    // guard every base but one is filtered out and the word gets no pin at all.
    { word: "مُحَمَّد", falsePositives: [3, 6], pinnedGlyphs: [0, 3, 6] },
  ];

  for (const { word, falsePositives, pinnedGlyphs } of CASES) {
    it(
      `FatemiMaqala / ${word}: pins the letters the dx heuristic misreads as marks`,
      async () => {
        const { glyphs, font, unitsPerEm } = await shapeReal(word, "FatemiMaqala.ttf");
        const nuqta = nuqtaPx("FatemiMaqala", FONT_SIZE)!;

        // The premise: these really are advancing glyphs the detector flags.
        // If a future detector change stops flagging them, this test is no
        // longer exercising the guard and should be re-measured, not deleted.
        const marks = findDiacriticGlyphIndices(glyphs, font!);
        for (const i of falsePositives) {
          expect(marks.has(i), `FatemiMaqala ${word} glyph ${i} expected to be flagged`).toBe(true);
          expect(glyphs[i].ax ?? 0, `FatemiMaqala ${word} glyph ${i} advance`).toBeGreaterThan(0);
        }

        const pins = computeJoinPins({
          glyphs,
          font: font!,
          fontSize: FONT_SIZE,
          unitsPerEm,
          pinRadius: nuqta * PIN_RADIUS_NUQTA,
        });

        expect([...pins.keys()].sort((a, b) => a - b)).toEqual(pinnedGlyphs);

        // Genuine marks — the zero-advance ones — are still never pinned.
        for (const markIndex of marks) {
          if ((glyphs[markIndex].ax ?? 0) !== 0) continue;
          expect(pins.has(markIndex), `FatemiMaqala ${word} pinned mark glyph ${markIndex}`).toBe(
            false
          );
        }
      },
      20000
    );
  }
});

/**
 * Kufi2 decomposes its nuqat into separately positioned GPOS mark glyphs, so
 * pairing raw run neighbours breaks on words that carry no tashkeel at all —
 * a dot glyph sits between two letters and severs their adjacency. Measured
 * with raw-neighbour pairing versus base-letter pairing at FONT_SIZE 200:
 * `بسم` goes from 2 pinned glyphs to 3, and `كتب` from 2 to 3. This is a
 * *gain* from the mark-skipping change on a font the original five-font
 * matrix did not cover, and these exact sets hold it.
 */
describe("Kufi2 recovers joins severed by decomposed nuqat", () => {
  const CASES: Array<{ word: string; pinnedGlyphs: number[] }> = [
    // بسم — 4 glyphs, the dot at index 2; raw-neighbour pairing pinned [0,1].
    { word: "بسم", pinnedGlyphs: [0, 1, 3] },
    // كتب — 5 glyphs, dots at 0 and 2; raw-neighbour pairing pinned [3,4].
    { word: "كتب", pinnedGlyphs: [1, 3, 4] },
  ];

  for (const { word, pinnedGlyphs } of CASES) {
    it(
      `Kufi2 / ${word}: pins across its decomposed dot glyphs`,
      async () => {
        const { glyphs, font, unitsPerEm } = await shapeReal(word, "Kufi2.ttf");
        const nuqta = nuqtaPx("Kufi2", FONT_SIZE)!;

        const pins = computeJoinPins({
          glyphs,
          font: font!,
          fontSize: FONT_SIZE,
          unitsPerEm,
          pinRadius: nuqta * PIN_RADIUS_NUQTA,
        });

        expect([...pins.keys()].sort((a, b) => a - b)).toEqual(pinnedGlyphs);
      },
      20000
    );
  }
});
