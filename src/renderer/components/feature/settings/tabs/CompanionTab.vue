<script setup lang="ts">
import { ipcRenderer } from "@/api";
import SettingItem from "@/components/feature/settings/SettingItem.vue";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@iconify/vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { toast } from "vue-sonner";
import type {
  CompanionDeviceInfo,
  CompanionPairingCode,
  CompanionServerStatus,
} from "../../../../../types/companion";

const status = ref<CompanionServerStatus | null>(null);
const devices = ref<CompanionDeviceInfo[]>([]);
const pairing = ref<CompanionPairingCode | null>(null);
const isUpdating = ref(false);
const isRefreshing = ref(false);
const syncStatus = ref<{
  state: "idle" | "syncing" | "success" | "error";
  lastSyncedAt: string | null;
  bookCount: number;
  cursor: number;
  error: string | null;
} | null>(null);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const serverAddresses = computed(() => {
  if (!status.value?.addresses.length) return [];
  return status.value.addresses.map(
    (address) => `http://${address}:${status.value!.port}`,
  );
});

async function refresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    status.value = await ipcRenderer.invoke("get-companion-status");
    devices.value = await ipcRenderer.invoke("get-companion-devices");
    syncStatus.value = await ipcRenderer.invoke("get-companion-sync-status");
  } finally {
    isRefreshing.value = false;
  }
}

async function toggleServer(enabled: boolean) {
  isUpdating.value = true;
  pairing.value = null;
  try {
    const result = enabled
      ? await ipcRenderer.invoke("start-companion-server")
      : await ipcRenderer.invoke("stop-companion-server");
    if (!result.success) {
      throw new Error(result.error || "서버 상태를 변경하지 못했습니다.");
    }
    await refresh();
    toast.success(
      enabled ? "모바일 연동을 시작했습니다." : "모바일 연동을 중지했습니다.",
    );
  } catch (error) {
    toast.error("모바일 연동 설정에 실패했습니다.", {
      description: error instanceof Error ? error.message : String(error),
    });
  } finally {
    isUpdating.value = false;
  }
}

async function createPairingCode() {
  const result = await ipcRenderer.invoke("create-companion-pairing-code");
  if (result.success && result.data) {
    pairing.value = result.data;
  } else {
    toast.error("페어링 코드를 만들지 못했습니다.", {
      description: result.error,
    });
  }
}

async function revokeDevice(deviceId: string) {
  const result = await ipcRenderer.invoke("revoke-companion-device", deviceId);
  if (result.success) {
    await refresh();
    toast.success("등록된 기기 연결을 해제했습니다.");
  }
}

function formatDate(value: string | null) {
  if (!value) return "연결 기록 없음";
  return new Date(value).toLocaleString();
}

async function runSync() {
  if (syncStatus.value?.state === "syncing") return;
  syncStatus.value = {
    ...(syncStatus.value || {
      lastSyncedAt: null,
      bookCount: 0,
      cursor: 0,
      error: null,
    }),
    state: "syncing",
  };
  const result = await ipcRenderer.invoke("run-companion-sync");
  await refresh();
  if (result.success) toast.success("연결된 Android 기기에 동기화를 요청했습니다.");
  else toast.error("동기화 요청에 실패했습니다.", { description: result.error });
}

function connectionLabel(device: CompanionDeviceInfo) {
  if (!status.value?.running) return "연결 끊김";
  if (device.connectionState === "connecting") return "연결 중…";
  if (device.connectionState === "connected") return "연결됨";
  return "연결 끊김";
}

function connectionTextClass(device: CompanionDeviceInfo) {
  if (device.connectionState === "connecting") return "text-amber-600";
  if (device.connectionState === "connected") return "text-green-600";
  return "text-muted-foreground";
}

function connectionDotClass(device: CompanionDeviceInfo) {
  if (device.connectionState === "connecting") {
    return "bg-amber-500 animate-pulse";
  }
  if (device.connectionState === "connected") return "bg-green-500";
  return "bg-gray-400";
}

