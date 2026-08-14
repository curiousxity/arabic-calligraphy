import { describe, expect, it } from "vitest";
import {
  ARTBOARD_PRESETS,
  DEFAULT_CUSTOM_ARTBOARD,
  PRINT_DPI,
  SCREEN_DPI,
  artboardRect,
  clampMargin,
  configFromPreset,
  exportPixelRatio,
  exportPixelSize,
  findArtboardPreset,
  fromDisplayUnit,
  isArtboardConfig,
  marginRect,
  matchArtboardPreset,
  pxToMm,
  toDisplayUnit,
  withDpi,
  withOrientation,
  withSize,
  type ArtboardConfig,
} from "./artboard";

const square = () => configFromPreset(findArtboardPreset("ig-square")!);
const a4 = () => configFromPreset(findArtboardPreset("a4")!);

describe("presets", () => {
  it("gives the paper sizes their familiar 300dpi pixel counts", () => {
    expect(exportPixelSize(a4())).toEqual({ width: 2480, height: 3508 });
    expect(exportPixelSize(configFromPreset(findArtboardPreset("a5")!))).toEqual({
      width: 1748,
      height: 2480,
    });
    expect(exportPixelSize(configFromPreset(findArtboardPreset("a3")!))).toEqual({
      width: 3508,
      height: 4961,
    });
    expect(exportPixelSize(configFromPreset(findArtboardPreset("us-letter")!))).toEqual({
      width: 2550,
      height: 3300,
    });
  });

  it("keeps the screen presets at exactly their stated pixel size", () => {
    expect(exportPixelSize(square())).toEqual({ width: 1080, height: 1080 });
    expect(exportPixelSize(configFromPreset(findArtboardPreset("story")!))).toEqual({
      width: 1080,
      height: 1920,
    });
  });

  it("round-trips every preset through a config and back", () => {
    for (const preset of ARTBOARD_PRESETS) {
      const cfg = configFromPreset(preset);
      expect(cfg.presetId).toBe(preset.id);
      expect(cfg.width).toBe(preset.width);
      expect(cfg.height).toBe(preset.height);
      expect(cfg.dpi).toBe(preset.dpi);
      expect(cfg.unit).toBe(preset.unit);
      expect(matchArtboardPreset(cfg)?.id).toBe(preset.id);
    }
  });

  it("still recognises a preset after its orientation is flipped", () => {
    const flipped = withOrientation(a4(), "landscape");
    expect(matchArtboardPreset(flipped)?.id).toBe("a4");
  });

  it("derives orientation from the preset's own proportions", () => {
    expect(a4().orientation).toBe("portrait");
    expect(configFromPreset(findArtboardPreset("x-header")!).orientation).toBe("landscape");
    // Square is neither; portrait is the arbitrary-but-stable answer.
    expect(square().orientation).toBe("portrait");
  });

  it("reports an unknown id as no preset", () => {
    expect(findArtboardPreset("nope")).toBeNull();
    expect(findArtboardPreset(null)).toBeNull();
  });
});

