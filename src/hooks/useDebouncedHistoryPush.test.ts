// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDebouncedHistoryPush } from "./useDebouncedHistoryPush";

/**
 * Every caller in App.tsx updates state first and calls `schedule()` second,
 * and `pushHistory` snapshots whatever state its own render closed over. So
 * the push that records a gesture has to happen on the gesture's *first*
 * call — the one made from the render before the change landed. A trailing
 * push instead records the gesture's end state, which makes the first Ctrl+Z
 * after a pause a no-op: the stroke-cut undo e2e test only passed because it
 * pressed the key inside the 300ms window.
 */
describe("useDebouncedHistoryPush", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pushes once, immediately, on the first call of a burst", () => {
    const pushHistory = vi.fn();
    const { result } = renderHook(() => useDebouncedHistoryPush(pushHistory));

    result.current();
    expect(pushHistory).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(100);
      result.current();
    }
    vi.advanceTimersByTime(1000);
    expect(pushHistory).toHaveBeenCalledTimes(1);
  });

  it("records the state from before the gesture, not after it", () => {
    let state = 0;
    const recorded: number[] = [];
    const { result, rerender } = renderHook(
      ({ snapshot }) => useDebouncedHistoryPush(() => recorded.push(snapshot)),
      { initialProps: { snapshot: state } }
    );

    // A drag: each frame changes state, re-renders, then schedules.
    for (let frame = 0; frame < 4; frame++) {
      state += 1;
      result.current();
      rerender({ snapshot: state });
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(1000);

    expect(recorded).toEqual([0]);
  });

  it("starts a new entry once the burst has gone quiet", () => {
    const pushHistory = vi.fn();
    const { result } = renderHook(() => useDebouncedHistoryPush(pushHistory));

    result.current();
    vi.advanceTimersByTime(400);
    result.current();

    expect(pushHistory).toHaveBeenCalledTimes(2);
  });
});
