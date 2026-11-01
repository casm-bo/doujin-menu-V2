<script setup lang="ts">
import { useGalleryBorders } from "@/composable/useGalleryBorders";
import ProxiedImage from "@/components/common/ProxiedImage.vue";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useTagDisplay } from "@/composable/useTagDisplay";
import { useGalleryCard } from "@/composable/useGalleryCard";
import { formatPublishDate } from "@/lib/formatDate";
import { Icon } from "@iconify/vue";
import { computed } from "vue";
import type { HitomiGalleryDetails } from "../../../../types/hitomi.js";

interface Props {
  gallery: HitomiGalleryDetails;
  downloadStatus?: {
    status: string;
    progress?: number;
    error?: string;
    bookId?: number | null;
  };
  selected?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  downloadStatus: () => ({ status: "idle" }),
  selected: false,
});

const emit = defineEmits<{
  "select-gallery": [gallery: HitomiGalleryDetails];
  "preview-gallery": [gallery: HitomiGalleryDetails];
  "book-deleted": [galleryId: number];
}>();

// 업로드 날짜 포맷
const formattedDate = computed(() =>
  formatPublishDate(props.gallery.publishedDate),
);

// composable 사용
const {
  displayTitle,
  buttonText,
  isDeleteDialogOpen,
  isDownloading,
  isDownloadCompleted,
  isInLibrary,
  isDownloadFailed,
  handleOpenBook,
  handleDownload,
  handleDeleteGallery,
  confirmDeleteGallery,
  copyToClipboard,
  permanentDelete,
} = useGalleryCard(props, emit);
const { borderStyle } = useGalleryBorders();
const { getTagDisplayInfo } = useTagDisplay();
</script>

<template>
  <article
    class="bg-card text-card-foreground flex h-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border"
    :class="{ 'bg-selected-card ring-primary ring-2': selected }"
    :style="borderStyle()"
    @click="emit('select-gallery', gallery)"
  >
    <button
      type="button"
      class="bg-muted relative block aspect-[0.72] w-full overflow-hidden"
      :aria-label="`${displayTitle} 상세 보기`"
      @click.stop="emit('preview-gallery', gallery)"
    >
      <ProxiedImage
        :id="gallery.id"
        :url="gallery.thumbnailUrl"
        :referer="`https://hitomi.la/reader/${gallery.id}.html`"
        :alt="displayTitle"
        fit="cover"
      />
      <span
        v-if="selected"
        class="bg-selected-cover pointer-events-none absolute inset-0"
      />
      <span
        v-if="selected"
        class="bg-primary text-primary-foreground absolute top-2 left-2 rounded-full p-1"
        ><Icon icon="solar:check-read-linear" class="size-4"
      /></span>
    </button>
    <div class="flex min-w-0 flex-1 flex-col gap-1 p-3">
      <button
        type="button"
        class="line-clamp-2 min-h-10 text-left text-sm font-semibold"
        :title="displayTitle"
        @click.stop="emit('preview-gallery', gallery)"
      >
        {{ displayTitle }}
      </button>
      <p class="text-primary truncate text-xs">
        <template v-for="(artist, index) in gallery.artists" :key="artist"
          ><button
            type="button"
            @click.stop="copyToClipboard(`artist:${artist}`)"
          >
            {{ artist }}</button
          >{{ index < gallery.artists.length - 1 ? ", " : "" }}</template
        >
        <template v-if="!gallery.artists?.length">작가 정보 없음</template>
      </p>
      <p class="text-muted-foreground truncate text-xs">
        {{ gallery.type }} ·
        {{ gallery.languageName?.local || gallery.languageName?.english }} ·
        {{ gallery.files?.length || 0 }} 페이지
      </p>
      <div
        class="flex max-h-[5.25rem] min-h-[5.25rem] flex-wrap content-start gap-1 overflow-hidden"
      >
        <button
          v-for="tag in gallery.tags"
          :key="`${tag.type}:${tag.name}`"
          type="button"
          :class="getTagDisplayInfo(tag).className"
          class="max-w-full truncate rounded-full"
          @click.stop="
            copyToClipboard(
              `${tag.type === 'male' || tag.type === 'female' ? tag.type : 'tag'}:${tag.name}`,
            )
          "
          @contextmenu.prevent.stop="
            copyToClipboard(
              `-${tag.type === 'male' || tag.type === 'female' ? tag.type : 'tag'}:${tag.name}`,
            )
          "
        >
          {{ getTagDisplayInfo(tag).displayText }}
        </button>
      </div>
      <p
        class="text-muted-foreground truncate text-xs"
        :class="{ 'text-destructive': isDownloadFailed }"
      >
        {{
          isInLibrary
            ? "보유"
            : isDownloadCompleted
              ? "다운로드 완료"
              : isDownloading || isDownloadFailed
                ? buttonText
                : formattedDate || "다운로드 가능"
        }}
      </p>
      <div class="mt-auto flex flex-wrap gap-1 pt-2" @click.stop>
        <Button
          size="sm"
          variant="outline"
          :disabled="isDownloading || !!isDownloadCompleted"
          @click.stop="handleDownload"
          ><Icon icon="solar:download-linear" class="size-4" />{{
            buttonText
          }}</Button
        >
        <Button v-if="isInLibrary" size="sm" @click.stop="handleOpenBook"
          >열기</Button
        >
        <Button
          v-if="isInLibrary"
          size="sm"
          variant="ghost"
          @click.stop="handleDeleteGallery"
          >삭제</Button
        >
      </div>
    </div>
  </article>

  <!-- 삭제 확인 다이얼로그 -->
  <AlertDialog
    :open="isDeleteDialogOpen"
    @update:open="isDeleteDialogOpen = $event"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>책을 삭제하시겠습니까?</AlertDialogTitle>
        <AlertDialogDescription>
          {{
            permanentDelete
              ? "데이터베이스의 책 정보와 파일이 영구적으로 삭제됩니다."
              : "데이터베이스에서 책 정보가 삭제되고, 파일은 휴지통으로 이동합니다."
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Label class="flex cursor-pointer items-center gap-2 font-normal">
        <Checkbox v-model="permanentDelete" />
        휴지통을 거치지 않고 영구 삭제
      </Label>
      <AlertDialogFooter>
        <AlertDialogCancel>취소</AlertDialogCancel>
        <AlertDialogAction @click="confirmDeleteGallery"
          >삭제</AlertDialogAction
        >
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
