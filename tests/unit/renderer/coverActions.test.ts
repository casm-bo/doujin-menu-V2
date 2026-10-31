// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- Test-only component stubs. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App } from "vue";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/api", () => ({ ipcRenderer: { invoke: mocks.invoke } }));
vi.mock("vue-sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
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
vi.mock("@/components/ui/button", () => ({
  Button: defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h("button", slots.default?.()),
  }),
}));
import CoverActions from "../../../src/renderer/components/feature/CoverActions.vue";

let app: App;
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await nextTick();
  }
};
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = "";
});
function mount(kind: "book" | "series" = "book") {
  const updated = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp({
    render: () =>
      h(CoverActions, {
        target: { kind, id: 7 },
        sources: [
          {
            url: "/page.jpg",
            label: "3페이지",
            source: { kind: "page", bookId: 7, pageIndex: 2 },
          },
        ],
        onUpdated: updated,
      }),
  });
  app.mount(host);
  return { host, updated };
}
describe("cover selection", () => {
  it("sends the selected internal page and refreshes details after saving", async () => {
    mocks.invoke.mockResolvedValue({ status: "applied" });
    const { host, updated } = mount();
    (
      host.querySelector(
        '[aria-label="3페이지 표지로 사용"]',
      ) as HTMLButtonElement
    ).click();
    await flush();
    expect(mocks.invoke).toHaveBeenCalledWith("change-cover", {
      target: { kind: "book", id: 7 },
      source: { kind: "page", bookId: 7, pageIndex: 2 },
    });
    expect(updated).toHaveBeenCalledOnce();
  });
  it("opens external selection for the series and keeps canceled edits unchanged", async () => {
    mocks.invoke.mockResolvedValue(null);
    const { host, updated } = mount("series");
    const button = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("외부 이미지"),
    )!;
    button.click();
    await flush();
    expect(mocks.invoke).toHaveBeenCalledWith("change-cover", {
      target: { kind: "series", id: 7 },
      source: { kind: "external" },
    });
    expect(updated).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("reports conflicts without claiming the cover was saved", async () => {
    mocks.invoke.mockResolvedValue({ status: "conflict" });
    const { host, updated } = mount();
    (
      host.querySelector(
        '[aria-label="3페이지 표지로 사용"]',
      ) as HTMLButtonElement
    ).click();
    await flush();
    expect(updated).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
