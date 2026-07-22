import { describe, it, expect } from "vitest";
import { getStrokeSchema, getLigatureSchema } from "./registry";
import { deriveStretchCatalog } from "./deriveCatalog";
import type { GlyphDescription } from "./types";

describe("stroke schema registry + deriveStretchCatalog", () => {
  it("loads the seeded seen-medial schema (refined geometry: 3 teeth + a kashida-eligible connector) and derives its stretch catalog", () => {
    const schema = getStrokeSchema("0633", "medial");
    expect(schema).toBeDefined();

    // The 3 tooth strokes have no stretchZones (only a "tooth-rhythm"
    // protected-zone advisory) — only the connector stroke is stretchable.
    const catalog = deriveStretchCatalog(schema!);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      strokeId: "S_CONNECT_1",
      componentType: "BODY",
      kashidaEligible: true,
      minFactor: 0.9,
      maxFactor: 2.2,
      priority: 8,
    });
  });

  it("returns undefined for a letter/form with no authored schema", () => {
    expect(getStrokeSchema("0628", "ligature")).toBeUndefined();
  });

  it("loads the seeded isolated-form letters (teh, alif, beh) without key collisions", () => {
    const teh = getStrokeSchema("062A", "isolated");
    const alif = getStrokeSchema("0627", "isolated");
    const beh = getStrokeSchema("0628", "isolated");
    expect(teh?.glyph.id).toBe("TEH_ISOLATED");
    expect(alif?.glyph.id).toBe("ALIF_ISOLATED");
    expect(beh?.glyph.id).toBe("BEH_ISOLATED");

    // teh and beh share the same anatomy/factor range in this style, but are
    // distinct schema entries (different unicode) rather than one aliasing the other.
    const tehCatalog = deriveStretchCatalog(teh!);
    const behCatalog = deriveStretchCatalog(beh!);
    expect(tehCatalog.find((c) => c.componentType === "BODY")).toMatchObject({
      kashidaEligible: true,
      minFactor: 0.85,
      maxFactor: 1.8,
    });
    expect(behCatalog.find((c) => c.componentType === "BODY")).toMatchObject({
      kashidaEligible: true,
      minFactor: 0.85,
      maxFactor: 1.8,
    });

    // alif's stem stretches vertically and is NOT kashida-eligible (a taller
    // alif isn't a horizontal-justification technique).
    const alifCatalog = deriveStretchCatalog(alif!);
    expect(alifCatalog).toHaveLength(1);
    expect(alifCatalog[0]).toMatchObject({
      componentType: "BODY",
      kashidaEligible: false,
      minFactor: 0.85,
      maxFactor: 1.5,
    });
  });

  it("loads all four contextual forms for a dual-joining letter (beh), each with formMetadata", () => {
    for (const form of ["isolated", "initial", "medial", "final"] as const) {
      const schema = getStrokeSchema("0628", form);
      expect(schema, `beh ${form}`).toBeDefined();
      expect(schema!.glyph.joiningForm).toBe(form);
      expect(schema!.glyph.formMetadata).toBeDefined();
    }
  });

  it("only has isolated/final forms for a right-joining-only letter (alif)", () => {
    expect(getStrokeSchema("0627", "isolated")).toBeDefined();
    expect(getStrokeSchema("0627", "final")).toBeDefined();
    expect(getStrokeSchema("0627", "initial")).toBeUndefined();
    expect(getStrokeSchema("0627", "medial")).toBeUndefined();
  });

  it("emits one StretchDefinition per zone when a stroke has more than one, using each zone's own label when present", () => {
    const synthetic: GlyphDescription = {
      schemaVersion: "1.0.0",
      styleProfile: {
        script: "arabic",
        calligraphicModel: "naskh",
        measurementSystem: { dotUnit: { name: "nuqta", shape: "rhombic", width: 1, height: 1 }, angleDegrees: 45 },
        verticalLevels: [],
      },
      glyph: {
        id: "TEST_MULTI_ZONE",
        baseLetter: "x",
        joiningForm: "isolated",
        components: [
          {
            id: "BODY_1",
            type: "BODY",
            semanticLabel: { en: "body" },
            strokes: [
              {
                id: "S_BODY_1",
                function: "BODY",
                path: { kind: "bezier", nodes: [] },
                editBehavior: {
                  stretchZones: [
                    { fromNode: 0, toNode: 1, axis: "y", minFactor: 0.9, maxFactor: 1.3, label: { en: "Height" } },
                    { fromNode: 0, toNode: 2, axis: "x", minFactor: 0.8, maxFactor: 2.0 },
                  ],
                  protectedZones: [],
                  priority: 8,
                  kashidaEligible: true,
                },
              },
            ],
          },
        ],
      },
    };

    const catalog = deriveStretchCatalog(synthetic);
    expect(catalog).toHaveLength(2);

    expect(catalog[0]).toMatchObject({ strokeId: "S_BODY_1", zoneIndex: 0, label: { en: "Height" }, minFactor: 0.9, maxFactor: 1.3 });
    // No zone-level label authored for the second zone, and there's more than
    // one zone on this stroke, so it falls back to a disambiguated label
    // rather than reusing "body" verbatim (which would be indistinguishable
    // from the first zone's fallback had it also lacked a label).
    expect(catalog[1]).toMatchObject({ strokeId: "S_BODY_1", zoneIndex: 1, minFactor: 0.8, maxFactor: 2.0 });
    expect(catalog[1].label.en).toBe("body 2");
  });

  it("derives a labeled zone-per-axis catalog for the الله ligature, none kashida-eligible", () => {
    const schema = getLigatureSchema(["0627", "0644", "0644", "0647"]);
    expect(schema).toBeDefined();

    const catalog = deriveStretchCatalog(schema!);
    const labels = catalog.map((c) => c.label.en);
    expect(labels).toEqual([
      "Alif height",
      "First lam height",
      "Second lam height",
      "Second lam shoulder",
      "Heh loop",
      "Heh tail",
    ]);
    expect(catalog.every((c) => c.kashidaEligible === false)).toBe(true);
  });
});
