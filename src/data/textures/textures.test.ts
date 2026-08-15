import { describe, it, expect } from "vitest";
import { TEXTURES, getTexture } from "./index";
import { tileFbm, tileNoise, tileSpeckle } from "./_noise";

describe("the texture registry", () => {
  it("picks up every texture module, with unique ids", () => {
    expect(TEXTURES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(TEXTURES.map((t) => t.id)).size).toBe(TEXTURES.length);
    expect(getTexture(TEXTURES[0].id)).toBe(TEXTURES[0]);
    expect(getTexture(null)).toBeNull();
    expect(getTexture("no-such-texture")).toBeNull();
  });

  it("skips the shared helper modules beside the data", () => {
    expect(TEXTURES.some((t) => t.id === "_noise" || t.id === "types")).toBe(false);
  });

  it("declares a sane tile size and default tint", () => {
    for (const t of TEXTURES) {
      expect(t.size).toBeGreaterThanOrEqual(64);
      expect(t.defaultTint).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.name.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The surface is drawn as a repeating pattern, so a tile whose grain does not
 * wrap shows a hard grid across the page — the one defect that would make the
 * whole feature unusable and the one that is invisible in a single tile.
 */
describe("seamlessness", () => {
  const samples = [0, 0.13, 0.37, 0.5, 0.61, 0.87, 0.99];

  it("wraps every texture's grain at both tile edges", () => {
    for (const t of TEXTURES) {
      for (const s of samples) {
        expect(t.grain(0, s), `${t.id} across u at v=${s}`).toBeCloseTo(t.grain(1, s), 9);
        expect(t.grain(s, 0), `${t.id} across v at u=${s}`).toBeCloseTo(t.grain(s, 1), 9);
      }
    }
  });

  it("wraps each noise primitive it is built from", () => {
    for (const s of samples) {
      expect(tileNoise(0, s, 8, 8, 3)).toBeCloseTo(tileNoise(1, s, 8, 8, 3), 12);
      expect(tileNoise(s, 0, 4, 32, 3)).toBeCloseTo(tileNoise(s, 1, 4, 32, 3), 12);
      expect(tileFbm(0, s, 3, 4, 9)).toBeCloseTo(tileFbm(1, s, 3, 4, 9), 12);
      expect(tileSpeckle(0, s, 12, 0.4, 0.2, 5)).toBeCloseTo(
        tileSpeckle(1, s, 12, 0.4, 0.2, 5),
        12
      );
    }
  });
});

describe("grain", () => {
  it("stays in a range that neither washes out nor blacks out the tint", () => {
    for (const t of TEXTURES) {
      let min = Infinity;
      let max = -Infinity;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const k = t.grain(x / 32, y / 32);
          min = Math.min(min, k);
          max = Math.max(max, k);
        }
      }
      expect(min, `${t.id} darkest`).toBeGreaterThan(-1);
      expect(max, `${t.id} lightest`).toBeLessThan(1);
      // A texture that never varies is a flat colour with extra steps.
      expect(max - min, `${t.id} contrast`).toBeGreaterThan(0.02);
    }
  });
});
