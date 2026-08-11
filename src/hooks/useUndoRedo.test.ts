// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUndoRedo } from "./useUndoRedo";

/**
 * Regression coverage for the coalescing-window bug found in code review:
 * pushHistory()'s 300ms coalesce timer wasn't reset by handleUndo/
 * handleRedo/jumpBy, so a push shortly after any of those silently
 * overwrote whatever unrelated entry now sat on top of `past` instead of
 * recording a new entry.
 *
 * Matches real call order used throughout App.tsx: pushHistory() is called
 * BEFORE the state mutation it's recording the pre-change snapshot for.
 *
 * Uses fake timers throughout: with real timers, two pushHistory() calls
 * made back-to-back in the same synchronous test body could themselves
 * land inside the 300ms coalesce window depending on machine speed. Fake
 * time lets each "distinct edit" push advance well past the window
 * (400ms) while the specific under-test scenario (a push shortly after
 * undo/redo/jumpBy) advances only 50ms, deliberately inside it.
 */
const OUTSIDE_WINDOW_MS = 400;
const INSIDE_WINDOW_MS = 50;

function setup() {
  let state = 0;
  const getSnapshot = () => state;
  const applySnapshot = (s: number) => {
    state = s;
  };
  const captureThumbnail = () => "thumb";

  const { result } = renderHook(() =>
    useUndoRedo(getSnapshot, applySnapshot, captureThumbnail)
  );

  return {
    result,
    setState: (s: number) => {
      state = s;
    },
    getState: () => state,
  };
}

describe("useUndoRedo coalescing", () => {
  it("does not coalesce a push that follows an undo into an unrelated entry", () => {
    vi.useFakeTimers();
    try {
      const { result, setState, getState } = setup();

      // Two distinct, non-adjacent edits: 0 -> 1 -> 2.
      act(() => result.current.pushHistory()); // past: [0]
      setState(1);
      vi.advanceTimersByTime(OUTSIDE_WINDOW_MS);
      act(() => result.current.pushHistory()); // past: [0, 1]
      setState(2);

      // Undo back to state 1 (past: [0], future holds the state-2 entry).
      act(() => result.current.handleUndo());
      expect(getState()).toBe(1);

      // Immediately (well within the 300ms coalesce window) start an
      // unrelated edit: 1 -> 3.
      vi.advanceTimersByTime(INSIDE_WINDOW_MS);
      act(() => result.current.pushHistory());
      setState(3);

      // The push after undo must NOT have coalesced into (overwritten)
      // the unrelated `0` entry still sitting on top of `past`.
      act(() => result.current.handleUndo());
      expect(getState()).toBe(1);
      act(() => result.current.handleUndo());
      expect(getState()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not coalesce a push that follows a redo into an unrelated entry", () => {
    vi.useFakeTimers();
    try {
      const { result, setState, getState } = setup();

      act(() => result.current.pushHistory()); // past: [0]
      setState(1);
      vi.advanceTimersByTime(OUTSIDE_WINDOW_MS);
      act(() => result.current.pushHistory()); // past: [0, 1]
      setState(2);

      act(() => result.current.handleUndo()); // back to 1, future: [2]
      expect(getState()).toBe(1);
      act(() => result.current.handleRedo()); // forward to 2, past: [0, 1]
      expect(getState()).toBe(2);

      vi.advanceTimersByTime(INSIDE_WINDOW_MS);
      act(() => result.current.pushHistory()); // should push, not coalesce into `1`
      setState(3);

      act(() => result.current.handleUndo());
      expect(getState()).toBe(2);
      act(() => result.current.handleUndo());
      expect(getState()).toBe(1);
      act(() => result.current.handleUndo());
      expect(getState()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not coalesce a push that follows a jumpBy into an unrelated entry", () => {
    vi.useFakeTimers();
    try {
      const { result, setState, getState } = setup();

      act(() => result.current.pushHistory()); // past: [0]
      setState(1);
      vi.advanceTimersByTime(OUTSIDE_WINDOW_MS);
      act(() => result.current.pushHistory()); // past: [0, 1]
      setState(2);
      vi.advanceTimersByTime(OUTSIDE_WINDOW_MS);
      act(() => result.current.pushHistory()); // past: [0, 1, 2]
      setState(3);

      // Jump back two steps in one move: 3 -> 1.
      act(() => result.current.jumpBy(-2));
      expect(getState()).toBe(1);

      vi.advanceTimersByTime(INSIDE_WINDOW_MS);
      act(() => result.current.pushHistory());
      setState(4);

      act(() => result.current.handleUndo());
      expect(getState()).toBe(1);
      act(() => result.current.handleUndo());
      expect(getState()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still coalesces rapid-fire pushes with no undo/redo/jump in between", () => {
    vi.useFakeTimers();
    try {
      const { result, setState } = setup();

      act(() => result.current.pushHistory()); // past: [0]
      setState(1);

      // Rapid-fire second push (e.g. next keystroke) with no undo/redo/jump
      // in between still coalesces into the same entry, unchanged behavior:
      // one push slot consumed, not two.
      vi.advanceTimersByTime(INSIDE_WINDOW_MS);
      act(() => result.current.pushHistory());
      setState(2);
      expect(result.current.historyEntries.length).toBe(1);

      act(() => result.current.handleUndo());
      expect(result.current.canUndo).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
