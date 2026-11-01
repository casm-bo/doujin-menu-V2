// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
vi.mock("vue-router", () => ({ useRoute: () => ({ name: "Downloader" }) }));
import {
  useScrollRestoration,
  clearScrollPosition,
} from "../../../src/renderer/composable/useScrollRestoration";
let app: App;
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = "";
  clearScrollPosition("Downloader");
});
it("restores independent source scroll positions and resets only the active source", async () => {
  const source = ref("search");
  let reset = () => {};
  app = createApp({
    setup() {
      reset = useScrollRestoration("[data-result-scroll]", source).resetScroll;
      return () => h("div", { "data-result-scroll": "" });
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  app.mount(host);
  await nextTick();
  await nextTick();
  const result = host.firstElementChild as HTMLElement;
  result.scrollTop = 120;
  result.dispatchEvent(new Event("scroll"));
  source.value = "subscription";
  await nextTick();
  await nextTick();
  expect(result.scrollTop).toBe(0);
  result.scrollTop = 35;
  result.dispatchEvent(new Event("scroll"));
  source.value = "search";
  await nextTick();
  await nextTick();
  expect(result.scrollTop).toBe(120);
  reset();
  expect(result.scrollTop).toBe(0);
  source.value = "subscription";
  await nextTick();
  await nextTick();
  expect(result.scrollTop).toBe(35);
});
