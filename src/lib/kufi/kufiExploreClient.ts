/**
 * Runs the Kufi panel's exploration (`kufiExplore.ts`) in a Web Worker of its
 * own and keeps what it found, for `useSyncExternalStore`.
 *
 * - **One job at a time, never on the pack worker.** An exploration tries
 *   ~100 changes and can take ten seconds; sharing the packer's worker would
 *   stall every layout and drag preview behind it.
 * - **Cached by `kufiLayoutKey`** (at most `CACHE_LIMIT`, oldest dropped). A
 *   request for a key already running or done is a no-op.
 * - **A new key replaces the running one.** The worker is terminated (the
 *   next request makes a fresh one) and the partial state discarded; replies
 *   whose id is not the running job's are ignored.
 * - **Stable snapshots.** A state object is replaced only when a try or done
 *   arrives, so a snapshot read twice in between is the same object.
 *
 * The worker is injectable (`_setKufiExploreWorkerFactory`); without a
 * `Worker` global the default factory runs the exploration in-process on a
 * timer, as `kufiLayoutClient.ts` does.
 */
import type { KufiTry } from "./kufiExplore";
import { kufiLayoutKey } from "./kufiLayoutClient";
import type { KufiPackResult } from "./kufiPack";
import {
  runKufiExplore,
  type KufiExploreRequest,
  type KufiExploreResponse,
  type KufiLayoutInputs,
} from "./kufiWorkerProtocol";

type Ok = Extract<KufiPackResult, { ok: true }>;

/** `failed`: the worker died or went silent; `done` is then true too, with what had arrived. */
export type KufiExploreState = { key: string; tries: KufiTry[]; done: boolean; failed: boolean };

export type KufiExploreWorkerLike = {
  postMessage(m: KufiExploreRequest): void;
  onmessage: ((e: { data: KufiExploreResponse }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror?: ((e: unknown) => void) | null;
  terminate(): void;
};

const CACHE_LIMIT = 16;

/** Longest silence tolerated from a running job (since its last try or done) before the worker is taken for dead. */
export const KUFI_EXPLORE_WATCHDOG_MS = 20_000;

/** No `Worker` (Node, very old browsers): explore on a timer so callers still see async replies. */
function inProcessWorker(): KufiExploreWorkerLike {
  let dead = false;
  const w: KufiExploreWorkerLike = {
    onmessage: null,
    onerror: null,
    terminate() {
      dead = true;
    },
    postMessage(req) {
      setTimeout(() => {
        try {
          runKufiExplore(req, (r) => {
            if (!dead) w.onmessage?.({ data: r });
          });
        } catch (err) {
          if (!dead) w.onerror?.(err);
        }
      }, 0);
    },
  };
  return w;
}

function defaultFactory(): KufiExploreWorkerLike {
  if (typeof Worker === "undefined") return inProcessWorker();
  return new Worker(new URL("./kufiExplore.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as KufiExploreWorkerLike;
}

let factory: () => KufiExploreWorkerLike = defaultFactory;
let worker: KufiExploreWorkerLike | null = null;
/** Insertion order is age: the first key is the oldest. */
const states = new Map<string, KufiExploreState>();
let running: { id: number; key: string } | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function clearWatchdog() {
  if (watchdog !== null) clearTimeout(watchdog);
  watchdog = null;
}

function armWatchdog() {
  clearWatchdog();
  const id = running?.id;
  watchdog = setTimeout(() => {
    watchdog = null;
    if (running?.id === id) onWorkerError(new Error(`kufi explore worker silent for ${KUFI_EXPLORE_WATCHDOG_MS} ms`));
  }, KUFI_EXPLORE_WATCHDOG_MS);
}

function stopWorker() {
  clearWatchdog();
  worker?.terminate();
  worker = null;
  running = null;
}

function trim() {
  for (const k of [...states.keys()]) {
    if (states.size <= CACHE_LIMIT) break;
    if (k !== running?.key) states.delete(k);
  }
}

function setState(s: KufiExploreState) {
  states.delete(s.key);
  states.set(s.key, s);
  trim();
  notify();
}

function onReply(data: KufiExploreResponse) {
  if (!running || data.id !== running.id) return;
  const prev = states.get(running.key);
  if (!prev) return;
  if (data.kind === "try") {
    armWatchdog();
    setState({ ...prev, tries: [...prev.tries, data.try] });
  }
  else {
    stopWorker();
    setState({ ...prev, done: true });
  }
}

/** A worker that fails or goes silent ends the exploration with what it had: done and failed. */
function onWorkerError(err: unknown) {
  console.error("kufi explore worker failed", err);
  const key = running?.key;
  stopWorker();
  const prev = key === undefined ? undefined : states.get(key);
  if (prev) setState({ ...prev, done: true, failed: true });
}

/** Starts exploring the single changes to `current` (the packed result for exactly `inputs`), unless already running or done. A failed key is explored again. */
export function exploreKufiPanel(inputs: KufiLayoutInputs, current: Ok): void {
  const key = kufiLayoutKey(inputs);
  const known = states.get(key);
  if (known && !known.failed) return;
  states.delete(key);
  // The running job is unfinished: its partial state goes with it.
  if (running) states.delete(running.key);
  stopWorker();
  states.set(key, { key, tries: [], done: false, failed: false });
  const id = nextId++;
  running = { id, key };
  trim();
  try {
    const w = factory();
    w.onmessage = (e) => onReply(e.data);
    w.onerror = (err) => onWorkerError(err);
    w.onmessageerror = (err) => onWorkerError(err);
    worker = w;
    armWatchdog();
    w.postMessage({ id, inputs: { ...inputs }, current });
  } catch (err) {
    onWorkerError(err);
  }
}

/** What exploration has found for these inputs, or null if none was started. Same object until a try or done arrives. */
export function kufiExploreSnapshot(inputs: KufiLayoutInputs): KufiExploreState | null {
  return states.get(kufiLayoutKey(inputs)) ?? null;
}

/** Subscribes to every try or done arriving (the shape `useSyncExternalStore` wants). */
export function subscribeKufiExplore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only: swap the worker. */
export function _setKufiExploreWorkerFactory(f: () => KufiExploreWorkerLike): void {
  stopWorker();
  factory = f;
}

/** Tests only: forget everything. */
export function _resetKufiExplore(): void {
  stopWorker();
  states.clear();
  factory = defaultFactory;
}
