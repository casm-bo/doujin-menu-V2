<script setup lang="ts">
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Icon } from "@iconify/vue";
import SettingItem from "@/components/feature/settings/SettingItem.vue";
import { BLACKLIST_TYPES, buildBlacklistEntry } from "@/lib/blacklistTag";
import { AcceptableValue } from "reka-ui";
import { onMounted, ref } from "vue";
import { toast } from "vue-sonner";
import { ipcRenderer } from "@/api";
import { useQueryClient } from "@tanstack/vue-query";

const queryClient = useQueryClient();
const saveConfig = async (key: string, value: unknown) => {
  const result = await ipcRenderer.invoke("set-config", { key, value });
  if (!result.success && result.error) {
    toast.error("설정 저장에 실패했습니다.", { description: result.error });
  }
  queryClient.invalidateQueries({ queryKey: ["config"] });
};

const createInfoTxtFile = ref(true);
const subscriptionEnabled = ref(true);
const downloadPattern = ref("[%artist%][%id%] %title%");
const compressDownload = ref(false);
const compressFormat = ref<"cbz" | "zip">("cbz");
const downloadPath = ref("");
const hddDownloadMode = ref(false);
const capitalizeNames = ref(false);
const blacklistTags = ref<string[]>([]);
const newTagType = ref("tag");
const newTagName = ref("");
const blacklistError = ref("");

onMounted(async () => {
  const config = await ipcRenderer.invoke("get-config");
  createInfoTxtFile.value = config.createInfoTxtFile !== false;
  subscriptionEnabled.value = config.subscriptionEnabled !== false;
  downloadPattern.value =
    (config.downloadPattern as string) || "[%artist%][%id%] %title%";
  compressDownload.value = config.compressDownload === true;
  compressFormat.value = (config.compressFormat as "cbz" | "zip") || "cbz";
  downloadPath.value = (config.downloadPath as string) || "";
  hddDownloadMode.value = config.hddDownloadMode === true;
  capitalizeNames.value = config.capitalizeNames === true;
  blacklistTags.value = (config.downloaderBlacklistTags as string[]) || [];
});

const addBlacklistTag = () => {
  const result = buildBlacklistEntry(newTagType.value, newTagName.value);
  if (!result.ok) {
    blacklistError.value = result.error;
    return;
  }
  if (blacklistTags.value.includes(result.entry)) {
    blacklistError.value = "이미 목록에 있는 태그입니다.";
    return;
  }

  blacklistError.value = "";
  blacklistTags.value = [...blacklistTags.value, result.entry];
  newTagName.value = "";
  saveConfig("downloaderBlacklistTags", blacklistTags.value);
};

const removeBlacklistTag = (entry: string) => {
  blacklistTags.value = blacklistTags.value.filter((tag) => tag !== entry);
  blacklistError.value = "";
  saveConfig("downloaderBlacklistTags", blacklistTags.value);
};

const selectDownloadPath = async () => {
  const result = await ipcRenderer.invoke("select-folder");
  if (!result.success || !result.path) return;
  downloadPath.value = result.path;
  await saveConfig("downloadPath", result.path);
};

const openDownloadPath = () => {
  if (downloadPath.value) ipcRenderer.invoke("open-folder", downloadPath.value);
};

const onCreateInfoTxtFileChange = (value: boolean) => {
  createInfoTxtFile.value = value;
  saveConfig("createInfoTxtFile", value);
};

const onSubscriptionEnabledChange = (value: boolean) => {
  subscriptionEnabled.value = value;
  saveConfig("subscriptionEnabled", value);
};

const onDownloadPatternChange = (value: string) => {
  downloadPattern.value = value;
  saveConfig("downloadPattern", value);
};

const onCompressDownloadChange = (value: boolean) => {
  compressDownload.value = value;
  saveConfig("compressDownload", value);
};

