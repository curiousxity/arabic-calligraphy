/**
 * The messages between `kufiLayoutClient.ts` and `kufiPack.worker.ts`, and the
 * one function that answers them. Its own module so the worker bundle never
 * imports the client (which names the worker's URL).
 */
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

