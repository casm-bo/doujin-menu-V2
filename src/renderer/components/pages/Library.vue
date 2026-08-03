<script setup lang="ts">
import HelpDialog from "@/components/common/HelpDialog.vue";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useKeybindings } from "@/composable/useKeybindings";
import { useQueryAndParams } from "@/composable/useQueryAndParams";
import { useScrollRestoration } from "@/composable/useScrollRestoration";
import { useLibraryScanStore } from "@/store/libraryScanStore";
import { useUiStore } from "@/store/uiStore";
import { hasOpenDialog } from "@/lib/utils";
import { Icon } from "@iconify/vue";
import PageHeader from "../layout/PageHeader.vue";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/vue-query";
import { debouncedRef, debouncedWatch } from "@vueuse/core";
import {
  computed,
  nextTick,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  toRaw,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import type { Book, FilterParams } from "../../../types/ipc";
import type { SeriesCollectionWithBooks } from "../../../main/db/types";
import {
  deleteBook,
  getRandomBook,
  ipcRenderer,
  openBookFolder,
  runSeriesDetection,
  toggleBookFavorite,
} from "../../api";
import SmartSearchInput from "../common/SmartSearchInput.vue";
import BookCard from "../feature/BookCard.vue";
import BookDetailDialog from "../feature/BookDetailDialog.vue";
import BookPreviewDialog from "../feature/BookPreviewDialog.vue";
import BookRowCard from "../feature/BookRowCard.vue";
import CreateSeriesDialog from "../feature/CreateSeriesDialog.vue";
import SeriesDetailDialog from "../feature/SeriesDetailDialog.vue";
import LibraryScanProgress from "../feature/LibraryScanProgress.vue";
import {
  rectanglesIntersect,
  selectBookRange,
} from "../feature/librarySelection";

const queryClient = useQueryClient();

const uiStore = useUiStore();

const route = useRoute();
const router = useRouter();
const loader = ref(null);
const searchInputRef = ref<InstanceType<typeof SmartSearchInput> | null>(null);

const showBookDetailDialog = ref(false);
const showBookPreviewDialog = ref(false);
const selectedBook = ref<Book | null>(null);
const selectedSeries = ref<SeriesCollectionWithBooks | null>(null);
const showSeriesDetailDialog = ref(false);
const previewBook = ref<Book | null>(null);

// Filter and Sort State
const libraryPath = ref((route.query.libraryPath as string) || "all");
const readStatus = ref<"all" | "read" | "unread">(
  (route.query.readStatus as "all" | "read" | "unread") || "all",
);
const isFavorite = ref((route.query.isFavorite as string) || "all");
const offlineStatus = ref<"all" | "online" | "offline">(
  (route.query.offlineStatus as "all" | "online" | "offline") || "all",
);
const seriesStatus = ref<"all" | "series" | "standalone">(
  (route.query.seriesStatus as "all" | "series" | "standalone") || "all",
);
const sortBy = ref((route.query.sortBy as string) || "added_at");
const sortOrder = ref<"asc" | "desc">(
  (route.query.sortOrder as "asc" | "desc") || "desc",
);
const viewMode = ref<"grid" | "list">("grid");

const { schWord: searchQuery } = useQueryAndParams({
  queries: {
    libraryPath,
    readStatus,
    isFavorite,
    offlineStatus,
    seriesStatus,
    sortBy,
    sortOrder,
  },
  defaultOptions: {
    libraryPath: "all",
    readStatus: "all",
    isFavorite: "all",
    offlineStatus: "all",
    seriesStatus: "all",
    sortBy: "added_at",
    sortOrder: "desc",
  },
});

// 검색어 debounce 적용 (API 호출 최적화)
const debouncedSearchQuery = debouncedRef(searchQuery, 300);

const { data: config, isSuccess: isConfigLoaded } = useQuery({
  queryKey: ["config"],
  queryFn: () => ipcRenderer.invoke("get-config"),
});

// 태그 표시 설정
const hideLibraryTags = computed(() => {
  return config.value?.hideLibraryTags === true;
});

// 설정 초기화 완료 여부를 추적하는 플래그
const isSettingsInitialized = ref(false);

// 설정을 로드하는 공통 함수
const loadSettings = () => {
  if (config.value && config.value.libraryViewSettings) {
    const settings = config.value.libraryViewSettings as {
      sortBy: string;
      sortOrder: "asc" | "desc";
      readStatus: "all" | "read" | "unread";
      viewMode: "grid" | "list";
    };
    const query = route.query;

    // 각 파라미터를 개별적으로 확인하여 URL 쿼리에 없는 것만 설정에서 불러옴
    if (!query.sortBy) {
      sortBy.value = settings.sortBy;
    }
    if (!query.sortOrder) {
      sortOrder.value = settings.sortOrder;
    }
    if (!query.readStatus) {
      readStatus.value = settings.readStatus;
    }
    // viewMode는 URL 쿼리에 포함되지 않으므로 항상 설정에서 불러옴
    viewMode.value = settings.viewMode || "grid";

    // 설정 적용 완료 후 다음 틱에서 플래그 설정 (이후 변경부터 저장)
    nextTick(() => {
      isSettingsInitialized.value = true;
    });
  }
};

// Load settings when config is loaded
watch(
  isConfigLoaded,
  (loaded) => {
    if (loaded) {
      loadSettings();
    }
  },
  { immediate: true },
);

// 다른 페이지로 이동할 때 설정 저장 방지
onDeactivated(() => {
  // 다른 페이지로 이동 시 설정 저장 방지
  isSettingsInitialized.value = false;
});

// keep-alive로 인해 다른 페이지에서 돌아올 때 설정 다시 로드
onActivated(() => {
  // 설정 저장 방지를 위해 플래그 리셋
  isSettingsInitialized.value = false;
  // config가 이미 로드되어 있으면 설정 다시 불러오기
  if (isConfigLoaded.value) {
    loadSettings();
  }
});

// Watch for filter/sort changes and save them
debouncedWatch(
  [sortBy, sortOrder, readStatus, viewMode],
  async () => {
    // 설정이 초기화되기 전의 변경은 저장하지 않음
    if (!isConfigLoaded.value || !isSettingsInitialized.value) return;

    const settings = {
      sortBy: sortBy.value,
      sortOrder: sortOrder.value,
      readStatus: readStatus.value,
      viewMode: viewMode.value,
    };
    await ipcRenderer.invoke("set-config", {
      key: "libraryViewSettings",
      value: settings,
    });
    // 설정 저장 후 config 쿼리 캐시 무효화하여 최신 값 반영
    queryClient.invalidateQueries({ queryKey: ["config"] });
  },
  { debounce: 1000 },
);

const libraryDirectories = computed(
  () => config.value?.libraryFolders || ([] as string[]),
);

const queryKey = computed(
  () =>
    [
      "books",
      {
        searchQuery: debouncedSearchQuery.value,
        libraryPath: libraryPath.value,
        readStatus: readStatus.value,
        offlineStatus: offlineStatus.value,
        seriesStatus: seriesStatus.value,
        sortBy: sortBy.value,
        sortOrder: sortOrder.value,
        isFavorite: isFavorite.value === "favorite",
      },
    ] as const,
);

const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  refetch,
} = useInfiniteQuery({
  queryKey,
  queryFn: async ({ pageParam = 0 }) => {
    const result = await ipcRenderer.invoke("get-books", {
      pageParam,
      pageSize: 50,
      ...queryKey.value[1],
    });
    return result;
  },
  getNextPageParam: (lastPage) => {
    return lastPage.hasNextPage ? lastPage.nextPage : undefined;
  },
  initialPageParam: 0,
  refetchOnWindowFocus: false, // 윈도우 포커스 시 재조회 방지
  refetchOnMount: false, // 컴포넌트 마운트 시 재조회 방지
});

