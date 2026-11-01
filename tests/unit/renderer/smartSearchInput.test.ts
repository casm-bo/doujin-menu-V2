// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- Test-only UI stubs. */
import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
vi.mock("@/composable/useLookupData", () => ({
  useLookupData: () =>
    Object.fromEntries(
      [
        "artists",
        "tags",
        "series",
        "groups",
        "characters",
        "types",
        "languages",
      ].map((key) => [key, ref([])]),
    ),
}));
vi.mock("@/components/ui/popover", () => {
  const Slot = defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h("div", slots.default?.()),
  });
  return { Popover: Slot, PopoverAnchor: Slot, PopoverContent: Slot };
});
import SmartSearchInput from "../../../src/renderer/components/common/SmartSearchInput.vue";
let app: App;
afterEach(() => {
  app?.unmount();
  vi.useRealTimers();
});
it("ignores composing Enter, submits normal Enter and closes suggestions without clearing the query", async () => {
  vi.useFakeTimers();
  const query = ref("ar");
  const submit = vi.fn();
  const host = document.createElement("div");
  app = createApp({
    render: () =>
      h(SmartSearchInput, {
        modelValue: query.value,
        "onUpdate:modelValue": (value: string) => (query.value = value),
        onSubmit: submit,
      }),
  });
  app.mount(host);
  const input = host.querySelector("input")!;
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
    }),
  );
  expect(submit).not.toHaveBeenCalled();
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  expect(submit).toHaveBeenCalledTimes(1);
  input.dispatchEvent(new FocusEvent("focus"));
  query.value = "art";
  await nextTick();
  await vi.advanceTimersByTimeAsync(350);
  expect(host.querySelectorAll("li").length).toBeGreaterThan(0);
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await nextTick();
  expect(host.querySelectorAll("li")).toHaveLength(0);
  expect(query.value).toBe("art");
});
