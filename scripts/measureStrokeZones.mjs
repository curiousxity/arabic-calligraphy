// Coverage sweep for straight-stroke extension. Kept, not throwaway — the
// same reasoning that keeps measureNuqta.py: it is the other half of
// "don't redo the work." Run: npx --yes tsx scripts/measureStrokeZones.mjs
//
// Reads real fonts from public/fonts/, shapes real Arabic text through real
// harfbuzzjs, and runs the outline through the real detector in
// src/lib/strokeCuts.ts (never a hand-copied reimplementation of it) to
// measure how often findCutZones finds a legal straight-stroke cut zone.
//
// maxSlope can be overridden from the command line for the tuning steps
// documented in docs/archive/stroke-zone-coverage.md:
//   npx --yes tsx scripts/measureStrokeZones.mjs --maxSlope=0.25
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

// tsx runs the TS module directly.
const { toSvgCmds, flattenContours, findCutZones, DEFAULT_DETECT_OPTS } =
  await import("../src/lib/strokeCuts.ts");

// --maxSlope=0.25 style override, for the tuning steps in the brief. All
// other DetectOpts fields (step, thicknessTolerance, minZoneWidth) are
// deliberately not overridable here — the brief forbids tuning them to
// chase a number.
const argMaxSlope = process.argv
  .find((a) => a.startsWith("--maxSlope="))
  ?.split("=")[1];
const maxSlopeOverride = argMaxSlope !== undefined ? Number(argMaxSlope) : undefined;

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

const hb = await resolveHb(hbjs);
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

  let lettersWithZone = 0, totalZones = 0;
  const widths = [];

  for (const ch of LETTERS) {
    const glyphs = await shape(hb, bytes, upm, ch);
    let has = false;
    for (const g of glyphs) {
      const cmds = toSvgCmds(parsed.glyphs.get(g.g).getPath(0, 0, upm).commands);
      const zones = findCutZones(flattenContours(cmds), { glyphIndex: 0, cluster: 0 }, opts);
      if (zones.length) { has = true; totalZones += zones.length; }
      for (const z of zones) widths.push((z.toX - z.fromX) / upm);
    }
    if (has) lettersWithZone++;
  }

  let connectorSlots = 0, connectorZones = 0;
  for (const w of WORDS) {
    const glyphs = await shape(hb, bytes, upm, w);
    connectorSlots += Math.max(0, glyphs.length - 1);
    for (const g of glyphs) {
      const cmds = toSvgCmds(parsed.glyphs.get(g.g).getPath(0, 0, upm).commands);
      if (findCutZones(flattenContours(cmds), { glyphIndex: 0, cluster: 0 }, opts).length) {
        connectorZones++;
      }
    }
  }

  widths.sort((a, b) => a - b);
  rows.push({
    font: file,
    letterPct: Math.round((lettersWithZone / LETTERS.length) * 100),
    totalZones,
    medianEm: widths.length ? widths[Math.floor(widths.length / 2)].toFixed(3) : "-",
    connectorPct: connectorSlots ? Math.round((connectorZones / connectorSlots) * 100) : 0,
  });
}

console.log(`maxSlope=${maxSlopeOverride ?? DEFAULT_DETECT_OPTS.maxSlope}`);
console.log("| Font | letters with a zone | zones | median zone (em) | connector positions |");
console.log("|---|---|---|---|---|");
for (const r of rows) {
  console.log(`| ${r.font} | ${r.letterPct}% | ${r.totalZones} | ${r.medianEm} | ${r.connectorPct}% |`);
}
