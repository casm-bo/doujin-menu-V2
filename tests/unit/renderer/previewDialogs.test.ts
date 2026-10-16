// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- Test-only component stubs. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  reactive,
  type App,
  type Component,
} from "vue";
import type { HitomiGalleryDetails } from "../../../src/types/hitomi";

const api = vi.hoisted(() => ({
  invoke: vi.fn(),
  getBook: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/api", () => ({
  ipcRenderer: { invoke: api.invoke, send: api.send },
  getBook: api.getBook,
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("vue-sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/common/ProxiedImage.vue", () => ({
  default: defineComponent({
    props: { url: String, id: [String, Number], lazy: Boolean },
    setup: (props) => () =>
      h("img", { "data-proxy": props.id, src: props.url }),
  }),
}));
vi.mock("@/components/ui/dialog", () => {
  const Slot = defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h("div", slots.default?.()),
  });
  return {
    Dialog: Slot,
    DialogContent: Slot,
    DialogHeader: Slot,
    DialogTitle: Slot,
  };
});
vi.mock("@/components/ui/toggle-group", () => {
  const Slot = defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h("div", slots.default?.()),
  });
  return { ToggleGroup: Slot, ToggleGroupItem: Slot };
});
vi.mock("@/components/feature/MetadataField.vue", () => ({
  default: { render: () => null },
}));

import PagePreview from "../../../src/renderer/components/feature/PagePreview.vue";
import GalleryPreviewDialog from "../../../src/renderer/components/feature/downloader/GalleryPreviewDialog.vue";
import PageFullscreenDialog from "../../../src/renderer/components/feature/PageFullscreenDialog.vue";

