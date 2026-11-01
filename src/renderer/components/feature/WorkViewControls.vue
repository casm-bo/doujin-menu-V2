<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Grid2X2, List, Minus, Plus } from "lucide-vue-next";
defineProps<{ viewMode: "grid" | "list"; zoom: number }>();
const emit = defineEmits<{
  "update:viewMode": [value: "grid" | "list"];
  increase: [];
  decrease: [];
}>();
</script>
<template>
  <div
    class="bg-toolbar flex flex-wrap items-center gap-3 rounded-xl border p-1.5"
    role="group"
    aria-label="보기 설정"
  >
    <div class="flex items-center gap-1" role="group" aria-label="뷰 모드">
      <Button
        variant="ghost"
        :class="{ 'bg-nav-selected': viewMode === 'grid' }"
        :aria-pressed="viewMode === 'grid'"
        aria-label="썸네일 뷰"
        title="격자 보기"
        @click="emit('update:viewMode', 'grid')"
        ><Grid2X2 class="size-5" /><span class="hidden xl:inline"
          >격자</span
        ></Button
      >
      <Button
        variant="ghost"
        :class="{ 'bg-nav-selected': viewMode === 'list' }"
        :aria-pressed="viewMode === 'list'"
        aria-label="리스트 뷰"
        title="목록 보기"
        @click="emit('update:viewMode', 'list')"
        ><List class="size-5" /><span class="hidden xl:inline"
          >목록</span
        ></Button
      >
    </div>
    <div
      class="flex items-center gap-2 border-l pl-3"
      role="group"
      aria-label="썸네일 크기"
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label="카드 축소"
        title="썸네일 축소"
        :disabled="zoom <= 0.4"
        @click="emit('decrease')"
        ><Minus class="size-5"
      /></Button>
      <span class="min-w-12 text-center text-sm tabular-nums" role="status"
        >{{ Math.round(zoom * 100) }}%</span
      >
      <Button
        variant="ghost"
        size="icon"
        aria-label="카드 확대"
        title="썸네일 확대"
        :disabled="zoom >= 1.5"
        @click="emit('increase')"
        ><Plus class="size-5"
      /></Button>
    </div>
  </div>
</template>
