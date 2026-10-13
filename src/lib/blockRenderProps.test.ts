import { describe, it, expect } from "vitest";
import { shapedTextProps } from "./blockRenderProps";
import type { Block } from "../types";

describe("shapedTextProps", () => {
  it("carries letter and word spacing, defaulting to 0", () => {
    const b = {
      type: "text", text: "x", fontSize: 10, color: "#000", fontFamily: "Amiri",
      stroke: "#000", shadowColor: "#000", letterSpacing: 0.2, wordSpacing: -0.1,
    } as unknown as Extract<Block, { type: "text" }>;
    expect(shapedTextProps(b)).toMatchObject({ letterSpacing: 0.2, wordSpacing: -0.1 });
    const plain = { ...b, letterSpacing: undefined, wordSpacing: undefined };
    expect(shapedTextProps(plain)).toMatchObject({ letterSpacing: 0, wordSpacing: 0 });
  });
});
