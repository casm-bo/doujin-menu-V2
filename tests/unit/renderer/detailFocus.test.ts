// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import { useDetailReturnFocus } from "../../../src/renderer/composable/useDetailReturnFocus";
let app: App;
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = "";
});
it("returns focus to the original card and uses results when the card was removed", async () => {
  const open = ref(false);
  let restore = (_event: Event) => {};
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp({
    setup() {
      restore = useDetailReturnFocus(
        () => open.value,
        () => '[data-book-id="7"]',
      );
      return () => h("div");
    },
  });
  app.mount(host);
  const results = document.createElement("div");
  results.setAttribute("data-result-scroll", "");
  document.body.append(results);
  const card = document.createElement("article");
  card.dataset.bookId = "7";
  const button = document.createElement("button");
  button.setAttribute("data-detail-trigger", "");
  card.append(button);
  results.append(card);
  open.value = true;
  await nextTick();
  open.value = false;
  const event = new Event("close", { cancelable: true });
  restore(event);
  await nextTick();
  expect(event.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(button);
  open.value = true;
  await nextTick();
  card.remove();
  open.value = false;
  restore(new Event("close", { cancelable: true }));
  await nextTick();
  expect(document.activeElement).toBe(results);
});