const books = computed(
  () => data.value?.pages.flatMap((page) => page.data) ?? [],
);
const totalCount = computed(() => data.value?.pages[0]?.totalCount ?? 0);
const selectedBookIds = ref<Set<number>>(new Set());
const selectedCount = computed(() => selectedBookIds.value.size);
const orderedSelectedBookIds = computed(() => {
  const visible = new Set(books.value.map((book) => book.id));
  return [
    ...books.value
      .map((book) => book.id)
      .filter((bookId) => selectedBookIds.value.has(bookId)),
    ...[...selectedBookIds.value].filter((bookId) => !visible.has(bookId)),
  ];
});
const isSelectingAll = ref(false);
const allSelected = computed(
  () => totalCount.value > 0 && selectedCount.value === totalCount.value,
);
const showDeleteDialog = ref(false);
const showCreateSeriesDialog = ref(false);
const showSeriesConflictDialog = ref(false);
const replaceExistingSeries = ref(false);
const conflictingSeriesCount = ref(0);
const booksToDelete = ref<number[]>([]);
const selectionAnchorId = ref<number | null>(null);
const dragSelection = ref<{
  startX: number;
  startY: number;
  base: Set<number>;
  surface: HTMLElement;
} | null>(null);
const isDraggingSelection = ref(false);
const suppressSelectionClick = ref(false);
const dragCursor = ref({ x: 0, y: 0 });
const dragSelectionStyle = computed(() => ({
  left: `${Math.min(dragSelection.value?.startX || 0, dragCursor.value.x)}px`,
  top: `${Math.min(dragSelection.value?.startY || 0, dragCursor.value.y)}px`,
  width: `${Math.abs(dragCursor.value.x - (dragSelection.value?.startX || 0))}px`,
  height: `${Math.abs(dragCursor.value.y - (dragSelection.value?.startY || 0))}px`,
}));

const toggleBookSelection = (bookId: number, event?: MouseEvent) => {
  if (
    event?.shiftKey &&
    selectionAnchorId.value !== null &&
    selectedBookIds.value.size > 0
  ) {
    selectedBookIds.value = selectBookRange(
      books.value.map((book) => book.id),
      selectionAnchorId.value,
      bookId,
      selectedBookIds.value,
    );
  } else {
    const next = new Set(selectedBookIds.value);
    if (!next.delete(bookId)) next.add(bookId);
    selectedBookIds.value = next;
  }
  if (selectedBookIds.value.has(bookId)) selectionAnchorId.value = bookId;
  else if (selectedBookIds.value.size === 0) selectionAnchorId.value = null;
};

const handleSelectionPointerDown = (event: PointerEvent) => {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement;
  if (target.closest("button, input, [role='checkbox']")) return;
  dragSelection.value = {
    startX: event.clientX,
    startY: event.clientY,
    base: event.ctrlKey ? new Set(selectedBookIds.value) : new Set(),
    surface: event.currentTarget as HTMLElement,
  };
  dragCursor.value = { x: event.clientX, y: event.clientY };
};

