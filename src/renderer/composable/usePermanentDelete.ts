import { useLocalStorage } from "@vueuse/core";

const permanentDelete = useLocalStorage("delete-book-permanent", false);

export function usePermanentDelete() {
  return { permanentDelete };
}
