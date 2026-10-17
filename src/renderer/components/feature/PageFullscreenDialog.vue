<script setup lang="ts">
import { ipcRenderer } from "@/api";
import ProxiedImage from "@/components/common/ProxiedImage.vue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { computed, nextTick, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    pages: string[];
    startIndex: number;
    proxyId?: number;
    referer?: string;
  }>(),
  { referer: "" },
);
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const dialogOpen = computed({
  get: () => props.open,
  set: (value) => emit("update:open", value),
});
const index = ref(props.startIndex);
const currentPage = computed(() => props.pages[index.value]);
const move = (offset: number) => {
  index.value = Math.max(
    0,
    Math.min(props.pages.length - 1, index.value + offset),
  );
};

watch(
  () => [props.open, props.startIndex, props.pages] as const,
  () => {
    index.value = Math.max(
      0,
      Math.min(props.pages.length - 1, props.startIndex),
    );
  },
);

watch(
  () => props.open,
  async (open, _, onCleanup) => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    let cancelled = false;
    let changedFullscreen = false;
    onCleanup(() => {
      cancelled = true;
      if (changedFullscreen) ipcRenderer.send("set-fullscreen-window", false);
      void nextTick(() => {
        if (previousFocus?.isConnected) previousFocus.focus();
      });
    });
    try {
      const wasFullscreen = await ipcRenderer.invoke("is-fullscreen-window");
      if (!cancelled && !wasFullscreen) {
        ipcRenderer.send("set-fullscreen-window", true);
        changedFullscreen = true;
      }
    } catch (error) {
      console.error("전체화면 전환 실패:", error);
    }
  },
  { immediate: true },
);
</script>

<template>
  <Dialog v-model:open="dialogOpen">
    <DialogContent
      class="fixed top-0 left-0 z-[60] flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-none"
      :show-close-button="false"
      :aria-describedby="undefined"
      @escape-key-down.stop
      @pointer-down-outside.prevent
      @keydown.left.prevent.stop="move(-1)"
      @keydown.right.prevent.stop="move(1)"
    >
      <DialogTitle class="sr-only">미리보기 전체화면</DialogTitle>
      <div
        class="flex shrink-0 items-center justify-between gap-2 border-b p-2"
      >
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            :disabled="index <= 0"
            aria-label="이전 페이지"
            @click="move(-1)"
            >이전</Button
          >
          <span class="text-sm tabular-nums" aria-live="polite"
            >{{ index + 1 }} / {{ pages.length }}</span
          >
          <Button
            variant="outline"
            :disabled="index >= pages.length - 1"
            aria-label="다음 페이지"
            @click="move(1)"
            >다음</Button
          >
        </div>
        <Button
          variant="outline"
          aria-label="전체화면 닫기"
          @click="dialogOpen = false"
          >닫기 · Esc</Button
        >
      </div>
      <div
        class="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2"
      >
        <ProxiedImage
          v-if="currentPage && proxyId"
          :id="proxyId"
          :key="currentPage"
          :url="currentPage"
          :referer="referer"
          :alt="`${index + 1}페이지`"
          :lazy="false"
          fit="contain"
          class="h-full w-full"
        />
        <img
          v-else-if="currentPage"
          :key="currentPage"
          :src="currentPage"
          :alt="`${index + 1}페이지`"
          class="h-full w-full object-contain"
        />
      </div>
    </DialogContent>
  </Dialog>
</template>
