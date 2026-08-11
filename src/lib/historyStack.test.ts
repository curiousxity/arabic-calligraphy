import { describe, it, expect } from "vitest";
import {
  emptyHistoryStack,
  pushEntry,
  moveBack,
  moveForward,
  canUndo,
  canRedo,
  pastTimeline,
  MAX_HISTORY,
  type HistoryStack,
  type HistoryEntry,
} from "./historyStack";

const entry = (label: string): HistoryEntry<string> => ({
  snapshot: label,
  thumbnail: `thumb:${label}`,
});

describe("historyStack", () => {
  it("starts empty with no undo/redo available", () => {
    const stack = emptyHistoryStack<string>();
    expect(canUndo(stack)).toBe(false);
    expect(canRedo(stack)).toBe(false);
    expect(pastTimeline(stack)).toEqual([]);
  });

  it("pushEntry appends to past and clears future", () => {
    let stack = emptyHistoryStack<string>();
    stack = pushEntry(stack, entry("A"));
    stack = pushEntry(stack, entry("B"));
    expect(stack.past.map((e) => e.snapshot)).toEqual(["A", "B"]);
    expect(canUndo(stack)).toBe(true);
    expect(canRedo(stack)).toBe(false);
  });

  it("pushEntry after some future exists discards that future", () => {
    let stack = emptyHistoryStack<string>();
    stack = pushEntry(stack, entry("A"));
    stack = pushEntry(stack, entry("B"));
    const back = moveBack(stack, entry("live-after-B"))!;
    stack = back.stack;
    expect(canRedo(stack)).toBe(true);
    stack = pushEntry(stack, entry("C"));
    expect(canRedo(stack)).toBe(false);
    expect(stack.past.map((e) => e.snapshot)).toEqual(["A", "C"]);
  });

  it("moveBack one step: restores the most recent past entry, stashes current into future", () => {
    let stack = emptyHistoryStack<string>();
    stack = pushEntry(stack, entry("A"));
    stack = pushEntry(stack, entry("B"));
    const result = moveBack(stack, entry("live"), 1)!;
    expect(result.restore.snapshot).toBe("B");
    expect(result.stack.past.map((e) => e.snapshot)).toEqual(["A"]);
    expect(result.stack.future.map((e) => e.snapshot)).toEqual(["live"]);
  });

  it("moveBack N steps lands on the N-th past entry and preserves replay order in future", () => {
    let stack = emptyHistoryStack<string>();
    for (const label of ["A", "B", "C", "D"]) stack = pushEntry(stack, entry(label));
    const result = moveBack(stack, entry("live"), 3)!;
    // 1 step back = D, 2 = C, 3 = B — landing on B.
    expect(result.restore.snapshot).toBe("B");
    expect(result.stack.past.map((e) => e.snapshot)).toEqual(["A"]);
    // Redoing forward from here, one step at a time, should replay C, then D, then live.
    let forward = result.stack;
    let step = moveForward(forward, entry("B"), 1)!;
    expect(step.restore.snapshot).toBe("C");
    forward = step.stack;
    step = moveForward(forward, entry("C"), 1)!;
    expect(step.restore.snapshot).toBe("D");
    forward = step.stack;
    step = moveForward(forward, entry("D"), 1)!;
    expect(step.restore.snapshot).toBe("live");
  });

  it("moveForward N steps is the mirror image of moveBack N steps", () => {
    let stack = emptyHistoryStack<string>();
    for (const label of ["A", "B", "C", "D"]) stack = pushEntry(stack, entry(label));
    const back = moveBack(stack, entry("live"), 4)!;
    expect(back.restore.snapshot).toBe("A");
    const forward = moveForward(back.stack, entry("A"), 4)!;
    expect(forward.restore.snapshot).toBe("live");
    expect(canRedo(forward.stack)).toBe(false);
    expect(forward.stack.past.map((e) => e.snapshot)).toEqual(["A", "B", "C", "D"]);
  });

  it("moveBack clamps to available past and returns null when there is none", () => {
    const stack = emptyHistoryStack<string>();
    expect(moveBack(stack, entry("live"), 1)).toBeNull();
  });

  it("moveBack requesting more steps than available clamps to what's there", () => {
    let stack = emptyHistoryStack<string>();
    stack = pushEntry(stack, entry("A"));
    stack = pushEntry(stack, entry("B"));
    const result = moveBack(stack, entry("live"), 10)!;
    expect(result.restore.snapshot).toBe("A");
    expect(result.stack.past).toEqual([]);
  });

  it("moveForward returns null when there is no future", () => {
    const stack = emptyHistoryStack<string>();
    expect(moveForward(stack, entry("live"), 1)).toBeNull();
  });

  it("pastTimeline lists past entries most-recent-first with negative step counts", () => {
    let stack = emptyHistoryStack<string>();
    stack = pushEntry(stack, entry("A"));
    stack = pushEntry(stack, entry("B"));
    stack = pushEntry(stack, entry("C"));
    expect(pastTimeline(stack)).toEqual([
      { thumbnail: "thumb:C", steps: -1 },
      { thumbnail: "thumb:B", steps: -2 },
      { thumbnail: "thumb:A", steps: -3 },
    ]);
  });

  it("caps past length at MAX_HISTORY, dropping the oldest entries", () => {
    let stack: HistoryStack<string> = emptyHistoryStack<string>();
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      stack = pushEntry(stack, entry(`E${i}`));
    }
    expect(stack.past.length).toBe(MAX_HISTORY);
    expect(stack.past[0].snapshot).toBe("E5");
    expect(stack.past[stack.past.length - 1].snapshot).toBe(`E${MAX_HISTORY + 4}`);
  });
});
