/// <reference types="node" />
/**
 * The committed spine tables, checked against the real font binaries.
 *
 * The highest-value assertion here is the SHA-256 one: a font regenerated or
 * replaced without re-running scripts/deriveStrokeSpines.py leaves a table
 * anchored to outlines that no longer exist, and nothing else in the app would
 * notice. CLAUDE.md's "adding a font is a five-place edit" warning exists
 * because these omissions all fail silently; this makes one of them fail loudly.
 *
 * Coverage counts are a CHARACTERIZATION, like joinPins.fonts.test.ts's
 * EXPECTED_COVERAGE — they pin what the generator currently produces so a
 * regeneration that quietly loses letters is visible. Regenerating and getting
 * different numbers is not automatically a bug; it is a prompt to look.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as opentype from "opentype.js";
import type { SpineTable } from "./types";
import { allStrokeSchemas } from "../strokeSchema/registry";
import { nuqtaEmRatio } from "../nuqta";
import { contoursToPolygons, splitContours } from "../glyphContours";
import { pointInPolygon } from "../svgPath";

const dir = path.dirname(fileURLToPath(import.meta.url));
const SPINE_DIR = path.resolve(dir, "../../data/strokeSpines");
const FONT_DIR = path.resolve(dir, "../../../public/fonts");

function tables(): { family: string; table: SpineTable }[] {
  return fs
    .readdirSync(SPINE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      family: f.replace(/\.json$/, ""),
      table: JSON.parse(fs.readFileSync(path.join(SPINE_DIR, f), "utf-8")) as SpineTable,
    }));
}

function fontFile(family: string): string {
  for (const ext of [".ttf", ".otf"]) {
    const p = path.join(FONT_DIR, `${family}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`No font file for ${family}`);
}

/**
 * Distance from (px, py) to the nearest edge of a polygon, same units as the
 * polygon's own coordinates. Used only to size the containment tolerance
 * below — a point that fails `pointInPolygon` may still be a hair outside.
 */
function distanceToPolygon(px: number, py: number, poly: Array<[number, number]>): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    best = Math.min(best, Math.hypot(px - cx, py - cy));
  }
  return best;
}

/**
 * CHARACTERIZED 2026-08-13/14: sweeping every point in the shipped tables
 * (96,827 points, 15 fonts) against strict `pointInPolygon` containment found
 * 184 failures (0.19%) — median 1.40 font units off the boundary, max 5.09,
 * upem 2048 throughout the sample (in nuqta: median 0.008, max 0.023). Every
 * failure sat tight against a contour edge; none landed meaningfully inside a
 * counter or off the glyph. That signature is two bezier flatteners
 * (the offline generator's vs. this test's `contoursToPolygons`) disagreeing
 * by a few units of subdivision resolution at the boundary, not the generator
 * placing a point on the wrong ink.
 *
 * 0.05 nuqta is ~2x the observed max (0.023), so it absorbs that flattener
 * noise with headroom while staying far short of a stroke's own thickness
 * (~1 nuqta) — it would NOT absorb a point sitting inside a counter or
 * clearly outside the glyph, which is the real defect this test exists to
 * catch. Do not raise it without re-measuring; do not switch to a
 * containment *rate* — a rate lets one catastrophic outlier hide inside a
 * large denominator, exactly the failure mode this test is for.
 */
const INK_TOLERANCE_NUQTA = 0.05;

