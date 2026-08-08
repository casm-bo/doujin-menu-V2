<script setup lang="ts">
import { ipcRenderer } from "@/api";
import ProxiedImage from "@/components/common/ProxiedImage.vue";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPublishDate } from "@/lib/formatDate";
import { computed, ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { HitomiGalleryDetails } from "../../../../types/hitomi.js";
import MetadataField from "../MetadataField.vue";
import PagePreview from "../PagePreview.vue";

const props = defineProps<{
  open: boolean;
  gallery: HitomiGalleryDetails | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const dialogOpen = computed({
  get: () => props.open,
  set: (value) => emit("update:open", value),
});

const refererUrl = computed(() =>
  props.gallery?.id ? `https://hitomi.la/reader/${props.gallery.id}.html` : "",
);
const displayLanguage = computed(
  () =>
    [
      props.gallery?.languageName?.local ||
        props.gallery?.languageName?.english,
    ].filter(Boolean) as string[],
);
const formattedDate = computed(() =>
  formatPublishDate(props.gallery?.publishedDate),
);
const previewImageUrls = ref<string[]>([]);
const isLoadingImages = ref(false);
const imageLoadError = ref<string | null>(null);

const copyMetadata = async (text: string, prefix: string) => {
  const isGenderTag = text.startsWith("male:") || text.startsWith("female:");
  const query = prefix === "tag" && isGenderTag ? text : `${prefix}:${text}`;
  try {
    await navigator.clipboard.writeText(query);
    toast.success(`${query}가 복사되었습니다.`);
  } catch {
    toast.error("복사 실패");
  }
};

watch(
  () => [props.open, props.gallery?.id] as const,
  async ([open]) => {
    if (!open || !props.gallery) return;
    isLoadingImages.value = true;
    imageLoadError.value = null;
    previewImageUrls.value = [];

    try {
      const result = await ipcRenderer.invoke(
        "get-gallery-image-urls",
        props.gallery.id,
      );
      if (result.success && result.data) {
        previewImageUrls.value = result.data;
      } else {
        imageLoadError.value =
          result.error || "미리보기 URL을 가져오지 못했습니다.";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      imageLoadError.value = `미리보기 로드 중 오류 발생: ${message}`;
    } finally {
      isLoadingImages.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <Dialog v-model:open="dialogOpen">
    <DialogContent
      class="flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-[900px]"
      @close-auto-focus.prevent
    >
      <DialogHeader>
        <DialogTitle>다운로드 상세</DialogTitle>
      </DialogHeader>

      <div
        v-if="gallery"
        class="min-h-0 flex-1 space-y-6 overflow-y-auto py-2 pr-2"
      >
        <div class="flex gap-5">
          <div class="h-56 w-40 shrink-0 overflow-hidden rounded-lg shadow">
            <ProxiedImage
              :id="gallery.id"
              :url="gallery.thumbnailUrl"
              :referer="refererUrl"
              :alt="gallery.title.display"
              :lazy="false"
            />
          </div>

          <div class="flex min-w-0 flex-1 flex-col gap-3">
            <h2 class="text-2xl leading-tight font-bold">
              {{ gallery.title.display || "N/A" }}
            </h2>
            <p class="text-muted-foreground text-xs">
              메타데이터를 클릭하면 검색어 형식으로 복사합니다.
            </p>
            <div class="grid gap-2">
              <MetadataField
                label="Hitomi ID"
                icon="solar:hashtag-circle-bold-duotone"
                :values="[String(gallery.id)]"
                @activate="copyMetadata($event, 'id')"
              />
              <MetadataField
                label="작가"
                icon="solar:user-bold-duotone"
                :values="gallery.artists"
                @activate="copyMetadata($event, 'artist')"
              />
              <MetadataField
                label="시리즈"
                icon="solar:library-bold-duotone"
                :values="gallery.series"
                @activate="copyMetadata($event, 'series')"
              />
              <MetadataField
                label="유형"
                icon="solar:bookmark-bold-duotone"
                :values="[gallery.type]"
                @activate="copyMetadata($event, 'type')"
              />
              <MetadataField
                label="언어"
                icon="solar:translation-bold-duotone"
                :values="displayLanguage"
                @activate="copyMetadata($event, 'language')"
              />
              <MetadataField
                label="그룹"
                icon="solar:users-group-rounded-bold-duotone"
                :values="gallery.groups"
                @activate="copyMetadata($event, 'group')"
              />
              <MetadataField
                label="태그"
                icon="solar:tag-bold-duotone"
                :values="
                  gallery.tags.map((tag) =>
                    tag.type === 'male' || tag.type === 'female'
                      ? `${tag.type}:${tag.name}`
                      : tag.name,
                  )
                "
                tag-style
                @activate="copyMetadata($event, 'tag')"
              />
              <MetadataField
                label="캐릭터"
                icon="solar:user-speak-bold-duotone"
                :values="gallery.characters"
                @activate="copyMetadata($event, 'character')"
              />
            </div>
          </div>
        </div>

        <div class="space-y-2">
          <h4 class="font-semibold">상세정보</h4>
          <div class="bg-muted/50 space-y-2 rounded-lg p-4">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">페이지 수</span>
              <span class="font-medium">{{ gallery.files.length }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">발행일</span>
              <span class="font-medium">{{ formattedDate || "N/A" }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">일본어 제목</span>
              <span class="max-w-[70%] text-right font-medium">
                {{ gallery.title.japanese || "N/A" }}
              </span>
            </div>
          </div>
        </div>

        <PagePreview
          :pages="previewImageUrls"
          :proxy-id="gallery.id"
          :referer="refererUrl"
          :loading="isLoadingImages"
          :error="imageLoadError"
          :interactive="false"
        />
      </div>

      <div v-else class="text-muted-foreground py-8 text-center">
        선택된 갤러리가 없습니다.
      </div>
    </DialogContent>
  </Dialog>
</template>
