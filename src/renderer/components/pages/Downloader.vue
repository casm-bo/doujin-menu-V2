<script setup lang="ts">
import {
  getPresentation,
  enterSubscriptionTab,
  ipcRenderer,
  refreshSubscriptions,
} from "@/api";
import HelpDialog from "@/components/common/HelpDialog.vue"; // HelpDialog 임포트
import SmartSearchInput from "@/components/common/SmartSearchInput.vue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useKeybindings } from "@/composable/useKeybindings";
import { useScrollRestoration } from "@/composable/useScrollRestoration";
import { useSearchPersistence } from "@/composable/useSearchPersistence";
import { useDownloadQueueStore } from "@/store/downloadQueueStore";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { useUiStore } from "@/store/uiStore";
import { Icon } from "@iconify/vue";
import PageHeader from "../layout/PageHeader.vue";
import { applyGalleryPresentation } from "../../../types/presentationGallery";
import { useInfiniteQuery, useQueryClient } from "@tanstack/vue-query";
import type { HitomiGalleryDetails } from "../../../types/hitomi.js";
import { AcceptableValue } from "reka-ui";
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";

const uiStore = useUiStore();
const queryClient = useQueryClient();
const stopPresentationUpdates = ipcRenderer.on(
  "presentation-updated",
  async (key: unknown) => {
    if (typeof key !== "string") return;
    if (!key.startsWith("hitomi:")) return;
    const value = await getPresentation(key).catch(() => null);
    if (!value) return;
    queryClient.setQueriesData<{
      pages: { galleries: HitomiGalleryDetails[]; nextPage?: number }[];
      pageParams: number[];
    }>({ queryKey: ["galleries"] }, (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              galleries: page.galleries.map((gallery) =>
                applyGalleryPresentation(gallery, value),
              ),
            })),
          }
        : old,
    );
    if (selectedGallery.value)
      selectedGallery.value = applyGalleryPresentation(
        selectedGallery.value,
        value,
      );
  },
);

// 썸네일 그리드 줌 스타일
const downloaderGridStyle = computed(() => ({
  zoom: uiStore.thumbnailZoom,
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
}));

// Ctrl+Wheel로 썸네일 줌 조절
const handleGridWheel = (event: WheelEvent) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  if (event.deltaY < 0) {
    uiStore.zoomIn();
  } else {
    uiStore.zoomOut();
  }
};
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import PresetDropdown from "../common/PresetDropdown.vue";
import GalleryPreviewDialog from "../feature/downloader/GalleryPreviewDialog.vue";
import GalleryRowCard from "../feature/downloader/GalleryRowCard.vue";
import GalleryThumbnailCard from "../feature/downloader/GalleryThumbnailCard.vue";
import SubscriptionToolbar from "../feature/downloader/SubscriptionToolbar.vue";

// 검색어 상태
const searchQuery = ref("");
const downloaderLanguage = ref("korean");
type Popularity = "none" | "day" | "week" | "month" | "year";
const downloaderPopularity = ref<Popularity>("none");

const languageOptions = [
  { value: "all", label: "전체 언어" },
  { value: "korean", label: "한국어" },
  { value: "japanese", label: "일본어" },
  { value: "english", label: "영어" },
  { value: "chinese", label: "중국어" },
];

const popularityOptions = [
  { value: "none", label: "기본순" },
  { value: "day", label: "일간 인기" },
  { value: "week", label: "주간 인기" },
  { value: "month", label: "월간 인기" },
  { value: "year", label: "연간 인기" },
] satisfies { value: Popularity; label: string }[];

const isPopularity = (value: unknown): value is Popularity =>
  popularityOptions.some((option) => option.value === value);

// 뷰 모드 상태 ("grid": 썸네일, "list": 리스트)
const viewMode = ref<"grid" | "list">(
  (localStorage.getItem("downloaderViewMode") as "grid" | "list") || "list",
);

