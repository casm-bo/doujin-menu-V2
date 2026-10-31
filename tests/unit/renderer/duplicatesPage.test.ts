// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- Test-only UI stubs. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { DuplicateGroup } from "../../../src/types/ipc";

const api = vi.hoisted(() => ({
  getDuplicateGroups: vi.fn(),
  dismissMissingIdBooks: vi.fn(),
  deleteDuplicateBooks: vi.fn(),
  getThumbnailUrl: vi.fn(() => ""),
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@/api", () => api);
vi.mock("vue-sonner", () => ({ toast }));
vi.mock("@iconify/vue", () => ({ Icon: { render: () => null } }));
vi.mock("../../../src/renderer/components/layout/PageHeader.vue", () => ({
  default: { render: () => null },
}));
vi.mock("@/components/ui/button", () => ({
  Button: defineComponent({
    setup:
      (_, { slots, attrs }) =>
      () =>
        h("button", attrs, slots.default?.()),
  }),
}));
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: defineComponent({
    props: { modelValue: Boolean, disabled: Boolean },
    setup: (props) => () =>
      h("input", {
        type: "checkbox",
        checked: props.modelValue,
        disabled: props.disabled,
      }),
  }),
}));
vi.mock("@/components/ui/card", () => ({
  Card: defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h("section", slots.default?.()),
  }),
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h("span", slots.default?.()),
  }),
}));
vi.mock("@/components/ui/alert-dialog", () => {
  const Slot = defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h("div", slots.default?.()),
  });
  return {
    AlertDialog: defineComponent({
      props: { open: Boolean },
      setup:
        (props, { slots }) =>
        () =>
          props.open ? h("div", slots.default?.()) : null,
    }),
    AlertDialogAction: Slot,
    AlertDialogCancel: Slot,
    AlertDialogContent: Slot,
    AlertDialogDescription: Slot,
    AlertDialogFooter: Slot,
    AlertDialogHeader: Slot,
    AlertDialogTitle: Slot,
  };
});
import Duplicates from "../../../src/renderer/components/pages/Duplicates.vue";

let app: App;
let host: HTMLDivElement;
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  }
};
const group = (matchType: DuplicateGroup["matchType"]): DuplicateGroup => ({
  key: "test",
  matchType,
  books: [
    {
      id: 1,
      title: "Local work",
      path: "/local.cbz",
      isArchive: true,
      page_count: 1,
      cover_path: null,
      is_offline: false,
      is_favorite: false,
      current_page: null,
      last_read_at: null,
    },
  ],
});
async function mount(matchType: DuplicateGroup["matchType"] = "missing_id") {
  api.getDuplicateGroups.mockResolvedValue([group(matchType)]);
  host = document.createElement("div");
  document.body.append(host);
  app = createApp(Duplicates);
  app.use(VueQueryPlugin, {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  });
  app.mount(host);
  await flush();
}
const button = (label: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label,
  )!;
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = "";
});

it("labels missing IDs as review items and saves a non-duplicate decision without deletion", async () => {
  await mount();
  expect(host.textContent).toContain("ID 없음");
  expect(host.textContent).toContain("서로 중복이라는 뜻은 아닙니다");
  expect(button("중복 아님").disabled).toBe(true);
  host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  await flush();
  expect(host.textContent).not.toContain("원본까지 삭제");
  api.dismissMissingIdBooks.mockResolvedValue(1);
  api.getDuplicateGroups.mockResolvedValue([]);
  button("중복 아님").click();
  await flush();
  expect(api.dismissMissingIdBooks).toHaveBeenCalledExactlyOnceWith([1]);
  expect(api.deleteDuplicateBooks).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Local work");
  expect(host.textContent).toContain("0개 선택됨");
});

it("keeps selected works on review failure and supports retry", async () => {
  await mount();
  host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  await flush();
  api.dismissMissingIdBooks.mockRejectedValue(new Error("저장 실패"));
  button("중복 아님").click();
  await flush();
  expect(toast.error).toHaveBeenCalledWith("저장 실패");
  expect(host.textContent).toContain("1개 선택됨");
  expect(button("중복 아님").disabled).toBe(false);
});

it("preserves delete confirmation and does not dismiss actual ID matches", async () => {
  await mount("hitomi_id");
  host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  await flush();
  expect(button("중복 아님").disabled).toBe(true);
  button("휴지통으로 이동").click();
  await flush();
  expect(host.textContent).toContain("휴지통으로 이동하시겠습니까?");
  expect(api.deleteDuplicateBooks).not.toHaveBeenCalled();
});
