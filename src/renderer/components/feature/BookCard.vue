<script setup lang="ts">
import * as api from "@/api";
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
import { Badge, LightBadge } from "@/components/ui/badge";
import { CardContent, CardFooter, LightCard } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"; // ContextMenu 관련 컴포넌트 임포트
import { Icon } from "@iconify/vue";
import { useQueryClient } from "@tanstack/vue-query";
import { computed, ref, toRaw } from "vue";
import { toast } from "vue-sonner";
import ContextMenuSeparator from "../ui/context-menu/ContextMenuSeparator.vue";
import { useTagDisplay } from "@/composable/useTagDisplay";
import type { Book } from "../../../types/ipc";

const props = defineProps<{
  book: Book;
  queryKey: readonly unknown[];
  hideTags?: boolean;
  externalImageViewerPath?: string;
  externalArchiveViewerPath?: string;
  selected?: boolean;
}>();
const emit = defineEmits([
  "selectTag",
  "excludeTag",
  "selectArtist",
  "selectGroup",
  "toggle-favorite",
  "open-book-folder",
  "show-details",
  "show-series",
  "show-preview",
  "toggle-select",
  "deleted",
]);

const { getTagDisplayInfo } = useTagDisplay();
const displayTitle = computed(
  () => props.book.series_collection_name || props.book.title,
);

const viewerLink = computed(() => ({
  name: "Viewer",
  params: { id: props.book.id },
  query: {
    filter: JSON.stringify(toRaw(props.queryKey[1])),
  },
}));

// 오프라인 상태 여부 (라이브러리 폴더 접근 불가)
const isOffline = computed(() => !!props.book.is_offline);

// 오프라인 책 열람 시도 시 안내 토스트
const showOfflineToast = () => {
  toast.warning("라이브러리 폴더에 접근할 수 없습니다.", {
    description: "해당 폴더에 접근할 수 있는지 확인한 후 다시 스캔해 주세요.",
  });
};

const openInNewWindow = () => {
  if (isOffline.value) {
    showOfflineToast();
    return;
  }
  const url = `/viewer/${viewerLink.value.params.id}?${new URLSearchParams(viewerLink.value.query).toString()}`;
  api.openNewWindow(url);
};

const handleCardClick = (event: MouseEvent) => {
  if (event.shiftKey) {
    emit("toggle-select", event);
    return;
  }
  if (isOffline.value) {
    showOfflineToast();
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    // metaKey for Command key on macOS
    openInNewWindow();
  } else {
    emit(
      props.book.series_collection_id ? "show-series" : "show-details",
      props.book,
    );
  }
};

const isRead = computed(() =>
  props.book.series_collection_id
    ? Number(props.book.series_read_count || 0) >=
      Number(props.book.series_book_count || 0)
    : !!props.book.is_read,
);

const toggleRead = async () => {
  const result = props.book.series_collection_id
    ? await api.ipcRenderer.invoke("set-series-read", {
        seriesId: props.book.series_collection_id,
        isRead: !isRead.value,
      })
    : await api.ipcRenderer.invoke("set-book-read", {
        bookId: props.book.id,
        isRead: !isRead.value,
      });
  if (!result.success) {
    toast.error("읽음 상태 변경에 실패했습니다.");
    return;
  }
  queryClient.invalidateQueries({ queryKey: ["books"] });
};

const toggleCardFavorite = async () => {
  if (!props.book.series_collection_id) return toggleFavorite();
  const result = await api.ipcRenderer.invoke(
    "toggle-series-favorite",
    props.book.series_collection_id,
  );
  if (!result.success) {
    toast.error("시리즈 즐겨찾기 변경에 실패했습니다.");
    return;
  }
  queryClient.invalidateQueries({ queryKey: ["books"] });
};

const thumbnailKey = ref(0);

// 태그 영역 펼침 상태
const isTagsExpanded = ref(false);

const coverUrl = computed(() => {
  return api.getThumbnailUrl(props.book.cover_path, thumbnailKey.value);
});

const handleTagClick = (tag: { name: string }) => {
  emit("selectTag", tag.name);
};

const handleArtistClick = (artist: { name: string }) => {
  emit("selectArtist", artist.name);
};

const handleGroupClick = (group: { name: string }) => {
  emit("selectGroup", group.name);
};

// 유효한 작가 목록 (빈 문자열, null, undefined 제외)
const validArtists = computed(() => {
  return (
    props.book.artists?.filter((a) => a.name && a.name.trim() !== "") || []
  );
});

// 유효한 그룹 목록 (빈 문자열, null, undefined 제외)
const validGroups = computed(() => {
  return props.book.groups?.filter((g) => g.name && g.name.trim() !== "") || [];
});

// 작가 또는 그룹 정보가 있는지 확인
const hasCreatorInfo = computed(() => {
  return validArtists.value.length > 0 || validGroups.value.length > 0;
});

const toggleFavorite = () => {
  emit("toggle-favorite", props.book.id, props.book.is_favorite);
};

