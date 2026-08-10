<script setup lang="ts">
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import LibraryScanProgress from "@/components/feature/LibraryScanProgress.vue";
import SettingItem from "@/components/feature/settings/SettingItem.vue";
import { Icon } from "@iconify/vue";
import { onMounted, onUnmounted, ref } from "vue";
import { toast } from "vue-sonner";
import { ipcRenderer } from "@/api";
import { useQueryClient } from "@tanstack/vue-query";
import type { MetadataRescanMode } from "../../../../../types/ipc";

interface LibraryFolder {
  path: string;
  bookCount: number;
  lastScanned: string | null;
}

interface ArchivedLibraryFolder {
  path: string;
  removedAt: string;
  bookCount: number;
}

const queryClient = useQueryClient();
const isRegeneratingThumbnails = ref(false);
const saveConfig = async (key: string, value: unknown) => {
  const result = await ipcRenderer.invoke("set-config", { key, value });
  if (!result.success && result.error) {
    toast.error("설정 저장에 실패했습니다.", { description: result.error });
  }
  queryClient.invalidateQueries({ queryKey: ["config"] });
};

const libraryFolders = ref<LibraryFolder[]>([]);
const archivedLibraryFolders = ref<ArchivedLibraryFolder[]>([]);
const folderToRemove = ref<string | null>(null);
const folderToForget = ref<string | null>(null);
const prioritizeKoreanTitles = ref(false);
const hideLibraryTags = ref(false);
const showRescanModeDialog = ref(false);
const showHardRescanWarning = ref(false);
const isRescanningMetadata = ref(false);

// info.txt 생성 상태
const isGeneratingInfoFiles = ref(false);
const generationProgress = ref({
  current: 0,
  total: 0,
  message: "",
});
const infoFilePattern = ref("\\((\\d+)\\)$");
const handleInfoGenerationProgress = (...args: unknown[]) => {
  const progress = args[0] as {
    current: number;
    total: number;
    message: string;
  };
  generationProgress.value = progress;
  if (progress.current >= progress.total) {
    isGeneratingInfoFiles.value = false;
  }
};
let stopInfoGenerationProgress = () => {};

onMounted(async () => {
  const config = await ipcRenderer.invoke("get-config");
  prioritizeKoreanTitles.value = config.prioritizeKoreanTitles === true;
  hideLibraryTags.value = config.hideLibraryTags === true;
  await loadLibraryFolders();

  stopInfoGenerationProgress = ipcRenderer.on(
    "info-generation-progress",
    handleInfoGenerationProgress,
  );
});

onUnmounted(() => {
  stopInfoGenerationProgress();
});

// 라이브러리 폴더 정보 불러오기
const loadLibraryFolders = async () => {
  const config = await ipcRenderer.invoke("get-config");
  const folders = (config.libraryFolders || []) as string[];
  const folderPromises = folders.map(async (folder: string) => {
    const stats = await ipcRenderer.invoke("get-library-folder-stats", folder);
    return {
      path: folder,
      bookCount: stats.data?.bookCount || 0,
      lastScanned: stats.data?.lastScanned || null,
    };
  });
  libraryFolders.value = await Promise.all(folderPromises);
  archivedLibraryFolders.value = await Promise.all(
    (config.archivedLibraryFolders || []).map(async (folder) => {
      const stats = await ipcRenderer.invoke(
        "get-library-folder-stats",
        folder.path,
      );
      return {
        ...folder,
        bookCount: stats.data?.bookCount || 0,
      };
    }),
  );
};

// 라이브러리 폴더 추가
const addLibraryFolder = async () => {
  const result = await ipcRenderer.invoke("add-library-folder");
  if (result.success) {
    await loadLibraryFolders();
    await queryClient.invalidateQueries({ queryKey: ["config"] });
    if (result.added && result.added.length > 0) {
      toast.success(
        `${result.added.length}개의 라이브러리 폴더가 추가되었습니다.`,
      );
    }
    if (result.alreadyExists && result.alreadyExists.length > 0) {
      toast.info(`${result.alreadyExists.length}개의 폴더는 이미 존재합니다.`);
    }
  } else if (result.error && result.error !== "No folder selected.") {
    toast.error("폴더 추가에 실패했습니다.", { description: result.error });
  }
};