const handleSelectionPointerMove = (event: PointerEvent) => {
  const drag = dragSelection.value;
  if (!drag) return;
  if (!isDraggingSelection.value) {
    if (
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6
    )
      return;
    isDraggingSelection.value = true;
  }
  dragCursor.value = { x: event.clientX, y: event.clientY };
  event.preventDefault();
  const left = Math.min(drag.startX, event.clientX);
  const right = Math.max(drag.startX, event.clientX);
  const top = Math.min(drag.startY, event.clientY);
  const bottom = Math.max(drag.startY, event.clientY);
  const next = new Set(drag.base);
  const selectionRect = { left, right, top, bottom };
  for (const card of Array.from(
    drag.surface.querySelectorAll<HTMLElement>("[data-book-id]"),
  )) {
    const rect = card.getBoundingClientRect();
    if (rectanglesIntersect(selectionRect, rect)) {
      next.add(Number(card.dataset.bookId));
    }
  }
  selectedBookIds.value = next;
};

const handleSelectionPointerUp = () => {
  if (isDraggingSelection.value) {
    suppressSelectionClick.value = true;
    window.setTimeout(() => (suppressSelectionClick.value = false));
    selectionAnchorId.value =
      books.value.find((book) => selectedBookIds.value.has(book.id))?.id ||
      null;
  }
  dragSelection.value = null;
  isDraggingSelection.value = false;
};

const suppressClickAfterDrag = (event: MouseEvent) => {
  if (!suppressSelectionClick.value) return;
  event.preventDefault();
  event.stopPropagation();
};

const clearSelectionOnEscape = (event: KeyboardEvent) => {
  if (
    event.key !== "Escape" ||
    selectedBookIds.value.size === 0 ||
    hasOpenDialog()
  )
    return;
  event.preventDefault();
  event.stopImmediatePropagation();
  selectedBookIds.value = new Set();
  selectionAnchorId.value = null;
};

const prepareCreateSeries = async () => {
  const selected = await Promise.all(
    orderedSelectedBookIds.value.map((bookId) =>
      ipcRenderer.invoke("get-book", bookId),
    ),
  );
  conflictingSeriesCount.value = new Set(
    selected.map((book) => book?.series_collection_id).filter(Boolean),
  ).size;
  replaceExistingSeries.value = conflictingSeriesCount.value > 0;
  if (replaceExistingSeries.value) showSeriesConflictDialog.value = true;
  else showCreateSeriesDialog.value = true;
};

const confirmSeriesReplacement = () => {
  showSeriesConflictDialog.value = false;
  showCreateSeriesDialog.value = true;
};

const toggleAll = async () => {
  if (allSelected.value) {
    selectedBookIds.value = new Set();
    return;
  }
  isSelectingAll.value = true;
  try {
    const result = await ipcRenderer.invoke("get-books", {
      pageParam: 0,
      pageSize: Math.max(totalCount.value, 1),
      ...toRaw(queryKey.value[1]),
    });
    selectedBookIds.value = new Set(result.data.map((book: Book) => book.id));
  } catch (error) {
    toast.error(`전체 선택 실패: ${(error as Error).message}`);
  } finally {
    isSelectingAll.value = false;
  }
};

watch(queryKey, () => {
  selectedBookIds.value = new Set();
  selectionAnchorId.value = null;
});

const deleteMutation = useMutation({
  mutationFn: async (bookIds: number[]) => {
    const failedIds: number[] = [];
    for (const bookId of bookIds) {
      try {
        await deleteBook(bookId);
      } catch {
        failedIds.push(bookId);
      }
    }
    return { deletedCount: bookIds.length - failedIds.length, failedIds };
  },
  onSuccess: ({ deletedCount, failedIds }) => {
    if (failedIds.length > 0) {
      toast.warning(
        `${deletedCount}권 삭제 완료, ${failedIds.length}권 삭제 실패`,
      );
    } else {
      toast.success(`${deletedCount}권을 삭제했습니다.`);
    }
    selectedBookIds.value = new Set(failedIds);
    void queryClient.invalidateQueries({ queryKey: ["books"] });
  },
  onError: (error) => {
    toast.error(`삭제 실패: ${error.message}`);
  },
});

const seriesDetectionMutation = useMutation({
  mutationFn: () => runSeriesDetection(),
  onSuccess: (result) => {
    toast.success(
      `시리즈 자동 생성 완료: ${result?.created_count || 0}개 생성`,
    );
    void queryClient.invalidateQueries({ queryKey: ["books"] });
  },
  onError: (error) => toast.error(`시리즈 자동 생성 실패: ${error.message}`),
});

const handleDeleteSelected = () => {
  if (selectedBookIds.value.size === 0) return;
  booksToDelete.value = [...selectedBookIds.value];
  showDeleteDialog.value = true;
};

const confirmDelete = () => {
  if (booksToDelete.value.length > 0) {
    deleteMutation.mutate([...booksToDelete.value]);
    booksToDelete.value = [];
  }
  showDeleteDialog.value = false;
};

const handleBookDeleted = (bookId: number) => {
  if (!selectedBookIds.value.has(bookId)) return;
  const next = new Set(selectedBookIds.value);
  next.delete(bookId);
  selectedBookIds.value = next;
};

const handleBooksUpdated = () => {
  void queryClient.invalidateQueries({ queryKey: ["books"] });
};

const handleSeriesCreated = () => {
  selectedBookIds.value = new Set();
  void queryClient.invalidateQueries({ queryKey: ["books"] });
};
let stopBooksUpdated = () => {};

