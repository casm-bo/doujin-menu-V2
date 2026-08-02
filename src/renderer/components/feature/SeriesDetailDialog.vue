<script setup lang="ts">
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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "@iconify/vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { SeriesCollectionWithBooks } from "../../../main/db/types";
import type { Book } from "../../../types/ipc";
import {
  getSeriesCollectionById,
  getThumbnailUrl,
  removeBookFromSeries,
  reorderBooksInSeries,
  updateSeriesCollection,
} from "../../api";
import AddBookToSeriesDialog from "./AddBookToSeriesDialog.vue";
import BookDetailDialog from "./BookDetailDialog.vue";
import { reorderForDrop, type DropPosition } from "./seriesReorder";

interface Props {
  open: boolean;
  series: SeriesCollectionWithBooks | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  updated: [];
}>();

// 편집 모드
const isEditing = ref(false);
const editName = ref("");
const editDescription = ref("");

// 책 추가 다이얼로그
const showAddBookDialog = ref(false);

// 책 제거 확인 다이얼로그
const showRemoveDialog = ref(false);
const bookToRemove = ref<number | null>(null);

// 드래그 앤 드롭 상태
const draggedIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);
const dragOverPosition = ref<DropPosition>("before");
const books = ref<Book[]>([]);
const selectedEpisode = ref<Book | null>(null);
const showEpisodeDetail = ref(false);
let reorderTimer: ReturnType<typeof setTimeout> | null = null;
let pendingReorder: {
  seriesId: number;
  bookIds: number[];
  revision: number;
} | null = null;
let reorderRevision = 0;
let reorderWriteChain: Promise<void> = Promise.resolve();

// 시리즈 상세 조회
const { data: seriesDetail, refetch } = useQuery({
  queryKey: computed(() => ["seriesCollection", props.series?.id]),
  queryFn: () => getSeriesCollectionById(props.series!.id),
  enabled: computed(() => props.open && !!props.series),
});

// 시리즈가 변경되면 기존 데이터 초기화
watch(
  () => props.series?.id,
  () => {
    books.value = [];
  },
);

// 시리즈 상세 데이터가 변경되면 books 배열 업데이트
watch(
  () => seriesDetail.value,
  (detail) => {
    if (detail?.books) {
      books.value = [...detail.books];
    }
  },
  { immediate: true },
);

// 시리즈 정보 업데이트 뮤테이션
const updateMutation = useMutation({
  mutationFn: ({
    id,
    data,
  }: {
    id: number;
    data: { name?: string; description?: string };
  }) => updateSeriesCollection(id, data),
  onSuccess: () => {
    toast.success("시리즈 정보가 업데이트되었습니다");
    isEditing.value = false;
    refetch();
    emit("updated");
  },
  onError: (error) => {
    toast.error(`업데이트 실패: ${error.message}`);
  },
});

// 책 제거 뮤테이션
const removeBookMutation = useMutation({
  mutationFn: removeBookFromSeries,
  onSuccess: () => {
    toast.success("책이 시리즈에서 제거되었습니다");
    refetch();
    emit("updated");
  },
  onError: (error) => {
    toast.error(`제거 실패: ${error.message}`);
  },
});

const flushReorder = () => {
  if (reorderTimer !== null) {
    clearTimeout(reorderTimer);
    reorderTimer = null;
  }
  const payload = pendingReorder;
  pendingReorder = null;
  if (!payload) return;

  reorderWriteChain = reorderWriteChain
    .catch(() => undefined)
    .then(() => reorderBooksInSeries(payload.seriesId, payload.bookIds))
    .then(() => {
      if (payload.revision !== reorderRevision) return;
      toast.success("순서가 변경되었습니다");
      void refetch();
      emit("updated");
    })
    .catch((error: Error) => {
      if (payload.revision !== reorderRevision) return;
      toast.error(`순서 변경 실패: ${error.message}`);
      void refetch();
    });
};

const scheduleReorder = () => {
  if (!props.series) return;
  reorderRevision += 1;
  pendingReorder = {
    seriesId: props.series.id,
    bookIds: books.value.map((book) => book.id),
    revision: reorderRevision,
  };
  if (reorderTimer !== null) clearTimeout(reorderTimer);
  reorderTimer = setTimeout(flushReorder, 250);
};

