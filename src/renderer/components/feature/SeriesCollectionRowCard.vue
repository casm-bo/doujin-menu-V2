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
    class="bg-card hover:bg-accent/50 flex cursor-pointer items-center gap-4 rounded-lg border p-3 transition-colors"
    :class="{ 'border-primary bg-accent/40': selected }"
    @click="emit('click')"
  >
    <Checkbox
      :model-value="selected"
      :aria-label="`${series.name} 선택`"
      @click.stop="emit('toggle-select')"
    />

    <!-- 썸네일 -->
    <div class="bg-muted h-20 w-14 flex-shrink-0 overflow-hidden rounded">
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
        <h3 class="truncate font-semibold" :title="series.name">
          {{ series.name }}
        </h3>
      </div>
      <p
        v-if="series.description"
        class="text-muted-foreground truncate text-sm"
      >
        {{ series.description }}
      </p>
      <div class="text-muted-foreground mt-1 text-xs">
        {{ series.book_count || 0 }}권
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
