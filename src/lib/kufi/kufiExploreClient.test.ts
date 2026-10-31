import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { _internal, packKufiPanel, type KufiPackResult } from "./kufiPack";
import { kufiChangesOf, type KufiTry } from "./kufiExplore";
import {
  _resetKufiExplore,
  _setKufiExploreWorkerFactory,
  exploreKufiPanel,
  kufiExploreSnapshot,
  subscribeKufiExplore,
  type KufiExploreWorkerLike,
} from "./kufiExploreClient";
import {
  KUFI_EXPLORE_MAX_TRIES,
  runKufiExplore,
  type KufiExploreRequest,
  type KufiExploreResponse,
} from "./kufiWorkerProtocol";

type Ok = Extract<KufiPackResult, { ok: true }>;
const BAQARAH = "لا يكلف الله نفسا إلا وسعها";

class FakeWorker implements KufiExploreWorkerLike {
  posted: KufiExploreRequest[] = [];
  onmessage: ((e: { data: KufiExploreResponse }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  terminate() {
    this.terminated = true;
  }
  postMessage(m: KufiExploreRequest) {
    this.posted.push(m);
  }
  reply(data: KufiExploreResponse) {
    this.onmessage?.({ data });
  }
}

const okResult = (): Ok => ({ ok: true, cells: [], placements: [] }) as unknown as Ok;
const tryOf = (n: number): KufiTry => ({
  change: { kind: "form", unitIndex: n, glyphId: "x" },
  edits: {},
  result: null,
});

const A = { text: "الله", cols: 9, rows: 9 };
const B = { text: "الله", cols: 10, rows: 10 };

let workers: FakeWorker[];
let notified: number;
let unsubscribe: () => void;

beforeEach(() => {
  _resetKufiExplore();
  workers = [];
  _setKufiExploreWorkerFactory(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  notified = 0;
  unsubscribe = subscribeKufiExplore(() => notified++);
});
afterEach(() => {
  unsubscribe();
  _resetKufiExplore();
});

describe("exploreKufiPanel", () => {
  it("streams tries into the snapshot and marks done", () => {
    exploreKufiPanel(A, okResult());
    const w = workers[0];
    const id = w.posted[0].id;
    expect(kufiExploreSnapshot(A)?.tries).toEqual([]);
    w.reply({ id, kind: "try", try: tryOf(1) });
    const s1 = kufiExploreSnapshot(A)!;
    expect(s1.tries).toHaveLength(1);
    expect(s1.done).toBe(false);
    expect(kufiExploreSnapshot(A)).toBe(s1);
    w.reply({ id, kind: "try", try: tryOf(2) });
    w.reply({ id, kind: "done" });
    const s2 = kufiExploreSnapshot(A)!;
    expect(s2.tries).toHaveLength(2);
    expect(s2.done).toBe(true);
    expect(kufiExploreSnapshot(A)).toBe(s2);
    expect(notified).toBe(3);
  });

  it("one job per key", () => {
    exploreKufiPanel(A, okResult());
    exploreKufiPanel({ ...A }, okResult());
    expect(workers.flatMap((w) => w.posted)).toHaveLength(1);
    const w = workers[0];
    w.reply({ id: w.posted[0].id, kind: "done" });
    exploreKufiPanel(A, okResult());
    expect(workers.flatMap((w) => w.posted)).toHaveLength(1);
  });

  it("drops tries for inputs no longer wanted", () => {
    exploreKufiPanel(A, okResult());
    const wa = workers[0];
    const idA = wa.posted[0].id;
    exploreKufiPanel(B, okResult());
    expect(wa.terminated).toBe(true);
    const wb = workers[1];
    const idB = wb.posted[0].id;
    wb.reply({ id: idB, kind: "try", try: tryOf(1) });
    const before = kufiExploreSnapshot(B)!;
    wa.reply({ id: idA, kind: "try", try: tryOf(2) });
    expect(kufiExploreSnapshot(B)).toBe(before);
    expect(kufiExploreSnapshot(A)).toBeNull();
  });
});

describe("runKufiExplore", () => {
  beforeAll(() => _internal.setClockOverride(Infinity));
  afterAll(() => _internal.setClockOverride(null));

  it("sends every try, then done", () => {
    const inputs = { text: BAQARAH, cols: 21, rows: 21 };
    const current = packKufiPanel(inputs);
    if (!current.ok) throw new Error("did not pack");
    const sent: KufiExploreResponse[] = [];
    // The wall-clock budget is not under test (it depends on the machine's load).
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      runKufiExplore({ id: 7, inputs, current }, (r) => sent.push(r));
    } finally {
      now.mockRestore();
    }
    const n = Math.min(kufiChangesOf(BAQARAH, current).length, KUFI_EXPLORE_MAX_TRIES);
    expect(sent.filter((r) => r.kind === "try")).toHaveLength(n);
    expect(sent.filter((r) => r.kind === "done")).toHaveLength(1);
    expect(sent[sent.length - 1].kind).toBe("done");
    expect(sent.every((r) => r.id === 7)).toBe(true);
  }, 60000);
});
