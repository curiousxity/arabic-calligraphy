import { describe, expect, it } from "vitest";
import {
  getOrnament,
  listOrnaments,
  ornamentPathData,
  ornamentSvgDataUrl,
  ornamentSvgMarkup,
} from "./ornaments";
import { parseSvgPath, pathToPolygon, pointInPolygon } from "./svgPath";

/** The shapes the initial library promises; more may be added beside them. */
const EXPECTED_IDS = [
  "border-frame",
  "boteh",
  "crescent",
  "horseshoe-arch",
  "khatam-star-8",
  "medallion",
  "mihrab-arch",
  "ogee-cartouche",
  "scalloped-roundel",
  "star-12",
];

const polygonOf = (d: string) => pathToPolygon(parseSvgPath(d));

function bounds(poly: Array<[number, number]>) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe("the ornament registry", () => {
  it("auto-loads every module in src/data/ornaments", () => {
    const ids = listOrnaments().map((o) => o.id);
    for (const id of EXPECTED_IDS) expect(ids).toContain(id);
  });

  it("skips the shared geometry helpers, which export no ornament", () => {
    // _geometry.ts matches the glob too; a registry that took every module
    // at face value would surface it as a broken entry.
    expect(listOrnaments().every((o) => o.paths.length > 0)).toBe(true);
  });

  it("gives every ornament a unique id and a positive viewBox", () => {
    const ids = listOrnaments().map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const o of listOrnaments()) {
      expect(o.viewBox.w).toBeGreaterThan(0);
      expect(o.viewBox.h).toBeGreaterThan(0);
      expect(o.name.length).toBeGreaterThan(0);
      expect(o.nameAr.length).toBeGreaterThan(0);
    }
  });

  it("looks an ornament up by id, and reports a miss as undefined", () => {
    expect(getOrnament("medallion")?.name).toBe("Circular medallion");
    expect(getOrnament("no-such-ornament")).toBeUndefined();
  });
});

describe("ornament geometry", () => {
  // This is the same journey a Shape Fill block puts an uploaded silhouette
  // through, so an ornament that degenerates here would render as an empty
  // block rather than as an error.
  it.each(listOrnaments().map((o) => [o.id, o] as const))(
    "%s survives parseSvgPath -> pathToPolygon as a non-degenerate polygon",
    (_id, o) => {
      const poly = polygonOf(ornamentPathData(o));

      expect(poly.length).toBeGreaterThan(8);
      expect(poly.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(
        true
      );

      const b = bounds(poly);
      // Fills a real fraction of its own box in both axes: a shape that
      // collapsed to a line or a dot would still produce points.
      expect(b.maxX - b.minX).toBeGreaterThan(o.viewBox.w * 0.4);
      expect(b.maxY - b.minY).toBeGreaterThan(o.viewBox.h * 0.4);
    }
  );

  it.each(listOrnaments().map((o) => [o.id, o] as const))(
    "%s stays inside its declared viewBox",
    (_id, o) => {
      const b = bounds(polygonOf(ornamentPathData(o)));
      const slack = 1;
      expect(b.minX).toBeGreaterThanOrEqual(-slack);
      expect(b.minY).toBeGreaterThanOrEqual(-slack);
      expect(b.maxX).toBeLessThanOrEqual(o.viewBox.w + slack);
      expect(b.maxY).toBeLessThanOrEqual(o.viewBox.h + slack);
    }
  );

  it("fills the middle of a solid ornament", () => {
    const medallion = getOrnament("medallion")!;
    const poly = polygonOf(ornamentPathData(medallion));
    expect(pointInPolygon(120, 120, poly)).toBe(true);
  });

  it("leaves the middle of the border frame hollow", () => {
    // The hole is cut with a doubled-back bridge rather than a second
    // subpath specifically so ray-casting sees it — this is that check.
    const frame = getOrnament("border-frame")!;
    const poly = polygonOf(ornamentPathData(frame));
    expect(pointInPolygon(150, 110, poly)).toBe(false);
    expect(pointInPolygon(10, 110, poly)).toBe(true);
  });

  it("leaves the bitten-out side of the crescent hollow", () => {
    const crescent = getOrnament("crescent")!;
    const poly = polygonOf(ornamentPathData(crescent));
    // Inside circle 1 but also inside the circle removed from it.
    expect(pointInPolygon(170, 110, poly)).toBe(false);
    // The thick back of the crescent.
    expect(pointInPolygon(30, 110, poly)).toBe(true);
  });
});

describe("SVG serialization", () => {
  it("emits ASCII-only markup, since btoa cannot encode the Arabic names", () => {
    for (const o of listOrnaments()) {
      const markup = ornamentSvgMarkup(o, "#c9a227");
      // eslint-disable-next-line no-control-regex
      expect(markup).toMatch(/^[\x00-\x7F]*$/);
    }
  });

  it("round-trips a data URL back through atob to the original markup", () => {
    const o = getOrnament("khatam-star-8")!;
    const url = ornamentSvgDataUrl(o, "#1e3a5f");

    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const decoded = atob(url.slice("data:image/svg+xml;base64,".length));
    expect(decoded).toBe(ornamentSvgMarkup(o, "#1e3a5f"));
  });

  it("bakes the requested fill colour into every path", () => {
    const o = getOrnament("border-frame")!;
    const markup = ornamentSvgMarkup(o, "#ff0000");
    expect(markup.match(/fill="#ff0000"/g)).toHaveLength(o.paths.length);
    expect(markup).toContain(`viewBox="0 0 ${o.viewBox.w} ${o.viewBox.h}"`);
  });
});