// ToggleGroup의 선택 해제 방지
const handleViewModeChange = (value: AcceptableValue | AcceptableValue[]) => {
  if (
    value &&
    typeof value === "string" &&
    (value === "grid" || value === "list")
  ) {
    viewMode.value = value;
    localStorage.setItem("downloaderViewMode", value);
  }
};

// 각 갤러리 ID별 다운로드 상태를 저장하는 객체
const downloadStatuses = reactive<{
  [key: number]: {
    status: string;
    progress?: number;
    error?: string;
    bookId?: number | null;
  };
}>({});

// 다운로드 큐 store
const downloadQueueStore = useDownloadQueueStore();
const subscriptionStore = useSubscriptionStore();

const searchKey = ref(0); // 검색 트리거를 위한 키
const subscriptionKey = ref(1);
const activeSource = ref<"search" | "subscription">("search");
const blacklistCount = ref(0);
const sourceKey = computed(() =>
  activeSource.value === "subscription"
    ? subscriptionKey.value
    : searchKey.value,
);

// 미리보기 다이얼로그 관련 상태
const isPreviewDialogOpen = ref(false);
const selectedGallery = ref<HitomiGalleryDetails | null>(null);

const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  isError,
  error,
} = useInfiniteQuery({
  queryKey: ["galleries", activeSource, sourceKey],
  queryFn: async ({ pageParam = 1 }) => {
    const finalSearchQuery =
      downloaderLanguage.value !== "all"
        ? `language:${downloaderLanguage.value} ${searchQuery.value}`
        : searchQuery.value;

    const query = {
      searchQuery: finalSearchQuery.trim(),
      offset: 0,
      popularityOrderBy:
        downloaderPopularity.value === "none" ? "" : downloaderPopularity.value,
    };
    const result =
      activeSource.value === "subscription"
        ? await ipcRenderer.invoke("get-subscription-feed", {
            start: (pageParam - 1) * 30,
            count: 30,
          })
        : await ipcRenderer.invoke("search-galleries", {
            query,
            page: pageParam,
          });

    if (result.success && result.data) {
      const galleryDetailsPromises = result.data.map((id: number) =>
        ipcRenderer.invoke("get-gallery-details", id),
      );
      const detailResults = (await Promise.all(galleryDetailsPromises)) as {
        success: boolean;
        data: HitomiGalleryDetails;
      }[];
      return {
        galleries: detailResults
          .filter((res) => res.success)
          .map((res) => res.data),
        nextPage:
          ("hasNextPage" in result && result.hasNextPage) ||
          (result.total !== undefined && pageParam * 30 < result.total)
            ? pageParam + 1
            : undefined,
      };
    } else {
      throw new Error(result.error || "검색 실패");
    }
  },
  getNextPageParam: (lastPage) => lastPage.nextPage,
  initialPageParam: 1,
  enabled: computed(
    () => activeSource.value === "subscription" || searchKey.value > 0,
  ),
});

const allGalleries = computed(() => {
  return data.value?.pages?.flatMap((page) => page.galleries) || [];
});

// Intersection Observer 설정
const observerTarget = ref(null);
let observer: IntersectionObserver | null = null;

const handleSelectGallery = (gallery: HitomiGalleryDetails) => {
  selectedGallery.value = gallery;
  if (activeSource.value === "subscription")
    void ipcRenderer.invoke("mark-subscription-read", {
      galleryId: gallery.id,
    });
};

const handleBookDeleted = (galleryId: number) => {
  // 삭제된 책의 다운로드 상태 초기화
  delete downloadStatuses[galleryId];
};

// 다운로더 단축키 등록 (미리보기 토글)
useKeybindings("downloader", {
  "downloader:preview-toggle": () => {
    if (selectedGallery.value) {
      isPreviewDialogOpen.value = !isPreviewDialogOpen.value;
    }
  },
});

