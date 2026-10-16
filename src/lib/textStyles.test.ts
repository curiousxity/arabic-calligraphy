import { describe, it, expect } from "vitest";
import { captureStyle, styleToPatch, type TextStyle } from "./textStyles";
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

describe("letter and word spacing in styles", () => {
  it("captures and re-applies both spacing fields", () => {
    const style = captureStyle(block({ letterSpacing: 0.3, wordSpacing: -0.2 }), "Tight");
    expect(style).toMatchObject({ letterSpacing: 0.3, wordSpacing: -0.2 });
    expect(styleToPatch(style)).toMatchObject({ letterSpacing: 0.3, wordSpacing: -0.2 });
  });
});
