/// <reference types="node" />
/**
 * PHASE C — how far does the schema's idealized spine land from real ink?
 *
 * This is the measurement that gates changes 2 and 4 of the per-stroke
 * editing design (`docs/superpowers/specs/2026-08-12-per-stroke-editing-design.md`),
 * and its answer was **no: the mapping is not accurate enough**. Run
 * 2026-08-13 over 105 schemas x 5 fonts = 1318 mapped nodes:
 *
 *     landed inside ink   14.5%
 *     median 0.37 nuqta   p90 1.43   p99 2.98   max 4.68
 *
 * The bar set before looking was median <= 0.25 / p90 <= 0.5 to proceed as
 * designed, p90 > 1 to require re-anchoring first. p90 is 1.43. The full
 * per-font, per-form and per-component breakdown lives in the spec.
 *
 * **This is a characterization test, not a guard.** It asserts the mapping
 * is still as inaccurate as measured, so that anyone who improves it — by
 * snapping the spine to nearest ink, or to a medial axis — gets a failure
 * telling them to re-run Phase C and reconsider whether Phase D is now
 * viable. A failure here is good news, not a regression.
 *
 * It imports the app's REAL mapping (`mapNormToRealBox`,
 * `deriveStretchCatalog`) rather than reimplementing it — measuring a
 * mapping that isn't the shipped one would be worthless. Error is expressed
 * in nuqta because a stroke feature is roughly one nuqta thick, so "1.43
 * nuqta away" reads directly as "more than a stroke width off the ink it
 * was supposed to describe".
 *
 * SINCE 2026-08-13 THIS MEASURES THE SEED, NOT THE SHIPPED MAPPING.
 * Stretch handles now take their axis from the generated spine tables
 * (src/data/strokeSpines/, see spineTable.test.ts); mapNormToRealBox survives
 * only as the seed hint the offline matcher starts from. The numbers below are
 * still the reason that replacement happened, so they stay pinned here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

const lines: string[] = [];
const say = (s: string) => {
  lines.push(s);
};
import * as opentype from "opentype.js";
import type { PathCommand } from "opentype.js";
import { allStrokeSchemas } from "./registry";
import { deriveStretchCatalog } from "./deriveCatalog";
import { mapNormToRealBox } from "./schemaGeometry";
import { contoursToPolygons, splitContours } from "../glyphContours";
import { pointInPolygon } from "../svgPath";
import { nuqtaEmRatio } from "../nuqta";
import { normalizeGlyphs } from "../normalizeGlyphs";
import type { HarfBuzzGlyph } from "../normalizeGlyphs";

const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");

type HbModule = {
  createBlob: (d: ArrayBuffer | Uint8Array) => { destroy?: () => void };
  createFace: (b: unknown, i: number) => { destroy?: () => void };
  createFont: (f: unknown) => { setScale?: (x: number, y: number) => void; destroy?: () => void };
  createBuffer: () => {
    addText: (t: string) => void;
    guessSegmentProperties?: () => void;
    setDirection?: (d: string) => void;
    setScript?: (s: string) => void;
    setLanguage?: (l: string) => void;
    json?: (f?: unknown) => unknown[];
    destroy?: () => void;
  };
  shape: (f: unknown, b: unknown, feat?: string) => void;
};

function resolveHbLoader(mod: unknown): Promise<HbModule> {
  let m: unknown = mod;
  let rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;
  if (typeof m === "function") return (m as () => Promise<HbModule>)();
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec && typeof rec.then === "function") return m as Promise<HbModule>;
  throw new Error("cannot resolve harfbuzzjs");
}
const hbPromise = resolveHbLoader(hbjsModule);

const FONT_SIZE = 1000;

const fontCache = new Map<string, { data: Buffer; parsed: opentype.Font; upm: number }>();
function loadFont(file: string) {
  const hit = fontCache.get(file);
  if (hit) return hit;
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const data = fs.readFileSync(path.resolve(dir, "../../../public/fonts", file));
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const parsed = opentype.parse(ab);
  const entry = { data, parsed, upm: parsed.unitsPerEm || 1000 };
  fontCache.set(file, entry);
  return entry;
}

async function shapeReal(text: string, file: string): Promise<HarfBuzzGlyph[]> {
  const { data, upm } = loadFont(file);
  const hb = await hbPromise;
  const blob = hb.createBlob(new Uint8Array(data));
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
    hb.shape(font, buffer);
    let raw: unknown[] = [];
    if (typeof buffer.json === "function") {
      try {
        raw = buffer.json(font);
      } catch {
        raw = buffer.json();
      }
    }
    return normalizeGlyphs(raw as never);
  } finally {
    buffer.destroy?.();
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

/** Text that forces a given contextual form, plus which character index is the target letter. */
function contextFor(letter: string, form: string): { text: string; index: number } | null {
  const B = "ب"; // beh — dual-joining connector
  switch (form) {
    case "isolated":
      return { text: letter, index: 0 };
    case "initial":
      return { text: letter + B, index: 0 };
    case "medial":
      return { text: B + letter + B, index: 1 };
    case "final":
      return { text: B + letter, index: 1 };
    default:
      return null;
  }
}

