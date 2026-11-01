<script setup lang="ts">
import { useGalleryBorders } from "@/composable/useGalleryBorders";
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
    display_title?: string;
    description: string | null;
    cover_image: string | null;
    book_count?: number;
    is_favorite?: boolean;
  };
}

defineProps<Props>();
const emit = defineEmits<{
  click: [];
  delete: [];
  "toggle-select": [];
}>();
const { borderStyle } = useGalleryBorders();
</script>

<template>
  <div
    :data-series-id="series.id"
    :style="borderStyle(true, !!series.is_favorite)"
    class="bg-card hover:bg-accent/50 flex cursor-pointer items-center gap-4 rounded-xl border p-3 transition-colors"
    :class="{ 'bg-selected-card ring-primary ring-2': selected }"
    @click="emit('click')"
  >
    <Checkbox
      :model-value="selected"
      :aria-label="`${series.name} 선택`"
      @click.stop="emit('toggle-select')"
    />

    <!-- 썸네일 -->
    <div
      class="bg-muted aspect-[0.72] w-[104px] flex-shrink-0 overflow-hidden rounded"
    >
      <img
        v-if="series.cover_image"
        :src="getThumbnailUrl(series.cover_image)"
        :alt="series.name"
        class="h-full w-full object-cover"
        @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
      />
      <div v-else class="flex h-full w-full items-center justify-center">
        <Icon
          icon="solar:library-bold-duotone"
          class="text-muted-foreground/30 h-8 w-8"
        />
      </div>
    </div>

    <!-- 정보 -->
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <button
          type="button"
          data-detail-trigger
          class="line-clamp-2 min-h-10 text-left text-sm font-semibold"
          :title="series.name"
          @click.stop="emit('click')"
        >
          {{ series.display_title || series.name }}
        </button>
      </div>
      <p
        v-if="series.description"
        class="text-muted-foreground truncate text-sm"
      >
        {{ series.description }}
      </p>
      <div
        v-if="series.book_count != null"
        class="text-muted-foreground mt-1 text-xs"
      >
        {{ series.book_count }}권
      </div>
    </div>

    <!-- 액션 -->
    <div class="flex-shrink-0" @click.stop>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon" class="h-8 w-8">
            <Icon icon="solar:menu-dots-bold" class="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
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
  </div>
</template>
