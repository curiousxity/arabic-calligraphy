import { describe, it, expect } from "vitest";
import { loadSpineTable, getSpine, getSpineTableIfLoaded } from "./registry";

describe("stroke spine registry", () => {
  it("returns null for a font with no table, rather than throwing", async () => {
    expect(await loadSpineTable("Ruqaa")).toBeNull();
    expect(await loadSpineTable("NoSuchFont")).toBeNull();
  });

  it("loads a real generated table and caches it", async () => {
    const table = await loadSpineTable("TahaNaskhRegular");
    expect(table).not.toBeNull();
    expect(table!.font).toBe("TahaNaskhRegular");
    expect(table!.unitsPerEm).toBeGreaterThan(0);
    expect(table!.fontSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(getSpineTableIfLoaded("TahaNaskhRegular")).toBe(table);
  });

  it("finds a spine by glyph id, stroke id and zone index", async () => {
    const table = await loadSpineTable("TahaNaskhRegular");
    const [glyphId, entry] = Object.entries(table!.glyphs)[0];
    const first = entry.spines[0];

    const found = getSpine(table, Number(glyphId), first.strokeId, first.zoneIndex);
    expect(found).toEqual(first);
  });

  it("returns null for an unknown glyph, stroke or zone", async () => {
    const table = await loadSpineTable("TahaNaskhRegular");
    const [glyphId, entry] = Object.entries(table!.glyphs)[0];
    const first = entry.spines[0];

    expect(getSpine(table, 999999, first.strokeId, 0)).toBeNull();
    expect(getSpine(table, Number(glyphId), "NO_SUCH_STROKE", 0)).toBeNull();
    expect(getSpine(table, Number(glyphId), first.strokeId, 99)).toBeNull();
    expect(getSpine(null, 1, "x", 0)).toBeNull();
  });
});
