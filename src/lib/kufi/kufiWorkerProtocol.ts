/**
 * The messages between `kufiLayoutClient.ts` and `kufiPack.worker.ts`, and the
 * one function that answers them. Its own module so the worker bundle never
 * imports the client (which names the worker's URL).
 */
import { kufiChangesOf, tryKufiChange, type KufiTry } from "./kufiExplore";
import { fitKufiPanel, packKufiPanel, type KufiPackResult, type KufiPanelEdits } from "./kufiPack";

export type KufiLayoutInputs = { text: string; cols: number; rows: number; edits?: KufiPanelEdits };

export type KufiWorkerRequest =
  | { id: number; kind: "pack"; input: KufiLayoutInputs & { previous?: KufiPackResult }; text?: undefined }
  | { id: number; kind: "fit"; text: string; edits?: KufiPanelEdits; input?: undefined };

export type KufiWorkerResponse =
  | { id: number; kind: "pack"; result: KufiPackResult }
  | { id: number; kind: "fit"; size: { cols: number; rows: number } };

export type KufiWorkerLike = {
  postMessage(msg: KufiWorkerRequest): void;
  onmessage: ((e: { data: KufiWorkerResponse }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror?: ((e: unknown) => void) | null;
  terminate?(): void;
};

/** Runs a request on the calling thread: the worker's own body, and the fallback when there is no `Worker`. */
export function runKufiRequest(req: KufiWorkerRequest): KufiWorkerResponse {
  if (req.kind === "fit") return { id: req.id, kind: "fit", size: fitKufiPanel(req.text, req.edits) };
  return { id: req.id, kind: "pack", result: packKufiPanel(req.input) };
}

type Ok = Extract<KufiPackResult, { ok: true }>;

/** Explore every single change to a packed panel (`kufiExplore.ts`), on a worker of its own. */
export type KufiExploreRequest = { id: number; inputs: KufiLayoutInputs; current: Ok };
export type KufiExploreResponse = { id: number; kind: "try"; try: KufiTry } | { id: number; kind: "done" };

/** Most changes one exploration tries. */
export const KUFI_EXPLORE_MAX_TRIES = 120;
/** Wall-clock budget of one exploration; checked between tries. */
export const KUFI_EXPLORE_BUDGET_MS = 12_000;

/** Runs the whole exploration, calling `send` after each try; stops at KUFI_EXPLORE_MAX_TRIES or KUFI_EXPLORE_BUDGET_MS. */
export function runKufiExplore(req: KufiExploreRequest, send: (r: KufiExploreResponse) => void): void {
  const start = performance.now();
  const changes = kufiChangesOf(req.inputs.text, req.current).slice(0, KUFI_EXPLORE_MAX_TRIES);
  for (const change of changes) {
    if (performance.now() - start > KUFI_EXPLORE_BUDGET_MS) break;
    send({ id: req.id, kind: "try", try: tryKufiChange(req.inputs, req.current, change) });
  }
  send({ id: req.id, kind: "done" });
}

