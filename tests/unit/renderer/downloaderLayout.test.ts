// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- Test-only UI stubs. */
import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  enter: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/api", () => ({
  ipcRenderer: { invoke: mocks.invoke, on: () => () => {} },
  enterSubscriptionTab: mocks.enter,
  refreshSubscriptions: mocks.refresh,
  getPresentation: vi.fn(),
  addSubscription: vi.fn(),
}));
vi.mock("vue-router", () => ({
  useRoute: () => ({ name: "Downloader", query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/store/uiStore", () => ({
  useUiStore: () => ({ thumbnailZoom: 1 }),
}));
vi.mock("@/store/downloadQueueStore", () => ({
  useDownloadQueueStore: () => ({
    queue: [],
    initialize: vi.fn(),
    cleanup: vi.fn(),
    fetchQueue: async () => {},
  }),
}));
vi.mock("@/store/subscriptionStore", () => ({
  useSubscriptionStore: () => ({
    hasUnseen: true,
    newCount: 1,
    lastCheckedAt: null,
    feedGeneration: 0,
    refreshStatus: async () => {},
  }),
}));
vi.mock("@/composable/useKeybindings", () => ({ useKeybindings: () => {} }));
vi.mock("@/components/common/HelpDialog.vue", () => ({
  default: { render: () => null },
}));
vi.mock("@/components/common/PresetDropdown.vue", () => ({
  default: { render: () => null },
}));
vi.mock("@/components/feature/downloader/SubscriptionToolbar.vue", () => ({
  default: { render: () => null },
}));
vi.mock("@/components/feature/downloader/GalleryPreviewDialog.vue", () => ({
  default: { render: () => null },
}));
vi.mock("@/components/common/SmartSearchInput.vue", () => ({
  default: defineComponent({
    props: { modelValue: String },
    emits: ["update:modelValue", "submit"],
    setup:
      (props, { emit }) =>
      () =>
        h("input", {
          value: props.modelValue,
          onInput: (event: Event) =>
            emit("update:modelValue", (event.target as HTMLInputElement).value),
          onKeydown: (event: KeyboardEvent) => {
            if (event.key === "Enter") emit("submit");
          },
        }),
  }),
}));
vi.mock("@/components/feature/downloader/GalleryThumbnailCard.vue", () => ({
  default: defineComponent({
    props: { gallery: Object },
    emits: ["select-gallery"],
    setup:
      (props, { emit }) =>
      () =>
        h(
          "button",
          { onClick: () => emit("select-gallery", props.gallery) },
          "작품",
        ),
  }),
}));
vi.mock("@/components/feature/downloader/GalleryRowCard.vue", () => ({
  default: defineComponent({
    props: { gallery: Object },
    emits: ["select-gallery"],
    setup:
      (props, { emit }) =>
      () =>
        h(
          "button",
          { onClick: () => emit("select-gallery", props.gallery) },
          "작품",
        ),
  }),
}));
import Downloader from "../../../src/renderer/components/pages/Downloader.vue";
let app: App;
let client: QueryClient;
afterEach(() => {
  app?.unmount();
  client?.clear();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const flush = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  }
};
it("opens conditions without searching and preserves search result scroll through the subscription feed", async () => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  mocks.invoke.mockImplementation(async (channel: string) => {
    if (channel === "get-config") return {};
    if (channel === "get-config-value") return null;
    if (channel === "search-galleries" || channel === "get-subscription-feed")
      return { success: true, data: [42], hasNextPage: false };
    if (channel === "get-gallery-details")
      return {
        success: true,
        data: { id: 42, title: { display: "Synthetic" } },
      };
    return { success: true };
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp(Downloader);
  app.use(VueQueryPlugin, { queryClient: client });
  app.mount(host);
  await flush();
  const find = (text: string) =>
    Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === text,
    )!;
  find("태그 필터").click();
  await flush();
  expect(
    mocks.invoke.mock.calls.some(([channel]) => channel === "search-galleries"),
  ).toBe(false);
  const input = host.querySelector("input")!;
  input.value = "artist:synthetic";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  await flush();
  expect(mocks.invoke).toHaveBeenCalledWith(
    "search-galleries",
    expect.objectContaining({
      query: expect.objectContaining({
        searchQuery: "language:korean artist:synthetic",
      }),
    }),
  );
  const result = host.querySelector<HTMLElement>("[data-result-scroll]")!;
  result.scrollTop = 123;
  result.dispatchEvent(new Event("scroll"));
  host.querySelector<HTMLButtonElement>('[aria-label="구독 신작"]')!.click();
  await flush();
  find("작품").click();
  await flush();
  expect(
    mocks.invoke.mock.calls.filter(
      ([channel]) => channel === "mark-subscription-read",
    ),
  ).toHaveLength(1);
  result.scrollTop = 35;
  result.dispatchEvent(new Event("scroll"));
  find("검색으로 돌아가기").click();
  await flush();
  expect(host.querySelector("input")?.value).toBe("artist:synthetic");
  expect(result.scrollTop).toBe(123);
  expect(
    mocks.invoke.mock.calls.filter(
      ([channel]) => channel === "search-galleries",
    ),
  ).toHaveLength(1);
});
