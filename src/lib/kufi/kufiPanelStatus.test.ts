import { describe, expect, it } from "vitest";
import { kufiNoticeAt, kufiPanelStatus } from "./kufiPanelStatus";
import type { KufiPackResult } from "./kufiPack";

const size = { cols: 9, rows: 11 };
const ok = (editsBreakPacking: boolean): KufiPackResult => ({
  ok: true,
  cols: 9,
  rows: 11,
  cells: new Uint8Array(99),
  placements: [],
  editsBreakPacking,
});

describe("kufiPanelStatus", () => {
  it("is quiet while the first draft is pending", () => {
    expect(kufiPanelStatus(undefined, false, size)).toEqual({ text: "Arranging…", suggestions: [] });
  });

  it("says when the packer itself failed, even with an older result", () => {
    expect(kufiPanelStatus(undefined, true, size)?.text).toBe("Couldn't arrange this text");
    expect(kufiPanelStatus(ok(false), true, size)?.text).toBe("Couldn't arrange this text");
  });

  it("says nothing for a sound panel, and warns when painted cells break it", () => {
    expect(kufiPanelStatus(ok(false), false, size)).toBeNull();
    expect(kufiPanelStatus(ok(true), false, size)?.text).toBe("Painted cells leave a gap");
  });

  it("names the box and the sizes to try when the text is too long", () => {
    const r: KufiPackResult = { ok: false, reason: "tooLong", suggestions: [{ cols: 21, rows: 21 }, { cols: 23, rows: 23 }] };
    expect(kufiPanelStatus(r, false, size)).toEqual({ text: "Too long for 9×11 — try", suggestions: r.suggestions });
    expect(kufiPanelStatus({ ...r, suggestions: [] }, false, size)).toEqual({ text: "Too long for 9×11", suggestions: [] });
  });

  it("says too short, with sizes to try when there are any", () => {
    expect(kufiPanelStatus({ ok: false, reason: "tooShort", suggestions: [] }, false, size)?.text).toBe(
      "Too short to fill a box"
    );
    const r: KufiPackResult = { ok: false, reason: "tooShort", suggestions: [{ cols: 9, rows: 9 }] };
    expect(kufiPanelStatus(r, false, size)).toEqual({ text: "Too short to fill a box — try", suggestions: r.suggestions });
  });

  it("says a pinned edit cannot stay", () => {
    expect(kufiPanelStatus({ ok: false, reason: "pinConflict", suggestions: [] }, false, size)?.text).toBe(
      "A pinned edit can't stay where it is at this size"
    );
  });
});

describe("kufiNoticeAt", () => {
  const panel = { width: 120, height: 120 };
  const label = { width: 40, height: 14 };

  it("puts the label to the right of the letter's box, level with its top, when it fits", () => {
    expect(kufiNoticeAt({ x: 10, y: 30, width: 20, height: 30 }, panel, label, 4)).toEqual({ x: 34, y: 30 });
  });

  it("goes to the left when the right would leave the panel", () => {
    expect(kufiNoticeAt({ x: 80, y: 30, width: 20, height: 30 }, panel, label, 4)).toEqual({ x: 36, y: 30 });
  });

  it("takes the roomier side when neither fits, and keeps the label inside the panel's height", () => {
    const wide = { width: 100, height: 14 };
    expect(kufiNoticeAt({ x: 10, y: 112, width: 20, height: 8 }, panel, wide, 4)).toEqual({ x: 34, y: 106 });
    expect(kufiNoticeAt({ x: 90, y: -5, width: 20, height: 8 }, panel, wide, 4)).toEqual({ x: -14, y: 0 });
  });
});
