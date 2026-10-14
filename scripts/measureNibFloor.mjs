// Per-font nib floor: the ratio of a vertical stem's thickness to a
// horizontal connector's, per bundled font. Kept, not throwaway, like
// measureStrokeZones.mjs. Run: npx --yes tsx scripts/measureNibFloor.mjs
//
// A stack join's weight comes from the cut faces' vectors — the stroke's
// perpendicular cross-section, not the pen. A real Diwani reed is held at
// roughly 45 degrees, so a vertical stroke in the font is nearly as heavy as a
// horizontal one; the join model would thin a 90 degree climb all the way to
// its floor, so `minFraction` is doing the nib angle's job and has to be
// measured per font. Results feed NIB_FLOOR_RATIO in src/lib/nuqta.ts.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as opentype from "opentype.js";

const require = createRequire(import.meta.url);
const hbjs = require("harfbuzzjs");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(DIR, "../public/fonts");

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

const { toSvgCmds, flattenContours, rotateContours, findCutZonesSwept, DEFAULT_DETECT_OPTS } =
  await import("../src/lib/strokeCuts.ts");

const hb = await resolveHb(hbjs);

// Horizontal: a lone tatweel is a straight horizontal stroke; its zone thickness.
// Vertical: an isolated alef, rotated 90° so its stem lies along x, crossed at its middle.
for (const file of fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f)).sort()) {
  const bytes = fs.readFileSync(path.join(FONT_DIR, file));
  const parsed = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const upm = parsed.unitsPerEm || 1000;
  const opts = { ...DEFAULT_DETECT_OPTS, step: upm / 100, minZoneWidth: upm / 40 };
  const outline = async (text) => {
    const [g] = await shape(hb, bytes, upm, text);
    return flattenContours(toSvgCmds(parsed.glyphs.get(g.g).getPath(0, 0, upm).commands));
  };
  const meta = { glyphIndex: 0, cluster: 0 };
  const meanThickness = (zones) => (zones.length ? zones.reduce((a, z) => a + z.thickness, 0) / zones.length : NaN);
  // Both sides use the swept detector, which reports the stroke's
  // perpendicular thickness in its own inclined frame (mean over zones).
  // Horizontal: the middle glyph of "ببب" (a connector in context); a lone
  // tatweel only if that yields no zone, marked "tatweel" in the output.
  const mid = (await shape(hb, bytes, upm, "ببب"))[1];
  let horizontal = NaN, hSrc = "context";
  if (mid) {
    horizontal = meanThickness(findCutZonesSwept(
      flattenContours(toSvgCmds(parsed.glyphs.get(mid.g).getPath(0, 0, upm).commands)), meta, opts));
  }
  if (!Number.isFinite(horizontal)) {
    hSrc = "tatweel";
    horizontal = meanThickness(findCutZonesSwept(await outline("ـ"), meta, opts));
  }
  const alef = rotateContours(await outline("ا"), Math.PI / 2);
  const vertical = meanThickness(findCutZonesSwept(alef, meta, opts));
  const ratio = vertical / horizontal;
  // Clamp to [0.1, 1], round to 2 dp: the value that goes in NIB_FLOOR_RATIO.
  // A clamp at 1 means "never thin"; the raw value is printed so it is visible.
  const fin = Number.isFinite(ratio) ? Math.round(Math.min(1, Math.max(0.1, ratio)) * 100) / 100 : NaN;
  console.log(
    `${file.replace(/\.(ttf|otf)$/i, "")}: raw ${Number.isFinite(ratio) ? ratio.toFixed(3) : "—"}  final ${Number.isFinite(fin) ? fin.toFixed(2) : "—"}` +
    `${Number.isFinite(ratio) && ratio > 1 ? " (CLAMPED)" : ""}  (v ${vertical.toFixed(0)} alef / h ${horizontal.toFixed(0)} ${hSrc})`
  );
}
