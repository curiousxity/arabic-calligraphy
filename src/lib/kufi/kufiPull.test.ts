import { describe, expect, it } from "vitest";
import { PULL_REST_MS, pullAnswer, pullMove, pullRelease, pullRest, pullStart } from "./kufiPull";

describe("a stretch pull", () => {
  it("asks for a count when the pointer crosses into a new one, clamped to the slice's range", () => {
    let p = pullStart(0, -2, 12);
    expect(pullMove(p, 0)).toEqual({ pull: p, request: null, clear: false });
    const m1 = pullMove(p, 1);
    expect(m1.request).toBe(1);
    expect(m1.pull.count).toBe(1);
    p = m1.pull;
    // the same cell again asks nothing
    expect(pullMove(p, 1).request).toBeNull();
    expect(pullMove(p, -5).request).toBe(-2);
    expect(pullMove(p, 40).request).toBe(12);
  });

  it("shows the last preview that packed and keeps it while a further count is refused", () => {
    let p = pullMove(pullStart(0, 0, 12), 1).pull;
    const a1 = pullAnswer(p, 1, true);
    expect(a1.show).toBe(true);
    p = a1.pull;
    p = pullMove(p, 2).pull;
    const a2 = pullAnswer(p, 2, false);
    expect(a2.show).toBe(false);
    p = a2.pull;
    expect(p.shown).toBe(1);
    expect(pullRelease(p)).toEqual({ kind: "commit", count: 1 });
  });

  it("ignores an answer for a count no longer asked for", () => {
    let p = pullMove(pullStart(0, 0, 12), 1).pull;
    p = pullMove(p, 2).pull;
    const stale = pullAnswer(p, 1, true);
    expect(stale.show).toBe(false);
    expect(stale.pull).toBe(p);
  });

  it("returning to the start clears the preview and releases as a cancel, with no notice", () => {
    let p = pullMove(pullStart(0, 0, 12), 1).pull;
    p = pullAnswer(p, 1, true).pull;
    const back = pullMove(p, 0);
    expect(back).toMatchObject({ request: null, clear: true });
    expect(back.pull.shown).toBeNull();
    expect(pullRelease(back.pull)).toEqual({ kind: "cancel" });
  });

  it("a pull nothing packed releases as refused", () => {
    let p = pullMove(pullStart(0, 0, 12), 2).pull;
    p = pullAnswer(p, 2, false).pull;
    expect(pullRelease(p)).toEqual({ kind: "refused" });
  });

  it("a refused count is asked for once more when the pointer rests, and only once", () => {
    expect(PULL_REST_MS).toBeGreaterThanOrEqual(200);
    let p = pullMove(pullStart(0, 0, 12), 2).pull;
    p = pullAnswer(p, 2, false).pull;
    const r1 = pullRest(p);
    expect(r1.request).toBe(2);
    p = pullAnswer(r1.pull, 2, false).pull;
    expect(pullRest(p).request).toBeNull();
    // a count that packed has nothing to retry
    let q = pullMove(pullStart(0, 0, 12), 1).pull;
    q = pullAnswer(q, 1, true).pull;
    expect(pullRest(q).request).toBeNull();
    // nor does the start count, or one still unanswered
    expect(pullRest(pullStart(0, 0, 12)).request).toBeNull();
    expect(pullRest(pullMove(pullStart(0, 0, 12), 3).pull).request).toBeNull();
  });

  it("moving on after a refusal forgets it: the new count gets its own retry", () => {
    let p = pullMove(pullStart(0, 0, 12), 2).pull;
    p = pullAnswer(p, 2, false).pull;
    p = pullMove(p, 3).pull;
    expect(pullRest(p).request).toBeNull();
    p = pullAnswer(p, 3, false).pull;
    expect(pullRest(p).request).toBe(3);
  });

  it("the base count itself is never a commit, even after a shown preview", () => {
    let p = pullMove(pullStart(3, 0, 12), 5).pull;
    p = pullAnswer(p, 5, true).pull;
    p = pullMove(p, 0).pull;
    expect(pullRelease(p)).toEqual({ kind: "cancel" });
  });
});
