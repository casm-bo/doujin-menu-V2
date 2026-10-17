import type { DownloadQueueItem } from "../../../types/ipc.js";
import type { CompanionOperationResult } from "./companionServer.js";

type Result = CompanionOperationResult<DownloadQueueItem>;
export type DownloadReceipts = Record<string, DownloadQueueItem>;

/** Persist successful responses before acknowledging them to a mobile client. */
export function createDownloadRequestAdder(
  add: (galleryId: number) => Promise<Result>,
  getQueue: () => Promise<CompanionOperationResult<DownloadQueueItem[]>>,
  receipts: { read(): DownloadReceipts; write(value: DownloadReceipts): void },
) {
  // Serialize companion additions so concurrent retries cannot both enqueue.
  let tail: Promise<unknown> = Promise.resolve();
  return (galleryId: number, requestKey?: string): Promise<Result> => {
    const operation = tail.then(async (): Promise<Result> => {
      if (!requestKey) return add(galleryId);
      const saved = receipts.read()[requestKey];
      if (saved) {
        return saved.gallery_id === galleryId
          ? { success: true, data: saved }
          : {
              success: false,
              error: "requestId already belongs to another gallery",
            };
      }
      const queue = await getQueue();
      if (!queue.success || !queue.data) {
        return {
          success: false,
          error: queue.error || "Download queue unavailable",
        };
      }
      const existing = queue.data.find((item) => item.gallery_id === galleryId);
      const result = existing
        ? { success: true, data: existing }
        : await add(galleryId);
      if (result.success && result.data) {
        receipts.write({ ...receipts.read(), [requestKey]: result.data });
      }
      return result;
    });
    tail = operation.catch(() => undefined);
    return operation;
  };
}
