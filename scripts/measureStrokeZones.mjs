// Coverage sweep for straight-stroke extension. Kept, not throwaway — the
// same reasoning that keeps measureNuqta.py: it is the other half of
// "don't redo the work." Run: npx --yes tsx scripts/measureStrokeZones.mjs
//
// Reads real fonts from public/fonts/, shapes real Arabic text through real
// harfbuzzjs, and runs the outline through the real detector in
// src/lib/strokeCuts.ts (never a hand-copied reimplementation of it) to
// measure how often findCutZones finds a legal straight-stroke cut zone.
//
// Three coverage numbers are reported per font, deliberately kept separate
// because they measure different populations and do not predict one
// another (see docs/archive/stroke-zone-coverage.md's review fix-up):
//   - isolated%   — the 28 base letters shaped one at a time. This is what
//                    the original brief's script measured.
//   - contextual% — the fraction of glyphs, across five shaped test words,
//                    that carry a zone ANYWHERE in their own outline. Not
//                    the same population as isolated% (a letter's outline
//                    can differ in a word vs. isolation), and not a
//                    connector/join metric either — a zone in the middle of
//                    a bowl counts here just as much as one at a join.
//   - join%       — the real connector metric: for each adjacent LETTER
//                    pair in a shaped word (zero-advance glyphs — i'jam dot
//                    components and other mark attachments, ax === 0 — are
//                    skipped when pairing, so a letter is paired with its
//                    next non-zero-advance neighbour rather than with a
//                    mark sitting between them), whether a zone sits near
//                    the shared join edge (the earlier letter's trailing
//                    pen-edge, or the later letter's leading pen-edge),
//                    divided by the number of letter-to-letter pairs. A
//                    zero-advance glyph's own local edge arithmetic would be
//                    meaningless anyway (ax = 0 collapses its trailing and
//                    leading edges onto the same point, while its real
//                    offset lives in dx, which this metric does not read),
//                    so excluding it from pairing is not just a labeling
//                    fix — a base<->mark pair was never a letter join.
//
// Corpus size note: five short test words yield only 10-13 letter-join
// slots per font once zero-advance glyphs are excluded from pairing
// (Urdu.ttf yields just 3, its heavy ligation collapsing five words to 8
// glyphs total). A single slot flipping moves a font's join% by roughly
// 8-10 points (Urdu's 3 slots move it by 33 points each), so differences of
// a few points between fonts are noise, not signal — read join% as
// "clearly clears 80%," "clearly doesn't," or "unclear," not as a
// fine-grained ranking.
//
// Flags:
//   --maxSlope=0.25   override DetectOpts.maxSlope for the whole sweep
//                      (step/thicknessTolerance/minZoneWidth stay fixed —
//                      the brief forbids tuning those to chase a number)
//   --spotCheck        instead of the sweep, reproduce the curved-letter
//                      slope samples (ن، ح، س on the four gate fonts) that
//                      justify rejecting maxSlope 0.25/0.35 in the coverage
//                      record, at both 0.18 and 0.35 (or just --maxSlope's
//                      value if that flag is also given).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as opentype from "opentype.js";

const require = createRequire(import.meta.url);
const hbjs = require("harfbuzzjs");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(DIR, "../public/fonts");

const LETTERS = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي".split("");
const WORDS = ["حرف", "محمد", "بسم", "سلام", "كتاب"];
const GATE_FONTS = ["Amiri.ttf", "Scheherazade.ttf", "NotoSans.ttf", "Kufi.ttf"];
const SPOT_CHECK_LETTERS = ["ن", "ح", "س"];

// tsx runs the TS module directly.
const { toSvgCmds, flattenContours, findCutZones, crossingsAt, DEFAULT_DETECT_OPTS } =
  await import("../src/lib/strokeCuts.ts");

const argv = process.argv.slice(2);
const argMaxSlope = argv
  .find((a) => a.startsWith("--maxSlope="))
  ?.split("=")[1];
const maxSlopeOverride = argMaxSlope !== undefined ? Number(argMaxSlope) : undefined;
const spotCheckMode = argv.includes("--spotCheck");

