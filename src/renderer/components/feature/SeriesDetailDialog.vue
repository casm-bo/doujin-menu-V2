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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Icon } from "@iconify/vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import type { SeriesCollectionWithBooks } from "../../../main/db/types";
import type { Book } from "../../../types/ipc";
import {
  deleteSeriesCollection,
  getSeriesCollectionById,
  getThumbnailUrl,
  removeBookFromSeries,
  reorderBooksInSeries,
  updateSeriesCollection,
} from "../../api";
import AddBookToSeriesDialog from "./AddBookToSeriesDialog.vue";
import BookDetailDialog from "./BookDetailDialog.vue";
import MetadataField from "./MetadataField.vue";
import { reorderForDrop, type DropPosition } from "./seriesReorder";
import { getSeriesResumeTarget } from "./seriesResume";

interface Props {
  open: boolean;
  series: SeriesCollectionWithBooks | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  updated: [];
}>();
const router = useRouter();
const route = useRoute();
const dialogOpen = computed(() => props.open && route.name !== "Viewer");
const updateDialogOpen = (value: boolean) => {
  if (route.name !== "Viewer") emit("update:open", value);
};

const searchInDownloader = (text: string, prefix: string) => {
  const query =
    prefix === "tag" && (text.startsWith("male:") || text.startsWith("female:"))
      ? text
      : `${prefix}:${text}`;
  localStorage.setItem("downloader-search-query", query);
  emit("update:open", false);
  router.push("/downloader");
};

// 편집 모드
const isEditing = ref(false);
const editName = ref("");

// 책 추가 다이얼로그
const showAddBookDialog = ref(false);

// 책 제거 확인 다이얼로그
const showRemoveDialog = ref(false);
const showDeleteSeriesDialog = ref(false);
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

watch(
  () => props.open,
  (open) => {
    if (open && props.series) void refetch();
  },
);

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
  mutationFn: ({ id, data }: { id: number; data: { name?: string } }) =>
    updateSeriesCollection(id, data),
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

const deleteSeriesMutation = useMutation({
  mutationFn: () => deleteSeriesCollection(props.series!.id),
  onSuccess: () => {
    toast.success("시리즈를 삭제했습니다. 에피소드는 유지됩니다");
    showDeleteSeriesDialog.value = false;
    emit("update:open", false);
    emit("updated");
  },
  onError: (error) => toast.error(`시리즈 삭제 실패: ${error.message}`),
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
    }
  },
  { immediate: true },
);

// 편집 시작
const startEdit = () => {
  isEditing.value = true;
  editName.value = seriesDetail.value?.name || props.series?.name || "";
};

// 편집 취소
const cancelEdit = () => {
  isEditing.value = false;
  editName.value = seriesDetail.value?.name || props.series?.name || "";
};

