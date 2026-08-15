import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TEXT_STYLES_KEY,
  captureStyle,
  styleToPatch,
  loadStyles,
  saveStyles,
  upsertStyle,
  removeStyle,
  type TextStyle,
} from "./textStyles";
import type { TextBlock } from "../types";

const block = (over: Partial<TextBlock> = {}): TextBlock => ({
  id: 1,
  type: "text",
  text: "بسم الله",
  x: 120,
  y: 340,
  fontSize: 64,
  color: "#c9a227",
  fontFamily: "NotoSans",
  stroke: "#1c2a4a",
  strokeWidth: 2,
  shadowColor: "#000000",
  shadowBlur: 6,
  ...over,
});

describe("captureStyle / styleToPatch", () => {
  it("captures the styling fields and nothing else", () => {
    const style = captureStyle(block(), "Gold on navy");
    expect(style.name).toBe("Gold on navy");
    expect(style.fontFamily).toBe("NotoSans");
    expect(style.fontSize).toBe(64);
    expect(style.color).toBe("#c9a227");
    expect(style.stroke).toBe("#1c2a4a");
    expect(style.strokeWidth).toBe(2);
    expect(style.shadowColor).toBe("#000000");
    expect(style.shadowBlur).toBe(6);
  });

  it("never carries content, position, identity or type", () => {
    const style = captureStyle(block(), "s") as Record<string, unknown>;
    for (const forbidden of ["text", "x", "y", "type"]) {
      expect(style[forbidden]).toBeUndefined();
    }
    // `id` exists but is the *style's* id, not the block's.
    expect(style.id).not.toBe(1);
    expect(typeof style.id).toBe("string");
  });

  it("round-trips: applying the patch reproduces every captured field", () => {
    const source = block();
    const style = captureStyle(source, "s");
    const patched = { ...block({ id: 2, text: "طيب", x: 0, y: 0, color: "#000" }), ...styleToPatch(style) };
    expect(patched.color).toBe(source.color);
    expect(patched.fontFamily).toBe(source.fontFamily);
    expect(patched.fontSize).toBe(source.fontSize);
    // …while the target keeps its own content and position.
    expect(patched.text).toBe("طيب");
    expect(patched.x).toBe(0);
    expect(patched.y).toBe(0);
    expect(patched.id).toBe(2);
  });

  it("omits fields the block never set, so applying leaves them alone", () => {
    const style = captureStyle(block({ shadowBlur: undefined, strokeWidth: undefined }), "s");
    expect(style.shadowBlur).toBeUndefined();
    expect(Object.keys(styleToPatch(style))).not.toContain("shadowBlur");
  });

  it("drops a stored field of the wrong type rather than patching it in", () => {
    const bad = { id: "x", name: "n", color: "#fff", fontSize: "huge" } as unknown as TextStyle;
    const patch = styleToPatch(bad) as Record<string, unknown>;
    expect(patch.color).toBe("#fff");
    expect(patch.fontSize).toBeUndefined();
  });
});

/**
 * Vitest runs in the node environment here (no jsdom), so `localStorage`
 * genuinely doesn't exist — the same hand-rolled stub `exportPresets.test.ts`
 * uses, for the same reason.
 */
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

describe("the style store", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  const style = (over: Partial<TextStyle> = {}): TextStyle => ({
    id: "a",
    name: "Gold",
    color: "#c9a227",
    ...over,
  });

  it("returns [] when nothing is stored", () => {
    expect(loadStyles()).toEqual([]);
  });

  it("falls back to [] on corrupt JSON", () => {
    localStorage.setItem(TEXT_STYLES_KEY, "{not json");
    expect(loadStyles()).toEqual([]);
  });

  it("filters out malformed entries but keeps the good ones", () => {
    localStorage.setItem(
      TEXT_STYLES_KEY,
      JSON.stringify([style(), { id: "", name: "" }, { id: "b", name: "empty" }, null])
    );
    expect(loadStyles().map((s) => s.id)).toEqual(["a"]);
  });

  it("round-trips through save/load", () => {
    saveStyles([style(), style({ id: "b", name: "Ink" })]);
    expect(loadStyles().map((s) => s.name)).toEqual(["Gold", "Ink"]);
  });

  it("upserts by id — same id overwrites in place, new id appends", () => {
    const list = [style(), style({ id: "b", name: "Ink" })];
    expect(upsertStyle(list, style({ name: "Gold leaf" })).map((s) => s.name)).toEqual([
      "Gold leaf",
      "Ink",
    ]);
    expect(upsertStyle(list, style({ id: "c", name: "Red" })).map((s) => s.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(list.map((s) => s.name)).toEqual(["Gold", "Ink"]); // pure
  });

  it("overwrite-by-name is expressible: reusing the existing id replaces the entry", () => {
    const list = [style()];
    const existing = list.find((s) => s.name === "Gold");
    const next = upsertStyle(list, { ...captureStyle(block(), "Gold"), id: existing!.id });
    expect(next).toHaveLength(1);
    expect(next[0].fontSize).toBe(64);
  });

  it("removes by id and leaves the rest in order", () => {
    const list = [style(), style({ id: "b", name: "Ink" }), style({ id: "c", name: "Red" })];
    expect(removeStyle(list, "b").map((s) => s.id)).toEqual(["a", "c"]);
    expect(removeStyle(list, "nope")).toHaveLength(3);
  });
});
