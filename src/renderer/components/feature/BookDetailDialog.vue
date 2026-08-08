<script setup lang="ts">
import { getBook, getThumbnailUrl, updateBookMetadata } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePreviewViewMode } from "@/composables/usePreviewViewMode";
import { Icon } from "@iconify/vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import type { Book } from "../../../types/ipc";
import MetadataField from "./MetadataField.vue";

const props = defineProps<{
  modelValue: boolean;
  book: Book | null;
  suspendWhileViewing?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  updated: [];
}>();

const router = useRouter();
const route = useRoute();
const { viewMode, setViewMode } = usePreviewViewMode();
const detailBook = ref<Book | null>(null);
const book = computed(() => detailBook.value || props.book);
const isEditing = ref(false);
const saving = ref(false);
type ListField = "artists" | "tags" | "series" | "groups" | "characters";
type ScalarField = "hitomi_id" | "type" | "language";
const draft = ref({
  title: "",
  hitomi_id: [] as string[],
  type: [] as string[],
  language: [] as string[],
  artists: [] as string[],
  tags: [] as string[],
  series: [] as string[],
  groups: [] as string[],
  characters: [] as string[],
});

const open = computed({
  get: () =>
    props.modelValue && !(props.suspendWhileViewing && route.name === "Viewer"),
  set: (value) => {
    if (props.suspendWhileViewing && route.name === "Viewer") return;
    emit("update:modelValue", value);
  },
});

const displayPath = computed(() => {
  if (!book.value?.path) return "";
  const parts = book.value.path.split(/[\\/]/);
  return parts.slice(0, -1).join("/");
});

const previewPages = computed(() =>
  book.value
    ? Array.from(
        { length: book.value.page_count || 0 },
        (_, index) => `doujin-menu://page/${book.value!.id}/${index}`,
      )
    : [],
);

const openReader = (page: number) => {
  if (!book.value) return;
  router.push({
    name: "Viewer",
    params: { id: book.value.id },
    query: { start: String(page) },
  });
};

const values = (field: ListField) =>
  isEditing.value
    ? draft.value[field]
    : (book.value?.[field] || []).map((item) => item.name);
const scalarValues = (field: ScalarField) => {
  if (isEditing.value) return draft.value[field];
  const value =
    field === "language"
      ? book.value?.language_name_local || book.value?.language_name_english
      : book.value?.[field];
  return value ? [String(value)] : [];
};

const resetDraft = () => {
  if (!book.value) return;
  draft.value = {
    title: book.value.title,
    hitomi_id: book.value.hitomi_id ? [book.value.hitomi_id] : [],
    type: book.value.type ? [book.value.type] : [],
    language: [
      book.value.language_name_local || book.value.language_name_english || "",
    ].filter(Boolean),
    artists: values("artists"),
    tags: values("tags"),
    series: values("series"),
    groups: values("groups"),
    characters: values("characters"),
  };
};

const startEdit = () => {
  resetDraft();
  isEditing.value = true;
};
const cancelEdit = () => {
  isEditing.value = false;
  resetDraft();
};
const removeValue = (field: ListField | ScalarField, index: number) => {
  draft.value[field].splice(index, 1);
};
const addValue = (field: ListField | ScalarField, value: string) => {
  if (!draft.value[field].includes(value)) draft.value[field].push(value);
};

const saveMetadata = async () => {
  if (!book.value) return;
  saving.value = true;
  try {
    await updateBookMetadata(book.value.id, {
      title: draft.value.title,
      hitomi_id: draft.value.hitomi_id[0] || null,
      type: draft.value.type[0] || null,
      language_name_local: draft.value.language[0] || null,
      artists: [...draft.value.artists],
      tags: [...draft.value.tags],
      series: [...draft.value.series],
      groups: [...draft.value.groups],
      characters: [...draft.value.characters],
    });
    detailBook.value = await getBook(book.value.id);
    isEditing.value = false;
    emit("updated");
    toast.success("메타데이터를 저장했습니다");
  } catch (error) {
    toast.error(`저장 실패: ${(error as Error).message}`);
  } finally {
    saving.value = false;
  }
};

watch(
  () => [props.modelValue, props.book] as const,
  ([open, nextBook]) => {
    if (open) {
      detailBook.value = nextBook ? { ...nextBook } : null;
      isEditing.value = false;
    }
  },
  { immediate: true },
);

