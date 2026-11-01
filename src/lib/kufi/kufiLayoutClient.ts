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
 * - **Previews are one deep.** A canvas gesture (`previewKufiLayout`) packs
 *   from an explicit `previous` ahead of any slot's layout; while one is in
 *   flight only the newest asked-for preview waits, and the ones it displaced
 *   resolve `null`. A preview that packs is cached by its inputs, so
 *   committing it costs no second pack; one that does not is not, since a
 *   fresh draft has ten times the budget of a repack and may still manage.
 *
 * - **Star panels share the worker.** `requestKufiStarLayout` and the rest
 *   of the `*KufiStar*` functions are the same slots, cache and failure
 *   handling for a whole star's layout (`layoutKufiStar`), keyed by
 *   `kufiStarKey`; stars and panels are packed newest wanted first, still
 *   one job at a time.
 *
 * The worker is injectable (`_setKufiWorkerFactory`) so Vitest, which runs in
 * Node with no `Worker`, can drive the protocol by hand. Without a `Worker`
 * global the default factory runs the packer in-process on a timer.
 *
 * Pure apart from the worker: no React, no Konva, no `./harfbuzz`.
 */

import { packKufiPanel, type KufiPackResult, type KufiPanelEdits } from "./kufiPack";

import { kufiStarKey, kufiStarTextCount, layoutKufiStar, type KufiStarInputs, type KufiStarLayout } from "./kufiStarLayout";
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

/**
 * Most results kept beyond those a mounted slot is drawing, which are never
 * evicted (evicting one would only send it straight back to the worker).
 */
export const KUFI_CACHE_LIMIT = 64;

const results = new Map<string, KufiPackResult>();
const inputsByKey = new Map<string, KufiLayoutInputs>();
/** What each slot currently wants, and when it asked (newest is packed first). */
const wanted = new Map<string, { key: string; seq: number }>();
/** The last result each slot was shown, with the inputs it was packed for. */
const latest = new Map<string, { result: KufiPackResult; inputs: KufiLayoutInputs }>();
/** Inputs the packer threw on, even on the main thread: never retried. */
const failed = new Set<string>();
type FitWaiter = { resolve: (s: { cols: number; rows: number }) => void; reject: (e: Error) => void };
const fits: Array<{ req: KufiWorkerRequest } & FitWaiter> = [];
const fitWaiters = new Map<number, FitWaiter>();
type PreviewJob = { input: KufiLayoutInputs & { previous: KufiPackResult } } & {
  resolve: (r: KufiPackResult | null) => void;
  reject: (e: Error) => void;
};
/** The newest preview not yet posted; an older one waiting here resolves null when replaced. */
let pendingPreview: PreviewJob | null = null;
const previewWaiters = new Map<number, PreviewJob>();
/** The same five for star layouts, keyed by `kufiStarKey`. */
const starResults = new Map<string, KufiStarLayout>();
const starInputsByKey = new Map<string, KufiStarInputs>();
const starWanted = new Map<string, { key: string; seq: number }>();
const starLatest = new Map<string, KufiStarLayout>();
const starFailed = new Set<string>();
let inFlight: { id: number; key?: string; preview?: boolean; star?: boolean } | null = null;
/** The in-flight job's watchdog timer. */
let watchdog: ReturnType<typeof setTimeout> | null = null;
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

const isWanted = (key: string) => [...wanted.values()].some((w) => w.key === key);

/** Marks a cached result as just used: eviction takes the least recently used first. */
function touch(key: string) {
  const r = results.get(key);
  if (!r) return;
  results.delete(key);
  results.set(key, r);
}

function remember(key: string, r: KufiPackResult) {
  results.delete(key);
  results.set(key, r);
  if (results.size <= KUFI_CACHE_LIMIT) return;
  const keep = new Set([...wanted.values()].map((w) => w.key));
  for (const k of [...results.keys()]) {
    if (results.size <= KUFI_CACHE_LIMIT) break;
    if (keep.has(k)) continue;
    results.delete(k);
    inputsByKey.delete(k);
  }
}

const isStarWanted = (key: string) => [...starWanted.values()].some((w) => w.key === key);

function touchStar(key: string) {
  const r = starResults.get(key);
  if (!r) return;
  starResults.delete(key);
  starResults.set(key, r);
}

function rememberStar(key: string, r: KufiStarLayout) {
  starResults.delete(key);
  starResults.set(key, r);
  if (starResults.size <= KUFI_CACHE_LIMIT) return;
  const keep = new Set([...starWanted.values()].map((w) => w.key));
  for (const k of [...starResults.keys()]) {
    if (starResults.size <= KUFI_CACHE_LIMIT) break;
    if (keep.has(k)) continue;
    starResults.delete(k);
    starInputsByKey.delete(k);
  }
}