const observe = vi.fn();
const apps: App[] = [];
const gallery = (id = 42): HitomiGalleryDetails => ({
  id,
  title: { display: "Example", japanese: null },
  thumbnailUrl: "https://example.test/cover.jpg",
  type: "manga",
  languageName: { english: "English", local: null },
  artists: [],
  groups: [],
  series: [],
  characters: [],
  tags: [],
  files: [],
  publishedDate: null,
  translations: [],
  relatedIds: [],
});
const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await nextTick();
  }
};
function mount(component: Component, props: Record<string, unknown>) {
  const host = document.createElement("div");
  document.body.append(host);
  const state = reactive(props);
  const app = createApp({ render: () => h(component, state) });
  apps.push(app);
  app.mount(host);
  return { host, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = observe;
      disconnect = vi.fn();
    },
  );
});
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("preview loading", () => {
  it("opens the clicked local page in fullscreen and returns to the details", async () => {
    api.invoke.mockImplementation(async (channel: string) =>
      channel === "is-fullscreen-window" ? false : { success: true, bookId: 7 },
    );
    api.getBook.mockResolvedValue({ id: 7, page_count: 2, is_offline: false });
    const { host } = mount(GalleryPreviewDialog, {
      open: true,
      gallery: gallery(),
    });
    await flush();
    (host.querySelector('button[data-index="1"]') as HTMLButtonElement).click();
    await flush();
    expect(api.send).toHaveBeenCalledWith("set-fullscreen-window", true);
    expect(
      host.querySelector('img[alt="2페이지"][src="doujin-menu://page/7/1"]'),
    ).not.toBeNull();
    const fullscreen = host.querySelector('[aria-label="전체화면 닫기"]')!
      .parentElement!.parentElement!;
    fullscreen.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    await flush();
    expect(fullscreen.querySelector('img[alt="1페이지"]')).not.toBeNull();
    (
      host.querySelector('[aria-label="전체화면 닫기"]') as HTMLButtonElement
    ).click();
    await flush();
    expect(api.send).toHaveBeenLastCalledWith("set-fullscreen-window", false);
    expect(host.querySelector('[aria-label="전체화면 닫기"]')).toBeNull();
    expect(host.textContent).toContain("다운로드 상세");
  });

  it("keeps an already fullscreen window fullscreen when closing the image", async () => {
    api.invoke.mockResolvedValue(true);
    const { state } = mount(PageFullscreenDialog, {
      open: true,
      pages: ["/1.jpg"],
      startIndex: 0,
    });
    await flush();
    state.open = false;
    await flush();
    expect(api.send).not.toHaveBeenCalled();
  });

  it("does not enter fullscreen after a dismissed preview finishes its lookup", async () => {
    let finish!: (value: boolean) => void;
    api.invoke.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { state } = mount(PageFullscreenDialog, {
      open: true,
      pages: ["/1.jpg"],
      startIndex: 0,
    });
    state.open = false;
    await flush();
    finish(false);
    await flush();
    expect(api.send).not.toHaveBeenCalled();
  });

  it("scrolls pages with the wheel and lets the outer popup scroll at the edge", async () => {
    const { host } = mount(PagePreview, { pages: ["/1.jpg", "/2.jpg"] });
    await flush();
    const strip = host.querySelector(".overflow-x-auto") as HTMLElement;
    Object.defineProperties(strip, {
      scrollWidth: { value: 900 },
      clientWidth: { value: 300 },
    });
    const wheel = new WheelEvent("wheel", { deltaY: 120, cancelable: true });
    strip.dispatchEvent(wheel);
    expect(strip.scrollLeft).toBe(120);
    expect(wheel.defaultPrevented).toBe(true);
    strip.scrollLeft = 600;
    const edge = new WheelEvent("wheel", { deltaY: 120, cancelable: true });
    strip.dispatchEvent(edge);
    expect(edge.defaultPrevented).toBe(false);
    expect(strip.scrollLeft).toBe(600);
  });

  it("observes pages that appear only after a delayed loading phase", async () => {
    const { state } = mount(PagePreview, {
      pages: [],
      loading: true,
      proxyId: 42,
    });
    state.pages = ["https://example.test/1.jpg", "https://example.test/2.jpg"];
    await flush();
    expect(observe).not.toHaveBeenCalled();
    state.loading = false;
    await flush();
    expect(observe).toHaveBeenCalledTimes(2);
    expect(observe.mock.calls.every(([element]) => element.isConnected)).toBe(
      true,
    );
  });

  it("previews a local book without requesting online images", async () => {
    api.invoke.mockResolvedValue({ success: true, bookId: 7 });
    api.getBook.mockResolvedValue({ id: 7, page_count: 2, is_offline: false });
    const { host } = mount(GalleryPreviewDialog, {
      open: true,
      gallery: gallery(),
    });
    await flush();
    expect(api.invoke).toHaveBeenCalledTimes(1);
    expect(api.invoke).toHaveBeenCalledWith(
      "check-book-exists-by-hitomi-id",
      42,
    );
    expect(
      host.querySelectorAll('img[src^="doujin-menu://page/7/"]'),
    ).toHaveLength(3);
    expect(host.querySelector("img[data-proxy]")).toBeNull();
  });

  it("uses online images when the local storage is offline", async () => {
    api.invoke.mockImplementation(async (channel: string) =>
      channel === "check-book-exists-by-hitomi-id"
        ? { success: true, bookId: 7 }
        : { success: true, data: ["https://example.test/1.jpg"] },
    );
    api.getBook.mockResolvedValue({ id: 7, page_count: 2, is_offline: true });
    const { host } = mount(GalleryPreviewDialog, {
      open: true,
      gallery: gallery(),
    });
    await flush();
    expect(api.invoke).toHaveBeenCalledWith("get-gallery-image-urls", 42);
    expect(
      host.querySelector('img[src="https://example.test/1.jpg"]'),
    ).not.toBeNull();
  });

  it("ignores a local lookup that finishes after another gallery is opened", async () => {
    let finish!: (book: unknown) => void;
    api.invoke.mockImplementation(async (channel: string, id: number) =>
      channel === "check-book-exists-by-hitomi-id"
        ? { success: true, bookId: id === 42 ? 7 : null }
        : { success: true, data: ["https://example.test/new.jpg"] },
    );
    api.getBook.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { host, state } = mount(GalleryPreviewDialog, {
      open: true,
      gallery: gallery(),
    });
    await flush();
    state.gallery = gallery(43);
    await flush();
    finish({ id: 7, page_count: 2 });
    await flush();
    expect(
      host.querySelector('img[src="https://example.test/new.jpg"]'),
    ).not.toBeNull();
    expect(host.querySelector('img[src^="doujin-menu://page/7/"]')).toBeNull();
  });
});
