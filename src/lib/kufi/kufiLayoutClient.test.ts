import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KufiPackResult } from "./kufiPack";
import {
  KUFI_CACHE_LIMIT,
  KUFI_FIT_WATCHDOG_MS,
  KUFI_PACK_WATCHDOG_MS,
  _kufiLayoutInternals,
  _resetKufiLayouts,
  _setKufiWorkerFactory,
  cachedKufiLayout,
  ensureKufiLayouts,
  kufiLayoutFailed,
  kufiLayoutSnapshot,
  previewKufiLayout,
  releaseKufiLayout,
  requestKufiFit,
  seedKufiLayout,
  subscribeKufiLayouts,
  wantKufiLayout,
  type KufiLayoutInputs,
  type KufiWorkerLike,
  type KufiWorkerRequest,
  type KufiWorkerResponse,
} from "./kufiLayoutClient";

class FakeWorker implements KufiWorkerLike {
  posted: KufiWorkerRequest[] = [];
  onmessage: ((e: { data: KufiWorkerResponse }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  terminated = false;
  terminate() {
    this.terminated = true;
  }
  postMessage(msg: KufiWorkerRequest) {
    this.posted.push(msg);
  }
  reply(data: KufiWorkerResponse) {
    this.onmessage?.({ data });
  }
  last() {
    return this.posted[this.posted.length - 1];
  }
}

const fail = (n: number): KufiPackResult => ({ ok: false, reason: "tooLong", suggestions: [{ cols: n, rows: n }] });

const A: KufiLayoutInputs = { text: "الله", cols: 9, rows: 9 };
const B: KufiLayoutInputs = { text: "الله", cols: 10, rows: 10 };
const C: KufiLayoutInputs = { text: "الله", cols: 11, rows: 11 };

let worker: FakeWorker;
let workers: FakeWorker[];
let notified = 0;
let unsubscribe: () => void;

beforeEach(() => {
  _resetKufiLayouts();
  workers = [];
  _setKufiWorkerFactory(() => {
    worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  worker = new FakeWorker();
  notified = 0;
  unsubscribe = subscribeKufiLayouts(() => notified++);
});

afterEach(() => {
  unsubscribe();
  _resetKufiLayouts();
});

const okFor = (i: KufiLayoutInputs): KufiPackResult => ({
  ok: true, cols: i.cols, rows: i.rows, cells: new Uint8Array(i.cols * i.rows), placements: [], editsBreakPacking: false,
});

describe("kufi layout previews", () => {
  const prev = okFor(A);
  const E1: KufiLayoutInputs = { ...A, edits: { stretch: { 0: [1] } } };
  const E2: KufiLayoutInputs = { ...A, edits: { stretch: { 0: [2] } } };

  it("packs a preview from the given previous panel and caches an ok answer", async () => {
    const p = previewKufiLayout(E1, prev);
    const job = worker.last();
    expect(job).toMatchObject({ kind: "pack", input: { text: A.text, cols: 9, rows: 9, edits: E1.edits } });
    expect(job.input?.previous).toBe(prev);
    const r = okFor(E1);
    worker.reply({ id: job.id, kind: "pack", result: r });
    expect(await p).toBe(r);
    expect(cachedKufiLayout(E1)).toBe(r);
    // a slot asking for the same inputs later is served without a job
    const posted = worker.posted.length;
    wantKufiLayout("s1", E1);
    expect(kufiLayoutSnapshot("s1", E1)).toBe(r);
    expect(worker.posted.length).toBe(posted);
  });

  it("a cached answer resolves without a job", async () => {
    seedKufiLayout(E1, okFor(E1));
    const before = worker.posted.length;
    expect(await previewKufiLayout(E1, prev)).toBe(cachedKufiLayout(E1));
    expect(worker.posted.length).toBe(before);
  });

  it("does not cache a preview that did not pack: a fresh pack may still manage it", async () => {
    const p = previewKufiLayout(E1, prev);
    worker.reply({ id: worker.last().id, kind: "pack", result: fail(9) });
    expect((await p)?.ok).toBe(false);
    expect(cachedKufiLayout(E1)).toBeUndefined();
  });

  it("a newer preview supersedes one still waiting: the old one resolves null and is never posted", async () => {
    const first = previewKufiLayout(E1, prev);
    const job1 = worker.last();
    const second = previewKufiLayout(E2, prev);
    const third = previewKufiLayout({ ...A, edits: { stretch: { 0: [3] } } }, prev);
    expect(worker.posted.length).toBe(1);
    expect(await second).toBeNull();
    worker.reply({ id: job1.id, kind: "pack", result: okFor(E1) });
    expect((await first)?.ok).toBe(true);
    expect(worker.posted.length).toBe(2);
    expect(worker.last().input?.edits).toEqual({ stretch: { 0: [3] } });
    const r3 = okFor(A);
    worker.reply({ id: worker.last().id, kind: "pack", result: r3 });
    expect(await third).toBe(r3);
  });

  it("goes ahead of a slot's pending layout: a preview is interactive", () => {
    wantKufiLayout("s1", A);
    const draft = worker.last();
    wantKufiLayout("s2", B);
    void previewKufiLayout(E1, prev);
    expect(worker.posted.length).toBe(1);
    worker.reply({ id: draft.id, kind: "pack", result: okFor(A) });
    expect(worker.last().input?.edits).toEqual(E1.edits);
  });

  it("a worker that dies mid-preview is replaced and the preview is answered on this thread", async () => {
    const p = previewKufiLayout(E1, prev);
    worker.onerror?.(new Error("boom"));
    const r = await p;
    expect(r).not.toBeNull();
    expect(workers[0].terminated).toBe(true);
  });

  it("seeding serves the snapshot and the cache", () => {
    const r = okFor(E1);
    seedKufiLayout(E1, r);
    expect(cachedKufiLayout(E1)).toBe(r);
    wantKufiLayout("s1", E1);
    expect(kufiLayoutSnapshot("s1", E1)).toBe(r);
    expect(worker.posted.length).toBe(0);
  });
});

describe("kufi layout client", () => {
  it("is null until the worker answers, then serves the result from the cache", () => {
    wantKufiLayout("s1", A);
    expect(kufiLayoutSnapshot("s1", A)).toBeNull();
    const job = worker.last();
    expect(job).toMatchObject({ kind: "pack", input: { text: A.text, cols: 9, rows: 9 } });
    const r = fail(9);
    worker.reply({ id: job.id, kind: "pack", result: r });
    expect(notified).toBeGreaterThan(0);
    expect(kufiLayoutSnapshot("s1", A)).toBe(r);
    expect(cachedKufiLayout(A)).toBe(r);
  });

  it("keeps the slot's last result while a new one is pending", () => {
    wantKufiLayout("s1", A);
    const ra = fail(9);
    worker.reply({ id: worker.last().id, kind: "pack", result: ra });
    wantKufiLayout("s1", B);
    expect(kufiLayoutSnapshot("s1", B)).toBe(ra);
  });

  it("coalesces: only the latest wanted layout is posted after the one in flight", () => {
    wantKufiLayout("s1", A);
    const first = worker.last();
    wantKufiLayout("s1", B);
    wantKufiLayout("s1", C);
    expect(worker.posted).toHaveLength(1);
    worker.reply({ id: first.id, kind: "pack", result: fail(9) });
    expect(worker.posted).toHaveLength(2);
    expect(worker.last()).toMatchObject({ kind: "pack", input: { cols: 11 } });
  });

  it("drops a stale response: the slot moved on, so it keeps showing what it had", () => {
    wantKufiLayout("s1", A);
    const ra = fail(9);
    worker.reply({ id: worker.last().id, kind: "pack", result: ra });
    wantKufiLayout("s1", B);
    const jobB = worker.last();
    wantKufiLayout("s1", C);
    worker.reply({ id: jobB.id, kind: "pack", result: fail(10) });
    // B is cached by its own inputs, but the slot wants C now
    expect(kufiLayoutSnapshot("s1", C)).toBe(ra);
    // and a reply with an id nobody sent is ignored outright
    worker.reply({ id: 9999, kind: "pack", result: fail(1) });
    const jobC = worker.last();
    expect(jobC.input?.cols).toBe(11);
    const rc = fail(11);
    worker.reply({ id: jobC.id, kind: "pack", result: rc });
    expect(kufiLayoutSnapshot("s1", C)).toBe(rc);
  });

  it("two slots wanting the same layout share one job", () => {
    wantKufiLayout("s1", A);
    wantKufiLayout("s2", A);
    expect(worker.posted).toHaveLength(1);
    const r = fail(9);
    worker.reply({ id: worker.last().id, kind: "pack", result: r });
    expect(kufiLayoutSnapshot("s2", A)).toBe(r);
    releaseKufiLayout("s1");
    releaseKufiLayout("s2");
  });

  it("passes the slot's previous ok result when only the edits change", () => {
    wantKufiLayout("s1", A);
    const ok: KufiPackResult = { ok: true, cols: 9, rows: 9, cells: new Uint8Array(81), placements: [], editsBreakPacking: false };
    worker.reply({ id: worker.last().id, kind: "pack", result: ok });
    wantKufiLayout("s1", { ...A, edits: { routes: { 0: 1 } } });
    expect(worker.last().input?.previous).toBe(ok);
  });

  it("ensureKufiLayouts packs synchronously what the cache lacks, for export", () => {
    const changed = ensureKufiLayouts([A]);
    expect(changed).toBe(true);
    const r = cachedKufiLayout(A);
    expect(r?.ok).toBe(true);
    expect(ensureKufiLayouts([A])).toBe(false);
  });

  it("runs Fit in the worker", async () => {
    const p = requestKufiFit("الله");
    const job = worker.last();
    expect(job).toMatchObject({ kind: "fit", text: "الله" });
    worker.reply({ id: job.id, kind: "fit", size: { cols: 9, rows: 9 } });
    await expect(p).resolves.toEqual({ cols: 9, rows: 9 });
  });

  it("never evicts a layout a mounted slot still wants, so it is not packed again", () => {
    wantKufiLayout("kept", A);
    worker.reply({ id: worker.last().id, kind: "pack", result: fail(9) });
    for (let n = 0; n < KUFI_CACHE_LIMIT + 10; n++) {
      wantKufiLayout("busy", { text: "الله", cols: 20 + n, rows: 20 + n });
      worker.reply({ id: worker.last().id, kind: "pack", result: fail(20 + n) });
    }
    expect(cachedKufiLayout(A)).toBeDefined();
    // one post per layout: A was never sent back to the worker
    expect(worker.posted).toHaveLength(1 + KUFI_CACHE_LIMIT + 10);
  });

  it("a read refreshes recency: a result shown again outlives newer unwatched ones", () => {
    wantKufiLayout("s1", A);
    worker.reply({ id: worker.last().id, kind: "pack", result: fail(9) });
    releaseKufiLayout("s1");
    for (let n = 0; n < KUFI_CACHE_LIMIT - 1; n++) {
      wantKufiLayout("busy", { text: "الله", cols: 20 + n, rows: 20 + n });
      worker.reply({ id: worker.last().id, kind: "pack", result: fail(20 + n) });
      if (n === KUFI_CACHE_LIMIT - 3) kufiLayoutSnapshot("s2", A);
    }
    releaseKufiLayout("busy");
    wantKufiLayout("busy", { text: "الله", cols: 200, rows: 200 });
    worker.reply({ id: worker.last().id, kind: "pack", result: fail(200) });
    expect(cachedKufiLayout(A)).toBeDefined();
    expect(cachedKufiLayout({ text: "الله", cols: 20, rows: 20 })).toBeUndefined();
  });

  it("a worker error answers the pack on the main thread and carries on with the queue", () => {
    wantKufiLayout("s1", A);
    const first = worker;
    const fit = requestKufiFit("الله");
    first.onerror?.(new Error("boom"));
    expect(first.terminated).toBe(true);
    expect(cachedKufiLayout(A)?.ok).toBe(true);
    // the queued Fit went to a fresh worker
    expect(workers).toHaveLength(2);
    expect(worker.last()).toMatchObject({ kind: "fit" });
    worker.reply({ id: worker.last().id, kind: "fit", size: { cols: 9, rows: 9 } });
    return expect(fit).resolves.toEqual({ cols: 9, rows: 9 });
  });

  it("a layout the packer cannot do even on the main thread is marked failed, not retried", () => {
    const bad = { text: null as unknown as string, cols: 9, rows: 9 };
    wantKufiLayout("s1", bad);
    const fit = requestKufiFit("الله");
    expect(() => worker.onerror?.(new Error("boom"))).not.toThrow();
    expect(kufiLayoutFailed(bad)).toBe(true);
    expect(kufiLayoutSnapshot("s1", bad)).toBeNull();
    // the queue moved on to the Fit, and the failed key is never posted again
    expect(worker.last()).toMatchObject({ kind: "fit" });
    worker.reply({ id: worker.last().id, kind: "fit", size: { cols: 9, rows: 9 } });
    expect(worker.posted.filter((m) => m.kind === "pack")).toHaveLength(0);
    return fit;
  });

  it("a failed Fit rejects rather than resolving a fake size", async () => {
    const fit = requestKufiFit("الله");
    worker.onmessageerror?.(new Error("clone failed"));
    await expect(fit).rejects.toThrow(/Fit failed/);
  });

  it("a message error on a pack is handled like a worker error", () => {
    wantKufiLayout("s1", A);
    worker.onmessageerror?.(new Error("clone failed"));
    expect(cachedKufiLayout(A)?.ok).toBe(true);
  });

  it("forgets the inputs of layouts nobody wants any more and that were never packed", () => {
    wantKufiLayout("s1", A);
    wantKufiLayout("s1", B);
    wantKufiLayout("s1", C);
    // A is in flight; B was coalesced away
    expect(_kufiLayoutInternals().inputKeys).toBe(2);
    worker.reply({ id: worker.last().id, kind: "pack", result: fail(9) });
    releaseKufiLayout("s1");
    // C is in flight now; only A (which has a result) and C are known
    expect(_kufiLayoutInternals().inputKeys).toBe(2);
    worker.reply({ id: worker.last().id, kind: "pack", result: fail(11) });
    expect(_kufiLayoutInternals().inputKeys).toBe(2);
  });

  describe("a worker that cannot take a job", () => {
    /** A worker whose postMessage throws, as a worker that failed to start does. */
    const throwingFactory = () => {
      const w = new FakeWorker();
      w.postMessage = () => {
        throw new Error("cannot post");
      };
      workers.push(w);
      worker = w;
      return w;
    };

    it("rejects a Fit with Fit failed and keeps the queue moving", async () => {
      _setKufiWorkerFactory(throwingFactory);
      const fit = requestKufiFit("الله");
      await expect(fit).rejects.toThrow(/^Fit failed/);
      // nothing is stuck in flight: the next request reaches a working worker
      _setKufiWorkerFactory(() => {
        worker = new FakeWorker();
        workers.push(worker);
        return worker;
      });
      const next = requestKufiFit("الله");
      expect(worker.last()).toMatchObject({ kind: "fit" });
      worker.reply({ id: worker.last().id, kind: "fit", size: { cols: 9, rows: 9 } });
      await expect(next).resolves.toEqual({ cols: 9, rows: 9 });
    });

    it("packs on the main thread instead, and marks failed a layout that throws there too", () => {
      _setKufiWorkerFactory(throwingFactory);
      wantKufiLayout("s1", A);
      expect(cachedKufiLayout(A)?.ok).toBe(true);
      const bad = { text: null as unknown as string, cols: 9, rows: 9 };
      expect(() => wantKufiLayout("s2", bad)).not.toThrow();
      expect(kufiLayoutFailed(bad)).toBe(true);
      expect(workers.every((w) => w.terminated)).toBe(true);
    });
  });

  describe("a worker that goes silent", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("a pack with no answer is packed on the main thread after the watchdog", () => {
      wantKufiLayout("s1", A);
      const first = worker;
      vi.advanceTimersByTime(KUFI_PACK_WATCHDOG_MS - 1);
      expect(cachedKufiLayout(A)).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(first.terminated).toBe(true);
      expect(cachedKufiLayout(A)?.ok).toBe(true);
    });

    it("a Fit with no answer rejects with Fit failed after the watchdog, and the queue moves on", async () => {
      const fit = requestKufiFit("الله");
      const caught = fit.catch((e: Error) => e);
      wantKufiLayout("s1", B);
      const first = worker;
      vi.advanceTimersByTime(KUFI_FIT_WATCHDOG_MS);
      expect(first.terminated).toBe(true);
      expect(((await caught) as Error).message).toMatch(/^Fit failed/);
      // the queued pack went to a fresh worker
      expect(workers).toHaveLength(2);
      expect(worker.last()).toMatchObject({ kind: "pack" });
    });

    it("an answer in time clears the watchdog", () => {
      wantKufiLayout("s1", A);
      const first = worker;
      first.reply({ id: first.last().id, kind: "pack", result: fail(9) });
      vi.advanceTimersByTime(KUFI_FIT_WATCHDOG_MS * 2);
      expect(first.terminated).toBe(false);
      expect(cachedKufiLayout(A)).toEqual(fail(9));
    });

    it("gives a Fit longer than a pack", () => {
      expect(KUFI_FIT_WATCHDOG_MS).toBeGreaterThan(KUFI_PACK_WATCHDOG_MS);
    });
  });
});