// 저장
const saveEdit = () => {
  if (!props.series) return;
  if (!editName.value.trim()) {
    toast.error("시리즈 제목을 입력해주세요");
    return;
  }

  updateMutation.mutate({
    id: props.series.id,
    data: { name: editName.value.trim() },
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
const resumeTarget = computed(() => getSeriesResumeTarget(books.value));
const openReader = (book: Book | null, page: number) => {
  if (!book) return;
  router.push({
    name: "Viewer",
    params: { id: book.id },
    query: { start: String(page) },
  });
};
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
const uniqueBookValues = (key: "hitomi_id" | "type") =>
  computed(() => [
    ...new Set(
      books.value.map((book) => book[key]).filter(Boolean) as string[],
    ),
  ]);
const seriesHitomiIds = uniqueBookValues("hitomi_id");
const seriesTypes = uniqueBookValues("type");
const seriesLanguages = computed(() => [
  ...new Set(
    books.value
      .map((book) => book.language_name_local || book.language_name_english)
      .filter(Boolean) as string[],
  ),
]);

const handleEpisodeUpdated = async () => {
  await refetch();
  emit("updated");
};

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
  <Dialog :open="dialogOpen" @update:open="updateDialogOpen">
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
            <div class="flex min-w-0 flex-1 flex-col gap-3">
              <div class="flex items-start justify-between gap-3">
                <Input
                  v-if="isEditing"
                  v-model="editName"
                  class="h-auto flex-1 py-2 text-xl font-bold"
                  aria-label="시리즈 제목"
                />
                <h2
                  v-else
                  class="text-2xl font-bold"
                  @contextmenu.prevent="
                    searchInDownloader(
                      seriesDetail?.name || series?.name || '',
                      'series',
                    )
                  "
                >
                  {{ seriesDetail?.name || series?.name }}
                </h2>
                <div class="flex shrink-0 gap-2">
                  <template v-if="isEditing">
                    <Button variant="outline" size="sm" @click="cancelEdit">
                      취소
                    </Button>
                    <Button
                      size="sm"
                      :disabled="updateMutation.isPending.value"
                      @click="saveEdit"
                    >
                      저장
                    </Button>
                  </template>
                  <Button v-else variant="outline" size="sm" @click="startEdit">
                    <Icon icon="solar:pen-bold-duotone" class="mr-2 h-4 w-4" />
                    편집
                  </Button>
                  <Button
                    v-if="!isEditing"
                    variant="destructive"
                    size="sm"
                    @click="showDeleteSeriesDialog = true"
                  >
                    <Icon
                      icon="solar:trash-bin-trash-bold-duotone"
                      class="mr-2 h-4 w-4"
                    />
                    시리즈 삭제
                  </Button>
                </div>
              </div>
              <div class="grid gap-2">
                <MetadataField
                  label="Hitomi ID"
                  icon="solar:hashtag-circle-bold-duotone"
                  :values="seriesHitomiIds"
                  @activate="searchInDownloader($event, 'id')"
                  @search="searchInDownloader($event, 'id')"
                />
                <MetadataField
                  label="작가"
                  icon="solar:user-bold-duotone"
                  :values="seriesArtists"
                  @activate="searchInDownloader($event, 'artist')"
                  @search="searchInDownloader($event, 'artist')"
                />
                <MetadataField
                  label="그룹"
                  icon="solar:users-group-rounded-bold-duotone"
                  :values="seriesGroups"
                  @activate="searchInDownloader($event, 'group')"
                  @search="searchInDownloader($event, 'group')"
                />
                <MetadataField
                  label="태그"
                  icon="solar:tag-bold-duotone"
                  :values="seriesTags"
                  tag-style
                  @activate="searchInDownloader($event, 'tag')"
                  @search="searchInDownloader($event, 'tag')"
                />
                <MetadataField
                  label="캐릭터"
                  icon="solar:user-speak-bold-duotone"
                  :values="seriesCharacters"
                  @activate="searchInDownloader($event, 'character')"
                  @search="searchInDownloader($event, 'character')"
                />
                <MetadataField
                  label="유형"
                  icon="solar:bookmark-bold-duotone"
                  :values="seriesTypes"
                  @activate="searchInDownloader($event, 'type')"
                  @search="searchInDownloader($event, 'type')"
                />
                <MetadataField
                  label="언어"
                  icon="solar:translation-bold-duotone"
                  :values="seriesLanguages"
                  @activate="searchInDownloader($event, 'language')"
                  @search="searchInDownloader($event, 'language')"
                />
              </div>
              <p class="text-muted-foreground text-sm">
                {{ seriesDetail?.description || series?.description || "N/A" }}
              </p>
              <div class="mt-auto flex justify-end gap-2">
                <Button
                  variant="outline"
                  :disabled="!firstBook"
                  @click="openReader(firstBook, 1)"
                >
                  처음부터 보기
                </Button>
                <Button
                  :disabled="!resumeTarget"
                  @click="
                    resumeTarget &&
                    openReader(resumeTarget.book, resumeTarget.page)
                  "
                >
                  이어서 보기
                </Button>
              </div>
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

  <BookDetailDialog
    v-model="showEpisodeDetail"
    :book="selectedEpisode"
    suspend-while-viewing
    @updated="handleEpisodeUpdated"
  />

  <AlertDialog
    :open="showDeleteSeriesDialog"
    @update:open="showDeleteSeriesDialog = $event"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>시리즈를 삭제하시겠습니까?</AlertDialogTitle>
        <AlertDialogDescription>
          시리즈만 삭제합니다. 안에 있던 에피소드와 실제 파일은 삭제하지
          않습니다.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>취소</AlertDialogCancel>
        <AlertDialogAction
          :disabled="deleteSeriesMutation.isPending.value"
          @click="deleteSeriesMutation.mutate()"
        >
          시리즈 삭제
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

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