// 클립보드 복사 함수
const copyToClipboard = async (text: string, prefix: string) => {
  try {
    const isGenderTag = text.startsWith("male:") || text.startsWith("female:");
    const searchQuery =
      prefix === "tag" && isGenderTag ? text : `${prefix}:${text}`;
    await navigator.clipboard.writeText(searchQuery);
    toast.success(`${searchQuery}가 복사되었습니다.`);
  } catch {
    toast.error("복사 실패");
  }
};

// 다운로더에서 검색 (우클릭)
const searchInDownloader = (text: string, prefix: string) => {
  const isGenderTag = text.startsWith("male:") || text.startsWith("female:");
  const searchQuery =
    prefix === "tag" && isGenderTag ? text : `${prefix}:${text}`;
  localStorage.setItem("downloader-search-query", searchQuery);
  open.value = false;
  router.push("/downloader");
  toast.info(`다운로더로 이동: ${searchQuery}`);
};
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-[900px]"
    >
      <DialogHeader>
        <DialogTitle>상세 정보</DialogTitle>
        <DialogDescription>
          선택한 만화책의 상세 정보를 확인합니다. 클릭 시 검색어 형식으로 복사 /
          우클릭 시 다운로더에서 검색
        </DialogDescription>
      </DialogHeader>
      <div
        v-if="book"
        class="min-h-0 flex-1 space-y-6 overflow-y-auto py-2 pr-2"
      >
        <!-- 커버 이미지와 기본 정보 -->
        <div class="flex gap-6">
          <img
            :src="getThumbnailUrl(book.cover_path)"
            alt="Book Cover"
            class="h-64 w-auto rounded-lg object-cover shadow-lg"
          />
          <div class="flex flex-1 flex-col gap-3">
            <div class="flex items-start justify-between gap-3">
              <div v-if="isEditing" class="relative flex-1">
                <Input
                  v-model="draft.title"
                  class="h-auto py-2 pr-9 text-xl font-bold"
                  aria-label="제목"
                />
                <button
                  type="button"
                  class="text-destructive hover:bg-destructive/10 absolute top-1/2 right-2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded"
                  aria-label="제목 삭제"
                  @click="draft.title = ''"
                >
                  <Icon icon="solar:close-circle-bold" class="size-4" />
                </button>
              </div>
              <h3 v-else class="text-2xl leading-tight font-bold">
                {{ book.title || "N/A" }}
              </h3>
              <div class="flex shrink-0 gap-2">
                <template v-if="isEditing">
                  <Button variant="outline" size="sm" @click="cancelEdit">
                    취소
                  </Button>
                  <Button size="sm" :disabled="saving" @click="saveMetadata">
                    저장
                  </Button>
                </template>
                <Button v-else variant="outline" size="sm" @click="startEdit">
                  <Icon icon="solar:pen-bold-duotone" class="mr-2 h-4 w-4" />
                  편집
                </Button>
              </div>
            </div>

            <!-- 메타데이터 안내 -->
            <p class="text-muted-foreground text-xs">
              메타데이터를 클릭하면 복사, 우클릭하면 다운로더에서 검색합니다.
            </p>

            <div class="grid gap-2" :class="{ 'gap-3': isEditing }">
              <MetadataField
                label="Hitomi ID"
                icon="solar:hashtag-circle-bold-duotone"
                :values="scalarValues('hitomi_id')"
                :editing="isEditing"
                :multiple="false"
                @activate="copyToClipboard($event, 'id')"
                @search="searchInDownloader($event, 'id')"
                @remove="removeValue('hitomi_id', $event)"
                @add="addValue('hitomi_id', $event)"
              />
              <MetadataField
                label="작가"
                icon="solar:user-bold-duotone"
                :values="values('artists')"
                :editing="isEditing"
                @activate="copyToClipboard($event, 'artist')"
                @search="searchInDownloader($event, 'artist')"
                @remove="removeValue('artists', $event)"
                @add="addValue('artists', $event)"
              />
              <MetadataField
                label="시리즈"
                icon="solar:library-bold-duotone"
                :values="values('series')"
                :editing="isEditing"
                @activate="copyToClipboard($event, 'series')"
                @search="searchInDownloader($event, 'series')"
                @remove="removeValue('series', $event)"
                @add="addValue('series', $event)"
              />
              <MetadataField
                label="유형"
                icon="solar:bookmark-bold-duotone"
                :values="scalarValues('type')"
                :editing="isEditing"
                :multiple="false"
                @activate="copyToClipboard($event, 'type')"
                @search="searchInDownloader($event, 'type')"
                @remove="removeValue('type', $event)"
                @add="addValue('type', $event)"
              />
              <MetadataField
                label="언어"
                icon="solar:translation-bold-duotone"
                :values="scalarValues('language')"
                :editing="isEditing"
                :multiple="false"
                @activate="copyToClipboard($event, 'language')"
                @search="searchInDownloader($event, 'language')"
                @remove="removeValue('language', $event)"
                @add="addValue('language', $event)"
              />
            </div>

            <div class="mt-auto flex justify-end gap-2">
              <Button variant="outline" @click="openReader(1)">
                처음부터 보기
              </Button>
              <Button @click="openReader(Math.max(1, book.current_page || 1))">
                이어서 보기
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        <div class="space-y-2" :class="{ 'space-y-3': isEditing }">
          <MetadataField
            label="태그"
            icon="solar:tag-bold-duotone"
            :values="values('tags')"
            tag-style
            :editing="isEditing"
            @activate="copyToClipboard($event, 'tag')"
            @search="searchInDownloader($event, 'tag')"
            @remove="removeValue('tags', $event)"
            @add="addValue('tags', $event)"
          />
          <MetadataField
            label="그룹"
            icon="solar:users-group-rounded-bold-duotone"
            :values="values('groups')"
            :editing="isEditing"
            @activate="copyToClipboard($event, 'group')"
            @search="searchInDownloader($event, 'group')"
            @remove="removeValue('groups', $event)"
            @add="addValue('groups', $event)"
          />
          <MetadataField
            label="캐릭터"
            icon="solar:user-speak-bold-duotone"
            :values="values('characters')"
            :editing="isEditing"
            @activate="copyToClipboard($event, 'character')"
            @search="searchInDownloader($event, 'character')"
            @remove="removeValue('characters', $event)"
            @add="addValue('characters', $event)"
          />
        </div>

        <Separator />

        <!-- 기타 정보 -->
        <div class="bg-muted/50 space-y-2 rounded-lg p-4">
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">페이지 수</span>
            <span class="font-medium">{{ book.page_count || "N/A" }}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">추가된 날짜</span>
            <span class="font-medium">
              {{
                book.added_at
                  ? new Date(book.added_at).toLocaleDateString()
                  : "N/A"
              }}
            </span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">마지막 읽은 날짜</span>
            <span class="font-medium">
              {{
                book.last_read_at
                  ? new Date(book.last_read_at).toLocaleDateString()
                  : "N/A"
              }}
            </span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">즐겨찾기</span>
            <span class="font-medium">
              <Icon
                v-if="book.is_favorite"
                icon="solar:star-bold"
                class="text-yellow-500"
              />
              <span v-else>N/A</span>
            </span>
          </div>
          <div class="flex flex-col gap-1 text-sm">
            <span class="text-muted-foreground">경로</span>
            <span class="font-mono text-xs break-all">{{
              displayPath || "N/A"
            }}</span>
          </div>
        </div>

        <Separator />

        <div class="space-y-3">
          <div class="flex items-center justify-between gap-3">
            <h4 class="font-semibold">미리보기</h4>
            <ToggleGroup
              type="single"
              :model-value="viewMode"
              variant="outline"
              size="sm"
              @update:model-value="setViewMode"
            >
              <ToggleGroupItem
                value="scroll"
                aria-label="크게 보기"
                title="크게 보기"
              >
                <Icon icon="solar:gallery-wide-bold-duotone" class="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem
                value="grid"
                aria-label="여러 개 보기"
                title="여러 개 보기"
              >
                <Icon icon="solar:widget-5-bold-duotone" class="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div
            v-if="viewMode === 'scroll'"
            class="flex h-64 gap-3 overflow-x-auto rounded-md border p-2"
          >
            <button
              v-for="(page, index) in previewPages"
              :key="page"
              type="button"
              class="h-full shrink-0 cursor-pointer"
              :title="`${index + 1}페이지부터 보기`"
              @click="openReader(index + 1)"
            >
              <img
                :src="page"
                :alt="`${index + 1}페이지`"
                class="h-full w-auto rounded object-contain"
                loading="lazy"
              />
            </button>
          </div>
          <div
            v-else
            class="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto rounded-md border p-2 sm:grid-cols-5"
          >
            <button
              v-for="(page, index) in previewPages"
              :key="page"
              type="button"
              class="cursor-pointer"
              :title="`${index + 1}페이지부터 보기`"
              @click="openReader(index + 1)"
            >
              <img
                :src="page"
                :alt="`${index + 1}페이지`"
                class="aspect-[3/4] w-full rounded object-cover"
                loading="lazy"
              />
            </button>
          </div>
        </div>
      </div>
      <div v-else class="text-muted-foreground py-8 text-center">
        책 정보를 불러올 수 없습니다.
      </div>
    </DialogContent>
  </Dialog>
</template>
