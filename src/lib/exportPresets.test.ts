import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_PRESETS,
  EXPORT_PRESETS_KEY,
  loadPresets,
  savePresets,
  upsertPreset,
  removePreset,
  type ExportPreset,
} from "./exportPresets";

const preset = (id: string, overrides: Partial<ExportPreset> = {}): ExportPreset => ({
  id,
  name: `Preset ${id}`,
  scale: 2,
  transparent: false,
  formats: ["png"],
  ...overrides,
});

/**
 * Vitest runs these in the node environment (there is no vitest config, so no
 * jsdom), meaning `localStorage` genuinely doesn't exist here. A hand-rolled
 * stub is therefore both necessary and preferable — it keeps the tests
 * independent of any jsdom storage quirks and lets a throwing store be
 * simulated directly.
 */
class MemoryStorage {
  private data = new Map<string, string>();
  throwOnWrite = false;
  getItem(key: string) {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    if (this.throwOnWrite) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = storage;
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("upsertPreset", () => {
  it("appends a preset whose id is not present", () => {
    const list = [preset("a")];
    const next = upsertPreset(list, preset("b"));
    expect(next.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("replaces in place by id, keeping position", () => {
    const list = [preset("a"), preset("b"), preset("c")];
    const next = upsertPreset(list, preset("b", { name: "Renamed", scale: 4 }));
    expect(next.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(next[1]).toMatchObject({ name: "Renamed", scale: 4 });
  });

  it("does not mutate the input list", () => {
    const list = [preset("a")];
    upsertPreset(list, preset("a", { name: "Changed" }));
    expect(list[0].name).toBe("Preset a");
  });
});

describe("removePreset", () => {
  it("removes by id and leaves the others intact", () => {
    const list = [preset("a"), preset("b"), preset("c")];
    expect(removePreset(list, "b").map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("is a no-op for an unknown id", () => {
    const list = [preset("a")];
    expect(removePreset(list, "zzz")).toEqual(list);
  });
});

describe("loadPresets", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadPresets()).toEqual(DEFAULT_PRESETS);
  });

  it("returns the defaults when the stored value is not JSON", () => {
    storage.setItem(EXPORT_PRESETS_KEY, "{not json");
    expect(loadPresets()).toEqual(DEFAULT_PRESETS);
  });

  it("returns the defaults when the stored value is JSON of the wrong shape", () => {
    storage.setItem(EXPORT_PRESETS_KEY, JSON.stringify({ nope: true }));
    expect(loadPresets()).toEqual(DEFAULT_PRESETS);
  });

  it("returns the defaults when every stored entry is malformed", () => {
    storage.setItem(
      EXPORT_PRESETS_KEY,
      JSON.stringify([{ id: "x" }, { id: "y", name: "y", scale: "big" }])
    );
    expect(loadPresets()).toEqual(DEFAULT_PRESETS);
  });

  it("drops only the malformed entries when some are valid", () => {
    storage.setItem(EXPORT_PRESETS_KEY, JSON.stringify([preset("good"), { id: "bad" }]));
    expect(loadPresets().map((p) => p.id)).toEqual(["good"]);
  });

  it("rejects an entry carrying an unknown format", () => {
    storage.setItem(
      EXPORT_PRESETS_KEY,
      JSON.stringify([preset("a", { formats: ["png", "tiff"] as ExportPreset["formats"] })])
    );
    expect(loadPresets()).toEqual(DEFAULT_PRESETS);
  });

  it("returns the defaults when localStorage is unavailable", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadPresets()).toEqual(DEFAULT_PRESETS);
  });
});

describe("save → load round trip", () => {
  it("preserves every field of every preset", () => {
    const list: ExportPreset[] = [
      preset("a", { name: "Web @1x", scale: 1, transparent: true, formats: ["png", "svg"] }),
      preset("b", { name: "All formats", scale: 3.5, transparent: false, formats: ["png", "jpeg", "svg", "pdf"] }),
    ];
    savePresets(list);
    expect(loadPresets()).toEqual(list);
  });

  it("swallows a storage write failure rather than throwing", () => {
    storage.throwOnWrite = true;
    expect(() => savePresets([preset("a")])).not.toThrow();
    expect(loadPresets()).toEqual(DEFAULT_PRESETS);
  });
});