// 큐 상태를 downloadStatuses에 반영하는 함수
const syncQueueToStatuses = () => {
  // 현재 큐에 있는 갤러리 ID 목록
  const queueGalleryIds = new Set(
    downloadQueueStore.queue.map((item) => item.gallery_id),
  );

  // 큐에서 제거된 상태는 지웁니다. 라이브러리 등록 여부는 각 카드가 별도로 확인합니다.
  Object.keys(downloadStatuses).forEach((galleryIdStr) => {
    const galleryId = Number(galleryIdStr);
    if (!queueGalleryIds.has(galleryId)) {
      delete downloadStatuses[galleryId];
    }
  });

  // 큐에 있는 항목들을 downloadStatuses에 업데이트
  downloadQueueStore.queue.forEach((queueItem) => {
    // 큐의 상태를 downloadStatuses에 매핑
    let mappedStatus: string = queueItem.status;

    // downloading -> progress로 매핑
    if (queueItem.status === "downloading") {
      mappedStatus = "progress";
    }

    const currentStatus = downloadStatuses[queueItem.gallery_id];
    downloadStatuses[queueItem.gallery_id] = {
      status: mappedStatus,
      progress: queueItem.progress,
      error: queueItem.error_message,
      bookId: currentStatus?.bookId,
    };
  });
};

const handleDownloadProgress = (...args: unknown[]) => {
  const { galleryId, status, progress, error, bookId } = args[0] as {
    galleryId: number;
    status: string;
    progress?: number;
    error?: string;
    bookId?: number | null;
  };
  downloadStatuses[galleryId] = {
    status,
    progress,
    error,
    bookId: bookId ?? downloadStatuses[galleryId]?.bookId,
  };

  if (status === "completed") {
    const completedGallery = allGalleries.value.find(
      (gallery) => gallery.id === galleryId,
    );
    if (completedGallery) {
      toast.success(
        `${completedGallery.title.display}이(가) 다운로드되었습니다.`,
      );
    }
  } else if (status === "failed") {
    toast.error("다운로드 실패", {
      description: error || "다운로드 중 오류가 발생했습니다.",
    });
  }
};

const handleDownloadQueueUpdated = () => {
  void downloadQueueStore.fetchQueue().then(syncQueueToStatuses);
};
let stopDownloadProgress = () => {};
let stopDownloadQueueUpdated = () => {};

onMounted(() => {
  // 다운로드 큐 store 초기화
  downloadQueueStore.initialize();

  // 초기 큐 상태 동기화
  syncQueueToStatuses();

  observer = new IntersectionObserver(
    (entries) => {
      if (
        entries[0].isIntersecting &&
        hasNextPage.value &&
        !isFetchingNextPage.value
      ) {
        fetchNextPage();
      }
    },
    { threshold: 0.1 },
  );
  if (observerTarget.value) {
    observer.observe(observerTarget.value);
  }

  // 다운로드 진행 상황 수신
  stopDownloadProgress = ipcRenderer.on(
    "download-progress",
    handleDownloadProgress,
  );

  // 큐 업데이트 이벤트 수신 (큐 상태가 변경되면 downloadStatuses에 반영)
  stopDownloadQueueUpdated = ipcRenderer.on(
    "download-queue-updated",
    handleDownloadQueueUpdated,
  );

  // 저장된 언어 설정 불러오기
  ipcRenderer.invoke("get-config-value", "downloaderLanguage").then((lang) => {
    if (lang) {
      downloaderLanguage.value = lang as string;
    }
  });
  ipcRenderer
    .invoke("get-config-value", "downloaderPopularity")
    .then((popularity) => {
      downloaderPopularity.value = isPopularity(popularity)
        ? popularity
        : "none";
    });
  ipcRenderer.invoke("get-config").then((config) => {
    blacklistCount.value = Array.isArray(config.downloaderBlacklistTags)
      ? config.downloaderBlacklistTags.length
      : 0;
  });
});

onUnmounted(() => {
  stopPresentationUpdates();
  if (observer) {
    observer.disconnect();
  }

  // 큐 store cleanup
  downloadQueueStore.cleanup();
  stopDownloadProgress();
  stopDownloadQueueUpdated();
});

watch(observerTarget, (newTarget) => {
  if (observer) {
    observer.disconnect();
    if (newTarget) {
      observer.observe(newTarget);
    }
  }
});

const handleSearch = async () => {
  activeSource.value = "search";
  searchKey.value++;
};