onMounted(() => {
  void refresh();
  refreshTimer = setInterval(() => void refresh(), 1_000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>모바일 연동</CardTitle>
        <CardDescription>
          같은 로컬 네트워크의 Android 앱에서 데스크톱 라이브러리 열람, 히토미
          검색과 다운로드를 사용할 수 있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <SettingItem
          label-for="companion-enabled"
          title="Companion Server"
          subtitle="데스크톱 앱이 실행 중일 때만 로컬 연결을 허용합니다."
        >
          <Switch
            id="companion-enabled"
            :model-value="status?.enabled || false"
            :disabled="isUpdating"
            @update:model-value="toggleServer"
          />
        </SettingItem>

        <div v-if="status?.running" class="rounded-lg border p-4">
          <div class="mb-3 flex items-center gap-2 font-medium">
            <span class="size-2 rounded-full bg-green-500" />
            연결 대기 중
          </div>
          <div v-if="serverAddresses.length" class="space-y-1 text-sm">
            <p
              v-for="address in serverAddresses"
              :key="address"
              class="font-mono"
            >
              {{ address }}
            </p>
          </div>
          <p v-else class="text-muted-foreground text-sm">
            사용 가능한 사설 IPv4 주소를 찾지 못했습니다.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-3 rounded-lg border p-4">
          <Button
            :disabled="!status?.running || syncStatus?.state === 'syncing'"
            @click="runSync"
          >
            <Icon
              :icon="syncStatus?.state === 'syncing' ? 'solar:refresh-circle-bold' : 'solar:refresh-bold'"
              class="size-5"
              :class="{ 'animate-spin': syncStatus?.state === 'syncing' }"
            />
            {{ syncStatus?.state === "syncing" ? "동기화 중" : "지금 동기화" }}
          </Button>
          <div class="text-sm">
            <p>
              상태:
              <span :class="syncStatus?.state === 'error' ? 'text-destructive' : 'text-muted-foreground'">
                {{ syncStatus?.state || "idle" }}
              </span>
            </p>
            <p v-if="syncStatus?.lastSyncedAt" class="text-muted-foreground text-xs">
              마지막 동기화 {{ formatDate(syncStatus.lastSyncedAt) }} · {{ syncStatus.bookCount }}권
            </p>
            <p v-if="syncStatus?.error" class="text-destructive text-xs">
              {{ syncStatus.error }}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card v-if="status?.running">
      <CardHeader>
        <CardTitle>새 기기 페어링</CardTitle>
        <CardDescription>
          코드는 5분 동안 유효하며 한 번 사용하면 즉시 만료됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <Button @click="createPairingCode">
          <Icon
            icon="solar:smartphone-rotate-angle-bold-duotone"
            class="size-5"
          />
          페어링 코드 생성
        </Button>

        <div v-if="pairing" class="rounded-lg border p-6 text-center">
          <p class="text-muted-foreground mb-2 text-sm">
            Android 앱에 입력할 코드
          </p>
          <p class="font-mono text-4xl font-bold tracking-[0.25em]">
            {{ pairing.code }}
          </p>
          <p class="text-muted-foreground mt-3 text-xs">
            {{ formatDate(pairing.expiresAt) }}까지 유효
          </p>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>등록된 기기</CardTitle>
        <CardDescription>페어링된 모바일 기기를 관리합니다.</CardDescription>
      </CardHeader>
      <CardContent>
        <p v-if="devices.length === 0" class="text-muted-foreground text-sm">
          등록된 기기가 없습니다.
        </p>
        <div v-else class="divide-y rounded-lg border">
          <div
            v-for="device in devices"
            :key="device.id"
            class="flex items-center justify-between gap-4 p-4"
          >
            <div>
              <p class="font-medium">{{ device.name }}</p>
              <p
                class="mt-1 flex items-center gap-1.5 text-sm font-medium"
                :class="connectionTextClass(device)"
              >
                <span
                  class="size-2 rounded-full"
                  :class="connectionDotClass(device)"
                />
                {{ connectionLabel(device) }}
              </p>
              <p class="text-muted-foreground text-xs">
                마지막 연결: {{ formatDate(device.lastSeenAt) }}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              @click="revokeDevice(device.id)"
            >
              연결 해제
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