const openBookFolder = () => {
  emit("open-book-folder", props.book.path);
};

// 외부 뷰어 설정 여부 확인 (아카이브/폴더 유형에 따라 다른 뷰어 경로 사용)
const hasExternalViewer = computed(() => {
  const bookPath = props.book.path || "";
  const isArchive = /\.(cbz|zip)$/i.test(bookPath);
  if (isArchive) {
    return !!props.externalArchiveViewerPath;
  }
  return !!props.externalImageViewerPath;
});

// 외부 프로그램으로 책 열기
const openWithExternalViewer = async () => {
  try {
    await api.openBookWithExternalViewer(props.book.id);
    toast.success("외부 프로그램으로 열었습니다.");
  } catch (error) {
    toast.error("외부 프로그램 실행 실패", {
      description: (error as Error).message,
    });
  }
};

const isDeleteDialogOpen = ref(false);

const queryClient = useQueryClient();

const isRescanning = ref(false);

const handleRescanMetadata = async () => {
  if (isRescanning.value) return;
  isRescanning.value = true;
  try {
    await api.rescanBookMetadata(props.book.id);
    await queryClient.invalidateQueries({ queryKey: ["books"] });
    thumbnailKey.value = Date.now();
    toast.success("메타데이터 재스캔 완료", {
      description: `${props.book.title}의 메타데이터가 갱신되었습니다.`,
    });
  } catch (error) {
    console.error("메타데이터 재스캔 실패:", error);
    toast.error("재스캔 실패", {
      description: "메타데이터를 갱신하는 중 오류가 발생했습니다.",
    });
  } finally {
    isRescanning.value = false;
  }
};

const handleDeleteBook = async () => {
  isDeleteDialogOpen.value = true;
};

