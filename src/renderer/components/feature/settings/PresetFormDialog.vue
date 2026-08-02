<script setup lang="ts">
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ref, watch } from "vue";
import { toast } from "vue-sonner";
import { Preset } from "../../../../types/ipc";

const props = defineProps<{ open: boolean; editingPreset: Preset | null }>();
const emit = defineEmits(["update:open", "save"]);

const presetName = ref("");

watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      presetName.value = props.editingPreset?.name || "";
    }
  },
  { immediate: true },
);

const handleSubmit = () => {
  if (!presetName.value.trim() || !props.editingPreset) {
    toast.error("이름을 입력해주세요.");
    return;
  }

  emit("save", { ...props.editingPreset, name: presetName.value.trim() });
};

const handleOpenChange = (value: boolean) => {
  emit("update:open", value);
};
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>프리셋 이름 편집</DialogTitle>
        <DialogDescription>저장된 검색어의 표시 이름을 변경합니다.</DialogDescription>
      </DialogHeader>
      <div class="grid gap-4 py-4">
        <div class="grid grid-cols-4 items-center gap-4">
          <Label for="name" class="text-right"> 이름 </Label>
          <Input
            id="name"
            v-model="presetName"
            class="col-span-3"
            placeholder="프리셋 이름"
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" @click="handleSubmit">저장</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
