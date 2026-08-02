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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@iconify/vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, ref } from "vue";
import { toast } from "vue-sonner";
import type { Preset } from "../../../types/ipc";
import { addPreset, deletePreset, getPresets, updatePreset } from "../../api";
import PresetFormDialog from "../feature/settings/PresetFormDialog.vue";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits(["update:modelValue", "applyPreset"]);

const queryClient = useQueryClient();
const managerOpen = ref(false);
const formOpen = ref(false);
const editingPreset = ref<Preset | null>(null);

const { data: presets } = useQuery({
  queryKey: ["presets"],
  queryFn: getPresets,
});

const selectedPresetName = computed(
  () =>
    presets.value?.find((preset) => preset.query === props.modelValue)?.name ||
    "프리셋 선택",
);

const handleApplyPreset = (presetQuery: string) => {
  emit("update:modelValue", presetQuery);
  emit("applyPreset", presetQuery); // 추가적인 이벤트 발생
};

const saveMutation = useMutation({
  mutationFn: updatePreset,
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["presets"] });
    formOpen.value = false;
    editingPreset.value = null;
    toast.success("프리셋을 저장했습니다.");
  },
  onError: (error) => toast.error(`프리셋 저장 실패: ${error.message}`),
});

const addMutation = useMutation({
  mutationFn: (query: string) => addPreset({ name: query, query }),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["presets"] });
    toast.success("현재 검색어를 프리셋에 추가했습니다.");
  },
  onError: (error) => toast.error(`프리셋 추가 실패: ${error.message}`),
});

const reorderMutation = useMutation({
  mutationFn: ([current, neighbor]: [Preset, Preset]) =>
    Promise.all([
      updatePreset({ ...current, sort_order: neighbor.sort_order }),
      updatePreset({ ...neighbor, sort_order: current.sort_order }),
    ]),
  onSuccess: () =>
    void queryClient.invalidateQueries({ queryKey: ["presets"] }),
  onError: (error) => toast.error(`순서 변경 실패: ${error.message}`),
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

const addCurrentSearch = () => {
  const query = props.modelValue.trim();
  if (query) addMutation.mutate(query);
};

const movePreset = (preset: Preset, offset: number) => {
  const index = presets.value?.findIndex((item) => item.id === preset.id) ?? -1;
  const neighbor = presets.value?.[index + offset];
  if (index >= 0 && neighbor) reorderMutation.mutate([preset, neighbor]);
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
      <Button variant="outline" class="w-full justify-between font-normal">
        <span class="truncate">{{ selectedPresetName }}</span>
        <Icon
          icon="solar:alt-arrow-down-linear"
          class="h-4 w-4 shrink-0 opacity-50"
        />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem
        :disabled="!modelValue.trim() || addMutation.isPending.value"
        @click="addCurrentSearch"
      >
        <Icon icon="solar:add-circle-linear" class="h-4 w-4" />
        현재 검색어 추가
      </DropdownMenuItem>
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
        <Icon icon="solar:settings-linear" class="h-4 w-4" />
        프리셋 관리
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>

  <Dialog v-model:open="managerOpen">
    <DialogContent class="sm:max-w-[680px]">
      <DialogHeader>
        <DialogTitle>다운로더 프리셋 관리</DialogTitle>
      </DialogHeader>
      <div class="max-h-[55vh] space-y-2 overflow-y-auto">
        <div
          v-for="(preset, index) in presets"
          :key="preset.id"
          class="flex items-center gap-3 rounded-lg border p-3"
        >
          <div class="min-w-0 flex-1">
            <p class="font-medium">{{ preset.name }}</p>
            <p class="text-muted-foreground truncate text-xs">{{ preset.query }}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            title="위로 이동"
            :disabled="index === 0 || reorderMutation.isPending.value"
            @click="movePreset(preset, -1)"
          >
            <Icon icon="solar:alt-arrow-up-linear" class="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="아래로 이동"
            :disabled="
              index === (presets?.length ?? 0) - 1 ||
              reorderMutation.isPending.value
            "
            @click="movePreset(preset, 1)"
          >
            <Icon icon="solar:alt-arrow-down-linear" class="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="이름 편집"
            @click="openForm(preset)"
          >
            <Icon icon="solar:pen-bold-duotone" class="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="삭제"
            @click="removePreset(preset)"
          >
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