// The join-proximity window: how close a zone has to sit to the shared pen
// edge between two adjacent glyphs to count as covering that join, in font
// units. Chosen as 5 sample steps (step = upm/100 per the brief's per-font
// scaling), i.e. upm/20 — wide enough to tolerate a letter's own side
// bearing at the join without being so wide it accepts a zone that is
// really just "somewhere in the glyph." Fixed before the join numbers below
// were ever seen, and never adjusted afterward.
const JOIN_WINDOW_STEPS = 5;

async function resolveHb(mod) {
  let m = mod;
  while (m && typeof m === "object" && m.default !== undefined) m = m.default;
  if (typeof m === "function") return m();
  return m;
}

async function shape(hb, fontData, upm, text) {
  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();
  try {
    font.setScale?.(upm, upm);
    buffer.addText(text);
    buffer.guessSegmentProperties?.();
    buffer.setDirection?.("rtl");
    buffer.setScript?.("arab");
    buffer.setLanguage?.("ar");
    hb.shape(font, buffer, "");
    return buffer.json?.(font) ?? [];
  } finally {
    buffer.destroy?.(); font.destroy?.(); face.destroy?.(); blob.destroy?.();
  }
}

function zonesForGlyph(parsed, upm, opts, g, fontFile) {
  const glyphObj = parsed.glyphs.get(g.g);
  if (!glyphObj) {
    // A measurement script should fail loudly on a glyph it cannot resolve
    // rather than silently counting it as zone-free — that quietly depresses
    // every coverage number derived from it. Does not fire on any of the 17
    // bundled fonts as of this writing.
    throw new Error(`${fontFile}: opentype.js could not resolve glyph id ${g.g}`);
  }
  const cmds = toSvgCmds(glyphObj.getPath(0, 0, upm).commands);
  return findCutZones(flattenContours(cmds), { glyphIndex: 0, cluster: 0 }, opts);
}

/** Does any zone in `zones` (glyph-local font units) overlap the window
 *  [edgeX - window, edgeX + window]? */
function zoneNearEdge(zones, edgeX, window) {
  return zones.some((z) => z.fromX <= edgeX + window && z.toX >= edgeX - window);
}

const hb = await resolveHb(hbjs);

async function runSpotCheck() {
  const maxSlopes = maxSlopeOverride !== undefined ? [maxSlopeOverride] : [0.18, 0.35];
  for (const maxSlope of maxSlopes) {
    console.log(`\n===== spotCheck maxSlope=${maxSlope} =====`);
    for (const file of GATE_FONTS) {
      const bytes = fs.readFileSync(path.join(FONT_DIR, file));
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const parsed = opentype.parse(ab);
      const upm = parsed.unitsPerEm || 1000;
      const opts = { ...DEFAULT_DETECT_OPTS, maxSlope, step: upm / 100, minZoneWidth: upm / 40 };
      for (const ch of SPOT_CHECK_LETTERS) {
        const glyphs = await shape(hb, bytes, upm, ch);
        for (const g of glyphs) {
          const glyphObj = parsed.glyphs.get(g.g);
          if (!glyphObj) continue;
          const cmds = toSvgCmds(glyphObj.getPath(0, 0, upm).commands);
          const contours = flattenContours(cmds);
          const zones = findCutZones(contours, { glyphIndex: 0, cluster: 0 }, opts);
          let minX = Infinity, maxX = -Infinity;
          for (const c of contours) for (const [x] of c) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
          console.log(`${file} '${ch}' glyph=${glyphObj.name ?? "(unnamed)"} width=${(maxX - minX).toFixed(0)}u range=[${minX.toFixed(0)},${maxX.toFixed(0)}]`);
          if (!zones.length) { console.log("  (no zones)"); continue; }
          for (const z of zones) {
            const relFrom = ((z.fromX - minX) / (maxX - minX)).toFixed(2);
            const relTo = ((z.toX - minX) / (maxX - minX)).toFixed(2);
            console.log(`  zone x=[${z.fromX.toFixed(0)},${z.toX.toFixed(0)}] rel=[${relFrom},${relTo}] thickness=${z.thickness.toFixed(1)}`);
            const n = 5;
            const samples = [];
            for (let i = 0; i <= n; i++) {
              const x = z.fromX + (i / n) * (z.toX - z.fromX);
              const cs = crossingsAt(contours, x);
              samples.push(cs.map((c) => c.slope.toFixed(3)).join(","));
            }
            console.log(`    slopes @5pts: ${samples.join(" | ")}`);
          }
        }
      }
    }
  }
}

