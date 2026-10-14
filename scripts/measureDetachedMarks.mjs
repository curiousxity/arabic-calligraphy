// Coverage gate for detached-mark detection (dots, hamza, the kaf stroke).
// Run: npx --yes tsx scripts/measureDetachedMarks.mjs
//
// Reads real fonts from public/fonts/, shapes real letters through real
// harfbuzzjs, and runs them through the real detector in
// src/lib/detachedMarks.ts (never a reimplementation). Unicode fixes how
// many dots a letter carries, so the detector can be scored exactly. Two
// halves per font:
//   dotted%    (letter, form) cells on dotted letters where 1 <= detected
//              <= expected. Many faces draw a dot group as one merged
//              contour; that is one movable mark, which is what the user
//              wants, so it passes and is counted under "merged".
//   undotted%  cells on undotted letters with zero detections — the half
//              that matters: a false hit is a handle on the letter's body.
// Gate: undotted >= 99%, else the font goes in UNSUPPORTED_FONTS. The dotted
// half is reported, not gated: a miss there is a dot the font draws fused to
// its stem (Diwani ف, Ruqaa ن), which has no handle and harms nothing. Tuning means editing MAX_MARK_FRACTION /
// MAX_MARK_EM_AREA in the module and re-running, so the archived number is
// always the shipped one. Results: docs/archive/detached-mark-coverage.md.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as opentype from "opentype.js";

const require = createRequire(import.meta.url);
const hbjs = require("harfbuzzjs");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(DIR, "../public/fonts");

const { findDetachedMarks } = await import("../src/lib/detachedMarks.ts");
const { findDiacriticGlyphIndices } = await import("../src/lib/diacritics.ts");
const { normalizeGlyphs } = await import("../src/lib/normalizeGlyphs.ts");

const EXPECTED = {
  "ا": 0, "د": 0, "ر": 0, "س": 0, "ص": 0, "ط": 0, "ع": 0, "ل": 0, "م": 0, "ه": 0, "و": 0, "ح": 0,
  "ب": 1, "ج": 1, "خ": 1, "ذ": 1, "ز": 1, "ض": 1, "ظ": 1, "غ": 1, "ف": 1, "ن": 1,
  "ت": 2, "ق": 2, "ي": 2,
  "ث": 3, "ش": 3,
  "أ": 1, "إ": 1, "ؤ": 1, "ئ": 1,
};
// ك is reported, not scored: 1 where the kaf stroke is detached, 0 where fused.
const FORMS = (l) => [l, `${l}ـ`, `ـ${l}ـ`, `ـ${l}`];

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
    return normalizeGlyphs(buffer.json?.(font) ?? []);
  } finally {
    buffer.destroy?.(); font.destroy?.(); face.destroy?.(); blob.destroy?.();
  }
}

const hb = await resolveHb(hbjs);

for (const file of fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/.test(f)).sort()) {
  const family = file.replace(/\.(ttf|otf)$/, "");
  const bytes = fs.readFileSync(path.join(FONT_DIR, file));
  const parsed = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const upm = parsed.unitsPerEm || 1000;
  const marksOn = async (text, letter) => {
    const glyphs = await shape(hb, bytes, upm, text);
    const dia = findDiacriticGlyphIndices(glyphs, parsed, text);
    const marks = findDetachedMarks(glyphs, parsed, upm, dia, family);
    // Count marks on the letter's own cluster (the tatweels carry none).
    const letterCl = [...text].findIndex((ch) => ch === letter);
    let n = 0;
    for (const list of marks.values()) for (const m of list) if (m.cluster === letterCl) n++;
    // Several fonts decompose أ إ ؤ ئ into a base plus a U+0654/U+0655
    // glyph, which findDiacriticGlyphIndices claims as a tashkeel — so it
    // is movable through the tashkeel handles instead. That counts as
    // covered; the two tools together are what the user gets.
    if ("أإؤئ".includes(letter)) for (const i of dia) if ((glyphs[i].cl ?? 0) === letterCl) n++;
    return n;
  };

  let dottedOk = 0, dottedN = 0, undottedOk = 0, undottedN = 0, merged = 0;
  const misses = [];
  for (const [letter, expected] of Object.entries(EXPECTED)) {
    for (const text of FORMS(letter)) {
      const n = await marksOn(text, letter);
      if (expected === 0) {
        undottedN++;
        if (n === 0) undottedOk++; else misses.push(`${text}:${n}`);
      } else {
        dottedN++;
        if (n >= 1 && n <= expected) { dottedOk++; if (n < expected) merged++; }
        else misses.push(`${text}:${n}/${expected}`);
      }
    }
  }
  const kaf = await marksOn("ك", "ك");
  const d = (100 * dottedOk / dottedN).toFixed(1), u = (100 * undottedOk / undottedN).toFixed(1);
  const pass = undottedOk / undottedN >= 0.99;
  console.log(`${family.padEnd(18)} dotted ${d.padStart(5)}%  undotted ${u.padStart(5)}%  merged ${String(merged).padStart(2)}  kaf ${kaf}  ${pass ? "PASS" : "FAIL"}  ${misses.slice(0, 8).join(" ")}`);
}
