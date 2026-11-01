// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, watch, type App } from "vue";
import LibrarySeriesChips from "../../../src/renderer/components/feature/LibrarySeriesChips.vue";
let app: App;
afterEach(() => app?.unmount());
it("cycles series states, clears selection only on changes and preserves other conditions", async () => {
  const state = ref<"all" | "series" | "standalone">("all");
  const selected = ref(new Set([7]));
  const conditions = { searchQuery: "artist:sample", sortBy: "title" };
  const fetch = vi.fn();
  watch(state, () => {
    selected.value = new Set();
    fetch({ ...conditions, seriesStatus: state.value });
  });
  const host = document.createElement("div");
  app = createApp({
    render: () =>
      h(LibrarySeriesChips, {
        modelValue: state.value,
        "onUpdate:modelValue": (value: "all" | "series" | "standalone") =>
          (state.value = value),
      }),
  });
  app.mount(host);
  const [all, series] = Array.from(host.querySelectorAll("button"));
  all.click();
  await nextTick();
  expect(fetch).not.toHaveBeenCalled();
  expect(selected.value.has(7)).toBe(true);
  for (const expected of ["series", "standalone", "series"]) {
    series.click();
    await nextTick();
    expect(state.value).toBe(expected);
    expect(series.getAttribute("aria-pressed")).toBe("true");
    expect(selected.value.size).toBe(0);
    expect(fetch).toHaveBeenLastCalledWith({
      ...conditions,
      seriesStatus: expected,
    });
  }
  for (const start of ["all", "series", "standalone"] as const) {
    state.value = start;
    await nextTick();
    all.click();
    await nextTick();
    expect(state.value).toBe("all");
    expect(all.getAttribute("aria-pressed")).toBe("true");
  }
});
