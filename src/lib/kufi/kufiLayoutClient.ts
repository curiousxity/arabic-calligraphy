/**
 * Runs the square-Kufi packer off the main thread and keeps what it found.
 *
 * A first draft takes ~0.7–1.7 s and a Fit up to ~9 s, so neither may run on
 * the UI thread. This module owns one Web Worker (`kufiPack.worker.ts`), a
 * cache of results keyed by the layout's inputs, and the "slots" that want a
 * layout (one per mounted renderer: a panel and each mirror of it).
 *
 * - **Keyed on inputs, never on a block.** The key is text, cols, rows and
 *   edits, so dragging a block (a new object, same inputs) costs nothing.
 * - **One job in flight.** The packer is synchronous inside the worker and
 *   cannot be interrupted, so while it runs only the *latest* wanted layout
 *   waits behind it: typing a word costs at most one stale draft, not one per
 *   keystroke.
 * - **Stale answers are dropped.** Every job carries a request id; a reply
 *   whose id is not the one in flight is ignored, and a reply for inputs a
 *   slot no longer wants is cached by its own inputs but never shown in that
 *   slot. While a slot waits it keeps showing its last result.
 * - **Export reads synchronously.** `cachedKufiLayout` and
 *   `ensureKufiLayouts` (which packs on the calling thread what the cache
 *   lacks) let the export paths draw the current inputs, never a stale draft.
 *
 * The worker is injectable (`_setKufiWorkerFactory`) so Vitest, which runs in
 * Node with no `Worker`, can drive the protocol by hand. Without a `Worker`
 * global the default factory runs the packer in-process on a timer.
 *
 * Pure apart from the worker: no React, no Konva, no `./harfbuzz`.
 */

import { packKufiPanel, type KufiPackResult, type KufiPanelEdits } from "./kufiPack";

import {
  runKufiRequest,
  type KufiLayoutInputs,
  type KufiWorkerLike,
  type KufiWorkerRequest,
  type KufiWorkerResponse,
} from "./kufiWorkerProtocol";

export type { KufiLayoutInputs, KufiWorkerLike, KufiWorkerRequest, KufiWorkerResponse };

/** No `Worker` (Node, very old browsers): answer on a timer so callers still see an async reply. */
function inProcessWorker(): KufiWorkerLike {
  const w: KufiWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(msg) {
      setTimeout(() => {
        try {
          w.onmessage?.({ data: runKufiRequest(msg) });
        } catch (err) {
          w.onerror?.(err);
        }
      }, 0);
    },
  };
  return w;
}

function defaultFactory(): KufiWorkerLike {
  if (typeof Worker === "undefined") return inProcessWorker();
  return new Worker(new URL("./kufiPack.worker.ts", import.meta.url), { type: "module" }) as unknown as KufiWorkerLike;
}

let factory: () => KufiWorkerLike = defaultFactory;
let worker: KufiWorkerLike | null = null;

/** Most results kept; an evicted one is simply packed again when wanted. */
const CACHE_LIMIT = 64;

const results = new Map<string, KufiPackResult>();
const inputsByKey = new Map<string, KufiLayoutInputs>();
/** What each slot currently wants, and when it asked (newest is packed first). */
const wanted = new Map<string, { key: string; seq: number }>();
/** The last result each slot was shown, with the inputs it was packed for. */
const latest = new Map<string, { result: KufiPackResult; inputs: KufiLayoutInputs }>();
const fits: Array<{ req: KufiWorkerRequest; resolve: (s: { cols: number; rows: number }) => void }> = [];
const fitWaiters = new Map<number, (s: { cols: number; rows: number }) => void>();
let inFlight: { id: number; key?: string } | null = null;
let nextId = 1;
let nextSeq = 1;
const listeners = new Set<() => void>();

const hasEdits = (e: KufiPanelEdits | undefined) => !!e && Object.values(e).some((v) => v !== undefined);

/** The cache key: the layout's inputs and nothing else. */
export function kufiLayoutKey(i: KufiLayoutInputs): string {
  return JSON.stringify([i.text, i.cols, i.rows, hasEdits(i.edits) ? i.edits : null]);
}

function notify() {
  for (const l of listeners) l();
}

function remember(key: string, r: KufiPackResult) {
  results.delete(key);
  results.set(key, r);
  while (results.size > CACHE_LIMIT) {
    const oldest = results.keys().next().value as string;
    results.delete(oldest);
    if (![...wanted.values()].some((w) => w.key === oldest)) inputsByKey.delete(oldest);
  }
}

function getWorker(): KufiWorkerLike {
  if (worker) return worker;
  const w = factory();
  w.onmessage = (e) => onReply(e.data);
  w.onerror = (err) => onWorkerError(err);
  worker = w;
  return w;
}

/**
 * The previous ok result of a slot moving to `key` with the same text and
 * box: the packer then repacks only the edited lines (~150 ms) instead of
 * starting over.
 */
