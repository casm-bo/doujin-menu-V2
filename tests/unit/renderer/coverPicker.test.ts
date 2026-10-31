// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../../src/renderer/components/ui/dialog";
import CoverActions from "../../../src/renderer/components/feature/CoverActions.vue";

vi.mock("@/api", () => ({ ipcRenderer: { invoke: vi.fn() } }));
vi.mock("vue-sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let app: App;
const flush = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
    await nextTick();
  }
};
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = "";
});

describe("cover picker dialog", () => {
  it.each(["book", "series"] as const)(
    "opens inside %s details and stays open when the same target is refreshed",
    async (kind) => {
      const refresh = ref(0);
      const targetId = ref(7);
      const host = document.createElement("div");
      document.body.append(host);
      app = createApp({
        render: () =>
          h(Dialog, { open: true }, () =>
            h(DialogContent, {}, () => [
              h(DialogTitle, {}, () => "Details"),
              h("span", String(refresh.value)),
              h(CoverActions, {
                target: { kind, id: targetId.value },
                sources: [
                  {
                    url: "/page.jpg",
                    label: "Page 1",
                    source: { kind: "page", bookId: 7, pageIndex: 0 },
                  },
                ],
              }),
            ]),
          ),
      });
      app.mount(host);
      await flush();
      expect(
        document.querySelector('[aria-label="Page 1 표지로 사용"]'),
      ).toBeNull();
      const button = Array.from(document.querySelectorAll("button")).find(
        (button) =>
          button.textContent?.includes(
            kind === "book" ? "내부 페이지" : "소속 작품",
          ),
      )!;
      expect(button).toBeDefined();
      button.click();
      await flush();
      expect(
        document.querySelector('[aria-label="Page 1 표지로 사용"]'),
      ).not.toBeNull();
      refresh.value++;
      await flush();
      expect(
        document.querySelector('[aria-label="Page 1 표지로 사용"]'),
      ).not.toBeNull();
      targetId.value = 8;
      await flush();
      expect(
        document.querySelector('[aria-label="Page 1 표지로 사용"]'),
      ).toBeNull();
    },
  );
});
