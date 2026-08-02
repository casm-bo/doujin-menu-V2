<script setup lang="ts">
import { ipcRenderer } from "@/api";
import SettingItem from "@/components/feature/settings/SettingItem.vue";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useUiStore } from "@/store/uiStore";
import { useQueryClient } from "@tanstack/vue-query";
import { AcceptableValue } from "reka-ui";
import { onMounted, ref } from "vue";
import { toast } from "vue-sonner";

const queryClient = useQueryClient();
const saveConfig = async (key: string, value: unknown) => {
  const result = await ipcRenderer.invoke("set-config", { key, value });
  if (!result.success && result.error) {
    toast.error("설정 저장에 실패했습니다.", { description: result.error });
  }
  queryClient.invalidateQueries({ queryKey: ["config"] });
};

// 일반 설정 상태
const autoLoadLibrary = ref(true);
const enableReadingHistory = ref(true);

// 화면 회전 설정 상태
const uiStore = useUiStore();
const screenRotation = ref<0 | 90 | 180 | 270>(0);

onMounted(async () => {
  const config = await ipcRenderer.invoke("get-config");
  autoLoadLibrary.value = config.autoLoadLibrary !== false;
  enableReadingHistory.value = config.enableReadingHistory !== false;
  screenRotation.value = (config.screenRotation as 0 | 90 | 180 | 270) || 0;
});

// 스위치 변경 시 저장
const onAutoLoadChange = (value: boolean) => {
  autoLoadLibrary.value = value;
  saveConfig("autoLoadLibrary", value);
};

const onEnableReadingHistoryChange = (value: boolean) => {
  enableReadingHistory.value = value;
  saveConfig("enableReadingHistory", value);
};

// 화면 회전 변경 시 저장
const onScreenRotationChange = async (value: AcceptableValue) => {
  const rotation = Number(value) as 0 | 90 | 180 | 270;
  screenRotation.value = rotation;
  uiStore.setScreenRotation(rotation); // 즉시 UI 반영
  await saveConfig("screenRotation", rotation);
};
</script>

<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>일반 설정</CardTitle>
        <CardDescription>앱의 일반적인 동작을 설정합니다.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <SettingItem
          label-for="auto-load-library"
          title="시작 시 라이브러리 자동 스캔"
          subtitle="앱 시작 시 라이브러리 폴더를 자동으로 스캔합니다."
        >
          <Switch
            id="auto-load-library"
            :model-value="autoLoadLibrary"
            class="justify-self-end"
            @update:model-value="onAutoLoadChange"
          />
        </SettingItem>
        <SettingItem
          label-for="enable-reading-history"
          title="읽음 기록"
          subtitle="책을 열람한 기록을 저장합니다."
        >
          <Switch
            id="enable-reading-history"
            :model-value="enableReadingHistory"
            class="justify-self-end"
            @update:model-value="onEnableReadingHistoryChange"
          />
        </SettingItem>
        <SettingItem
          label-for="screen-rotation"
          title="화면 회전"
          subtitle="원격 데스크톱 사용 시 유용합니다. (일부 UI 요소가 정상 표시되지 않을 수 있습니다)"
        >
          <Select
            id="screen-rotation"
            :model-value="String(screenRotation)"
            @update:model-value="onScreenRotationChange"
          >
            <SelectTrigger>
              <SelectValue placeholder="회전 각도 선택" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">0도 (기본)</SelectItem>
              <SelectItem value="90">90도</SelectItem>
              <SelectItem value="180">180도</SelectItem>
              <SelectItem value="270">270도</SelectItem>
            </SelectContent>
          </Select>
        </SettingItem>
      </CardContent>
    </Card>

  </div>
</template>
