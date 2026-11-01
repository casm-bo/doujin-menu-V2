// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
vi.mock("@/store/subscriptionStore", () => ({
  useSubscriptionStore: () => ({ hasUnseen: true }),
}));
import Sidebar from "../../../src/renderer/components/layout/Sidebar.vue";
let app: App;
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = "";
});
it("keeps search/library/settings routes and marks management pages", async () => {
  const paths = [
    "/library",
    "/downloader",
    "/settings",
    "/browse",
    "/series-manager",
    "/duplicates",
    "/statistics",
  ];
  const router = createRouter({
    history: createMemoryHistory(),
    routes: paths.map((path) => ({ path, component: { render: () => null } })),
  });
  await router.push("/library");
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp({ render: () => h(Sidebar) });
  app.use(router);
  app.mount(host);
  for (const [label, path] of [
    ["검색", "/downloader"],
    ["라이브러리", "/library"],
    ["설정", "/settings"],
  ]) {
    host.querySelector<HTMLButtonElement>(`button[title="${label}"]`)!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.currentRoute.value.path).toBe(path);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain(
      label,
    );
  }
  for (const path of paths.slice(3)) {
    await router.push(path);
    await nextTick();
    expect(
      host
        .querySelector('button[aria-label="관리 메뉴"]')
        ?.getAttribute("data-active"),
    ).toBe("true");
  }
});
