import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  updated: null as (() => void) | null,
  stop: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@/api", () => ({
  getSubscriptionStatus: ipc.status,
  ipcRenderer: {
    on: vi.fn((_channel: string, callback: () => void) => {
      ipc.updated = callback;
      return ipc.stop;
    }),
  },
}));
import { useSubscriptionStore } from "../../../src/renderer/store/subscriptionStore";

const status = {
  newCount: 1,
  subscriptionCount: 1,
  feedTotal: 1,
  lastCheckedAt: "2026-01-01T00:00:00Z",
  generation: 1,
};
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  ipc.updated = null;
  ipc.status.mockResolvedValue(status);
});

it("refreshes remote list changes immediately and feed changes without a new check time", async () => {
  const store = useSubscriptionStore();
  store.initialize();
  await vi.waitFor(() => expect(store.feedGeneration).toBe(1));
  ipc.status.mockResolvedValue({
    ...status,
    generation: 2,
    newCount: 0,
    subscriptionCount: 0,
    feedTotal: 0,
  });
  ipc.updated!();
  expect(store.revision).toBe(1);
  await vi.waitFor(() => expect(store.feedGeneration).toBe(2));
  expect(store.lastCheckedAt).toBe(status.lastCheckedAt);
  expect(store.subscriptionCount).toBe(0);
  store.cleanup();
  expect(ipc.stop).toHaveBeenCalledOnce();
});

it("updates read badges without changing the gallery feed generation", async () => {
  const store = useSubscriptionStore();
  store.initialize();
  await vi.waitFor(() => expect(store.hasUnseen).toBe(true));
  ipc.status.mockResolvedValue({ ...status, newCount: 0 });
  ipc.updated!();
  await vi.waitFor(() => expect(store.hasUnseen).toBe(false));
  expect(store.feedGeneration).toBe(1);
  store.cleanup();
});
