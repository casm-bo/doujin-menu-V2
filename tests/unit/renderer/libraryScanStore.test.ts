import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryScanProgress } from "../../../src/types/ipc";

const ipcMock = vi.hoisted(() => ({
  handler: null as ((progress: LibraryScanProgress) => void) | null,
  stop: vi.fn(),
}));

vi.mock("@/api", () => ({
  ipcRenderer: {
    on: vi.fn(
      (_channel: string, handler: (progress: LibraryScanProgress) => void) => {
        ipcMock.handler = handler;
        return ipcMock.stop;
      },
    ),
  },
}));

import {
  AUTO_DISMISS_DELAY,
  useLibraryScanStore,
} from "../../../src/renderer/store/libraryScanStore";

const progress = (
  phase: LibraryScanProgress["phase"],
): LibraryScanProgress => ({
  folderPath: "C:\\library",
  phase,
  progress: phase === "completed" ? 100 : 50,
  currentFile: null,
  processedCount: 1,
  totalCount: 1,
  addedCount: 1,
  updatedCount: 0,
  deletedCount: 0,
});

describe("library scan store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ipcMock.handler = null;
    ipcMock.stop.mockReset();
    setActivePinia(createPinia());
  });

  it("automatically clears a completed scan", () => {
    const store = useLibraryScanStore();
    store.initialize();
    ipcMock.handler?.(progress("completed"));

    expect(store.scanProgress?.phase).toBe("completed");
    vi.advanceTimersByTime(AUTO_DISMISS_DELAY);
    expect(store.scanProgress).toBeNull();
  });

  it("cancels auto-dismiss when a new scan starts", () => {
    const store = useLibraryScanStore();
    store.initialize();
    ipcMock.handler?.(progress("completed"));
    ipcMock.handler?.(progress("scanning"));

    vi.advanceTimersByTime(AUTO_DISMISS_DELAY);
    expect(store.scanProgress?.phase).toBe("scanning");
  });
});
