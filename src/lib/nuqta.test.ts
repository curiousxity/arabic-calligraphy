/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { nuqtaUnits, FALLBACK_RATIO } from "./nuqta";

const FONT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/fonts"
);
const families = fs
  .readdirSync(FONT_DIR)
  .filter((f) => /\.(ttf|otf)$/i.test(f))
  .map((f) => f.replace(/\.(ttf|otf)$/i, ""));

describe("nuqtaUnits", () => {
  it("finds every bundled font on disk", () => {
    expect(families.length).toBeGreaterThan(10);
  });

  it.each(families)("resolves %s to a positive distance", (family) => {
    // A silent `undefined` here would make every cut zero-width, so the
    // feature would look broken rather than mis-sized.
    const u = nuqtaUnits(family, 100);
    expect(Number.isFinite(u)).toBe(true);
    expect(u).toBeGreaterThan(0);
  });

  it("scales linearly with font size", () => {
    expect(nuqtaUnits("Amiri", 200)).toBeCloseTo(nuqtaUnits("Amiri", 100) * 2, 9);
  });

  it("returns the measured ratio for a measured face", () => {
    // Source: docs/archive/nuqta-measurements.md. Pinned so a careless edit
    // to the table is visible rather than merely producing different sizes.
    expect(nuqtaUnits("Amiri", 1000)).toBeCloseTo(135, 6);
    expect(nuqtaUnits("Wessam", 1000)).toBeCloseTo(76.2, 6);
  });

  it("falls back for an uploaded font, which can never have an entry", () => {
    expect(nuqtaUnits("custom-my-font-a1b2c3", 1000)).toBeCloseTo(
      FALLBACK_RATIO * 1000, 6
    );
  });

  it("falls back for the two faces the archive does not cover", () => {
    // HarfCanvasDiwani postdates the measurement; Ruqaa was never measured.
    // Pinned so that if either is measured later, this test is the reminder
    // that the fallback is no longer what they should use.
    for (const family of ["HarfCanvasDiwani", "Ruqaa"]) {
      expect(nuqtaUnits(family, 1000)).toBeCloseTo(FALLBACK_RATIO * 1000, 6);
    }
  });
});
