import { describe, it, expect } from "vitest";
import type { Block, GuideBlock, TextBlock, TextPathBlock } from "../types";
import {
  attachTextToGuide,
  attachedTo,
  deleteBlocksDetachingGuides,
  detachFromGuide,
  dropOrphanedAttachments,
  hasOrphanedAttachments,
  newAttachedText,
} from "./guides";
import { isMirrorSourceCandidate } from "./mirror";

const base = {
  text: "", x: 0, y: 0, fontSize: 40, color: "#000", fontFamily: "Amiri",
  stroke: "#000", shadowColor: "#000",
};
const guide: GuideBlock = { ...base, id: 1, type: "guide", guideShape: "circle", guideD: "M 0 -100 Z", x: 50, y: 60, rotation: 15 };
const onGuide = (id: number, over: Partial<TextPathBlock> = {}): TextPathBlock => ({
  ...base, id, type: "textPath", text: "بسم", textPathD: "M 0 0 L 1 0",
  guide: { id: 1, offset: 0.25, align: "center", side: "outside", flip: false, gap: 0.1 }, ...over,
});

describe("guides bookkeeping", () => {
  it("lists the texts on a guide", () => {
    const blocks: Block[] = [guide, onGuide(2), onGuide(3, { guide: undefined })];
    expect(attachedTo(blocks, 1).map((b) => b.id)).toEqual([2]);
  });

  it("detaches onto the guide's own shape and place", () => {
    const d = detachFromGuide(onGuide(2, { guide: { id: 1, offset: 0, align: "center", side: "outside", flip: true, gap: 0.1 } }), guide);
    expect(d.guide).toBeUndefined();
    expect(d.textPathD).toBe(guide.guideD);
    expect([d.x, d.y, d.rotation]).toEqual([50, 60, 15]);
    // The Curve renderer walks reversed when textPathReversed is false.
    expect(d.textPathReversed).toBe(false);
    // flip + outside hangs: positive offset.
    expect(d.textPathBaselineOffset).toBeGreaterThan(0);
  });

  it("detaches the survivors when a guide is deleted, and drops the deleted", () => {
    const blocks: Block[] = [guide, onGuide(2), onGuide(3)];
    const out = deleteBlocksDetachingGuides(blocks, new Set([1, 3]));
    expect(out.map((b) => b.id)).toEqual([2]);
    expect((out[0] as TextPathBlock).guide).toBeUndefined();
    expect((out[0] as TextPathBlock).textPathD).toBe(guide.guideD);
  });

  it("finds and drops orphaned attachments without losing the block", () => {
    const blocks: Block[] = [onGuide(2)];
    expect(hasOrphanedAttachments(blocks)).toBe(true);
    const out = dropOrphanedAttachments(blocks);
    expect(out).toHaveLength(1);
    expect((out[0] as TextPathBlock).guide).toBeUndefined();
    expect(hasOrphanedAttachments([guide, onGuide(2)])).toBe(false);
  });

  it("converts a text block, naming what it had to drop", () => {
    const t: TextBlock = {
      ...base, id: 9, type: "text", text: "الله", letterSpacing: 0.2,
      diacriticOverrides: [{ glyphIndex: 1 }],
      glyphAlternates: [{ letter: 0, char: "ا", feature: "salt", value: 1 }],
    };
    const { block, dropped } = attachTextToGuide(t, guide);
    expect(block.type).toBe("textPath");
    expect(block.id).toBe(9);
    expect(block.text).toBe("الله");
    expect(block.guide?.id).toBe(1);
    expect(block.textPathD).toBe(guide.guideD);
    expect(block.glyphAlternates).toEqual(t.glyphAlternates);
    expect("letterSpacing" in block).toBe(false);
    expect(dropped).toContain("diacritic moves");
    expect(dropped).toContain("letter and word spacing");
  });

  it("creates a new attached text at the guide", () => {
    const b = newAttachedText(7, guide, { fontFamily: "Amiri" });
    expect(b.guide?.id).toBe(1);
    expect(b.type).toBe("textPath");
    expect(b.fontSize).toBeGreaterThan(0);
  });

  it("never lets a guide be a mirror source", () => {
    expect(isMirrorSourceCandidate(guide)).toBe(false);
  });
});

import { exportableBlocks } from "./guides";

describe("exportableBlocks", () => {
  it("leaves guides out of the export crop", () => {
    expect(exportableBlocks([guide, onGuide(2)]).map((b) => b.id)).toEqual([2]);
  });
});

import { reorderDetachingGuides, syncAttachedToGuides } from "./guides";

describe("syncAttachedToGuides", () => {
  it("keeps an attached text's own geometry equal to its guide's", () => {
    const out = syncAttachedToGuides([guide, onGuide(2, { x: 1, y: 2, rotation: 0 })]);
    const t = out[1] as TextPathBlock;
    expect([t.x, t.y, t.rotation]).toEqual([50, 60, 15]);
    expect(t.textPathD).toBe(guide.guideD);
    expect(t.textPathReversed).toBe(true);
    expect(t.guide?.id).toBe(1);
  });

  it("returns the same array when everything is already in sync", () => {
    const once = syncAttachedToGuides([guide, onGuide(2)]);
    expect(syncAttachedToGuides(once)).toBe(once);
  });

  it("leaves orphans and plain blocks alone", () => {
    const plain = onGuide(3, { guide: undefined });
    const blocks: Block[] = [plain, onGuide(4)];
    expect(syncAttachedToGuides(blocks)).toBe(blocks);
  });
});

describe("reorderDetachingGuides", () => {
  it("detaches the texts of a guide the reorder removed (Layers delete)", () => {
    const prev: Block[] = [guide, onGuide(2), onGuide(3)];
    const next = prev.filter((b) => b.id !== 1);
    const out = reorderDetachingGuides(prev, next);
    expect(out.map((b) => b.id)).toEqual([2, 3]);
    for (const b of out as TextPathBlock[]) {
      expect(b.guide).toBeUndefined();
      expect([b.x, b.y]).toEqual([50, 60]);
    }
  });

  it("passes a pure reorder through untouched", () => {
    const prev: Block[] = [guide, onGuide(2)];
    const next = [prev[1], prev[0]];
    expect(reorderDetachingGuides(prev, next)).toBe(next);
  });
});
