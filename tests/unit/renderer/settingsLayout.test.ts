// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
vi.mock("@/store/libraryScanStore", () => ({
  useLibraryScanStore: () => ({ initialize: vi.fn() }),
}));
vi.mock(
  "../../../src/renderer/components/feature/settings/tabs/AppearanceTab.vue",
  () => ({ default: { render: () => h("p", "Appearance") } }),
);
vi.mock(
  "../../../src/renderer/components/feature/settings/tabs/GeneralTab.vue",
  () => ({ default: { render: () => h("p", "General") } }),
);
vi.mock(
  "../../../src/renderer/components/feature/settings/tabs/LibraryTab.vue",
  () => ({ default: { render: () => h("p", "Library") } }),
);
vi.mock(
  "../../../src/renderer/components/feature/settings/tabs/ViewerTab.vue",
  () => ({ default: { render: () => h("p", "Viewer") } }),
);
vi.mock(
  "../../../src/renderer/components/feature/settings/tabs/DownloaderTab.vue",
  () => ({ default: { render: () => h("p", "Downloader") } }),
);
vi.mock(
  "../../../src/renderer/components/feature/settings/tabs/CompanionTab.vue",
  () => ({ default: { render: () => h("p", "Companion") } }),
);
vi.mock(
  "../../../src/renderer/components/feature/settings/tabs/DataSecurityTab.vue",
  () => ({ default: { render: () => h("p", "DataSecurity") } }),
);
vi.mock(
  "../../../src/renderer/components/feature/settings/tabs/AboutTab.vue",
  () => ({ default: { render: () => h("p", "About") } }),
);
vi.mock(
  "../../../src/renderer/components/feature/settings/KeybindingSettings.vue",
  () => ({ default: { render: () => h("p", "Keybindings") } }),
);
import Settings from "../../../src/renderer/components/pages/Settings.vue";
let app: App;
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = "";
});
for (const tab of [
  "appearance",
  "general",
  "library",
  "viewer",
  "keybindings",
  "downloader",
  "companion",
  "data-security",
  "about",
]) {
  it(`preserves settings deep link ${tab}`, async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/settings", component: Settings }],
    });
    await router.push(`/settings?tab=${tab}`);
    const host = document.createElement("div");
    document.body.append(host);
    app = createApp({ render: () => h(Settings) });
    app.use(router);
    app.mount(host);
    await nextTick();
    const selected = host.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent?.trim()).toBe(
      (
        {
          appearance: "외관",
          general: "일반",
          library: "라이브러리",
          viewer: "뷰어",
          keybindings: "단축키",
          downloader: "다운로드",
          companion: "모바일 연동",
          "data-security": "데이터 · 보안",
          about: "정보 · 업데이트",
        } as Record<string, string>
      )[tab],
    );
    expect(host.querySelector('[role="tabpanel"]')).not.toBeNull();
  });
}