function previousFor(key: string, input: KufiLayoutInputs): KufiPackResult | undefined {
  for (const [slot, w] of wanted) {
    if (w.key !== key) continue;
    const prev = latest.get(slot);
    if (prev?.result.ok && prev.inputs.text === input.text && prev.inputs.cols === input.cols && prev.inputs.rows === input.rows)
      return prev.result;
  }
  return undefined;
}

function pump() {
  if (inFlight) return;
  const fit = fits.shift();
  if (fit) {
    inFlight = { id: fit.req.id };
    fitWaiters.set(fit.req.id, fit.resolve);
    getWorker().postMessage(fit.req);
    return;
  }
  // Only what some slot wants *now* is packed, newest first: inputs a slot
  // has moved on from are never sent at all.
  let pick: { key: string; seq: number } | null = null;
  for (const w of wanted.values()) if (!results.has(w.key) && (!pick || w.seq > pick.seq)) pick = w;
  if (!pick) return;
  const input = inputsByKey.get(pick.key)!;
  const id = nextId++;
  inFlight = { id, key: pick.key };
  const previous = previousFor(pick.key, input);
  getWorker().postMessage({ id, kind: "pack", input: previous ? { ...input, previous } : { ...input } });
}

function deliver(key: string, r: KufiPackResult) {
  remember(key, r);
  const inputs = inputsByKey.get(key);
  if (inputs) for (const [slot, w] of wanted) if (w.key === key) latest.set(slot, { result: r, inputs });
  notify();
}

function onReply(data: KufiWorkerResponse) {
  if (!inFlight || data.id !== inFlight.id) return;
  const job = inFlight;
  inFlight = null;
  if (data.kind === "fit") {
    fitWaiters.get(data.id)?.(data.size);
    fitWaiters.delete(data.id);
  } else if (job.key) deliver(job.key, data.result);
  pump();
}

/** A worker that fails is replaced; the job it held is answered on this thread so nothing waits forever. */
function onWorkerError(err: unknown) {
  console.error("kufi worker failed", err);
  worker?.terminate?.();
  worker = null;
  const job = inFlight;
  inFlight = null;
  if (job?.key) {
    const input = inputsByKey.get(job.key);
    if (input) deliver(job.key, packKufiPanel(input));
  } else if (job) {
    const fit = fitWaiters.get(job.id);
    fitWaiters.delete(job.id);
    fit?.({ cols: 0, rows: 0 });
  }
  pump();
}

/** Subscribes to every result arriving (the shape `useSyncExternalStore` wants). */
export function subscribeKufiLayouts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What a slot should draw for these inputs now: their result, else the slot's last one, else null. */
export function kufiLayoutSnapshot(slot: string, inputs: KufiLayoutInputs): KufiPackResult | null {
  return results.get(kufiLayoutKey(inputs)) ?? latest.get(slot)?.result ?? null;
}

/** The cached result for these inputs, if any. */
export function cachedKufiLayout(inputs: KufiLayoutInputs): KufiPackResult | undefined {
  return results.get(kufiLayoutKey(inputs));
}

/** A slot now wants these inputs drawn: served from the cache, or queued for the worker. */
export function wantKufiLayout(slot: string, inputs: KufiLayoutInputs): void {
  const key = kufiLayoutKey(inputs);
  if (wanted.get(slot)?.key === key) return;
  wanted.set(slot, { key, seq: nextSeq++ });
  if (!inputsByKey.has(key)) inputsByKey.set(key, { ...inputs });
  const hit = results.get(key);
  if (hit) {
    latest.set(slot, { result: hit, inputs: inputsByKey.get(key)! });
    return;
  }
  pump();
}

/** A slot unmounted. */
export function releaseKufiLayout(slot: string): void {
  wanted.delete(slot);
  latest.delete(slot);
}

/**
 * Packs, on the calling thread, every layout the cache lacks — for export,
 * which is not interactive and must draw the current inputs. Returns whether
 * anything was added (the caller then lets the canvas redraw before reading it).
 */
export function ensureKufiLayouts(all: KufiLayoutInputs[]): boolean {
  let changed = false;
  for (const inputs of all) {
    const key = kufiLayoutKey(inputs);
    if (results.has(key)) continue;
    if (!inputsByKey.has(key)) inputsByKey.set(key, { ...inputs });
    deliver(key, packKufiPanel({ ...inputs }));
    changed = true;
  }
  return changed;
}

/** A square size that packs `text` (`fitKufiPanel`), computed in the worker. */
export function requestKufiFit(text: string, edits?: KufiPanelEdits): Promise<{ cols: number; rows: number }> {
  return new Promise((resolve) => {
    fits.push({ req: { id: nextId++, kind: "fit", text, edits }, resolve });
    pump();
  });
}

/** Tests only: swap the worker. */
export function _setKufiWorkerFactory(f: () => KufiWorkerLike): void {
  worker?.terminate?.();
  worker = null;
  factory = f;
}

/** Tests only: forget everything. */
export function _resetKufiLayouts(): void {
  results.clear();
  inputsByKey.clear();
  wanted.clear();
  latest.clear();
  fits.length = 0;
  fitWaiters.clear();
  inFlight = null;
  worker?.terminate?.();
  worker = null;
  factory = defaultFactory;
}