describe("unit conversion", () => {
  it("is the identity for px at any dpi", () => {
    for (const dpi of [72, SCREEN_DPI, PRINT_DPI]) {
      const cfg = { unit: "px" as const, dpi };
      expect(toDisplayUnit(1234, cfg)).toBe(1234);
      expect(fromDisplayUnit(1234, cfg)).toBe(1234);
    }
  });

  it("shows a 300dpi A4 page as 210 × 297 mm", () => {
    const cfg = a4();
    expect(Math.round(toDisplayUnit(cfg.width, cfg))).toBe(210);
    expect(Math.round(toDisplayUnit(cfg.height, cfg))).toBe(297);
  });

  it("shows a 300dpi US Letter page as 8.5 × 11 in", () => {
    const cfg = configFromPreset(findArtboardPreset("us-letter")!);
    expect(toDisplayUnit(cfg.width, cfg)).toBeCloseTo(8.5, 6);
    expect(toDisplayUnit(cfg.height, cfg)).toBeCloseTo(11, 6);
  });

  it("round-trips display units back to px at each dpi", () => {
    for (const dpi of [SCREEN_DPI, 150, PRINT_DPI]) {
      for (const unit of ["mm", "in"] as const) {
        const cfg = { unit, dpi };
        const px = 2480;
        // Through mm the round trip is rounded to whole px, so allow one.
        expect(Math.abs(fromDisplayUnit(toDisplayUnit(px, cfg), cfg) - px)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("converts px to mm at the config's dpi, not a fixed 96", () => {
    expect(pxToMm(96, SCREEN_DPI)).toBeCloseTo(25.4, 6);
    expect(pxToMm(300, PRINT_DPI)).toBeCloseTo(25.4, 6);
  });
});

describe("geometry", () => {
  it("centres the page rect on the origin", () => {
    expect(artboardRect(square())).toEqual({
      x: -540,
      y: -540,
      width: 1080,
      height: 1080,
    });
  });

  it("insets the margin rect uniformly", () => {
    const cfg = { ...square(), margin: 40 };
    expect(marginRect(cfg)).toEqual({ x: -500, y: -500, width: 1000, height: 1000 });
  });

  it("has no margin rect when the margin is zero or negative", () => {
    expect(marginRect(square())).toBeNull();
    expect(marginRect({ ...square(), margin: -10 })).toBeNull();
  });
});

describe("margin clamping", () => {
  it("never lets a margin swallow the page", () => {
    const cfg = square();
    const clamped = clampMargin(100000, cfg);
    expect(clamped).toBeLessThan(cfg.height / 2);
    const rect = marginRect({ ...cfg, margin: 100000 })!;
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });

  it("clamps against the shorter side of a very wide page", () => {
    const cfg = configFromPreset(findArtboardPreset("x-header")!); // 1500 × 500
    expect(clampMargin(400, cfg)).toBeLessThan(250);
  });

  it("passes a reasonable margin through untouched, and floors junk at 0", () => {
    expect(clampMargin(48, square())).toBe(48);
    expect(clampMargin(-5, square())).toBe(0);
    expect(clampMargin(Number.NaN, square())).toBe(0);
  });

  it("re-clamps a carried-over margin when the page shrinks under it", () => {
    const wide = { ...square(), margin: 400 };
    const shrunk = withSize(wide, 200, 200);
    expect(shrunk.margin).toBeLessThan(100);
  });
});

describe("orientation", () => {
  it("swaps the two dimensions", () => {
    const landscape = withOrientation(a4(), "landscape");
    expect(landscape.width).toBe(3508);
    expect(landscape.height).toBe(2480);
    expect(landscape.orientation).toBe("landscape");
  });

  it("is a no-op when the orientation already matches", () => {
    const cfg = a4();
    expect(withOrientation(cfg, "portrait")).toBe(cfg);
  });

  it("returns to the original size when flipped back", () => {
    const cfg = a4();
    expect(withOrientation(withOrientation(cfg, "landscape"), "portrait")).toEqual(cfg);
  });
});

describe("resizing", () => {
  it("re-derives the preset id when a custom size lands on a known page", () => {
    const custom = withSize(DEFAULT_CUSTOM_ARTBOARD, 1080, 1080);
    expect(custom.presetId).toBe("ig-square");
  });

  it("drops to custom when the size is nothing recognised", () => {
    const custom = withSize(square(), 900, 400);
    expect(custom.presetId).toBeNull();
    expect(custom.orientation).toBe("landscape");
  });

  it("refuses degenerate sizes", () => {
    expect(withSize(square(), 0, -20).width).toBe(1);
    expect(withSize(square(), 0, -20).height).toBe(1);
  });
});

describe("dpi changes", () => {
  it("keeps the physical size and rescales the pixels", () => {
    const at96 = { ...a4(), dpi: SCREEN_DPI, width: 794, height: 1123, presetId: null };
    const at300 = withDpi(at96, PRINT_DPI);
    expect(Math.round(toDisplayUnit(at300.width, { unit: "mm", dpi: PRINT_DPI }))).toBe(210);
    expect(at300.dpi).toBe(PRINT_DPI);
  });

  it("is a no-op at the same dpi", () => {
    const cfg = a4();
    expect(withDpi(cfg, PRINT_DPI)).toBe(cfg);
  });
});

describe("export pixel ratio", () => {
  it("rasterises a page 1:1 whatever the scale slider says", () => {
    expect(exportPixelRatio(square(), 2)).toBe(1);
    expect(exportPixelRatio(square(), 4)).toBe(1);
    expect(exportPixelRatio(a4(), 0.5)).toBe(1);
  });

  it("honours the requested oversampling when there is no page", () => {
    expect(exportPixelRatio(null, 2)).toBe(2);
    expect(exportPixelRatio(null, 3.5)).toBe(3.5);
  });
});

describe("saved-payload validation", () => {
  const valid: ArtboardConfig = square();

  it("accepts a config it wrote itself", () => {
    expect(isArtboardConfig(valid)).toBe(true);
    expect(isArtboardConfig({ ...valid, presetId: null })).toBe(true);
  });

  it("rejects anything malformed, so an old or hand-edited save loads freeform", () => {
    expect(isArtboardConfig(null)).toBe(false);
    expect(isArtboardConfig(undefined)).toBe(false);
    expect(isArtboardConfig("a4")).toBe(false);
    expect(isArtboardConfig({ ...valid, width: 0 })).toBe(false);
    expect(isArtboardConfig({ ...valid, height: "tall" })).toBe(false);
    expect(isArtboardConfig({ ...valid, dpi: Number.NaN })).toBe(false);
    expect(isArtboardConfig({ ...valid, unit: "cm" })).toBe(false);
    expect(isArtboardConfig({ ...valid, orientation: "sideways" })).toBe(false);
    expect(isArtboardConfig({ ...valid, margin: undefined })).toBe(false);
  });
});