// 라이브러리 폴더 삭제
const removeLibraryFolder = async () => {
  if (!folderToRemove.value) return;
  const result = await ipcRenderer.invoke(
    "remove-library-folder",
    folderToRemove.value,
  );
  if (result.success) {
    await loadLibraryFolders();
    await queryClient.invalidateQueries({ queryKey: ["config"] });
    toast.success("라이브러리 폴더가 제거되었습니다.", {
      description: `${result.archivedBooks || 0}권의 책 기록을 보관했습니다. 실제 파일과 DB 정보는 삭제하지 않았습니다.`,
    });
  } else {
    toast.error("라이브러리 폴더를 제거하지 못했습니다.", {
      description: result.error,
    });
  }
  folderToRemove.value = null;
};

const restoreLibraryFolder = async (folderPath: string) => {
  const result = await ipcRenderer.invoke("restore-library-folder", folderPath);
  if (result.success) {
    await loadLibraryFolders();
    await queryClient.invalidateQueries({ queryKey: ["config"] });
    toast.success("라이브러리 폴더를 복원했습니다.", {
      description: "변경된 파일을 반영하려면 폴더를 다시 스캔하세요.",
    });
  } else {
    toast.error("라이브러리 폴더를 복원하지 못했습니다.", {
      description: result.error,
    });
  }
};

const forgetLibraryFolder = async () => {
  if (!folderToForget.value) return;
  const result = await ipcRenderer.invoke(
    "forget-library-folder",
    folderToForget.value,
  );
  if (result.success) {
    await loadLibraryFolders();
    await queryClient.invalidateQueries({ queryKey: ["books"] });
    toast.success("보관된 라이브러리 정보를 삭제했습니다.", {
      description: `${result.removedBooks || 0}권의 DB 기록을 삭제했습니다. 실제 파일은 유지됩니다.`,
    });
  } else {
    toast.error("보관된 라이브러리 정보를 삭제하지 못했습니다.", {
      description: result.error,
    });
  }
  folderToForget.value = null;
};

// 라이브러리 폴더 다시 스캔
const rescanLibraryFolder = async (folderPath: string) => {
  toast.info(`'${folderPath}' 폴더를 다시 스캔합니다...`);
  const result = await ipcRenderer.invoke("rescan-library-folder", folderPath);
  if (result.success && result.offline) {
    toast.warning("폴더에 접근할 수 없습니다.", {
      description: `해당 폴더에 접근할 수 없어 ${result.offlineCount}권을 오프라인으로 표시했습니다.`,
    });
  } else if (result.success) {
    await loadLibraryFolders();
    toast.success(`'${folderPath}' 폴더 스캔이 완료되었습니다.`);
  } else {
    toast.error("폴더 스캔에 실패했습니다.", { description: result.error });
  }
};

// 전체 썸네일 재생성
const regenerateAllThumbnails = async () => {
  if (isRegeneratingThumbnails.value) return;
  isRegeneratingThumbnails.value = true;
  toast.info("전체 썸네일 재생성을 시작합니다...");
  try {
    const result = await ipcRenderer.invoke("regenerate-all-thumbnails");
    if (result.success) {
      toast.success(`${result.count ?? 0}개의 썸네일을 재생성했습니다.`);
    } else {
      toast.error("썸네일 재생성에 실패했습니다.", {
        description: result.error,
      });
    }
  } finally {
    isRegeneratingThumbnails.value = false;
  }
};

