import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KufiPackResult } from "./kufiPack";
import {
  _resetKufiLayouts,
  _setKufiWorkerFactory,
  cachedKufiLayout,
  ensureKufiLayouts,
  kufiLayoutSnapshot,
  releaseKufiLayout,
  requestKufiFit,
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
let notified = 0;
let unsubscribe: () => void;

beforeEach(() => {
  _resetKufiLayouts();
  worker = new FakeWorker();
  _setKufiWorkerFactory(() => worker);
  notified = 0;
  unsubscribe = subscribeKufiLayouts(() => notified++);
});

afterEach(() => {
  unsubscribe();
  _resetKufiLayouts();
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
});
