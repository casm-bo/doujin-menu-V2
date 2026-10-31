<script setup lang="ts">
import { ipcRenderer } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { IpcChannels } from "../../../types/ipc";

type CoverRequest = IpcChannels["change-cover"]["request"];
const props = defineProps<{
  target: CoverRequest["target"];
  sources: { url: string; label: string; source: CoverRequest["source"] }[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ updated: [] }>();
const pickerOpen = ref(false);
const busy = ref(false);
watch([() => props.target.kind, () => props.target.id], () => {
  pickerOpen.value = false;
});

async function change(source: CoverRequest["source"]) {
  if (busy.value || props.disabled) return;
  const target = { ...props.target };
  busy.value = true;
  try {
    const result = await ipcRenderer.invoke("change-cover", { target, source });
    if (!result) return;
    if (result.status === "conflict") {
      toast.error("다른 기기에서 변경했습니다. 다시 선택해 주세요.");
      return;
    }
    if (target.kind === props.target.kind && target.id === props.target.id) {
      pickerOpen.value = false;
      emit("updated");
    }
    toast.success("표지를 변경했습니다.");
  } catch (error) {
    toast.error(`표지 변경 실패: ${(error as Error).message}`);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mt-3 flex flex-wrap gap-2">
    <Button
      variant="outline"
      size="sm"
      :disabled="busy || disabled || !sources.length"
      @click="pickerOpen = true"
    >
      {{
        target.kind === "series"
          ? "소속 작품에서 표지 선택"
          : "내부 페이지에서 표지 선택"
      }}
    </Button>
    <Button
      variant="outline"
      size="sm"
      :disabled="busy || disabled"
      @click="change({ kind: 'external' })"
    >
      외부 이미지로 표지 변경
    </Button>
  </div>
  <Dialog v-model:open="pickerOpen">
    <DialogContent
      class="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-[750px]"
    >
      <DialogHeader><DialogTitle>표지 선택</DialogTitle></DialogHeader>
      <div class="grid min-h-0 grid-cols-3 gap-3 overflow-y-auto">
        <button
          v-for="item in sources"
          :key="item.url"
          type="button"
          class="hover:bg-muted min-w-0 space-y-1 rounded p-1 focus-visible:outline-2"
          :disabled="busy || disabled"
          :aria-label="`${item.label} 표지로 사용`"
          @click="change(item.source)"
        >
          <img
            :src="item.url"
            :alt="item.label"
            class="aspect-[3/4] w-full rounded object-contain"
            loading="lazy"
          />
          <span class="block truncate text-sm">{{ item.label }}</span>
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>