async function runSweep() {
  const files = fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f));
  const rows = [];

  for (const file of files) {
    const bytes = fs.readFileSync(path.join(FONT_DIR, file));
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parsed = opentype.parse(ab);
    const upm = parsed.unitsPerEm || 1000;
    const opts = {
      ...DEFAULT_DETECT_OPTS,
      step: upm / 100,
      minZoneWidth: upm / 40,
      ...(maxSlopeOverride !== undefined ? { maxSlope: maxSlopeOverride } : {}),
    };
    const joinWindow = JOIN_WINDOW_STEPS * opts.step;

    // Isolated: the 28 base letters, one at a time.
    let lettersWithZone = 0, totalZones = 0;
    const widths = [];
    for (const ch of LETTERS) {
      const glyphs = await shape(hb, bytes, upm, ch);
      let has = false;
      for (const g of glyphs) {
        const zones = zonesForGlyph(parsed, upm, opts, g, file);
        if (zones.length) { has = true; totalZones += zones.length; }
        for (const z of zones) widths.push((z.toX - z.fromX) / upm);
      }
      if (has) lettersWithZone++;
    }

    // Contextual + join: five shaped words.
    let contextualTotal = 0, contextualWithZone = 0;
    let joinSlots = 0, joinsCovered = 0;
    for (const w of WORDS) {
      const glyphs = await shape(hb, bytes, upm, w);
      const zonesPerGlyph = glyphs.map((g) => zonesForGlyph(parsed, upm, opts, g, file));

      for (const zones of zonesPerGlyph) {
        contextualTotal++;
        if (zones.length) contextualWithZone++;
      }

      // A join slot is a pair of LETTERS, not a pair of output glyphs: a
      // zero-advance glyph (ax === 0 — an i'jam dot component or other mark
      // attachment) is not a joining letter, so it is skipped when pairing.
      // Each letter is paired with its next non-zero-advance neighbour,
      // which may or may not be the immediately adjacent array entry.
      const letterIdx = [];
      for (let i = 0; i < glyphs.length; i++) {
        if ((glyphs[i].ax ?? 0) !== 0) letterIdx.push(i);
      }
      for (let k = 0; k + 1 < letterIdx.length; k++) {
        joinSlots++;
        const i = letterIdx[k];
        const next = letterIdx[k + 1];
        const advI = glyphs[i].ax ?? 0;
        const nearTrailingEdgeOfI = zoneNearEdge(zonesPerGlyph[i], advI, joinWindow);
        const nearLeadingEdgeOfNext = zoneNearEdge(zonesPerGlyph[next], 0, joinWindow);
        if (nearTrailingEdgeOfI || nearLeadingEdgeOfNext) joinsCovered++;
      }
    }

    widths.sort((a, b) => a - b);
    rows.push({
      font: file,
      letterPct: Math.round((lettersWithZone / LETTERS.length) * 100),
      totalZones,
      medianEm: widths.length ? widths[Math.floor(widths.length / 2)].toFixed(3) : "-",
      contextualPct: contextualTotal ? Math.round((contextualWithZone / contextualTotal) * 100) : 0,
      joinPct: joinSlots ? Math.round((joinsCovered / joinSlots) * 100) : 0,
    });
  }

  console.log(`maxSlope=${maxSlopeOverride ?? DEFAULT_DETECT_OPTS.maxSlope} joinWindow=${JOIN_WINDOW_STEPS} steps (upm/${Math.round(100 / JOIN_WINDOW_STEPS)})`);
  console.log("| Font | isolated letters | zones | median zone (em) | contextual | join |");
  console.log("|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(`| ${r.font} | ${r.letterPct}% | ${r.totalZones} | ${r.medianEm} | ${r.contextualPct}% | ${r.joinPct}% |`);
  }
}

if (spotCheckMode) {
  await runSpotCheck();
} else {
  await runSweep();
}
