// Curve coverage for "bend a curved stroke". Kept, not throwaway: it is the
// gate the spec names. Run: npx --yes tsx scripts/measureCurves.mjs
//
// For each bundled font: shape four words with real harfbuzzjs, bake them
// with the real convertRunToStack, and run the real curveRegions over every
// letter piece. Reports curves found per letter, the mean turn, and — the
// gate — for each curve, whether freeing it at the apex succeeds and the
// outline's area stays within 5% of the original (n/a until bendCurveAt
// exists).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as opentype from "opentype.js";

const require = createRequire(import.meta.url);
const hbjs = require("harfbuzzjs");
const DIR = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(DIR, "../public/fonts");
const { curveRegions } = await import("../src/lib/stackCurve.ts");
const convertMod = await import("../src/lib/stackConvert.ts");
const { convertRunToStack } = convertMod;
const bendCurveAt = convertMod.bendCurveAt ?? null;
const { normalizeGlyphs } = await import("../src/lib/normalizeGlyphs.ts");
const { flattenContours } = await import("../src/lib/strokeCuts.ts");
const { assembleStackOutline } = await import("../src/lib/stackOutline.ts");
const { nibFloorFraction, nuqtaUnits } = await import("../src/lib/nuqta.ts");

const WORDS = ["الملك", "مصبح", "نحن", "حرف"];

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
const area = (cmds) =>
  flattenContours(cmds).reduce((sum, c) => {
    let a = 0;
    for (let i = 0; i + 1 < c.length; i++) a += c[i][0] * c[i + 1][1] - c[i + 1][0] * c[i][1];
    return sum + Math.abs(a) / 2;
  }, 0);

const hb = await resolveHb(hbjs);
const rows = [];
for (const file of fs.readdirSync(FONTS_DIR).filter((f) => /\.(ttf|otf)$/.test(f)).sort()) {
  const fontData = fs.readFileSync(path.join(FONTS_DIR, file));
  const parsed = opentype.parse(fontData.buffer.slice(fontData.byteOffset, fontData.byteOffset + fontData.byteLength));
  const upm = parsed.unitsPerEm || 1000;
  const family = file.replace(/\.(ttf|otf)$/, "");
  let letters = 0, curves = 0, turnSum = 0, freed = 0, identityOk = 0, tried = 0;
  for (const word of WORDS) {
    const glyphs = normalizeGlyphs(await shape(hb, fontData, upm, word));
    const { pieces, joins } = convertRunToStack({
      glyphs, font: parsed, unitsPerEm: upm, shapableText: word, cutPlan: null, diacriticOverrides: [],
      fontSize: upm, detachedMarkOverrides: [], fontFamily: family,
    });
    const nib = { width: nuqtaUnits(family, upm), minFraction: nibFloorFraction(family) };
    const before = area(assembleStackOutline(pieces, joins, nib));
    for (const p of pieces.filter((x) => x.role === "letter" && x.parentId === undefined)) {
      letters++;
      const regions = curveRegions(p.cmds, { maxLength: 3 * upm, faces: p.faces });
      curves += regions.length;
      for (const r of regions) {
        turnSum += r.trace.turn;
        if (!bendCurveAt) continue;
        tried++;
        const res = bendCurveAt(pieces, joins, p.id, r.trace);   // as the overlay does: the hover's own trace
        if (!res) continue;
        freed++;
        const after = area(assembleStackOutline(res.pieces, res.joins, nib));
        if (Math.abs(after - before) / before < 0.05) identityOk++;
      }
    }
  }
  rows.push({
    font: family, letters, curves, perLetter: (curves / Math.max(letters, 1)).toFixed(2),
    meanTurnDeg: curves ? Math.round((turnSum / curves) * 180 / Math.PI) : 0,
    freed: tried ? `${freed}/${tried}` : "n/a", identity: tried ? `${identityOk}/${tried}` : "n/a",
  });
}
console.table(rows);
