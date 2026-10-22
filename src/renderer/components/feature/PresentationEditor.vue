<script setup lang="ts">
import { ref, watch } from "vue";
import { getPresentation, savePresentation } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import MetadataField from "./MetadataField.vue";
import type { GalleryPresentation } from "../../../types/presentation";

const props = defineProps<{
  open: boolean;
  initial: GalleryPresentation | null;
}>();
const emit = defineEmits<{
  "update:open": [boolean];
  saved: [GalleryPresentation];
}>();
const draft = ref<GalleryPresentation | null>(null);
const conflict = ref<GalleryPresentation | null>(null);
const busy = ref(false);
const error = ref("");
const lists = [
  { key: "artists", label: "작가" },
  { key: "groups", label: "그룹" },
  { key: "series", label: "시리즈" },
  { key: "characters", label: "캐릭터" },
  { key: "tags", label: "태그" },
] as const;
const scalars = [
  { key: "galleryType", label: "유형" },
  { key: "language", label: "언어" },
  { key: "publishedDate", label: "발행일" },
] as const;
const clone = (value: GalleryPresentation) =>
  JSON.parse(JSON.stringify(value)) as GalleryPresentation;
watch(
  () => [props.open, props.initial?.key] as const,
  async ([open, key], _old, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    draft.value = null;
    conflict.value = null;
    error.value = "";
    if (!open || !key || !props.initial) return;
    busy.value = true;
    try {
      const value = await getPresentation(key);
      if (!cancelled) draft.value = clone(value || props.initial);
    } catch (e) {
      if (!cancelled) error.value = (e as Error).message;
    } finally {
      if (!cancelled) busy.value = false;
    }
  },
  { immediate: true },
);
async function save(overwrite = false) {
  if (!draft.value) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await savePresentation(
      clone(draft.value),
      overwrite && conflict.value
        ? conflict.value.version
        : draft.value.version,
    );
    if (result.status === "conflict") conflict.value = result.value;
    else {
      emit("saved", result.value);
      emit("update:open", false);
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-[650px]">
      <DialogHeader><DialogTitle>메타데이터 편집</DialogTitle></DialogHeader>
      <template v-if="draft">
        <label class="space-y-1 text-sm"
          >제목<Input v-model="draft.title" maxlength="500"
        /></label>
        <MetadataField
          v-for="field in lists"
          :key="field.key"
          :label="field.label"
          icon="solar:tag-bold-duotone"
          :values="draft.metadata[field.key]"
          editing
          @add="draft.metadata[field.key].push($event)"
          @remove="draft.metadata[field.key].splice($event, 1)"
        />
        <label
          v-for="field in scalars"
          :key="field.key"
          class="space-y-1 text-sm"
          >{{ field.label
          }}<Input
            :model-value="draft.metadata[field.key] || ''"
            maxlength="200"
            @update:model-value="
              draft.metadata[field.key] = String($event).trim() || null
            "
        /></label>
      </template>
      <p v-if="error" role="alert" class="text-destructive text-sm">
        {{ error }}
      </p>
      <div
        v-if="conflict"
        role="alert"
        class="space-y-2 rounded border p-3 text-sm"
      >
        <p>
          다른 기기에서 변경했습니다: {{ conflict.title }}. 저장할 내용을
          선택하세요.
        </p>
        <Button
          variant="outline"
          :disabled="busy"
          @click="
            draft = clone(conflict!);
            conflict = null;
          "
          >다른 기기 내용 불러오기</Button
        >
        <Button :disabled="busy" @click="save(true)">내 수정으로 저장</Button>
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="emit('update:open', false)"
          >취소</Button
        ><Button :disabled="busy || !draft || !!conflict" @click="save()"
          >저장</Button
        >
      </div>
    </DialogContent>
  </Dialog>
</template>