// 전체 메타데이터 재스캔
const rescanAllMetadata = async (mode: MetadataRescanMode) => {
  isRescanningMetadata.value = true;
  toast.info("전체 메타데이터 재스캔을 시작합니다...");
  try {
    const result = await ipcRenderer.invoke("rescan-all-metadata", mode);
    if (result.success) {
      await loadLibraryFolders();
      toast.success("모든 라이브러리 폴더의 메타데이터 스캔이 완료되었습니다.");
    } else {
      toast.error("메타데이터 재스캔에 실패했습니다.", {
        description: result.error,
      });
    }
  } finally {
    isRescanningMetadata.value = false;
  }
};

// 폴더 열기
const openFolder = async (folderPath: string) => {
  const result = await ipcRenderer.invoke("open-folder", folderPath);
  if (result.success) {
    toast.success("폴더를 열었습니다.");
  } else {
    toast.error("폴더 열기에 실패했습니다.", { description: result.error });
  }
};

const onPrioritizeKoreanTitlesChange = (value: boolean) => {
  prioritizeKoreanTitles.value = value;
  saveConfig("prioritizeKoreanTitles", value);
};

const onHideLibraryTagsChange = (value: boolean) => {
  hideLibraryTags.value = value;
  saveConfig("hideLibraryTags", value);
};