function forgetStarIfUnused(key: string) {
  if (starResults.has(key) || (inFlight?.star && inFlight.key === key) || isStarWanted(key)) return;
  starInputsByKey.delete(key);
  starFailed.delete(key);
}

/** Drops the inputs of a key nobody wants that has no result and is not being packed. */
function forgetIfUnused(key: string) {
  if (results.has(key) || inFlight?.key === key || isWanted(key)) return;
  inputsByKey.delete(key);
  failed.delete(key);
}

/**
 * How long a job may stay in flight with no answer before the worker is
 * taken for dead (a worker can die without firing any error): it is then
 * terminated and the job handled as on a worker error. Generous: a first
 * draft is capped near 1.75 s and a Fit has measured up to ~9 s.
 */
export const KUFI_PACK_WATCHDOG_MS = 10_000;
export const KUFI_FIT_WATCHDOG_MS = 30_000;
/** A star layout packs its region texts one after another: KUFI_PACK_WATCHDOG_MS for each text it holds. */
export const kufiStarWatchdogMs = (i: KufiStarInputs) => KUFI_PACK_WATCHDOG_MS * Math.max(1, kufiStarTextCount(i));

function clearWatchdog() {
  if (watchdog !== null) clearTimeout(watchdog);
  watchdog = null;
}

/**
 * Sends the in-flight job. A worker that throws while starting or posting
 * (so it never got the job) is handled as a worker error: the job is still
 * answered, and the queue never stalls behind `inFlight`.
 */
function post(req: KufiWorkerRequest, ms: number) {
  try {
    getWorker().postMessage(req);
  } catch (err) {
    onWorkerError(err);
    return;
  }
  watchdog = setTimeout(() => {
    watchdog = null;
    if (inFlight?.id === req.id) onWorkerError(new Error(`kufi worker gave no answer in ${ms} ms`));
  }, ms);
}

function getWorker(): KufiWorkerLike {
  if (worker) return worker;
  const w = factory();
  w.onmessage = (e) => onReply(e.data);
  w.onerror = (err) => onWorkerError(err);
  // A reply that could not be deserialised: the job it answered is lost the same way.
  w.onmessageerror = (err) => onWorkerError(err);
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
    fitWaiters.set(fit.req.id, { resolve: fit.resolve, reject: fit.reject });
    post(fit.req, KUFI_FIT_WATCHDOG_MS);
    return;
  }
  const preview = pendingPreview;
  if (preview) {
    pendingPreview = null;
    const id = nextId++;
    inFlight = { id, key: kufiLayoutKey(preview.input), preview: true };
    previewWaiters.set(id, preview);
    post({ id, kind: "pack", input: preview.input }, KUFI_PACK_WATCHDOG_MS);
    return;
  }
  // Only what some slot wants *now* is packed, newest first: inputs a slot
  // has moved on from are never sent at all.
  let pick: { key: string; seq: number } | null = null;
  for (const w of wanted.values())
    if (!results.has(w.key) && !failed.has(w.key) && inputsByKey.has(w.key) && (!pick || w.seq > pick.seq)) pick = w;
  let starPick: { key: string; seq: number } | null = null;
  for (const w of starWanted.values())
    if (!starResults.has(w.key) && !starFailed.has(w.key) && starInputsByKey.has(w.key) && (!starPick || w.seq > starPick.seq))
      starPick = w;
  if (starPick && (!pick || starPick.seq > pick.seq)) {
    const star = starInputsByKey.get(starPick.key)!;
    const id = nextId++;
    inFlight = { id, key: starPick.key, star: true };
    post({ id, kind: "star", star: { ...star } }, kufiStarWatchdogMs(star));
    return;
  }
  if (!pick) return;
  const input = inputsByKey.get(pick.key)!;
  const id = nextId++;
  inFlight = { id, key: pick.key };
  const previous = previousFor(pick.key, input);
  post({ id, kind: "pack", input: previous ? { ...input, previous } : { ...input } }, KUFI_PACK_WATCHDOG_MS);
}

function deliver(key: string, r: KufiPackResult) {
  remember(key, r);
  const inputs = inputsByKey.get(key);
  if (inputs) for (const [slot, w] of wanted) if (w.key === key) latest.set(slot, { result: r, inputs });
  notify();
}

function deliverStar(key: string, r: KufiStarLayout) {
  rememberStar(key, r);
  for (const [slot, w] of starWanted) if (w.key === key) starLatest.set(slot, r);
  notify();
}

