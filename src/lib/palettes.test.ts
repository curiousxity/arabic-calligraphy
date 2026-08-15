import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_PALETTES,
  MAX_PALETTE_COLORS,
  PALETTES_KEY,
  allPalettes,
  loadPalettes,
  savePalettes,
  upsertPalette,
  removePalette,
  type Palette,
} from "./palettes";

/** The same node-environment localStorage stub `exportPresets.test.ts` uses. */
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

const palette = (id: string, over: Partial<Palette> = {}): Palette => ({
  id,
  name: `Palette ${id}`,
  colors: ["#111111", "#222222"],
  ...over,
});

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("shipped defaults", () => {
  it("are always present and always listed first", () => {
    const listed = allPalettes([palette("mine")]);
    expect(listed.slice(0, DEFAULT_PALETTES.length).map((p) => p.id)).toEqual(
      DEFAULT_PALETTES.map((p) => p.id)
    );
    expect(listed.at(-1)?.id).toBe("mine");
  });

  it("survive an empty, missing or corrupt store", () => {
    expect(allPalettes(loadPalettes())).toHaveLength(DEFAULT_PALETTES.length);
    localStorage.setItem(PALETTES_KEY, "{not json");
    expect(allPalettes(loadPalettes())).toHaveLength(DEFAULT_PALETTES.length);
  });

  it("are defined in code, never written to storage", () => {
    savePalettes(allPalettes([palette("mine")]));
    const stored: Palette[] = JSON.parse(localStorage.getItem(PALETTES_KEY) as string);
    expect(stored.map((p) => p.id)).toEqual(["mine"]);
  });

  it("cannot be shadowed by a stored palette reusing a default's id", () => {
    localStorage.setItem(
      PALETTES_KEY,
      JSON.stringify([palette(DEFAULT_PALETTES[0].id, { name: "Impostor" })])
    );
    expect(loadPalettes()).toEqual([]);
    expect(allPalettes(loadPalettes())[0].name).toBe(DEFAULT_PALETTES[0].name);
  });

  it("hold at most the maximum number of colours", () => {
    for (const p of DEFAULT_PALETTES) {
      expect(p.colors.length).toBeGreaterThan(0);
      expect(p.colors.length).toBeLessThanOrEqual(MAX_PALETTE_COLORS);
    }
  });
});

describe("the palette store", () => {
  it("round-trips through save/load", () => {
    savePalettes([palette("a"), palette("b")]);
    expect(loadPalettes().map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("filters out malformed entries", () => {
    localStorage.setItem(
      PALETTES_KEY,
      JSON.stringify([
        palette("a"),
        { id: "b", name: "no colors", colors: [] },
        { id: "c", name: "too many", colors: Array(MAX_PALETTE_COLORS + 1).fill("#fff") },
        null,
      ])
    );
    expect(loadPalettes().map((p) => p.id)).toEqual(["a"]);
  });
});

describe("upsertPalette / removePalette", () => {
  it("replaces by id in place and appends a new id", () => {
    const list = [palette("a"), palette("b")];
    expect(upsertPalette(list, palette("a", { name: "Renamed" }))[0].name).toBe("Renamed");
    expect(upsertPalette(list, palette("c")).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(list[0].name).toBe("Palette a"); // pure
  });

  it("trims a palette past the colour cap rather than rejecting it", () => {
    const long = palette("a", { colors: Array(MAX_PALETTE_COLORS + 5).fill("#abcdef") });
    expect(upsertPalette([], long)[0].colors).toHaveLength(MAX_PALETTE_COLORS);
  });

  it("removes by id", () => {
    expect(removePalette([palette("a"), palette("b")], "a").map((p) => p.id)).toEqual(["b"]);
  });
});