onBeforeUnmount(flushReorder);

// props.series 변경 시 편집 폼 초기화
watch(
  () => props.series,
  (newSeries) => {
    if (newSeries) {
      editName.value = newSeries.name;
      editDescription.value = newSeries.description || "";
    }
  },
  { immediate: true },
);

// 편집 시작
const startEdit = () => {
  isEditing.value = true;
  editName.value = props.series?.name || "";
  editDescription.value = props.series?.description || "";
};

// 편집 취소
const cancelEdit = () => {
  isEditing.value = false;
  editName.value = props.series?.name || "";
  editDescription.value = props.series?.description || "";
};

// 저장
const saveEdit = () => {
  if (!props.series) return;

  updateMutation.mutate({
    id: props.series.id,
    data: {
      name: editName.value,
      description: editDescription.value || undefined,
    },
  });
};

// 책 제거 요청
const handleRemoveBook = (bookId: number) => {
  bookToRemove.value = bookId;
  showRemoveDialog.value = true;
};

// 책 제거 확정
const confirmRemoveBook = () => {
  if (bookToRemove.value !== null) {
    removeBookMutation.mutate(bookToRemove.value);
    bookToRemove.value = null;
  }
  showRemoveDialog.value = false;
};

// 시리즈 팝업은 유지하고 에피소드 상세를 위에 엽니다.
const handleBookClick = (book: Book) => {
  selectedEpisode.value = book;
  showEpisodeDetail.value = true;
};

const firstBook = computed(() => books.value[0] || null);
const uniqueNames = (key: "artists" | "tags" | "groups" | "characters") =>
  computed(() => [
    ...new Set(
      books.value.flatMap((book) =>
        (book[key] || []).map((item: { name: string }) => item.name),
      ),
    ),
  ]);
const seriesArtists = uniqueNames("artists");
const seriesTags = uniqueNames("tags");
const seriesGroups = uniqueNames("groups");
const seriesCharacters = uniqueNames("characters");

// 썸네일 URL 생성
const getCoverUrl = (book: Book) => {
  return getThumbnailUrl(book.cover_path);
};

// 작가명 표시
// 참고: 시리즈 상세 API에서는 GROUP_CONCAT으로 인해 artists가 문자열로 내려옴
const getArtistNames = (book: Book) => {
  if (!book.artists) return "";
  // 배열인 경우 (일반 Book 타입)
  if (Array.isArray(book.artists)) {
    if (book.artists.length === 0) return "";
    return book.artists.map((a: { name: string }) => a.name).join(", ");
  }
  // 문자열인 경우 (GROUP_CONCAT 결과)
  const str = String(book.artists);
  return str || "";
};

// 드래그 앤 드롭 핸들러
const handleDragStart = (index: number) => {
  draggedIndex.value = index;
};

const handleDragOver = (e: DragEvent, index: number) => {
  e.preventDefault();
  if (draggedIndex.value === null || draggedIndex.value === index) {
    dragOverIndex.value = null;
    return;
  }
  dragOverIndex.value = index;
  const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dragOverPosition.value =
    e.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
};

const handleDragLeave = () => {
  dragOverIndex.value = null;
};

const handleDrop = (index: number) => {
  if (draggedIndex.value === null || draggedIndex.value === index) {
    draggedIndex.value = null;
    dragOverIndex.value = null;
    return;
  }

  books.value = reorderForDrop(
    books.value,
    draggedIndex.value,
    index,
    dragOverPosition.value,
  );
  scheduleReorder();

  draggedIndex.value = null;
  dragOverIndex.value = null;
};

const handleDragEnd = () => {
  draggedIndex.value = null;
  dragOverIndex.value = null;
};

// 위/아래 버튼으로 순서 변경
const moveBook = (index: number, direction: "up" | "down") => {
  if (!props.series) return;
  const newIndex = direction === "up" ? index - 1 : index + 1;
  if (newIndex < 0 || newIndex >= books.value.length) return;

  const newBooks = [...books.value];
  const temp = newBooks[index];
  newBooks[index] = newBooks[newIndex];
  newBooks[newIndex] = temp;
  books.value = newBooks;

  scheduleReorder();
};

// 책 추가 완료
const handleBookAdded = () => {
  showAddBookDialog.value = false;
  refetch();
  emit("updated");
};