/** Distance from a point to the glyph's ink: 0 when inside, else distance to the nearest outline segment. */
function distanceToInk(x: number, y: number, polys: Array<[number, number]>[]): number {
  let crossings = 0;
  for (const p of polys) if (pointInPolygon(x, y, p)) crossings++;
  if (crossings % 2 === 1) return 0;

  let best = Infinity;
  for (const poly of polys) {
    for (let i = 0; i < poly.length - 1; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d < best) best = d;
    }
  }
  return best;
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

const FONTS: Array<[string, string, string]> = [
  ["TahaNaskhRegular", "TahaNaskhRegular.ttf", "Naskh"],
  ["Amiri", "Amiri.ttf", "Naskh"],
  ["Thuluth", "Thuluth.ttf", "Thuluth"],
  ["Kufi", "Kufi.ttf", "Kufi"],
  ["Urdu", "Urdu.ttf", "Urdu/Nastaliq"],
];

describe("PHASE C — schema spine vs real ink", () => {
  it("measures mapped-node error across fonts and letters", async () => {
    const schemas = allStrokeSchemas().filter((s) => s.glyph.unicode && !s.glyph.baseLetterSequence?.length);

    const perFont: Record<string, number[]> = {};
    const perStyle: Record<string, number[]> = {};
    const perForm: Record<string, number[]> = {};
    const perComponents: Record<number, number[]> = {};
    const worst: Array<{ e: number; font: string; glyph: string; label: string }> = [];
    let insideCount = 0;
    let total = 0;
    let noGlyph = 0;

    for (const [family, file, style] of FONTS) {
      const { parsed, upm } = loadFont(file);
      const nuqtaRatio = nuqtaEmRatio(family)!;
      const nuqtaUnits = nuqtaRatio * FONT_SIZE; // px at FONT_SIZE
      perFont[family] ??= [];
      perStyle[style] ??= [];

      for (const desc of schemas) {
        const letter = String.fromCodePoint(parseInt(desc.glyph.unicode!, 16));
        const ctx = contextFor(letter, desc.glyph.joiningForm);
        if (!ctx) continue;

        const glyphs = await shapeReal(ctx.text, file);
        const g = glyphs.find((gl) => gl.cl === ctx.index);
        if (!g) {
          noGlyph++;
          continue;
        }
        const glyphObj = parsed.glyphs.get(g.g);
        if (!glyphObj) {
          noGlyph++;
          continue;
        }

        const scale = FONT_SIZE / upm;
        const cmds = glyphObj.getPath(0, 0, FONT_SIZE).commands as PathCommand[];
        const polys = contoursToPolygons(splitContours(cmds));
        if (!polys.length) {
          noGlyph++;
          continue;
        }

        const bb = glyphObj.getPath(0, 0, FONT_SIZE).getBoundingBox();
        const box = { x: bb.x1, y: bb.y1, width: bb.x2 - bb.x1, height: bb.y2 - bb.y1 };
        if (!(box.width > 0) || !(box.height > 0)) {
          noGlyph++;
          continue;
        }
        void scale;

        for (const def of deriveStretchCatalog(desc)) {
          for (const [which, norm] of [
            ["anchor", def.anchorNorm],
            ["drag", def.dragNorm],
          ] as const) {
            const p = mapNormToRealBox(norm, box);
            const dPx = distanceToInk(p.x, p.y, polys);
            const dNuqta = dPx / nuqtaUnits;
            total++;
            if (dPx === 0) insideCount++;
            perFont[family].push(dNuqta);
            perStyle[style].push(dNuqta);
            (perForm[desc.glyph.joiningForm] ??= []).push(dNuqta);
            (perComponents[desc.glyph.components.length] ??= []).push(dNuqta);
            worst.push({
              e: dNuqta,
              font: family,
              glyph: desc.glyph.id,
              label: `${def.label.en ?? def.componentType}/${which}`,
            });
          }
        }
      }
    }

    const all = Object.values(perFont).flat().sort((a, b) => a - b);

    say("\n===== PHASE C RESULT — mapped spine node -> nearest ink, in NUQTA =====");
    say(`samples ${total}  |  landed inside ink ${((insideCount / total) * 100).toFixed(1)}%  |  skipped (no glyph) ${noGlyph}`);
    say(`OVERALL  median ${pct(all, 50).toFixed(2)}   p90 ${pct(all, 90).toFixed(2)}   p99 ${pct(all, 99).toFixed(2)}   max ${pct(all, 100).toFixed(2)}`);

    say("\n-- per font --");
    for (const [family] of FONTS) {
      const s = [...perFont[family]].sort((a, b) => a - b);
      const inside = s.filter((d) => d === 0).length;
      say(
        `${family.padEnd(20)} n=${String(s.length).padStart(4)}  inside ${((inside / s.length) * 100).toFixed(0).padStart(3)}%  median ${pct(s, 50).toFixed(2)}  p90 ${pct(s, 90).toFixed(2)}  max ${pct(s, 100).toFixed(2)}`
      );
    }

    say("\n-- worst 15 --");
    worst.sort((a, b) => b.e - a.e);
    for (const w of worst.slice(0, 15)) {
      say(`  ${w.e.toFixed(2)} nuqta  ${w.font.padEnd(18)} ${w.glyph.padEnd(22)} ${w.label}`);
    }
    say("\n-- by joining form (does per-form skeleton reuse explain it?) --");
    for (const form of ["isolated", "initial", "medial", "final"]) {
      const s = (perForm[form] ?? []).sort((a, b) => a - b);
      if (!s.length) continue;
      const inside = s.filter((d) => d === 0).length;
      say(
        `${form.padEnd(10)} n=${String(s.length).padStart(4)}  inside ${((inside / s.length) * 100).toFixed(0).padStart(3)}%  median ${pct(s, 50).toFixed(2)}  p90 ${pct(s, 90).toFixed(2)}`
      );
    }

    say("\n-- by component count in the schema (is whole-glyph bbox normalization the culprit?) --");
    for (const k of Object.keys(perComponents).map(Number).sort((a, b) => a - b)) {
      const s = [...perComponents[k]].sort((a, b) => a - b);
      const inside = s.filter((d) => d === 0).length;
      say(
        `${k} component(s)  n=${String(s.length).padStart(4)}  inside ${((inside / s.length) * 100).toFixed(0).padStart(3)}%  median ${pct(s, 50).toFixed(2)}  p90 ${pct(s, 90).toFixed(2)}`
      );
    }

    say("=====================================================================\n");

    const report = lines.join("\n");
    const median = pct(all, 50);
    const p90 = pct(all, 90);
    const insidePct = (insideCount / total) * 100;

    // An empty sweep must not masquerade as a pass.
    expect(total, report).toBeGreaterThan(1000);

    // The Phase C verdict, pinned. If any of these start failing because the
    // mapping got BETTER, that is the good outcome: re-run the numbers, put
    // them in the spec, and reconsider whether changes 2 and 4 are viable.
    expect(p90, `p90 improved past the Phase C verdict — re-evaluate Phase D.\n${report}`).toBeGreaterThan(1);
    expect(median, `median improved past the Phase C verdict — re-evaluate Phase D.\n${report}`).toBeGreaterThan(0.25);
    expect(insidePct, `far more nodes land inside ink than Phase C measured — re-evaluate Phase D.\n${report}`).toBeLessThan(40);
  }, 600000);
});