const changeSource = async (source: "search" | "subscription") => {
  activeSource.value = source;
  selectedGallery.value = null;
  if (source !== "subscription") return;

  await enterSubscriptionTab();
  subscriptionKey.value++;
  await subscriptionStore.refreshStatus();
};

const refreshSubscriptionFeed = async () => {
  await refreshSubscriptions();
  subscriptionKey.value++;
  await subscriptionStore.refreshStatus();
};

const handleSubscriptionsChanged = async () => {
  subscriptionKey.value++;
  await subscriptionStore.refreshStatus();
};

watch(
  () => subscriptionStore.feedGeneration,
  () => {
    if (activeSource.value === "subscription") subscriptionKey.value++;
  },
);

const handleLanguageChange = async (lang: AcceptableValue) => {
  if (!lang) return;
  downloaderLanguage.value = lang as string;
  await ipcRenderer.invoke("set-config", {
    key: "downloaderLanguage",
    value: lang,
  });
  // 언어 변경 시 즉시 검색 다시 실행
  if (searchQuery.value) {
    handleSearch();
  }
};

const handlePopularityChange = async (value: AcceptableValue) => {
  if (!isPopularity(value)) return;
  downloaderPopularity.value = value;
  await ipcRenderer.invoke("set-config", {
    key: "downloaderPopularity",
    value: value === "none" ? "" : value,
  });
  if (searchKey.value > 0) handleSearch();
};

const router = useRouter();

const goToSettings = () => {
  router.push({ path: "/settings", query: { tab: "downloader" } });
};

// 스크롤 위치 복원 (다운로더는 flex-1 사용)
useScrollRestoration(".flex-1.overflow-y-auto");

// 검색어 저장/복원
useSearchPersistence(searchQuery, "downloader-search-query");
</script>