// info.txt 파일 생성
const generateMissingInfoFiles = async () => {
  isGeneratingInfoFiles.value = true;
  generationProgress.value = { current: 0, total: 0, message: "" }; // 상태 초기화
  try {
    const result = await ipcRenderer.invoke(
      "generate-missing-info-files",
      infoFilePattern.value,
    );
    // 최종 결과는 progress 핸들러가 아닌 토스트로 표시
    if (result.success) {
      toast.success("info.txt 파일 생성이 완료되었습니다.", {
        description: "라이브러리를 갱신해야 변경사항이 반영됩니다.",
      });
    } else {
      toast.error(result.error || "알 수 없는 오류가 발생했습니다.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast.error(`오류가 발생했습니다: ${message}`);
    isGeneratingInfoFiles.value = false; // 에러 발생 시 명시적으로 상태 종료
  }
};
</script>

<template>
  <div class="space-y-6">
    <!-- 스캔 진행률 표시 -->
    <LibraryScanProgress />

    <Card>
      <CardHeader>
        <CardTitle>라이브러리 폴더</CardTitle>
        <CardDescription
          >만화 파일이 저장된 폴더를 관리합니다. 폴더를 추가하면 자동으로 스캔이
          시작됩니다.</CardDescription
        >
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <div
            v-if="libraryFolders.length === 0"
            class="text-muted-foreground rounded-md border-2 border-dashed p-6 text-center text-sm"
          >
            등록된 라이브러리 폴더가 없습니다.
          </div>
          <div
            v-for="folder in libraryFolders"
            :key="folder.path"
            class="flex items-center justify-between rounded-md border p-4"
          >
            <div class="truncate pr-4">
              <p class="font-mono text-sm">{{ folder.path }}</p>
              <p class="text-muted-foreground text-xs">
                {{ folder.bookCount || 0 }}권 | 마지막 스캔:
                {{
                  folder.lastScanned
                    ? new Date(folder.lastScanned).toLocaleString()
                    : "N/A"
                }}
              </p>
            </div>
            <div class="flex flex-shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                @click="openFolder(folder.path)"
              >
                <Icon
                  icon="solar:folder-open-bold-duotone"
                  class="h-5 w-5 text-gray-500"
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                @click="rescanLibraryFolder(folder.path)"
              >
                <Icon
                  icon="solar:refresh-bold-duotone"
                  class="h-5 w-5 text-blue-500"
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                @click="folderToRemove = folder.path"
              >
                <Icon
                  icon="solar:trash-bin-trash-bold-duotone"
                  class="h-5 w-5 text-red-500"
                />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button class="w-full" @click="addLibraryFolder">
          <Icon icon="solar:folder-add-bold-duotone" class="h-5 w-5" />
          라이브러리 폴더 추가
        </Button>
      </CardFooter>
    </Card>

    <AlertDialog
      :open="folderToRemove !== null"
      @update:open="(open) => !open && (folderToRemove = null)"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle
            >라이브러리 폴더를 제거하시겠습니까?</AlertDialogTitle
          >
          <AlertDialogDescription>
            폴더만 라이브러리에서 제거합니다. 책 정보, 읽기 기록, 즐겨찾기,
            시리즈와 실제 파일은 보관됩니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <Button @click="removeLibraryFolder"> 보관하고 제거 </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Card v-if="archivedLibraryFolders.length > 0">
      <CardHeader>
        <CardTitle>보관된 라이브러리</CardTitle>
        <CardDescription>
          제거한 폴더의 DB 정보입니다. 폴더를 복원하거나 정보를 영구적으로
          삭제할 수 있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <div
          v-for="folder in archivedLibraryFolders"
          :key="folder.path"
          class="flex items-center justify-between rounded-md border p-4"
        >
          <div class="min-w-0 truncate pr-4">
            <p class="truncate font-mono text-sm" :title="folder.path">
              {{ folder.path }}
            </p>
            <p class="text-muted-foreground text-xs">
              {{ folder.bookCount }}권 | 제거됨:
              {{ new Date(folder.removedAt).toLocaleString() }}
            </p>
          </div>
          <div class="flex flex-shrink-0 items-center gap-2">
            <Button
              variant="outline"
              @click="restoreLibraryFolder(folder.path)"
            >
              <Icon icon="solar:restart-bold-duotone" class="h-4 w-4" />
              복원
            </Button>
            <Button variant="destructive" @click="folderToForget = folder.path">
              <Icon icon="solar:trash-bin-trash-bold-duotone" class="h-4 w-4" />
              정보 삭제
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <AlertDialog
      :open="folderToForget !== null"
      @update:open="(open) => !open && (folderToForget = null)"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle
            >보관된 정보를 영구적으로 삭제하시겠습니까?</AlertDialogTitle
          >
          <AlertDialogDescription>
            책 정보, 읽기 기록, 즐겨찾기, 시리즈와 썸네일을 DB에서 삭제합니다.
            실제 파일은 삭제하지 않지만 이 작업은 되돌릴 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <Button variant="destructive" @click="forgetLibraryFolder">
            정보 영구 삭제
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Card>
      <CardHeader>
        <CardTitle>라이브러리 표시 설정</CardTitle>
        <CardDescription
          >라이브러리 화면에 표시되는 내용을 설정합니다.</CardDescription
        >
      </CardHeader>
      <CardContent class="space-y-6">
        <SettingItem
          label-for="prioritize-korean-titles"
          title="한국어 제목 우선 표시"
        >
          <template #subtitle>
            <p class="text-muted-foreground text-sm">
              제목에 한국어와 다른 언어가 함께 있을 경우 한국어를 우선적으로
              표시합니다. (예: 'Original Title | 한국어 제목' -> '한국어 제목')
            </p>
            <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">
              <Icon
                icon="solar:danger-triangle-bold-duotone"
                class="inline-block h-4 w-4"
              />
              이 기능은 파일명의 형식이 일관되지 않은 경우 제목이 예상대로
              나타나지 않을 수 있습니다.
            </p>
          </template>
          <Switch
            id="prioritize-korean-titles"
            :model-value="prioritizeKoreanTitles"
            class="justify-self-end"
            @update:model-value="onPrioritizeKoreanTitlesChange"
          />
        </SettingItem>
        <SettingItem
          label-for="hide-library-tags"
          title="라이브러리 태그 목록 숨기기"
          subtitle="라이브러리에서 책 카드의 태그 목록을 숨깁니다."
        >
          <Switch
            id="hide-library-tags"
            :model-value="hideLibraryTags"
            class="justify-self-end"
            @update:model-value="onHideLibraryTagsChange"
          />
        </SettingItem>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>라이브러리 재스캔</CardTitle>
        <CardDescription
          >라이브러리 전체를 대상으로 썸네일 및 메타데이터를 다시
          스캔합니다.</CardDescription
        >
      </CardHeader>
      <CardContent class="space-y-4">
        <SettingItem title="전체 썸네일 재생성">
          <Button
            variant="outline"
            :disabled="isRegeneratingThumbnails"
            @click="regenerateAllThumbnails"
            >재생성</Button
          >
        </SettingItem>
        <SettingItem title="전체 메타데이터 재스캔">
          <Button
            variant="outline"
            :disabled="isRescanningMetadata"
            @click="showRescanModeDialog = true"
          >
            재스캔
          </Button>
        </SettingItem>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>info.txt 생성</CardTitle>
        <CardDescription
          >info.txt 파일이 없는 폴더를 찾아 폴더명 정규식 기반으로 파일을
          생성합니다.</CardDescription
        >
      </CardHeader>
      <CardContent class="space-y-6">
        <div class="space-y-2">
          <Label for="info-file-pattern">폴더명 분석 정규식</Label>
          <Input
            id="info-file-pattern"
            v-model="infoFilePattern"
            placeholder="예: \((\d+)\)$"
          />
          <p class="text-muted-foreground text-sm">
            폴더명에서 갤러리 ID를 추출할 정규식을 입력합니다. 첫 번째 캡처
            그룹이 ID로 사용됩니다.
          </p>
        </div>
        <SettingItem
          label-for="generate-info-files"
          title="info.txt 생성"
          subtitle="info.txt 파일이 없는 폴더를 찾아 위 정규식을 기반으로 파일을 생성합니다."
        >
          <Button
            id="generate-info-files"
            variant="outline"
            class="justify-self-end"
            :disabled="isGeneratingInfoFiles"
            @click="generateMissingInfoFiles"
          >
            <Icon
              v-if="isGeneratingInfoFiles"
              icon="svg-spinners:ring-resize"
              class="mr-2 h-4 w-4"
            />
            생성 시작
          </Button>
        </SettingItem>
        <div
          v-if="isGeneratingInfoFiles || generationProgress.total > 0"
          class="space-y-2 pt-4"
        >
          <div class="text-muted-foreground flex justify-between text-sm">
            <span>진행률</span>
            <span
              >{{ generationProgress.current }} /
              {{ generationProgress.total }}</span
            >
          </div>
          <Progress
            :model-value="
              generationProgress.total > 0
                ? (generationProgress.current / generationProgress.total) * 100
                : 0
            "
            class="w-full"
          />
          <p class="text-muted-foreground truncate text-sm">
            {{ generationProgress.message }}
          </p>
        </div>
      </CardContent>
    </Card>
  </div>

  <AlertDialog
    :open="showRescanModeDialog"
    @update:open="showRescanModeDialog = $event"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>재스캔 방식을 선택하세요</AlertDialogTitle>
        <AlertDialogDescription>
          Soft는 현재 메타데이터를 유지하며 info.txt의 누락된 값을 합칩니다.
          Hard는 info.txt 기준으로 기존 메타데이터를 교체합니다.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>취소</AlertDialogCancel>
        <AlertDialogAction @click="rescanAllMetadata('soft')">
          Soft 재스캔
        </AlertDialogAction>
        <Button
          variant="destructive"
          @click="
            showRescanModeDialog = false;
            showHardRescanWarning = true;
          "
        >
          Hard 재스캔
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <AlertDialog
    :open="showHardRescanWarning"
    @update:open="showHardRescanWarning = $event"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>편집한 메타데이터를 덮어쓸까요?</AlertDialogTitle>
        <AlertDialogDescription>
          Hard 재스캔은 현재 값을 info.txt로 교체하며, info.txt에 없는 항목은
          비웁니다. 이 작업은 되돌릴 수 없습니다.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>취소</AlertDialogCancel>
        <AlertDialogAction @click="rescanAllMetadata('hard')">
          덮어쓰기
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
