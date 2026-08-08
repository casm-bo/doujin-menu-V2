<script setup lang="ts">
import ProxiedImage from "@/components/common/ProxiedImage.vue";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePreviewViewMode } from "@/composables/usePreviewViewMode";
import { Icon } from "@iconify/vue";
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    pages: string[];
    proxyId?: number;
    referer?: string;
    loading?: boolean;
    error?: string | null;
    interactive?: boolean;
  }>(),
  {
    referer: "",
    loading: false,
    error: null,
    interactive: true,
  },
);

const emit = defineEmits<{
  selectPage: [index: number];
}>();

const { viewMode, setViewMode } = usePreviewViewMode();
const pageRefs = ref<HTMLElement[]>([]);
const loadedPages = ref(new Set<number>());
let observer: IntersectionObserver | null = null;

const initObserver = () => {
  observer?.disconnect();
  loadedPages.value.clear();
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = Number(entry.target.getAttribute("data-index"));
        if (Number.isInteger(index)) loadedPages.value.add(index);
      }
    },
    { rootMargin: "200px" },
  );

  void nextTick(() => {
    for (const page of pageRefs.value) observer?.observe(page);
  });
};

watch(
  () => [props.pages, viewMode.value] as const,
  () => initObserver(),
  { immediate: true, flush: "post" },
);

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <section class="space-y-3">
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
      v-if="loading"
      class="text-muted-foreground flex h-64 items-center justify-center rounded-md border"
    >
      미리보기 이미지 불러오는 중...
    </div>
    <div
      v-else-if="error"
      class="text-destructive flex h-64 items-center justify-center rounded-md border"
    >
      {{ error }}
    </div>
    <div
      v-else-if="pages.length === 0"
      class="text-muted-foreground flex h-64 items-center justify-center rounded-md border"
    >
      미리보기 이미지가 없습니다.
    </div>
    <div
      v-else-if="viewMode === 'scroll'"
      class="flex h-64 gap-3 overflow-x-auto rounded-md border p-2"
    >
      <button
        v-for="(page, index) in pages"
        :key="page"
        ref="pageRefs"
        type="button"
        :data-index="index"
        class="h-full shrink-0"
        :class="interactive ? 'cursor-pointer' : 'cursor-default'"
        :title="interactive ? `${index + 1}페이지부터 읽기` : undefined"
        @click="interactive && emit('selectPage', index)"
      >
        <ProxiedImage
          v-if="proxyId"
          :id="proxyId"
          :url="page"
          :referer="referer"
          :alt="`${index + 1}페이지`"
          :lazy="!loadedPages.has(index)"
          class="h-full w-auto min-w-40 overflow-hidden rounded"
        />
        <img
          v-else
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
        v-for="(page, index) in pages"
        :key="page"
        ref="pageRefs"
        type="button"
        :data-index="index"
        :class="interactive ? 'cursor-pointer' : 'cursor-default'"
        :title="interactive ? `${index + 1}페이지부터 읽기` : undefined"
        @click="interactive && emit('selectPage', index)"
      >
        <ProxiedImage
          v-if="proxyId"
          :id="proxyId"
          :url="page"
          :referer="referer"
          :alt="`${index + 1}페이지`"
          :lazy="!loadedPages.has(index)"
          class="aspect-[3/4] w-full overflow-hidden rounded"
        />
        <img
          v-else
          :src="page"
          :alt="`${index + 1}페이지`"
          class="aspect-[3/4] w-full rounded object-cover"
          loading="lazy"
        />
      </button>
    </div>
  </section>
</template>