function onReply(data: KufiWorkerResponse) {
  if (!inFlight || data.id !== inFlight.id) return;
  const job = inFlight;
  inFlight = null;
  clearWatchdog();
  if (data.kind === "fit") {
    fitWaiters.get(data.id)?.resolve(data.size);
    fitWaiters.delete(data.id);
  } else if (data.kind === "star") {
    if (job.star && job.key) deliverStar(job.key, data.layout);
  } else if (job.preview) {
    const w = previewWaiters.get(data.id);
    previewWaiters.delete(data.id);
    if (job.key && data.result.ok) deliver(job.key, data.result);
    w?.resolve(data.result);
  } else if (job.key && !job.star) deliver(job.key, data.result);
  pump();
}

/**
 * Packs on the calling thread. A throw marks the inputs failed (so nothing
 * retries them in a loop) and leaves the slots on what they last showed.
 */
function packHere(key: string, input: KufiLayoutInputs): boolean {
  try {
    deliver(key, packKufiPanel({ ...input }));
    return true;
  } catch (err) {
    console.error("kufi packer failed", err);
    failed.add(key);
    notify();
    return false;
  }
}

/** `packHere` for a star layout. */
function layoutStarHere(key: string, input: KufiStarInputs): boolean {
  try {
    deliverStar(key, layoutKufiStar(input));
    return true;
  } catch (err) {
    console.error("kufi star layout failed", err);
    starFailed.add(key);
    notify();
    return false;
  }
}

/**
 * A worker that fails (an error event, a reply that cannot be read, a throw
 * while posting, or no answer before the watchdog) is replaced. A pack it held is answered on this thread
 * (or marked failed if the packer throws there too); a Fit it held rejects.
 * The queue always moves on.
 */
function onWorkerError(err: unknown) {
  console.error("kufi worker failed", err);
  clearWatchdog();
  worker?.terminate?.();
  worker = null;
  const job = inFlight;
  inFlight = null;
  try {
    if (job?.preview) {
      const w = previewWaiters.get(job.id);
      previewWaiters.delete(job.id);
      if (w) {
        try {
          const r = packKufiPanel({ ...w.input });
          if (job.key && r.ok) deliver(job.key, r);
          w.resolve(r);
        } catch (e) {
          w.reject(e instanceof Error ? e : new Error(String(e)));
        }
      }
    } else if (job?.star && job.key) {
      const input = starInputsByKey.get(job.key);
      if (input) layoutStarHere(job.key, input);
    } else if (job?.key) {
      const input = inputsByKey.get(job.key);
      if (input) packHere(job.key, input);
    } else if (job) {
      const fit = fitWaiters.get(job.id);
      fitWaiters.delete(job.id);
      fit?.reject(new Error("Fit failed: the packer's worker stopped"));
    }
  } finally {
    pump();
  }
}

/** Subscribes to every result arriving (the shape `useSyncExternalStore` wants). */
export function subscribeKufiLayouts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What a slot should draw for these inputs now: their result, else the slot's last one, else null. */
export function kufiLayoutSnapshot(slot: string, inputs: KufiLayoutInputs): KufiPackResult | null {
  const key = kufiLayoutKey(inputs);
  const hit = results.get(key);
  if (hit) {
    touch(key);
    return hit;
  }
  return latest.get(slot)?.result ?? null;
}

/** True when the packer threw on these inputs (in the worker and again on the main thread). */
export function kufiLayoutFailed(inputs: KufiLayoutInputs): boolean {
  return failed.has(kufiLayoutKey(inputs));
}

/** The cached result for these inputs, if any. */
export function cachedKufiLayout(inputs: KufiLayoutInputs): KufiPackResult | undefined {
  return results.get(kufiLayoutKey(inputs));
}

/** A slot now wants these inputs drawn: served from the cache, or queued for the worker. */
export function wantKufiLayout(slot: string, inputs: KufiLayoutInputs): void {
  const key = kufiLayoutKey(inputs);
  const before = wanted.get(slot)?.key;
  if (before === key) return;
  wanted.set(slot, { key, seq: nextSeq++ });
  if (before !== undefined) forgetIfUnused(before);
  if (!inputsByKey.has(key)) inputsByKey.set(key, { ...inputs });
  const hit = results.get(key);
  if (hit) {
    touch(key);
    latest.set(slot, { result: hit, inputs: inputsByKey.get(key)! });
    return;
  }
  pump();
}

/** A slot unmounted. */
export function releaseKufiLayout(slot: string): void {
  const key = wanted.get(slot)?.key;
  wanted.delete(slot);
  latest.delete(slot);
  if (key !== undefined) forgetIfUnused(key);
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
    if (results.has(key) || failed.has(key)) continue;
    if (!inputsByKey.has(key)) inputsByKey.set(key, { ...inputs });
    if (packHere(key, inputs)) changed = true;
  }
  return changed;
}

/**
 * A square size that packs `text` (`fitKufiPanel`), computed in the worker.
 * Rejects with an Error whose message starts "Fit failed" if the worker dies
 * while fitting; it never resolves a made-up size.
 */
