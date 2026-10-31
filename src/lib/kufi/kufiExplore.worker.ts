/**
 * The exploration's Web Worker, apart from the packer's so a long exploration
 * never delays a layout. Its whole protocol is `runKufiExplore`; see
 * `kufiWorkerProtocol.ts`.
 */
import { runKufiExplore, type KufiExploreRequest } from "./kufiWorkerProtocol";

self.onmessage = (e: MessageEvent<KufiExploreRequest>) => {
  runKufiExplore(e.data, (r) => self.postMessage(r));
};
