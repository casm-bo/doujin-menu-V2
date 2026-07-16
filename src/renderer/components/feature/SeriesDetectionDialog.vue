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
import { Icon } from "@iconify/vue";

interface Props {
  open: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  confirm: [];
}>();

const closeDialog = () => emit("update:open", false);
const handleConfirm = () => emit("confirm");
</script>

<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[500px]">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Icon
            icon="solar:magic-stick-3-bold-duotone"
            class="text-primary h-5 w-5"
          />
          시리즈 자동 생성
        </DialogTitle>
        <DialogDescription>
          Android 앱과 같은 규칙으로 아직 시리즈에 포함되지 않은 갤러리만
          검사합니다. 기존에 만든 시리즈는 변경하지 않습니다.
        </DialogDescription>
      </DialogHeader>

      <div class="bg-muted/50 space-y-3 rounded-lg p-4 text-sm">
        <div class="flex items-start gap-2">
          <Icon
            icon="solar:user-check-bold-duotone"
            class="text-primary mt-0.5 h-4 w-4"
          />
          <span>두 갤러리에 공통 작가가 한 명 이상 있어야 합니다.</span>
        </div>
        <div class="flex items-start gap-2">
          <Icon
            icon="solar:text-bold-duotone"
            class="text-primary mt-0.5 h-4 w-4"
          />
          <span
            >권·화·전편·중편·후편 같은 표기를 제외한 제목이 같거나 82% 이상
            유사해야 합니다.</span
          >
        </div>
        <div class="flex items-start gap-2">
          <Icon
            icon="solar:shield-check-bold-duotone"
            class="text-primary mt-0.5 h-4 w-4"
          />
          <span
            >조건을 만족하는 갤러리가 2개 이상일 때만 새 시리즈를
            만듭니다.</span
          >
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="closeDialog">취소</Button>
        <Button @click="handleConfirm">
          <Icon icon="solar:play-bold-duotone" class="mr-2 h-4 w-4" />
          실행
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