export function requestKufiFit(text: string, edits?: KufiPanelEdits): Promise<{ cols: number; rows: number }> {
  return new Promise((resolve, reject) => {
    fits.push({ req: { id: nextId++, kind: "fit", text, edits }, resolve, reject });
    pump();
  });
}

/**
 * A live preview for a canvas gesture: `inputs` packed from `previous` (the
 * panel the gesture started on, so only the edited lines move), in the
 * worker, ahead of any slot's layout. Resolves with the packer's answer, or
 * with `null` when a newer preview was asked for before this one was sent.
 * A result already cached for these inputs resolves at once. Rejects only if
 * the packer throws on the main thread after the worker died.
 */
export function previewKufiLayout(inputs: KufiLayoutInputs, previous: KufiPackResult): Promise<KufiPackResult | null> {
  const hit = results.get(kufiLayoutKey(inputs));
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    pendingPreview?.resolve(null);
    pendingPreview = { input: { ...inputs, previous }, resolve, reject };
    pump();
  });
}

/**
 * Stores a result the caller knows satisfies `inputs`: a committed preview,
 * whose edits are the preview's plus a pin at the place that very result
 * gave the unit. The renderer then draws the commit from the cache, with no
 * second pack and no frame of the old panel in between.
 */
export function seedKufiLayout(inputs: KufiLayoutInputs, result: KufiPackResult): void {
  const key = kufiLayoutKey(inputs);
  if (!inputsByKey.has(key)) inputsByKey.set(key, { ...inputs });
  deliver(key, result);
}

/** What a star slot should draw for these inputs now: their layout, else the slot's last one, else null. */
export function kufiStarLayoutSnapshot(slot: string, inputs: KufiStarInputs): KufiStarLayout | null {
  const key = kufiStarKey(inputs);
  const hit = starResults.get(key);
  if (hit) {
    touchStar(key);
    return hit;
  }
  return starLatest.get(slot) ?? null;
}

/** True when the layout threw on these inputs (in the worker and again on the main thread). */
export function kufiStarLayoutFailed(inputs: KufiStarInputs): boolean {
  return starFailed.has(kufiStarKey(inputs));
}

/** The cached star layout for these inputs, if any. */
export function cachedKufiStarLayout(inputs: KufiStarInputs): KufiStarLayout | undefined {
  return starResults.get(kufiStarKey(inputs));
}

/** A star slot now wants these inputs drawn: served from the cache, or queued for the worker. */
export function requestKufiStarLayout(slot: string, inputs: KufiStarInputs): void {
  const key = kufiStarKey(inputs);
  const before = starWanted.get(slot)?.key;
  if (before === key) return;
  starWanted.set(slot, { key, seq: nextSeq++ });
  if (before !== undefined) forgetStarIfUnused(before);
  if (!starInputsByKey.has(key)) starInputsByKey.set(key, { ...inputs, regions: [...inputs.regions] });
  const hit = starResults.get(key);
  if (hit) {
    touchStar(key);
    starLatest.set(slot, hit);
    return;
  }
  pump();
}

/** A star slot unmounted. */
export function releaseKufiStarLayout(slot: string): void {
  const key = starWanted.get(slot)?.key;
  starWanted.delete(slot);
  starLatest.delete(slot);
  if (key !== undefined) forgetStarIfUnused(key);
}

/** `ensureKufiLayouts` for star panels: lays out, on the calling thread, every star the cache lacks. */
export function ensureKufiStarLayouts(all: KufiStarInputs[]): boolean {
  let changed = false;
  for (const inputs of all) {
    const key = kufiStarKey(inputs);
    if (starResults.has(key) || starFailed.has(key)) continue;
    if (!starInputsByKey.has(key)) starInputsByKey.set(key, { ...inputs, regions: [...inputs.regions] });
    if (layoutStarHere(key, inputs)) changed = true;
  }
  return changed;
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
  failed.clear();
  starResults.clear();
  starInputsByKey.clear();
  starWanted.clear();
  starLatest.clear();
  starFailed.clear();
  fits.length = 0;
  fitWaiters.clear();
  pendingPreview = null;
  previewWaiters.clear();
  inFlight = null;
  clearWatchdog();
  worker?.terminate?.();
  worker = null;
  factory = defaultFactory;
}

/** Tests only: sizes of the internal maps. */
export function _kufiLayoutInternals(): {
  results: number;
  inputKeys: number;
  failed: number;
  starResults: number;
  starInputKeys: number;
} {
  return {
    results: results.size,
    inputKeys: inputsByKey.size,
    failed: failed.size,
    starResults: starResults.size,
    starInputKeys: starInputsByKey.size,
  };
}