onMounted(() => {
  // 라이브러리 스캔 Store 초기화
  const libraryScanStore = useLibraryScanStore();
  libraryScanStore.initialize();

  stopBooksUpdated = ipcRenderer.on("books-updated", handleBooksUpdated);
  window.addEventListener("pointermove", handleSelectionPointerMove);
  window.addEventListener("pointerup", handleSelectionPointerUp);
  window.addEventListener("keydown", clearSelectionOnEscape, true);
});

onUnmounted(() => {
  stopBooksUpdated();
  window.removeEventListener("pointermove", handleSelectionPointerMove);
  window.removeEventListener("pointerup", handleSelectionPointerUp);
  window.removeEventListener("keydown", clearSelectionOnEscape, true);
});

// keep-alive로 캐시된 컴포넌트가 활성화될 때 쿼리 다시 불러오기
onActivated(() => {
  refetch();
});

const observer = shallowRef<IntersectionObserver>();
watch(loader, (newLoaderEl) => {
  observer.value?.disconnect();
  observer.value = new IntersectionObserver((entries) => {
    if (
      entries[0].isIntersecting &&
      hasNextPage.value &&
      !isFetchingNextPage.value
    ) {
      fetchNextPage();
    }
  });

  if (newLoaderEl) {
    observer.value.observe(newLoaderEl);
  }
});

const toggleTag = (tag: string) => {
  const tagTerm = `tag:${tag}`;
  const currentQuery = searchQuery.value.split(" ").filter((s) => s !== "");
  const index = currentQuery.indexOf(tagTerm);

  if (index > -1) {
    currentQuery.splice(index, 1);
  } else {
    currentQuery.push(tagTerm);
  }
  searchQuery.value = currentQuery.join(" ");
};

const excludeTag = (tag: string) => {
  const excludeTerm = `-tag:${tag}`;
  const currentQuery = searchQuery.value.split(" ").filter((s) => s !== "");
  const index = currentQuery.indexOf(excludeTerm);

  if (index > -1) {
    currentQuery.splice(index, 1);
  } else {
    currentQuery.push(excludeTerm);
  }
  searchQuery.value = currentQuery.join(" ");
};

const toggleArtist = (artist: string) => {
  const artistTerm = `artist:${artist}`;
  const currentQuery = searchQuery.value.split(" ").filter((s) => s !== "");
  const index = currentQuery.indexOf(artistTerm);

  if (index > -1) {
    currentQuery.splice(index, 1);
  } else {
    currentQuery.push(artistTerm);
  }
  searchQuery.value = currentQuery.join(" ");
};

const toggleGroup = (group: string) => {
  const groupTerm = `group:${group}`;
  const currentQuery = searchQuery.value.split(" ").filter((s) => s !== "");
  const index = currentQuery.indexOf(groupTerm);

  if (index > -1) {
    currentQuery.splice(index, 1);
  } else {
    currentQuery.push(groupTerm);
  }
  searchQuery.value = currentQuery.join(" ");
};

const setSortBy = (column: string) => {
  sortBy.value = column;
};

const toggleSortOrder = () => {
  sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
};

// 즐겨찾기 필터 토글
const toggleFavoriteFilter = () => {
  isFavorite.value = isFavorite.value === "favorite" ? "all" : "favorite";
  toast.info(isFavorite.value === "favorite" ? "즐겨찾기만 표시" : "전체 표시");
};

// 읽음 상태 순환 (모두 → 읽음 → 안읽음)
const cycleReadStatus = () => {
  const cycle: Record<string, "all" | "read" | "unread"> = {
    all: "read",
    read: "unread",
    unread: "all",
  };
  const labels: Record<string, string> = {
    all: "모두",
    read: "읽음",
    unread: "안읽음",
  };
  readStatus.value = cycle[readStatus.value] || "all";
  toast.info(`읽음 상태: ${labels[readStatus.value]}`);
};

// 라이브러리 폴더 순환 ([ / ] 키)
const cycleLibrary = (direction: 1 | -1) => {
  const dirs = libraryDirectories.value;
  if (dirs.length === 0) return;

  // 현재 선택된 라이브러리의 인덱스 찾기
  const currentIndex =
    libraryPath.value === "all" ? -1 : dirs.indexOf(libraryPath.value);
  // 순환: all(-1) → 0 → 1 → ... → N-1 → all(-1)
  const totalOptions = dirs.length + 1; // all + 각 폴더
  const currentSlot = currentIndex === -1 ? 0 : currentIndex + 1;
  const nextSlot = (currentSlot + direction + totalOptions) % totalOptions;

  libraryPath.value = nextSlot === 0 ? "all" : dirs[nextSlot - 1];
  toast.info(
    libraryPath.value === "all"
      ? "모든 라이브러리"
      : libraryPath.value.split(/[/\\]/).pop() || libraryPath.value,
  );
};

const openRandomBookFromCurrentView = async () => {
  try {
    const randomBook = await getRandomBook(
      toRaw(queryKey.value[1]) as FilterParams,
    );
    if (!randomBook || !randomBook.id) {
      toast.info("현재 검색 조건에 맞는 랜덤 책을 찾을 수 없습니다.");
      return;
    }

    router.push({
      name: "Viewer",
      params: { id: randomBook.id },
      query: {
        filter: JSON.stringify(toRaw(queryKey.value[1])),
      },
    });
  } catch (error) {
    console.error("Failed to get random book:", error);
    toast.error("랜덤 책을 불러오는 데 실패했습니다.");
  }
};