// 현재 시리즈에 속한 책 ID 목록
const excludeBookIds = computed(() => books.value.map((book) => book.id));
</script>

<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent
      class="flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-[900px]"
    >
      <DialogHeader>
        <DialogTitle>시리즈 상세</DialogTitle>
      </DialogHeader>

      <div class="min-h-0 flex-1 overflow-y-auto pr-2">
        <div class="space-y-6 pb-4">
          <div class="flex gap-5">
            <img
              v-if="firstBook"
              :src="getCoverUrl(firstBook)"
              :alt="series?.name"
              class="h-56 w-40 rounded-lg object-cover shadow"
            />
            <div class="min-w-0 flex-1 space-y-3">
              <div class="flex items-start justify-between gap-3">
                <h2 class="text-2xl font-bold">{{ seriesDetail?.name || series?.name }}</h2>
                <Button v-if="!isEditing" variant="outline" size="sm" @click="startEdit">
                  <Icon icon="solar:pen-bold-duotone" class="mr-2 h-4 w-4" />
                  이름변경
                </Button>
              </div>
              <div v-if="seriesArtists.length" class="flex flex-wrap gap-1">
                <Badge v-for="name in seriesArtists" :key="name" variant="outline">{{ name }}</Badge>
              </div>
              <div v-if="seriesGroups.length" class="flex flex-wrap gap-1">
                <Badge v-for="name in seriesGroups" :key="name" variant="secondary">{{ name }}</Badge>
              </div>
              <div v-if="seriesTags.length" class="flex flex-wrap gap-1">
                <Badge v-for="name in seriesTags" :key="name" variant="secondary">{{ name }}</Badge>
              </div>
              <div v-if="seriesCharacters.length" class="text-muted-foreground text-xs">
                캐릭터: {{ seriesCharacters.join(", ") }}
              </div>
              <p
                v-if="seriesDetail?.description || series?.description"
                class="text-muted-foreground text-sm"
              >
                {{ seriesDetail?.description || series?.description }}
              </p>
            </div>
          </div>
          <div v-if="isEditing" class="space-y-4 rounded-lg border p-4">
            <div class="space-y-2">
              <Label for="series-name">시리즈명</Label>
              <Input
                id="series-name"
                v-model="editName"
                placeholder="시리즈 이름을 입력하세요"
              />
            </div>
            <div class="space-y-2">
              <Label for="series-description">설명</Label>
              <Textarea
                id="series-description"
                v-model="editDescription"
                placeholder="시리즈 설명을 입력하세요 (선택사항)"
                rows="3"
              />
            </div>
            <div class="flex justify-end gap-2">
              <Button variant="outline" size="sm" @click="cancelEdit">취소</Button>
              <Button
                size="sm"
                :disabled="updateMutation.isPending.value"
                @click="saveEdit"
              >
                저장
              </Button>
            </div>
          </div>

          <!-- 소속 책 목록 -->
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold">소속 책 ({{ books.length || 0 }}권)</h3>
              <Button
                variant="outline"
                size="sm"
                @click="showAddBookDialog = true"
              >
                <Icon
                  icon="solar:add-circle-bold-duotone"
                  class="mr-2 h-4 w-4"
                />
                책 추가
              </Button>
            </div>

            <div class="space-y-1">
              <template v-for="(book, index) in books" :key="book.id">
                <!-- 드롭 위치 표시줄 -->
                <div
                  v-if="
                    dragOverIndex === index &&
                    dragOverPosition === 'before' &&
                    draggedIndex !== null &&
                    draggedIndex !== index
                  "
                  class="bg-primary h-0.5 rounded-full transition-all"
                />

                <div
                  class="group flex items-stretch gap-3 rounded-lg border p-2 transition-colors"
                  :class="{
                    'opacity-40': draggedIndex === index,
                    'hover:bg-accent/50': draggedIndex !== index,
                  }"
                  draggable="true"
                  @dragstart="handleDragStart(index)"
                  @dragover="handleDragOver($event, index)"
                  @dragleave="handleDragLeave"
                  @drop="handleDrop(index)"
                  @dragend="handleDragEnd"
                >
                  <!-- 썸네일 -->
                  <div
                    class="bg-muted relative h-20 w-14 shrink-0 cursor-pointer overflow-hidden rounded"
                    @click="handleBookClick(book)"
                  >
                    <img
                      v-if="getCoverUrl(book)"
                      :src="getCoverUrl(book)"
                      :alt="book.title"
                      class="h-full w-full object-cover"
                      @error="
                        (e) =>
                          ((e.target as HTMLImageElement).style.display =
                            'none')
                      "
                    />
                    <div
                      v-else
                      class="flex h-full w-full items-center justify-center"
                    >
                      <Icon
                        icon="solar:book-bold-duotone"
                        class="text-muted-foreground/30 h-8 w-8"
                      />
                    </div>
                  </div>

                  <!-- 책 정보 (클릭 가능) -->
                  <div
                    class="min-w-0 flex-1 basis-0 cursor-pointer overflow-hidden py-0.5"
                    @click="handleBookClick(book)"
                  >
                    <div
                      class="hover:text-primary w-full truncate text-sm font-medium transition-colors"
                    >
                      {{ book.title }}
                    </div>
                    <div
                      class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                    >
                      <span
                        v-if="getArtistNames(book)"
                        class="flex items-center gap-1"
                      >
                        <Icon icon="solar:user-bold-duotone" class="h-3 w-3" />
                        {{ getArtistNames(book) }}
                      </span>
                      <span
                        v-if="book.page_count"
                        class="flex items-center gap-1"
                      >
                        <Icon
                          icon="solar:document-text-bold-duotone"
                          class="h-3 w-3"
                        />
                        {{ book.page_count }}페이지
                      </span>
                    </div>
                  </div>

                  <!-- 순서 + 정렬 버튼 -->
                  <div
                    class="flex shrink-0 flex-col items-center justify-center gap-0.5"
                    @click.stop
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      class="h-5 w-5"
                      :disabled="index === 0"
                      @click="moveBook(index, 'up')"
                    >
                      <Icon
                        icon="solar:alt-arrow-up-bold-duotone"
                        class="h-3.5 w-3.5"
                      />
                    </Button>
                    <span class="text-muted-foreground text-xs font-semibold">
                      {{ index + 1 }}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="h-5 w-5"
                      :disabled="index === books.length - 1"
                      @click="moveBook(index, 'down')"
                    >
                      <Icon
                        icon="solar:alt-arrow-down-bold-duotone"
                        class="h-3.5 w-3.5"
                      />
                    </Button>
                  </div>

                  <!-- 드래그 핸들 + 제거 버튼 -->
                  <div
                    class="flex shrink-0 flex-col items-center justify-center gap-1"
                    @click.stop
                  >
                    <div class="cursor-grab active:cursor-grabbing">
                      <Icon
                        icon="solar:hamburger-menu-bold-duotone"
                        class="text-muted-foreground h-4 w-4"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="text-muted-foreground hover:text-destructive h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                      @click="handleRemoveBook(book.id)"
                    >
                      <Icon
                        icon="solar:trash-bin-trash-bold-duotone"
                        class="h-3.5 w-3.5"
                      />
                    </Button>
                  </div>
                </div>

                <div
                  v-if="
                    dragOverIndex === index &&
                    dragOverPosition === 'after' &&
                    draggedIndex !== null &&
                    draggedIndex !== index
                  "
                  class="bg-primary h-0.5 rounded-full transition-all"
                />
              </template>

              <div
                v-if="!books || books.length === 0"
                class="text-muted-foreground py-8 text-center"
              >
                이 시리즈에 속한 책이 없습니다
              </div>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <BookDetailDialog v-model="showEpisodeDetail" :book="selectedEpisode" />

  <!-- 책 추가 다이얼로그 -->
  <AddBookToSeriesDialog
    v-model:open="showAddBookDialog"
    :series-id="series?.id || null"
    :exclude-book-ids="excludeBookIds"
    @added="handleBookAdded"
  />

  <!-- 책 제거 확인 다이얼로그 -->
  <AlertDialog
    :open="showRemoveDialog"
    @update:open="showRemoveDialog = $event"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>시리즈에서 책 제거</AlertDialogTitle>
        <AlertDialogDescription>
          이 책을 시리즈에서 제거하시겠습니까? 책 자체는 삭제되지 않고
          시리즈에서만 제거됩니다.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>취소</AlertDialogCancel>
        <AlertDialogAction @click="confirmRemoveBook">제거</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