const onCompressFormatChange = (value: AcceptableValue) => {
  compressFormat.value = value as "cbz" | "zip";
  saveConfig("compressFormat", value);
};

const onHddDownloadModeChange = (value: boolean) => {
  hddDownloadMode.value = value;
  saveConfig("hddDownloadMode", value);
};

const onCapitalizeNamesChange = (value: boolean) => {
  capitalizeNames.value = value;
  saveConfig("capitalizeNames", value);
};
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>다운로더 설정</CardTitle>
      <CardDescription>다운로드 관련 동작을 설정합니다.</CardDescription>
    </CardHeader>
    <CardContent class="space-y-6">
      <SettingItem
        title="다운로드 위치"
        subtitle="다운로드한 작품을 저장할 폴더입니다."
      >
        <div class="flex min-w-0 items-center justify-end gap-2">
          <code class="text-muted-foreground max-w-80 truncate text-xs">{{
            downloadPath || "미지정"
          }}</code>
          <Button variant="outline" size="sm" @click="selectDownloadPath">
            <Icon icon="solar:folder-open-bold-duotone" class="h-4 w-4" />변경
          </Button>
          <Button
            v-if="downloadPath"
            variant="outline"
            size="sm"
            @click="openDownloadPath"
          >
            열기
          </Button>
        </div>
      </SettingItem>
      <SettingItem
        label-for="hdd-download-mode"
        title="HDD 모드"
        subtitle="다운로드 폴더가 HDD일 때 사용합니다. SSD에서 다운로드와 압축을 처리해 HDD 부하를 줄이고 성능을 높인 뒤 완성된 파일만 HDD로 옮깁니다."
      >
        <Switch
          id="hdd-download-mode"
          :model-value="hddDownloadMode"
          class="justify-self-end"
          @update:model-value="onHddDownloadModeChange"
        />
      </SettingItem>
      <SettingItem
        label-for="create-info-txt-file"
        title="다운로드 후 info.txt 파일 생성"
        subtitle="다운로드 완료 후 작품 정보가 담긴 info.txt 파일을 생성합니다."
      >
        <Switch
          id="create-info-txt-file"
          :model-value="createInfoTxtFile"
          class="justify-self-end"
          @update:model-value="onCreateInfoTxtFileChange"
        />
      </SettingItem>
      <SettingItem
        label-for="subscription-enabled"
        title="구독 신작 확인"
        subtitle="앱이 켜져 있는 동안 1시간마다 구독한 검색어의 신작을 확인합니다."
      >
        <Switch
          id="subscription-enabled"
          :model-value="subscriptionEnabled"
          class="justify-self-end"
          @update:model-value="onSubscriptionEnabledChange"
        />
      </SettingItem>
      <SettingItem
        label-for="download-pattern-input"
        title="다운로드 폴더명 패턴"
        subtitle="다운로드될 폴더의 이름을 지정하는 패턴입니다."
      >
        <Input
          id="download-pattern-input"
          placeholder="[%artist%][%id%] %title%"
          class="col-span-1"
          :model-value="downloadPattern"
          @update:model-value="onDownloadPatternChange($event as string)"
        />
      </SettingItem>
      <div class="text-muted-foreground col-span-3 text-sm">
        <p class="font-semibold">사용 가능한 변수</p>
        <ul class="ml-4 list-inside list-disc">
          <li><code>%artist%</code>: 작가명</li>
          <li><code>%title%</code>: 작품 제목</li>
          <li><code>%id%</code>: 갤러리 ID</li>
          <li><code>%language%</code>: 언어</li>
          <li><code>%groups%</code>: 그룹</li>
          <li><code>%series%</code>: 시리즈</li>
          <li><code>%character%</code>: 캐릭터</li>
          <li><code>%type%</code>: 타입</li>
        </ul>
        <p class="mt-2 font-semibold">Fallback 문법</p>
        <p class="mt-1">
          <code>%변수1|변수2%</code> 형식으로 사용하면, 첫 번째 변수가 없을 때
          두 번째 변수를 대신 사용합니다.
        </p>
        <ul class="ml-4 list-inside list-disc">
          <li><code>%artist|groups%</code>: 작가명 (없으면 그룹명)</li>
          <li><code>%artist|groups|series%</code>: 작가 → 그룹 → 시리즈 순</li>
        </ul>
        <p class="mt-2">예시: <code>[%artist|groups%] %title% (%id%)</code></p>
        <p class="mt-2 font-semibold">폴더 구분자</p>
        <p class="mt-1">
          <code>\</code> 또는 <code>/</code>를 쓰면 하위 폴더가 만들어집니다.
        </p>
      </div>
      <SettingItem
        label-for="capitalize-names"
        title="작가·그룹명 첫 글자 대문자"
        subtitle="영문 작가명·그룹명의 각 단어 첫 글자를 대문자로 바꿉니다."
      >
        <Switch
          id="capitalize-names"
          :model-value="capitalizeNames"
          class="justify-self-end"
          @update:model-value="onCapitalizeNamesChange"
        />
      </SettingItem>
      <SettingItem
        label-for="compress-download"
        title="다운로드 후 압축"
        subtitle="다운로드 완료 후 이미지 파일을 압축합니다. 압축하면 원본 이미지 폴더는 자동으로 삭제됩니다."
      >
        <Switch
          id="compress-download"
          :model-value="compressDownload"
          class="justify-self-end"
          @update:model-value="onCompressDownloadChange"
        />
      </SettingItem>
      <SettingItem
        label-for="compress-format-select"
        title="압축 형식"
        subtitle="압축 파일의 형식을 선택합니다. CBZ는 만화책 전용 포맷입니다."
      >
        <Select
          id="compress-format-select"
          :model-value="compressFormat"
          :disabled="!compressDownload"
          @update:model-value="onCompressFormatChange"
        >
          <SelectTrigger class="w-[180px]">
            <SelectValue placeholder="압축 형식 선택" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cbz">CBZ (권장)</SelectItem>
            <SelectItem value="zip">ZIP</SelectItem>
          </SelectContent>
        </Select>
      </SettingItem>
      <div class="col-span-3 space-y-3 border-t pt-6">
        <div>
          <p class="text-sm font-semibold">차단 태그</p>
          <p class="text-muted-foreground text-sm">
            등록한 태그가 붙은 작품을 검색 결과에서 제외합니다. 갤러리 ID로 직접
            검색할 때는 적용하지 않습니다.
          </p>
        </div>
        <div class="flex flex-wrap items-start gap-2">
          <Select v-model="newTagType">
            <SelectTrigger class="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="type in BLACKLIST_TYPES"
                :key="type"
                :value="type"
              >
                {{ type }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Input
            v-model="newTagName"
            placeholder="예: yaoi, big breasts"
            class="w-[220px]"
            @keyup.enter="addBlacklistTag"
          />
          <Button variant="secondary" @click="addBlacklistTag">추가</Button>
        </div>
        <p v-if="blacklistError" class="text-destructive text-xs">
          {{ blacklistError }}
        </p>
        <div v-if="blacklistTags.length" class="flex flex-wrap gap-2">
          <span
            v-for="entry in blacklistTags"
            :key="entry"
            class="bg-muted inline-flex items-center gap-1 rounded-full py-1 pr-1 pl-3 text-xs"
          >
            {{ entry }}
            <button
              type="button"
              class="hover:bg-background rounded-full p-0.5"
              :aria-label="`${entry} 제거`"
              @click="removeBlacklistTag(entry)"
            >
              <Icon icon="solar:close-circle-bold-duotone" class="h-4 w-4" />
            </button>
          </span>
        </div>
        <p v-else class="text-muted-foreground text-xs">
          등록된 차단 태그가 없습니다.
        </p>
      </div>
    </CardContent>
  </Card>
</template>
