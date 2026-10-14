import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { FONT_OPTIONS, fontChoicesWith, groupByGenre, visibleFonts } from "./fontCatalog";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** `FONT_URLS` keys as written in useShapedGlyphs.ts (which cannot be imported: it pulls in harfbuzz). */
function registeredKeys(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "src/hooks/useShapedGlyphs.ts"), "utf8");
  const body = src.slice(src.indexOf("FONT_URLS"));
  return [...body.matchAll(/^\s*["']?([A-Za-z0-9_]+)["']?\s*:\s*["']\/fonts\//gm)].map((m) => m[1]);
}

describe("fontCatalog", () => {
  it("lists every font FONT_URLS can shape with", () => {
    const keys = registeredKeys();
    expect(keys.length).toBeGreaterThan(15);
    const missing = keys.filter((k) => !FONT_OPTIONS.some((f) => f.value === k));
    expect(missing, "missing from FONT_OPTIONS").toEqual([]);
  });

  it("keeps each genre's fonts together so the gallery heads each genre once", () => {
    const genres = groupByGenre(FONT_OPTIONS).map((g) => g.genre);
    expect(new Set(genres).size).toBe(genres.length);
  });

  it("hides retired fonts unless one is the current font", () => {
    const retired = FONT_OPTIONS.find((f) => f.retired)!;
    expect(visibleFonts(FONT_OPTIONS).some((f) => f.value === retired.value)).toBe(false);
    expect(visibleFonts(FONT_OPTIONS, retired.value).some((f) => f.value === retired.value)).toBe(true);
  });

  it("appends uploads under their own genre with the (uploaded) suffix", () => {
    const list = fontChoicesWith([{ key: "MyFont", label: "My Font" }]);
    const last = list[list.length - 1];
    expect(last).toEqual({ value: "MyFont", label: "My Font (uploaded)", cssFamily: "'MyFont'", genre: "Uploaded" });
    expect(list.length).toBe(FONT_OPTIONS.length + 1);
  });
});
