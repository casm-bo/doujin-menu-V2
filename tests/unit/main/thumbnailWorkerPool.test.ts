import { describe, expect, it, vi } from "vitest";

const { FakeWorker } = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;

  class FakeWorker {
    static instances: FakeWorker[] = [];

    private handlers = new Map<string, Handler[]>();
    postMessage = vi.fn();
    terminate = vi.fn(() => {
      this.emit("exit", 1);
      return Promise.resolve(0);
    });

    constructor() {
      FakeWorker.instances.push(this);
    }

    on(event: string, handler: Handler) {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    off(event: string, handler: Handler) {
      const handlers = this.handlers.get(event) ?? [];
      this.handlers.set(
        event,
        handlers.filter((candidate) => candidate !== handler),
      );
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      for (const handler of [...(this.handlers.get(event) ?? [])]) {
        handler(...args);
      }
    }

    hasListener(event: string) {
      return (this.handlers.get(event) ?? []).length > 0;
    }

    succeed(bookId: number, thumbnailPath: string) {
      this.emit("message", { status: "success", bookId, thumbnailPath });
    }

    crash() {
      this.emit("error", new Error("boom"));
    }
  }

  return { FakeWorker };
});

vi.mock("node:worker_threads", () => ({ Worker: FakeWorker }));
vi.mock("electron", () => ({
  app: { getPath: () => "/mock/userData" },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));
vi.mock("../../../src/main/main.js", () => ({
  console: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    time: vi.fn(),
  },
}));
vi.mock("../../../src/main/handlers/directoryHandler.js", () => ({
  extractCoverFromZip: vi.fn(),
}));
vi.mock("../../../src/main/db/index.js", () => ({
  default: () => ({
    where: () => ({
      first: () =>
        Promise.resolve({
          id: 1,
          path: "C:\\books\\single.jpg",
          is_offline: 0,
        }),
    }),
  }),
}));
vi.mock("fs/promises", () => ({
  default: {
    stat: () => Promise.resolve({ isDirectory: () => false }),
    readdir: () => Promise.resolve([]),
    mkdir: () => Promise.resolve(undefined),
  },
}));

const { generateThumbnailForBook } =
  await import("../../../src/main/handlers/thumbnailHandler.js");

async function takeBusyWorker(): Promise<InstanceType<typeof FakeWorker>> {
  let busy: InstanceType<typeof FakeWorker> | undefined;
  await vi.waitFor(() => {
    busy = FakeWorker.instances.find(
      (worker) => worker.postMessage.mock.calls.length > 0,
    );
    expect(busy).toBeDefined();
  });
  busy!.postMessage.mockClear();
  return busy!;
}

describe("thumbnail worker pool", () => {
  it("starts lazily", () => {
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("resolves a completed job", async () => {
    const promise = generateThumbnailForBook(1);
    const worker = await takeBusyWorker();
    worker.succeed(1, "/mock/userData/thumbnails/1.webp");
    await expect(promise).resolves.toMatchObject({ bookId: 1 });
  });

  it("rejects a crashed job and creates exactly one replacement", async () => {
    const promise = generateThumbnailForBook(1);
    const worker = await takeBusyWorker();
    const countBefore = FakeWorker.instances.length;
    worker.crash();
    await expect(promise).resolves.toBeNull();
    expect(FakeWorker.instances.length).toBe(countBefore + 1);
  });

  it("attaches lifecycle listeners to replacement workers", () => {
    const replacement = FakeWorker.instances.at(-1)!;
    expect(replacement.hasListener("error")).toBe(true);
    expect(replacement.hasListener("exit")).toBe(true);
  });

  it("continues processing after a crash", async () => {
    const promise = generateThumbnailForBook(1);
    const worker = await takeBusyWorker();
    worker.succeed(1, "/mock/userData/thumbnails/1.webp");
    await expect(promise).resolves.toMatchObject({ bookId: 1 });
  });
});
