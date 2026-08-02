<script setup lang="ts">
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@iconify/vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { ref } from "vue";
import { toast } from "vue-sonner";
import type { Preset } from "../../../types/ipc";
import { addPreset, deletePreset, getPresets, updatePreset } from "../../api";
import PresetFormDialog from "../feature/settings/PresetFormDialog.vue";

defineProps<{ modelValue: string }>();
const emit = defineEmits(["update:modelValue", "applyPreset"]);

const queryClient = useQueryClient();
const managerOpen = ref(false);
const formOpen = ref(false);
const editingPreset = ref<Preset | null>(null);

const { data: presets } = useQuery({
  queryKey: ["presets"],
  queryFn: getPresets,
});

const handleApplyPreset = (presetQuery: string) => {
  emit("update:modelValue", presetQuery);
  emit("applyPreset", presetQuery); // 추가적인 이벤트 발생
};

const saveMutation = useMutation({
  mutationFn: (preset: Omit<Preset, "id"> | Preset) =>
    "id" in preset ? updatePreset(preset) : addPreset(preset),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["presets"] });
    formOpen.value = false;
    editingPreset.value = null;
    toast.success("프리셋을 저장했습니다.");
  },
  onError: (error) => toast.error(`프리셋 저장 실패: ${error.message}`),
});

const deleteMutation = useMutation({
  mutationFn: deletePreset,
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["presets"] });
    toast.success("프리셋을 삭제했습니다.");
  },
  onError: (error) => toast.error(`프리셋 삭제 실패: ${error.message}`),
});

const openForm = (preset: Preset | null = null) => {
  editingPreset.value = preset;
  formOpen.value = true;
};

const removePreset = (preset: Preset) => {
  if (window.confirm(`'${preset.name}' 프리셋을 삭제하시겠습니까?`)) {
    deleteMutation.mutate(preset.id);
  }
};
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" size="icon">
        <Icon icon="solar:bookmark-bold-duotone" class="h-5 w-5" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent class="w-56">
      <DropdownMenuLabel>프리셋</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <template v-if="presets && presets.length > 0">
        <DropdownMenuItem
          v-for="preset in presets"
          :key="preset.id"
          @click="handleApplyPreset(preset.query)"
        >
          {{ preset.name }}
        </DropdownMenuItem>
      </template>
      <template v-else>
        <DropdownMenuItem disabled> (없음) </DropdownMenuItem>
      </template>
      <DropdownMenuSeparator />
      <DropdownMenuItem @click="managerOpen = true">
        프리셋 관리...
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>

  <Dialog v-model:open="managerOpen">
    <DialogContent class="sm:max-w-[680px]">
      <DialogHeader>
        <DialogTitle>다운로더 프리셋 관리</DialogTitle>
      </DialogHeader>
      <div class="flex justify-end">
        <Button @click="openForm()">
          <Icon icon="solar:add-circle-bold-duotone" class="h-4 w-4" />
          추가
        </Button>
      </div>
      <div class="max-h-[55vh] space-y-2 overflow-y-auto">
        <div
          v-for="preset in presets"
          :key="preset.id"
          class="flex items-center gap-3 rounded-lg border p-3"
        >
          <div class="min-w-0 flex-1">
            <p class="font-medium">{{ preset.name }}</p>
            <p class="text-muted-foreground truncate text-xs">{{ preset.query }}</p>
          </div>
          <Button variant="ghost" size="icon" @click="openForm(preset)">
            <Icon icon="solar:pen-bold-duotone" class="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" @click="removePreset(preset)">
            <Icon icon="solar:trash-bin-trash-bold-duotone" class="text-destructive h-4 w-4" />
          </Button>
        </div>
        <p v-if="!presets?.length" class="text-muted-foreground py-8 text-center">
          저장된 프리셋이 없습니다.
        </p>
      </div>
    </DialogContent>
  </Dialog>

  <PresetFormDialog
    :open="formOpen"
    :editing-preset="editingPreset"
    @update:open="formOpen = $event"
    @save="saveMutation.mutate($event)"
  />
</template>
