<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Search,
  Library,
  Settings,
  Wrench,
  Tags,
  Layers,
  Copy,
  ChartColumn,
} from "lucide-vue-next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearScrollPosition } from "@/composable/useScrollRestoration";
import { useSubscriptionStore } from "@/store/subscriptionStore";

const route = useRoute();
const router = useRouter();
const subscriptions = useSubscriptionStore();
const mainItems = [
  { to: "/downloader", name: "Downloader", label: "검색", icon: Search },
  { to: "/library", name: "Library", label: "라이브러리", icon: Library },
];
const managementItems = [
  { to: "/browse", name: "Browse", label: "태그 탐색", icon: Tags },
  {
    to: "/series-manager",
    name: "SeriesManager",
    label: "시리즈 관리",
    icon: Layers,
  },
  { to: "/duplicates", name: "Duplicates", label: "중복·ID 검토", icon: Copy },
  { to: "/statistics", name: "Statistics", label: "통계", icon: ChartColumn },
];
const isManagement = computed(() =>
  managementItems.some((item) => item.to === route.path),
);
const navigate = (item: { to: string; name: string }) => {
  if (route.path !== item.to) {
    router.push(item.to);
    return;
  }
  clearScrollPosition(item.name);
  document
    .querySelector<HTMLElement>("[data-result-scroll], main")
    ?.scrollTo({ top: 0 });
};
</script>

<template>
  <aside
    class="bg-toolbar flex min-h-0 w-[88px] flex-col items-center border-r py-3 select-none"
  >
    <nav
      aria-label="주 탐색"
      class="flex h-full w-full flex-col items-center gap-2"
    >
      <button
        v-for="item in mainItems"
        :key="item.to"
        type="button"
        class="rail-item"
        :aria-current="route.path === item.to ? 'page' : undefined"
        :title="item.label"
        @click="navigate(item)"
      >
        <span class="rail-icon relative"
          ><component :is="item.icon" class="size-5" />
          <span
            v-if="item.to === '/downloader' && subscriptions.hasUnseen"
            class="bg-destructive absolute top-0 right-2 size-2 rounded-full"
            aria-label="새 구독 작품 있음"
          />
        </span>
        <span>{{ item.label }}</span>
      </button>
      <div class="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="rail-item"
            :data-active="isManagement"
            aria-label="관리 메뉴"
            title="관리"
          >
            <span class="rail-icon"><Wrench class="size-5" /></span
            ><span>관리</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" class="w-48 rounded-xl">
          <DropdownMenuItem
            v-for="item in managementItems"
            :key="item.to"
            @select="navigate(item)"
          >
            <component :is="item.icon" class="mr-2 size-5" />{{ item.label }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        class="rail-item"
        :aria-current="route.path === '/settings' ? 'page' : undefined"
        title="설정"
        @click="navigate({ to: '/settings', name: 'Settings' })"
      >
        <span class="rail-icon"><Settings class="size-5" /></span
        ><span>설정</span>
      </button>
    </nav>
  </aside>
</template>

<style scoped>
.rail-item {
  display: flex;
  width: 80px;
  min-height: 64px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 12px;
}
.rail-icon {
  display: flex;
  width: 56px;
  min-height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 20px;
}
.rail-item:hover .rail-icon {
  background: var(--accent);
}
.rail-item[aria-current="page"] .rail-icon,
.rail-item[data-active="true"] .rail-icon {
  background: color-mix(
    in srgb,
    var(--primary) 22%,
    var(--toolbar, var(--sidebar))
  );
}
.rail-item:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
</style>