const handleToggleFavorite = async (
  bookId: number,
  currentIsFavorite: boolean,
) => {
  try {
    const newFavoriteStatus = await toggleBookFavorite(
      bookId,
      !currentIsFavorite,
    );
    queryClient.invalidateQueries({ queryKey: ["books"] });
    toast.success(`즐겨찾기 ${newFavoriteStatus ? "추가" : "해제"}되었습니다.`);
  } catch (error) {
    console.error(`Failed to toggle favorite for book ${bookId}:`, error);
    toast.error(
      `즐겨찾기 ${!currentIsFavorite ? "추가" : "해제"}에 실패했습니다.`,
    );
  }
};

const handleOpenFolder = async (bookPath: string) => {
  try {
    await openBookFolder(bookPath);
    toast.success("폴더가 열렸습니다.");
  } catch (error) {
    console.error(`Failed to open folder for book ${bookPath}:`, error);
    toast.error("폴더 열기에 실패했습니다.");
  }
};

const handleShowDetails = (book: Book) => {
  selectedBook.value = book;
  showBookDetailDialog.value = true;
};

const handleShowSeries = (book: Book) => {
  if (!book.series_collection_id) return;
  selectedSeries.value = {
    id: book.series_collection_id,
    name: book.series_collection_name || book.title,
    description: book.series_collection_description || null,
    cover_image: book.cover_path || null,
    is_auto_generated: false,
    is_manually_edited: false,
    confidence_score: 0,
    created_at: book.added_at || "",
    updated_at: book.added_at || "",
    books: [],
    book_count: Number(book.series_book_count || 0),
  };
  showSeriesDetailDialog.value = true;
};

const handleShowPreview = (book: Book) => {
  previewBook.value = book;
  showBookPreviewDialog.value = true;
};

// 라이브러리 단축키 등록
useKeybindings("library", {
  "library:search-focus": () => {
    searchInputRef.value?.focus();
  },
  "library:sort-order-toggle": () => {
    toggleSortOrder();
  },
  "library:quit-app": () => {
    ipcRenderer.send("close-window");
  },
  "library:toggle-favorite": toggleFavoriteFilter,
  "library:cycle-read-status": cycleReadStatus,
  "library:prev-library": () => cycleLibrary(-1),
  "library:next-library": () => cycleLibrary(1),
});

// Ctrl+Wheel로 썸네일 줌 조절
const gridRef = ref<HTMLElement | null>(null);

const handleGridWheel = (event: WheelEvent) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  if (event.deltaY < 0) {
    uiStore.zoomIn();
  } else {
    uiStore.zoomOut();
  }
};

// 썸네일 그리드 스타일 (줌 + auto-fill로 카드 자체가 작아짐)
const gridStyle = computed(() => ({
  zoom: uiStore.thumbnailZoom,
  gridTemplateColumns: "repeat(auto-fill, minmax(184px, 1fr))",
}));

// 스크롤 위치 복원
useScrollRestoration(".flex-grow.overflow-y-auto");
</script>