<template>
  <div class="flex h-full flex-col gap-6">
    <PageHeader icon="solar:download-square-bold-duotone" title="다운로더">
      <template #help>
        <HelpDialog
          title="다운로더 도움말"
          description="다운로더 사용법 및 검색 팁"
        >
          <template #trigger>
            <Button variant="ghost" size="icon">
              <Icon icon="solar:question-circle-bold-duotone" class="h-6 w-6" />
            </Button>
          </template>
          <div class="text-muted-foreground space-y-4 text-sm">
            <p>
              이 화면에서는 Hitomi.la에서 작품을 검색하고 다운로드할 수
              있습니다.
            </p>
            <h3 class="text-foreground text-base font-semibold">검색 팁</h3>
            <ul class="list-inside list-disc">
              <li>
                <Icon
                  icon="solar:global-bold-duotone"
                  class="inline-block h-4 w-4 align-text-bottom"
                />
                언어 설정을 통해 검색할 작품의 언어를 지정할 수 있습니다.
              </li>
              <li>
                <Icon
                  icon="solar:bookmark-bold-duotone"
                  class="inline-block h-4 w-4 align-text-bottom"
                />
                버튼을 클릭하여 저장된 프리셋 검색어를 사용할 수 있습니다.
              </li>
              <li><code>id:12345</code>: 특정 갤러리 ID로 검색합니다.</li>
              <li>
                <code>artist:작가명</code>: 특정 작가의 작품을 검색합니다.
              </li>
              <li>
                <code>태그명</code>: 특정 태그가 포함된 작품을 검색합니다. (예:
                <code>female:very_long_hair</code>)
              </li>
              <li>
                <code>-태그명</code>: 특정 태그를 제외하고 검색합니다. (예:
                <code>-female:guro</code>)
              </li>
              <li>여러 검색어를 공백으로 구분하여 조합할 수 있습니다.</li>
            </ul>
            <h3 class="text-foreground text-base font-semibold">
              다운로드 관리
            </h3>
            <ul class="list-inside list-disc">
              <li>
                검색 결과에서 작품을 클릭하여 상세 정보를 확인하고 다운로드할 수
                있습니다.
              </li>
              <li>다운로드 경로는 설정에서 변경할 수 있습니다.</li>
              <li>다운로드 진행 상황은 각 작품 카드에서 확인할 수 있습니다.</li>
            </ul>
            <h3 class="text-foreground text-base font-semibold">미리보기</h3>
            <ul class="list-inside list-disc">
              <li>
                검색 결과에서 작품을 선택한 후 <kbd>V</kbd> 키를 눌러 미리보기
                다이얼로그를 열 수 있습니다.
              </li>
            </ul>
            <h3 class="text-foreground text-base font-semibold">폴더명 패턴</h3>
            <ul class="list-inside list-disc">
              <li>
                <code>%artist|groups%</code>와 같이 Fallback 문법을 사용할 수
                있습니다. (artist가 없으면 groups 사용)
              </li>
            </ul>
          </div>
        </HelpDialog>
      </template>
      <template #actions>
        <Button variant="secondary" size="icon" @click="goToSettings">
          <Icon icon="solar:settings-bold-duotone" class="h-6 w-6" />
        </Button>
      </template>
    </PageHeader>

    <div class="flex flex-1 flex-col gap-6 overflow-y-auto">
      <!-- Left Column: Search & Settings -->
      <div class="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle class="flex items-center justify-between">
              <span>{{
                activeSource === "search" ? "작품 검색" : "구독 신작"
              }}</span>
              <div class="flex gap-2">
                <Button
                  size="sm"
                  :variant="activeSource === 'search' ? 'default' : 'outline'"
                  @click="changeSource('search')"
                >
                  검색
                </Button>
                <Button
                  size="sm"
                  :variant="
                    activeSource === 'subscription' ? 'default' : 'outline'
                  "
                  @click="changeSource('subscription')"
                >
                  구독
                  <span
                    v-if="subscriptionStore.hasUnseen"
                    class="bg-destructive ml-1 h-2 w-2 rounded-full"
                  />
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent v-if="activeSource === 'search'" class="space-y-4">
            <div class="space-y-1.5">
              <Label for="search-input">검색어</Label>
              <SmartSearchInput
                id="search-input"
                v-model="searchQuery"
                placeholder="예: artist:작가명 tag:태그명"
                @keyup.enter="handleSearch"
              />
            </div>
            <div
              class="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(260px,2fr)_minmax(120px,0.65fr)_minmax(120px,0.65fr)_minmax(100px,0.5fr)]"
            >
              <div class="flex flex-col space-y-1.5">
                <Label>프리셋</Label>
                <PresetDropdown
                  v-model="searchQuery"
                  @apply-preset="handleSearch"
                />
              </div>
              <div class="flex flex-col space-y-1.5">
                <Label for="popularity-select">정렬</Label>
                <Select
                  :model-value="downloaderPopularity"
                  @update:model-value="handlePopularityChange"
                >
                  <SelectTrigger id="popularity-select" class="w-full">
                    <SelectValue placeholder="정렬 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="option in popularityOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="flex flex-col space-y-1.5">
                <Label for="language-select">언어</Label>
                <Select
                  :model-value="downloaderLanguage"
                  @update:model-value="handleLanguageChange"
                >
                  <SelectTrigger id="language-select" class="w-full">
                    <SelectValue placeholder="언어를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="lang in languageOptions"
                      :key="lang.value"
                      :value="lang.value"
                    >
                      {{ lang.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="flex flex-col space-y-1.5">
                <Label>&nbsp;</Label>
                <Button @click="handleSearch">
                  <Icon
                    icon="solar:magnifer-bold-duotone"
                    class="h-5 w-5"
                  />검색
                </Button>
              </div>
            </div>
            <p class="text-muted-foreground pt-2 text-xs">
              검색은 히토미 검색과 동일한 문법을 지원합니다. (예:
              <code class="font-mono"
                >female:sole_female female:very_long_hair -female:guro</code
              >)
            </p>
          </CardContent>
          <CardContent v-else>
            <SubscriptionToolbar
              :new-count="subscriptionStore.newCount"
              :last-checked-at="subscriptionStore.lastCheckedAt"
              :language="downloaderLanguage"
              :blacklist-count="blacklistCount"
              @changed="handleSubscriptionsChanged"
              @refresh="refreshSubscriptionFeed"
            />
          </CardContent>
        </Card>
      </div>

      <!-- Right Column: Search Results -->
      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">
            {{ activeSource === "search" ? "검색 결과" : "구독 피드" }}
          </h2>
          <div class="flex items-center gap-2">
            <!-- 썸네일 줌 조절 -->
            <div
              class="inline-flex h-8 items-center rounded-md border"
              :class="viewMode !== 'grid' ? 'opacity-50' : ''"
            >
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 rounded-r-none border-r"
                :disabled="viewMode !== 'grid'"
                @click="uiStore.zoomOut()"
              >
                <Icon icon="solar:minus-circle-bold-duotone" class="h-4 w-4" />
              </Button>
              <div
                class="flex w-12 items-center justify-center text-xs tabular-nums"
              >
                {{ Math.round(uiStore.thumbnailZoom * 100) }}%
              </div>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 rounded-l-none border-l"
                :disabled="viewMode !== 'grid'"
                @click="uiStore.zoomIn()"
              >
                <Icon icon="solar:add-circle-bold-duotone" class="h-4 w-4" />
              </Button>
            </div>
            <ToggleGroup
              :model-value="viewMode"
              type="single"
              @update:model-value="handleViewModeChange"
            >
              <ToggleGroupItem value="grid" aria-label="썸네일 뷰">
                <Icon icon="solar:widget-4-bold-duotone" class="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="리스트 뷰">
                <Icon icon="solar:list-bold-duotone" class="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <div
          class="relative min-h-[60vh] flex-1 overflow-y-auto rounded-lg border p-2"
        >
          <div v-if="isLoading" class="flex h-full items-center justify-center">
            <p class="text-muted-foreground">
              <Icon icon="svg-spinners:ring-resize" class="size-8" />
            </p>
          </div>
          <div
            v-else-if="isError"
            class="text-destructive flex h-full items-center justify-center"
          >
            <p>오류 발생: {{ error?.message }}</p>
          </div>
          <div v-else-if="allGalleries.length > 0">
            <div
              v-if="viewMode === 'grid'"
              class="grid gap-4"
              :style="downloaderGridStyle"
              @wheel="handleGridWheel"
            >
              <GalleryThumbnailCard
                v-for="item in allGalleries"
                :key="item.id"
                :gallery="item"
                :download-status="downloadStatuses[item.id]"
                :selected="selectedGallery?.id === item.id"
                @select-gallery="handleSelectGallery"
                @preview-gallery="
                  (gallery) => {
                    handleSelectGallery(gallery);
                    isPreviewDialogOpen = true;
                  }
                "
                @book-deleted="handleBookDeleted"
              />
            </div>
            <div v-else class="flex flex-col gap-2">
              <GalleryRowCard
                v-for="item in allGalleries"
                :key="item.id"
                :gallery="item"
                :download-status="downloadStatuses[item.id]"
                :selected="selectedGallery?.id === item.id"
                @select-gallery="handleSelectGallery"
                @preview-gallery="
                  (gallery) => {
                    handleSelectGallery(gallery);
                    isPreviewDialogOpen = true;
                  }
                "
                @book-deleted="handleBookDeleted"
              />
            </div>
            <div
              ref="observerTarget"
              class="absolute bottom-0 h-[1200px]"
            ></div>
            <div
              v-if="isFetchingNextPage"
              class="text-muted-foreground py-4 text-center"
            >
              <p>더 많은 결과 불러오는 중...</p>
            </div>
          </div>
          <div v-else class="flex h-full items-center justify-center">
            <p class="text-muted-foreground">
              {{
                activeSource === "search"
                  ? "검색 결과가 없습니다."
                  : "구독한 작품이 없습니다."
              }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <GalleryPreviewDialog
    :open="isPreviewDialogOpen"
    :gallery="selectedGallery"
    @update:open="isPreviewDialogOpen = $event"
  />
</template>
