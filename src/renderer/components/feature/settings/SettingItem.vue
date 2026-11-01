<template>
  <div
    class="flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"
  >
    <div class="flex min-w-0 grow flex-col items-start gap-1 break-words">
      <Label :for="labelFor">{{ title }}</Label>
      <slot name="subtitle" />
      <p
        v-if="subtitle && !$slots.subtitle"
        class="text-muted-foreground text-sm"
      >
        {{ subtitle }}
      </p>
    </div>
    <div class="w-full min-w-0 sm:w-auto sm:shrink-0 [&>*]:max-w-full">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Label } from "@/components/ui/label";

defineProps<{
  labelFor?: string;
  title: string;
  subtitle?: string;
}>();
</script>
