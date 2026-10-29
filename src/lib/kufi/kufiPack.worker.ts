/**
 * The square-Kufi packer's Web Worker: packs and fits off the main thread.
 * Its whole protocol is `runKufiRequest`; see `kufiWorkerProtocol.ts`.
 */
import { runKufiRequest, type KufiWorkerRequest } from "./kufiWorkerProtocol";

self.onmessage = (e: MessageEvent<KufiWorkerRequest>) => {
  self.postMessage(runKufiRequest(e.data));
};
