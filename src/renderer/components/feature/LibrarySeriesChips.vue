<script setup lang="ts">
import { Check, Layers, Layers2 } from "lucide-vue-next";
const model = defineModel<"all" | "series" | "standalone">({ required: true });
</script>
<template>
  <div class="flex items-center gap-2" role="group" aria-label="시리즈 표시">
    <button
      type="button"
      class="mode-chip"
      :aria-pressed="model === 'all'"
      @click="model = 'all'"
    >
      <Check v-if="model === 'all'" class="size-4" />전체
    </button>
    <button
      type="button"
      class="mode-chip"
      :aria-pressed="model !== 'all'"
      :title="model === 'series' ? '시리즈 제외하기' : '시리즈만 보기'"
      @click="model = model === 'series' ? 'standalone' : 'series'"
    >
      <component
        :is="model === 'standalone' ? Layers2 : Layers"
        class="size-4"
      />{{
        model === "all"
          ? "시리즈"
          : model === "series"
            ? "시리즈만"
            : "시리즈 제외"
      }}
    </button>
  </div>
</template>
<style scoped>
.mode-chip {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 6px;
  padding: 4px 14px;
  border: 1px solid var(--border);
  border-radius: 16px;
  font-size: 14px;
}
.mode-chip[aria-pressed="true"] {
  background: color-mix(in srgb, var(--primary) 12%, var(--card));
  border-color: var(--primary);
}
.mode-chip:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
</style>
