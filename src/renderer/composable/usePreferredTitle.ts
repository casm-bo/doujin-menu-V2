import { ipcRenderer } from "@/api";
import { useQuery } from "@tanstack/vue-query";
import { computed } from "vue";
import { extractKoreanTitle } from "../../shared/title";

export function usePreferredTitle(title: () => string) {
  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: () => ipcRenderer.invoke("get-config"),
  });
  return computed(() =>
    extractKoreanTitle(title(), config.value?.prioritizeKoreanTitles === true),
  );
}
