import { ipcRenderer } from "@/api";
import { useQuery } from "@tanstack/vue-query";
import { computed } from "vue";
import {
  DEFAULT_GALLERY_BORDERS,
  galleryBorderStyle,
  isGalleryBorders,
} from "../../types/galleryBorders";

export function useGalleryBorders() {
  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: () => ipcRenderer.invoke("get-config"),
  });
  const borders = computed(() =>
    isGalleryBorders(config.value?.galleryBorders)
      ? config.value.galleryBorders
      : DEFAULT_GALLERY_BORDERS,
  );
  const borderStyle = (series = false, favorite = false) =>
    galleryBorderStyle(borders.value, series, favorite);
  return { borders, borderStyle };
}
