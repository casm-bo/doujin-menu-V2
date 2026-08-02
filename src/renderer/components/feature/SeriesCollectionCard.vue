<script setup lang="ts">
import { getThumbnailUrl } from "@/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@iconify/vue";

interface Props {
  selected?: boolean;
  series: {
    id: number;
    name: string;
    description: string | null;
    cover_image: string | null;
    book_count?: number;
  };
}

defineProps<Props>();
const emit = defineEmits<{
  click: [];
  delete: [];
  "toggle-select": [];
}>();
</script>

<template>
  <div
    class="group bg-card text-card-foreground relative cursor-pointer rounded-lg border shadow-sm transition-all hover:shadow-md"
    :class="{ 'ring-primary ring-2': selected }"
    @click="emit('click')"
  >
    <!-- 커버 이미지 영역 -->
    <div class="bg-muted relative aspect-[3/4] overflow-hidden rounded-t-lg">
      <img
        v-if="series.cover_image"
        :src="getThumbnailUrl(series.cover_image)"
        :alt="series.name"
        class="h-full w-full object-cover"
        @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
      />
      <div
        v-else
        class="from-primary/10 to-primary/5 flex h-full w-full items-center justify-center bg-gradient-to-br"
      >
        <Icon
          icon="solar:library-bold-duotone"
          class="text-primary/30 h-16 w-16"
        />
      </div>

      <!-- 권수 뱃지 -->
      <div
        class="absolute top-2 right-2 rounded bg-black/60 px-2 py-1 text-xs font-semibold text-white backdrop-blur-sm"
      >
        {{ series.book_count || 0 }}권
      </div>

      <!-- 옵션 메뉴 -->
      <div
        class="absolute top-2 left-11 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <DropdownMenu>
          <DropdownMenuTrigger as-child @click.stop>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 bg-black/60 text-white hover:bg-black/80"
            >
              <Icon icon="solar:menu-dots-bold" class="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem @click.stop="emit('click')">
              <Icon icon="solar:eye-bold-duotone" class="mr-2 h-4 w-4" />
              상세 보기
            </DropdownMenuItem>
            <DropdownMenuItem
              class="text-destructive"
              @click.stop="emit('delete')"
            >
              <Icon
                icon="solar:trash-bin-trash-bold-duotone"
                class="mr-2 h-4 w-4"
              />
              삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        class="absolute top-2 left-2 flex size-8 items-center justify-center rounded bg-black/60"
        @click.stop="emit('toggle-select')"
      >
        <Checkbox :model-value="selected" :aria-label="`${series.name} 선택`" />
      </div>
    </div>

    <!-- 정보 영역 -->
    <div class="space-y-2 p-4">
      <div class="flex items-start justify-between gap-2">
        <h3 class="line-clamp-2 flex-1 font-semibold" :title="series.name">
          {{ series.name }}
        </h3>
      </div>

      <!-- 설명 -->
      <p
        v-if="series.description"
        class="text-muted-foreground line-clamp-2 text-sm"
      >
        {{ series.description }}
      </p>
    </div>
  </div>
</template>