describe("committed stroke spine tables", () => {
  const all = tables();

  it("covers at least one font", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it.each(all)("$family: was generated from the font file that is here now", ({ family, table }) => {
    const bytes = fs.readFileSync(fontFile(family));
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(table.fontSha256);
  });

  it.each(all)("$family: unitsPerEm matches the font", ({ family, table }) => {
    const font = opentype.loadSync(fontFile(family));
    expect(table.unitsPerEm).toBe(font.unitsPerEm);
  });

  it.each(all)("$family: is only generated for fonts with a measured nuqta", ({ family }) => {
    expect(nuqtaEmRatio(family)).not.toBeNull();
  });

  it.each(all)("$family: every spine references a real schema stroke and zone", ({ table }) => {
    const schemas = new Map(allStrokeSchemas().map((s) => [s.glyph.id, s]));
    for (const entry of Object.values(table.glyphs)) {
      const schema = schemas.get(entry.schemaGlyph);
      expect(schema, `unknown schema glyph ${entry.schemaGlyph}`).toBeDefined();
      const strokes = new Map(
        schema!.glyph.components.flatMap((c) => c.strokes.map((s) => [s.id, s] as const))
      );
      for (const spine of entry.spines) {
        const stroke = strokes.get(spine.strokeId);
        expect(stroke, `unknown stroke ${spine.strokeId}`).toBeDefined();
        expect(stroke!.editBehavior.stretchZones[spine.zoneIndex]).toBeDefined();
      }
    }
  });

  it.each(all)("$family: every spine point lies inside its glyph's ink (or within 0.05 nuqta of it)", ({ family, table }) => {
    const font = opentype.loadSync(fontFile(family));
    const ratio = nuqtaEmRatio(family)!;
    const nuqtaUnits = ratio * table.unitsPerEm;
    for (const [glyphIdStr, entry] of Object.entries(table.glyphs)) {
      const glyph = font.glyphs.get(Number(glyphIdStr));
      if (!glyph) continue;
      // Font units, y-up: getPath at size = unitsPerEm gives y-down, so flip
      // the spine's y to compare in the same space.
      const polygons = contoursToPolygons(
        splitContours(glyph.getPath(0, 0, font.unitsPerEm).commands)
      );
      for (const spine of entry.spines) {
        for (const p of spine.points) {
          const inside = polygons.some((poly) => pointInPolygon(p.x, -p.y, poly));
          const nearest = inside
            ? 0
            : Math.min(...polygons.map((poly) => distanceToPolygon(p.x, -p.y, poly)));
          expect(
            nearest / nuqtaUnits,
            `${family} glyph ${glyphIdStr} ${spine.strokeId} (${p.x},${p.y}) is ${(nearest / nuqtaUnits).toFixed(4)} nuqta outside`
          ).toBeLessThanOrEqual(INK_TOLERANCE_NUQTA);
        }
      }
    }
  });

  /**
   * CHARACTERIZED 2026-08-13/14: `lengthDots` on a Stroke describes the whole
   * stroke, but a StretchZone can cover only part of it (fromNode/toNode a
   * strict sub-range of the stroke's own node list) — a partial zone's spine
   * is an arc *slice*, so comparing its length against the whole-stroke
   * `lengthDots` under-shoots by construction, not by generator defect.
   * Checked directly against the shipped tables: of 401 spines, 279 are
   * full-stroke zones and 122 partial; the strict comparison originally
   * written here failed on exactly 42 spines, and every one of them was
   * partial (dominated by S_EYE_1 loops and S_BOWL_1/S_BODY_1 zones) — zero
   * full-stroke zones failed. So this assertion is restricted to full-stroke
   * zones, which is a comparison of like quantities; partial zones are
   * skipped rather than scaled by node-span fraction, because that fraction
   * assumes length is distributed evenly across a stroke's schema nodes —
   * exactly the kind of proportional guess `spineError.test.ts` already
   * measured and rejected (median 0.37 nuqta error, p90 1.43). A future
   * full-stroke failure here is a real generator defect and should not be
   * waved through; a partial-zone one is not evidence of anything, which is
   * why it is never reached.
   */
  it.each(all)("$family: every full-stroke spine's length agrees with the schema's lengthDots", ({ family, table }) => {
    const ratio = nuqtaEmRatio(family)!;
    const nuqtaUnits = ratio * table.unitsPerEm;
    const schemas = new Map(allStrokeSchemas().map((s) => [s.glyph.id, s]));

    for (const entry of Object.values(table.glyphs)) {
      const strokes = new Map(
        schemas
          .get(entry.schemaGlyph)!
          .glyph.components.flatMap((c) => c.strokes.map((s) => [s.id, s] as const))
      );
      for (const spine of entry.spines) {
        const stroke = strokes.get(spine.strokeId)!;
        const zone = stroke.editBehavior.stretchZones[spine.zoneIndex];
        const isFullStroke = zone.fromNode === 0 && zone.toNode === stroke.path.nodes.length - 1;
        if (!isFullStroke) continue; // arc slice of the stroke — lengthDots describes the whole stroke, not this
        const want = (stroke.lengthDots ?? 0) * nuqtaUnits;
        if (want <= 0) continue; // the schema did not author a length for this stroke
        const got = spine.points
          .slice(1)
          .reduce(
            (n, p, i) => n + Math.hypot(p.x - spine.points[i].x, p.y - spine.points[i].y),
            0
          );
        // The same 0.5x-2x band scripts/deriveStrokeSpines.py gates on. If the
        // script's band is retuned, retune this with it — they are one decision.
        expect(got / want, `${family} ${spine.strokeId}`).toBeGreaterThanOrEqual(0.5);
        expect(got / want, `${family} ${spine.strokeId}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it.each(all)("$family: every spine has at least two points and a positive radius", ({ table }) => {
    for (const entry of Object.values(table.glyphs)) {
      for (const spine of entry.spines) {
        expect(spine.points.length).toBeGreaterThanOrEqual(2);
        for (const p of spine.points) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
          expect(p.radius).toBeGreaterThan(0);
        }
      }
    }
  });

  it("coverage has not silently collapsed", () => {
    // CHARACTERIZATION — fill these in from Task 4's report, then treat a
    // change as a prompt to look rather than as a failure to suppress.
    const counts = Object.fromEntries(
      all.map(({ family, table }) => [
        family,
        Object.values(table.glyphs).reduce((n, g) => n + g.spines.length, 0),
      ])
    );
    for (const [family, n] of Object.entries(counts)) {
      expect(n, `${family} produced no spines at all`).toBeGreaterThan(0);
    }
    expect(counts).toMatchSnapshot();
  });
});