<template>
  <div class="flex h-full flex-col gap-6">
    <div class="flex flex-col gap-2">
      <!-- 스캔 진행률 표시 -->
      <LibraryScanProgress />

      <PageHeader icon="solar:library-bold-duotone" title="라이브러리">
        <template #help>
          <HelpDialog
            title="라이브러리 도움말"
            description="라이브러리 사용법 및 검색 팁"
          >
            <template #trigger>
              <Button variant="ghost" size="icon">
                <Icon
                  icon="solar:question-circle-bold-duotone"
                  class="h-6 w-6"
                />
              </Button>
            </template>
            <div class="text-muted-foreground space-y-4 text-sm">
              <p>
                이 화면에서는 추가된 만화책들을 관리하고 열람할 수 있습니다.
              </p>
              <h3 class="text-foreground text-base font-semibold">
                키보드 단축키
              </h3>
              <ul class="list-inside list-disc">
                <li><kbd>Ctrl</kbd>+<kbd>F</kbd>: 검색창 포커스</li>
                <li><kbd>S</kbd>: 정렬 순서 전환 (오름차순/내림차순)</li>
                <li><kbd>F</kbd>: 즐겨찾기 필터 토글</li>
                <li><kbd>R</kbd>: 읽음 상태 순환 (모두→읽음→안읽음)</li>
                <li><kbd>[</kbd> / <kbd>]</kbd>: 이전/다음 라이브러리 폴더</li>
                <li><kbd>Ctrl</kbd>+<kbd>Wheel</kbd>: 썸네일 밀도 조절</li>
              </ul>
              <h3 class="text-foreground text-base font-semibold">검색 팁</h3>
              <ul class="list-inside list-disc">
                <li>
                  <kbd>Ctrl</kbd>+<kbd>F</kbd>로 검색창에 빠르게 포커스할 수
                  있습니다.
                </li>
                <li>
                  검색창에 제목, 작가, 태그, 시리즈를 입력하여 검색할 수
                  있습니다.
                </li>
                <li><code>tag:태그명</code>: 특정 태그로 검색합니다.</li>
                <li><code>artist:작가명</code>: 특정 작가로 검색합니다.</li>
                <li><code>series:시리즈명</code>: 특정 시리즈로 검색합니다.</li>
                <li>여러 검색어를 공백으로 구분하여 조합할 수 있습니다.</li>
              </ul>
              <h3 class="text-foreground text-base font-semibold">
                필터 및 정렬
              </h3>
              <ul class="list-inside list-disc">
                <li>
                  더보기 메뉴에서 특정 라이브러리 폴더의 책만 볼 수 있습니다.
                </li>
                <li>
                  뷰어에서 이전/다음 책으로 이동 시, 라이브러리 화면에서
                  적용했던 검색 및 필터 조건이 유지됩니다.
                </li>
                <li>
                  <Icon
                    icon="solar:filter-bold-duotone"
                    class="inline-block h-4 w-4 align-text-bottom"
                  />
                  버튼을 클릭하여 읽음 상태 및 즐겨찾기 여부로 필터링할 수
                  있습니다.
                </li>
                <li>
                  <Icon
                    icon="solar:sort-bold-duotone"
                    class="inline-block h-4 w-4 align-text-bottom"
                  />
                  버튼을 클릭하여 다양한 기준으로 정렬할 수 있습니다.
                </li>
              </ul>
              <h3 class="text-foreground text-base font-semibold">책 관리</h3>
              <ul class="list-inside list-disc">
                <li>책 카드를 클릭하여 뷰어를 열 수 있습니다.</li>
                <li>
                  책 카드를 <code>Ctrl</code>+클릭하거나 우클릭 메뉴의 '새
                  창으로 열기'를 선택하여 뷰어를 새 창에서 열 수 있습니다.
                </li>
                <li>
                  책 카드 우클릭 메뉴를 통해 폴더 열기, 즐겨찾기 추가/해제 등의
                  작업을 할 수 있습니다.
                </li>
              </ul>
              <h3 class="text-foreground text-base font-semibold">미리보기</h3>
              <ul class="list-inside list-disc">
                <li>
                  그리드 뷰에서 책 카드를 우클릭하여 '미리보기' 메뉴를 선택하면
                  페이지를 미리볼 수 있습니다.
                </li>
                <li>
                  리스트 뷰에서는 미리보기 버튼을 클릭하여 페이지를 미리볼 수
                  있습니다.
                </li>
                <li>
                  미리보기에서는 책의 모든 페이지를 가로 스크롤로 확인할 수
                  있습니다.
                </li>
              </ul>
            </div>
          </HelpDialog>
        </template>
        <template #actions>
          <Button
            variant="outline"
            :disabled="seriesDetectionMutation.isPending.value"
            @click="seriesDetectionMutation.mutate()"
          >
            <Icon
              icon="solar:magic-stick-3-bold-duotone"
              class="h-5 w-5"
              :class="{
                'animate-spin': seriesDetectionMutation.isPending.value,
              }"
            />
            시리즈 자동 생성
          </Button>
          <Button
            variant="outline"
            :disabled="selectedCount < 2"
            @click="prepareCreateSeries"
          >
            <Icon icon="solar:add-circle-bold-duotone" class="h-5 w-5" />
            시리즈 추가 ({{ selectedCount }})
          </Button>
          <Button
            variant="secondary"
            size="icon"
            @click="router.push('/settings?tab=library')"
          >
            <Icon icon="solar:settings-bold-duotone" class="h-6 w-6" />
          </Button>
        </template>
      </PageHeader>
    </div>

    <!-- 콘텐츠 -->
    <div class="flex min-h-0 flex-1 flex-col gap-4">
      <!-- 검색 및 필터 영역 -->
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          :disabled="totalCount === 0 || isSelectingAll"
          @click="toggleAll"
        >
          <Icon
            :icon="
              allSelected
                ? 'solar:close-square-bold-duotone'
                : 'solar:check-square-bold-duotone'
            "
            class="mr-2 h-4 w-4"
          />
          {{ allSelected ? "선택 해제" : "전체 선택" }}
        </Button>
        <Button
          variant="destructive"
          :disabled="selectedCount === 0 || deleteMutation.isPending.value"
          @click="handleDeleteSelected"
        >
          <Icon
            icon="solar:trash-bin-trash-bold-duotone"
            class="mr-2 h-4 w-4"
          />
          선택 삭제 ({{ selectedCount }})
        </Button>
        <SmartSearchInput
          ref="searchInputRef"
          v-model="searchQuery"
          placeholder="제목, 작가, 태그, 시리즈로 검색"
          class="min-w-64 flex-[1_1_24rem]"
        />
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline">
              <Icon icon="solar:filter-bold-duotone" class="h-4 w-4" />
              필터
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-56">
            <DropdownMenuLabel>읽음 상태</DropdownMenuLabel>
            <DropdownMenuRadioGroup v-model="readStatus">
              <DropdownMenuRadioItem value="all">모두</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="read">읽음</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="unread"
                >안 읽음</DropdownMenuRadioItem
              >
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>즐겨찾기</DropdownMenuLabel>
            <DropdownMenuRadioGroup v-model="isFavorite">
              <DropdownMenuRadioItem value="all">모두</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="favorite"
                >즐겨찾기만</DropdownMenuRadioItem
              >
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>시리즈</DropdownMenuLabel>
            <DropdownMenuRadioGroup v-model="seriesStatus">
              <DropdownMenuRadioItem value="all">모두</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="series"
                >시리즈만</DropdownMenuRadioItem
              >
              <DropdownMenuRadioItem value="standalone"
                >시리즈 제외</DropdownMenuRadioItem
              >
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>오프라인 상태</DropdownMenuLabel>
            <DropdownMenuRadioGroup v-model="offlineStatus">
              <DropdownMenuRadioItem value="all">모두</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="online"
                >온라인만</DropdownMenuRadioItem
              >
              <DropdownMenuRadioItem value="offline"
                >오프라인만</DropdownMenuRadioItem
              >
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div class="inline-flex">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" class="rounded-r-none">
                <Icon icon="solar:sort-bold-duotone" class="h-4 w-4" />
                정렬
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>정렬 기준</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem @click="setSortBy('title')">
                제목
                <Icon
                  v-if="sortBy === 'title'"
                  icon="solar:check-circle-bold-duotone"
                  class="ml-auto h-4 w-4"
                />
              </DropdownMenuItem>
              <DropdownMenuItem @click="setSortBy('added_at')">
                추가된 날짜
                <Icon
                  v-if="sortBy === 'added_at'"
                  icon="solar:check-circle-bold-duotone"
                  class="ml-auto h-4 w-4"
                />
              </DropdownMenuItem>
              <DropdownMenuItem @click="setSortBy('last_read_at')">
                최근 읽음
                <Icon
                  v-if="sortBy === 'last_read_at'"
                  icon="solar:check-circle-bold-duotone"
                  class="ml-auto h-4 w-4"
                />
              </DropdownMenuItem>
              <DropdownMenuItem @click="setSortBy('artists')">
                작가
                <Icon
                  v-if="sortBy === 'artists'"
                  icon="solar:check-circle-bold-duotone"
                  class="ml-auto h-4 w-4"
                />
              </DropdownMenuItem>
              <DropdownMenuItem @click="setSortBy('page_count')">
                페이지 수
                <Icon
                  v-if="sortBy === 'page_count'"
                  icon="solar:check-circle-bold-duotone"
                  class="ml-auto h-4 w-4"
                />
              </DropdownMenuItem>
              <DropdownMenuItem @click="setSortBy('hitomi_id')">
                Hitomi ID
                <Icon
                  v-if="sortBy === 'hitomi_id'"
                  icon="solar:check-circle-bold-duotone"
                  class="ml-auto h-4 w-4"
                />
              </DropdownMenuItem>
              <DropdownMenuItem @click="setSortBy('random')">
                랜덤
                <Icon
                  v-if="sortBy === 'random'"
                  icon="solar:check-circle-bold-duotone"
                  class="ml-auto h-4 w-4"
                />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            class="rounded-l-none border-l-0"
            :disabled="sortBy === 'random'"
            @click="toggleSortOrder"
          >
            <Icon
              v-if="sortOrder === 'asc'"
              icon="solar:sort-from-bottom-to-top-bold-duotone"
              class="h-4 w-4"
            />
            <Icon
              v-else
              icon="solar:sort-from-top-to-bottom-bold-duotone"
              class="h-4 w-4"
            />
          </Button>
        </div>
        <Button
          variant="outline"
          :disabled="books.length === 0"
          @click="openRandomBookFromCurrentView"
        >
          <Icon icon="solar:rocket-bold-duotone" class="h-4 w-4" />
          랜덤
        </Button>
        <!-- 보기 메뉴: 라이브러리 폴더 / 뷰 모드 / 썸네일 줌 -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline">
              <Icon icon="solar:menu-dots-bold" class="h-4 w-4" />
              보기
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-64">
            <DropdownMenuLabel>라이브러리 폴더</DropdownMenuLabel>
            <DropdownMenuRadioGroup v-model="libraryPath">
              <DropdownMenuRadioItem value="all">
                모든 라이브러리
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                v-for="dir in libraryDirectories"
                :key="dir"
                :value="dir"
                class="truncate"
              >
                <span class="truncate" :title="dir">{{ dir }}</span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>뷰 모드</DropdownMenuLabel>
            <DropdownMenuRadioGroup v-model="viewMode">
              <DropdownMenuRadioItem value="grid">
                <Icon icon="solar:widget-4-bold-duotone" class="mr-2 h-4 w-4" />
                그리드
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="list">
                <Icon icon="solar:list-bold-duotone" class="mr-2 h-4 w-4" />
                리스트
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>썸네일 크기</DropdownMenuLabel>
            <div
              class="flex items-center justify-between px-2 py-1.5"
              :class="viewMode !== 'grid' ? 'opacity-50' : ''"
            >
              <Button
                variant="outline"
                size="icon"
                class="h-7 w-7"
                :disabled="viewMode !== 'grid'"
                @click.stop="uiStore.zoomOut()"
              >
                <Icon icon="solar:minus-circle-bold-duotone" class="h-4 w-4" />
              </Button>
              <span class="text-xs tabular-nums">
                {{ Math.round(uiStore.thumbnailZoom * 100) }}%
              </span>
              <Button
                variant="outline"
                size="icon"
                class="h-7 w-7"
                :disabled="viewMode !== 'grid'"
                @click.stop="uiStore.zoomIn()"
              >
                <Icon icon="solar:add-circle-bold-duotone" class="h-4 w-4" />
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        v-if="isLoading"
        class="flex flex-grow flex-col items-center justify-center text-center"
      >
        <div
          class="text-muted-foreground mb-4 flex flex-col items-center justify-center gap-2 text-lg"
        >
          <Icon icon="svg-spinners:ring-resize" class="size-8" />
          <p>로딩중...</p>
        </div>
      </div>
      <!-- Grid View -->
      <div
        v-else-if="books.length > 0 && viewMode === 'grid'"
        ref="gridRef"
        class="grid flex-grow items-start gap-3 overflow-y-auto"
        :style="gridStyle"
        :class="{
          'cursor-crosshair select-none': isDraggingSelection,
        }"
        @pointerdown="handleSelectionPointerDown"
        @click.capture="suppressClickAfterDrag"
        @wheel="handleGridWheel"
      >
        <BookCard
          v-for="book in books"
          :key="book.id"
          :book="book"
          :query-key="queryKey"
          :hide-tags="hideLibraryTags"
          :external-image-viewer-path="config?.externalImageViewerPath"
          :external-archive-viewer-path="config?.externalArchiveViewerPath"
          :selected="selectedBookIds.has(book.id)"
          @select-tag="toggleTag"
          @exclude-tag="excludeTag"
          @select-artist="toggleArtist"
          @select-group="toggleGroup"
          @toggle-favorite="handleToggleFavorite"
          @open-book-folder="handleOpenFolder"
          @show-details="handleShowDetails"
          @show-series="handleShowSeries"
          @show-preview="handleShowPreview"
          @toggle-select="toggleBookSelection(book.id, $event)"
          @deleted="handleBookDeleted"
        />
        <div
          v-if="hasNextPage"
          ref="loader"
          class="col-span-full p-4 text-center"
        >
          <Button :disabled="isFetchingNextPage" @click="fetchNextPage">
            <Icon v-if="isFetchingNextPage" icon="svg-spinners:ring-resize" />
            <span>더 불러오기</span>
          </Button>
        </div>
      </div>
      <!-- List View -->
      <div
        v-else-if="books.length > 0 && viewMode === 'list'"
        class="flex flex-grow flex-col overflow-y-auto"
        :class="{
          'cursor-crosshair select-none': isDraggingSelection,
        }"
        @pointerdown="handleSelectionPointerDown"
        @click.capture="suppressClickAfterDrag"
      >
        <BookRowCard
          v-for="book in books"
          :key="book.id"
          :book="book"
          :query-key="queryKey"
          :hide-tags="hideLibraryTags"
          :selected="selectedBookIds.has(book.id)"
          @select-tag="toggleTag"
          @exclude-tag="excludeTag"
          @select-artist="toggleArtist"
          @select-group="toggleGroup"
          @toggle-favorite="handleToggleFavorite"
          @open-book-folder="handleOpenFolder"
          @show-details="handleShowDetails"
          @show-series="handleShowSeries"
          @show-preview="handleShowPreview"
          @toggle-select="toggleBookSelection(book.id, $event)"
          @deleted="handleBookDeleted"
        />
        <div v-if="hasNextPage" ref="loader" class="p-4 text-center">
          <Button :disabled="isFetchingNextPage" @click="fetchNextPage">
            <Icon v-if="isFetchingNextPage" icon="svg-spinners:ring-resize" />
            <span>더 불러오기</span>
          </Button>
        </div>
      </div>
      <div
        v-else-if="searchQuery.trim().length > 0"
        class="flex flex-grow flex-col items-center justify-center text-center"
      >
        <div
          class="text-muted-foreground mb-4 flex flex-col items-center justify-center gap-2 text-lg"
        >
          <p>검색된 데이터가 없습니다.</p>
        </div>
      </div>
      <div
        v-else
        class="flex flex-grow flex-col items-center justify-center text-center"
      >
        <div
          class="text-muted-foreground mb-4 flex flex-col items-center justify-center text-lg"
        >
          <p>등록된 라이브러리/책이 없습니다.</p>
          <p class="flex items-center justify-center gap-1">
            <Button
              variant="secondary"
              size="icon"
              @click="router.push('/settings?tab=library')"
            >
              <Icon icon="solar:settings-bold-duotone" class="h-5 w-5" />
            </Button>
            <span>버튼을 눌러 설정화면으로 이동하세요.</span>
          </p>
        </div>
      </div>
    </div>

    <BookDetailDialog
      v-model="showBookDetailDialog"
      :book="selectedBook"
      :on-toggle-favorite="handleToggleFavorite"
      :on-open-folder="handleOpenFolder"
      @updated="handleBooksUpdated"
    />
    <div
      v-if="isDraggingSelection"
      class="border-primary bg-primary/15 pointer-events-none fixed z-[100] border"
      :style="dragSelectionStyle"
    />
    <CreateSeriesDialog
      v-model:open="showCreateSeriesDialog"
      :book-ids="orderedSelectedBookIds"
      :replace-existing-series="replaceExistingSeries"
      @created="handleSeriesCreated"
    />

    <AlertDialog
      :open="showSeriesConflictDialog"
      @update:open="showSeriesConflictDialog = $event"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>기존 시리즈를 해체하시겠습니까?</AlertDialogTitle>
          <AlertDialogDescription>
            선택한 작품이 속한 기존 시리즈 {{ conflictingSeriesCount }}개는
            자동으로 해체·삭제됩니다. 에피소드와 실제 파일은 삭제되지 않으며,
            선택한 순서로 새 시리즈를 만듭니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction @click="confirmSeriesReplacement">
            계속
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <SeriesDetailDialog
      :open="showSeriesDetailDialog"
      :series="selectedSeries"
      @update:open="showSeriesDetailDialog = $event"
      @updated="handleBooksUpdated"
    />

    <BookPreviewDialog
      :open="showBookPreviewDialog"
      :book="previewBook"
      @update:open="showBookPreviewDialog = $event"
    />

    <AlertDialog
      :open="showDeleteDialog"
      @update:open="showDeleteDialog = $event"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>책 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            선택한 {{ booksToDelete.length }}권을 삭제하시겠습니까?
            데이터베이스에서 제거되고 원본 파일은 휴지통으로 이동합니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction @click="confirmDelete">삭제</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
