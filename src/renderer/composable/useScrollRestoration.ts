import {
  nextTick,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  watch,
  type Ref,
} from "vue";
import { useRoute } from "vue-router";

const scrollPositions = new Map<string, number>();
export function clearScrollPosition(routeName: string) {
  for (const key of scrollPositions.keys()) {
    if (key === routeName || key.startsWith(`${routeName}:`))
      scrollPositions.delete(key);
  }
}

export function useScrollRestoration(
  containerSelector: string,
  source?: Ref<string>,
) {
  const routeName = String(useRoute().name);
  const keyFor = (value = source?.value) =>
    value === undefined ? routeName : `${routeName}:${value}`;
  let scrollElement: HTMLElement | null = null;
  let revision = 0;
  let active = true;
  const handleScroll = () => {
    if (scrollElement) scrollPositions.set(keyFor(), scrollElement.scrollTop);
  };
  const detach = () => {
    scrollElement?.removeEventListener("scroll", handleScroll);
    scrollElement = null;
  };
  const restore = async () => {
    const request = ++revision;
    await nextTick();
    if (!active || request !== revision) return;
    detach();
    scrollElement = document.querySelector(containerSelector);
    if (scrollElement) {
      scrollElement.scrollTop = scrollPositions.get(keyFor()) || 0;
      scrollElement.addEventListener("scroll", handleScroll);
    }
  };
  if (source)
    watch(
      source,
      (_, previous) => {
        if (scrollElement)
          scrollPositions.set(keyFor(previous), scrollElement.scrollTop);
        detach();
        void restore();
      },
      { flush: "sync" },
    );
  onMounted(restore);
  onActivated(() => {
    active = true;
    void restore();
  });
  onDeactivated(() => {
    active = false;
    revision++;
    detach();
  });
  onUnmounted(() => {
    active = false;
    revision++;
    detach();
  });
  return {
    scrollTop: () => scrollPositions.get(keyFor()) || 0,
    resetScroll: () => {
      scrollPositions.set(keyFor(), 0);
      if (scrollElement) scrollElement.scrollTop = 0;
    },
    restoreScroll: restore,
  };
}
