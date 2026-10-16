import { describe, it, expect } from "vitest";
import { markProps, shapedTextProps, textPathProps } from "./blockRenderProps";
import type { Block } from "../types";
import { resolveGuidePath } from "./guides";

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


describe("guide-attached Curve props", () => {
  it("carries the attachment so a mirror of attached text follows it", () => {
    const b = {
      id: 2, type: "textPath", text: "بسم", x: 0, y: 0, fontSize: 40, color: "#000",
      fontFamily: "Amiri", stroke: "#000", shadowColor: "#000", textPathD: "M 0 0 L 1 0",
      guide: { id: 1, offset: 0.3, align: "center", side: "inside", flip: true, gap: 0.2 },
    } as const;
    expect(textPathProps(b as never).guideAttachment).toEqual(b.guide);
  });

  it("resolves a guide's path and placement, or null when it is gone", () => {
    const guide = {
      id: 1, type: "guide", guideShape: "circle", guideD: "M 0 -10 C 5 -10, 10 -5, 10 0 Z",
      text: "", x: 5, y: 6, rotation: 30, fontSize: 1, color: "#000", fontFamily: "Amiri",
      stroke: "#000", shadowColor: "#000",
    };
    const t = { id: 2, type: "textPath", guide: { id: 1 } };
    expect(resolveGuidePath([guide as never], t as never)).toMatchObject({ d: guide.guideD, closed: true, x: 5, y: 6, rotation: 30 });
    expect(resolveGuidePath([], t as never)).toBeNull();
  });
});

describe("markProps", () => {
  it("carries the outline, flip and styling, defaulting a dropped outline to empty", () => {
    const b = {
      id: 3, type: "mark", markId: "dots-40", markD: "M0 0L1 0L1 1Z", markFlipX: true,
      text: "", x: 0, y: 0, fontSize: 40, color: "#123456", fontFamily: "Amiri",
      stroke: "#000", shadowColor: "#000", rotation: 15,
    } as unknown as Extract<Block, { type: "mark" }>;
    expect(markProps(b)).toMatchObject({ markD: "M0 0L1 0L1 1Z", markFlipX: true, color: "#123456", rotation: 15 });
    expect(markProps({ ...b, markD: undefined as never, markFlipX: undefined })).toMatchObject({ markD: "", markFlipX: false });
  });
});
