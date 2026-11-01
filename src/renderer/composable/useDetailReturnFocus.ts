import { nextTick, watch } from "vue";

export function useDetailReturnFocus(
  isOpen: () => boolean,
  cardSelector: () => string,
) {
  let origin: HTMLElement | null = null;
  watch(
    isOpen,
    (open) => {
      if (!open) return;
      const active = document.activeElement as HTMLElement | null;
      const card = document.querySelector<HTMLElement>(cardSelector());
      origin = active?.closest('[role="dialog"]')
        ? active
        : card?.querySelector<HTMLElement>("[data-detail-trigger]") ||
          card ||
          active;
    },
    { immediate: true, flush: "sync" },
  );
  return (event: Event) => {
    event.preventDefault();
    void nextTick(() => {
      const target = origin?.isConnected
        ? origin
        : document.querySelector<HTMLElement>("[data-result-scroll], main");
      if (!target) return;
      if (
        !target.hasAttribute("tabindex") &&
        !target.matches("button, a, input")
      )
        target.tabIndex = -1;
      target.focus({ preventScroll: true });
    });
  };
}