const confirmDeleteBook = async () => {
  try {
    // Call the main process to delete the book
    await api.deleteBook(props.book.id);
    emit("deleted", props.book.id);
    toast.success("책 삭제 완료", {
      description: `${props.book.title}이(가) 삭제되었습니다.`,
    });
    queryClient.invalidateQueries({ queryKey: ["books"] }); // Invalidate the query
  } catch (error) {
    console.error("책 삭제 실패:", error);
    toast.error("책 삭제 실패", {
      description:
        (error as Error).message || "책을 삭제하는 중 오류가 발생했습니다.",
    });
  } finally {
    isDeleteDialogOpen.value = false;
  }
};
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger>
      <LightCard
        :data-book-id="book.id"
        class="flex h-full cursor-pointer flex-col gap-0 overflow-hidden py-0 transition-all duration-150 hover:shadow-lg"
        :class="{ 'ring-primary scale-[0.98] ring-2': selected }"
        @click="handleCardClick"
      >
        <CardContent class="relative p-0">
          <img
            :src="coverUrl"
            :alt="displayTitle"
            class="aspect-[2/3] h-auto w-full object-cover"
            :class="{ 'opacity-50 grayscale': isOffline }"
          />
          <Badge
            v-if="isOffline"
            variant="secondary"
            class="absolute top-11 right-2 gap-1"
          >
            <Icon icon="solar:plug-circle-bold-duotone" class="h-3 w-3" />
            오프라인
          </Badge>
          <div
            class="absolute top-2 left-2 z-10 flex size-8 items-center justify-center rounded-md transition-colors hover:bg-black/70 hover:text-white"
            @click.stop="emit('toggle-select', $event)"
          >
            <Checkbox
              :model-value="selected"
              :aria-label="`${displayTitle} 선택`"
            />
          </div>
          <Icon
            v-if="book.series_collection_id"
            icon="solar:library-bold-duotone"
            class="absolute bottom-2 left-2 size-7 rounded bg-black/65 p-1 text-white"
          />
          <div
            v-if="isRead"
            class="absolute top-2 right-2 rounded-md bg-black/65 px-2 py-1 text-xs font-semibold text-white"
          >
            읽음
          </div>
          <button
            class="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full bg-black/65 text-white transition-colors hover:bg-black/90"
            :aria-label="
              (
                book.series_collection_id
                  ? book.series_is_favorite
                  : book.is_favorite
              )
                ? '즐겨찾기 해제'
                : '즐겨찾기 추가'
            "
            @click.stop="toggleCardFavorite"
          >
            <Icon
              :icon="
                (
                  book.series_collection_id
                    ? book.series_is_favorite
                    : book.is_favorite
                )
                  ? 'solar:heart-bold'
                  : 'solar:heart-outline'
              "
              class="size-5"
            />
          </button>
        </CardContent>
        <CardFooter class="flex-grow flex-col items-start gap-1 p-2">
          <p
            class="w-full truncate text-sm font-semibold"
            :title="displayTitle"
          >
            {{ displayTitle }}
          </p>
          <!-- 작가/그룹 정보 -->
          <p
            v-if="!hasCreatorInfo"
            class="text-muted-foreground w-full truncate text-xs"
          >
            작가 정보 없음
          </p>
          <div
            v-if="hasCreatorInfo"
            class="text-muted-foreground flex w-full items-center gap-2 text-xs"
          >
            <div
              v-if="validArtists.length > 0"
              class="flex min-w-0 shrink-0 items-center gap-1"
            >
              <Icon
                icon="solar:user-bold-duotone"
                class="h-3 w-3 flex-shrink-0"
              />
              <span
                class="cursor-pointer truncate hover:underline"
                :title="validArtists.map((a) => a.name).join(', ')"
                @click.prevent.stop="handleArtistClick(validArtists[0])"
              >
                {{ validArtists.map((a) => a.name).join(", ") }}
              </span>
            </div>
            <div
              v-if="validGroups.length > 0"
              class="flex min-w-0 items-center gap-1 overflow-hidden"
            >
              <Icon
                icon="solar:users-group-rounded-bold-duotone"
                class="h-3 w-3 flex-shrink-0"
              />
              <span
                class="cursor-pointer truncate hover:underline"
                :title="validGroups.map((g) => g.name).join(', ')"
                @click.prevent.stop="handleGroupClick(validGroups[0])"
              >
                {{ validGroups.map((g) => g.name).join(", ") }}
              </span>
            </div>
          </div>
          <!-- 태그 영역: 기본 한 줄 (overflow hidden), + 버튼으로 펼치기 -->
          <div
            v-if="!hideTags && book.tags?.length"
            class="flex w-full items-start gap-1"
            :class="
              isTagsExpanded ? 'flex-wrap' : 'flex-nowrap overflow-hidden'
            "
          >
            <div
              class="flex min-w-0 flex-1 items-center gap-1"
              :class="
                isTagsExpanded ? 'flex-wrap' : 'flex-nowrap overflow-hidden'
              "
            >
              <LightBadge
                v-for="tag in book.tags"
                :key="tag.name"
                :class="getTagDisplayInfo(tag).className"
                class="flex-shrink-0"
                @click.prevent.stop="handleTagClick(tag)"
                @contextmenu.prevent.stop="emit('excludeTag', tag.name)"
              >
                {{ getTagDisplayInfo(tag).displayText }}
              </LightBadge>
            </div>
            <button
              v-if="book.tags.length > 1"
              class="text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors"
              @click.prevent.stop="isTagsExpanded = !isTagsExpanded"
            >
              <Icon
                :icon="
                  isTagsExpanded
                    ? 'solar:minus-circle-bold-duotone'
                    : 'solar:add-circle-bold-duotone'
                "
                class="h-[22px] w-[22px]"
              />
            </button>
          </div>
        </CardFooter>
      </LightCard>
    </ContextMenuTrigger>

    <ContextMenuContent>
      <ContextMenuItem @click="toggleRead">
        <Icon icon="solar:check-circle-bold-duotone" class="h-4 w-4" />
        {{ isRead ? "읽지 않음으로 표시" : "읽음으로 표시" }}
      </ContextMenuItem>
      <ContextMenuItem @click="toggleCardFavorite">
        <Icon
          :icon="
            (
              book.series_collection_id
                ? book.series_is_favorite
                : book.is_favorite
            )
              ? 'solar:heart-broken-line-duotone'
              : 'solar:heart-bold-duotone'
          "
          class="h-4 w-4"
        />
        {{
          (
            book.series_collection_id
              ? book.series_is_favorite
              : book.is_favorite
          )
            ? "즐겨찾기 해제"
            : "즐겨찾기 추가"
        }}
      </ContextMenuItem>
      <ContextMenuItem @click="openBookFolder">
        <Icon icon="solar:folder-open-bold-duotone" class="h-4 w-4" />
        폴더 열기
      </ContextMenuItem>
      <ContextMenuItem @click="openInNewWindow">
        <Icon icon="solar:square-top-down-bold-duotone" class="h-4 w-4" />
        새 창으로 열기
      </ContextMenuItem>
      <ContextMenuItem v-if="hasExternalViewer" @click="openWithExternalViewer">
        <Icon icon="solar:monitor-bold-duotone" class="h-4 w-4" />
        외부 프로그램으로 열기
      </ContextMenuItem>
      <ContextMenuItem @click.stop="handleRescanMetadata">
        <Icon
          icon="solar:refresh-bold-duotone"
          class="h-4 w-4"
          :class="{ 'animate-spin': isRescanning }"
        />
        메타데이터 재스캔
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @click="handleDeleteBook">
        <Icon icon="solar:trash-bin-trash-bold-duotone" class="h-4 w-4" />
        삭제
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
  <AlertDialog
    :open="isDeleteDialogOpen"
    @update:open="isDeleteDialogOpen = $event"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>책을 삭제하시겠습니까?</AlertDialogTitle>
        <AlertDialogDescription>
          데이터베이스에서 책 정보가 삭제되고, 파일은 휴지통으로 이동합니다.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>취소</AlertDialogCancel>
        <AlertDialogAction @click="confirmDeleteBook">삭제</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
