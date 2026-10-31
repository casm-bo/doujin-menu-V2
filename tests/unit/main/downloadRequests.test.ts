import { describe, expect, it, vi } from "vitest";
import {
  createDownloadRequestAdder,
  type DownloadReceipts,
} from "../../../src/main/services/companion/downloadRequests";
import type { DownloadQueueItem } from "../../../src/types/ipc";

describe("mobile download receipts", () => {
  const item = {
    id: 7,
    gallery_id: 42,
    gallery_title: "Example",
    status: "pending",
  } as DownloadQueueItem;

  it("replays concurrent and post-restart retries after the queue has been cleared", async () => {
    let saved: DownloadReceipts = {};
    const receipts = {
      read: () => saved,
      write: (next: DownloadReceipts) => {
        saved = next;
      },
    };
    const add = vi.fn().mockResolvedValue({ success: true, data: item });
    const queue = vi.fn().mockResolvedValue({ success: true, data: [] });
    const send = createDownloadRequestAdder(add, queue, receipts);
    const responses = await Promise.all([
      send(42, "device:request"),
      send(42, "device:request"),
    ]);
    expect(responses[0]).toEqual(responses[1]);
    expect(add).toHaveBeenCalledTimes(1);
    const restarted = createDownloadRequestAdder(add, queue, receipts);
    expect(await restarted(42, "device:request")).toEqual({
      success: true,
      data: item,
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect((await restarted(99, "device:request")).success).toBe(false);
  });

  it("acknowledges existing queue entries and retries unsuccessful submissions", async () => {
    let saved: DownloadReceipts = {};
    const receipts = {
      read: () => saved,
      write: (next: DownloadReceipts) => {
        saved = next;
      },
    };
    const add = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: "offline" })
      .mockResolvedValue({ success: true, data: item });
    const queue = vi.fn().mockResolvedValue({ success: true, data: [] });
    const send = createDownloadRequestAdder(add, queue, receipts);
    expect((await send(42, "first")).success).toBe(false);
    expect(saved).toEqual({});
    expect((await send(42, "first")).success).toBe(true);
    queue.mockResolvedValue({ success: true, data: [item] });
    expect((await send(42, "second")).data).toEqual(item);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it("does not acknowledge when durable receipt storage fails", async () => {
    const add = vi.fn().mockResolvedValue({ success: true, data: item });
    const send = createDownloadRequestAdder(
      add,
      async () => ({ success: true, data: [] }),
      {
        read: () => ({}),
        write: () => {
          throw new Error("disk full");
        },
      },
    );
    await expect(send(42, "request")).rejects.toThrow("disk full");
  });
});
