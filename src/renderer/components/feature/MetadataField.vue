<script setup lang="ts">
import { useTagDisplay } from "@/composable/useTagDisplay";
import { Icon } from "@iconify/vue";
import { nextTick, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    label: string;
    icon: string;
    values?: string[];
    editing?: boolean;
    multiple?: boolean;
    tagStyle?: boolean;
  }>(),
  { values: () => [], editing: false, multiple: true, tagStyle: false },
);

const { getTagDisplayInfo } = useTagDisplay();

const emit = defineEmits<{
  activate: [value: string];
  search: [value: string];
  remove: [index: number];
  add: [value: string];
}>();

const adding = ref(false);
const newValue = ref("");
const input = ref<HTMLInputElement | null>(null);

const beginAdd = async () => {
  adding.value = true;
  await nextTick();
  input.value?.focus();
};

const submit = () => {
  const value = newValue.value.trim();
  if (value) emit("add", value);
  newValue.value = "";
  adding.value = false;
};

const cancelAdd = () => {
  newValue.value = "";
  adding.value = false;
};

watch(
  () => props.editing,
  (editing) => {
    if (!editing) {
      adding.value = false;
      newValue.value = "";
    }
  },
);
</script>

<template>
  <div class="flex items-start gap-2" :class="{ 'gap-3 py-1': editing }">
    <Icon :icon="icon" class="text-primary mt-1 h-5 w-5 shrink-0" />
    <div class="min-w-0 flex-1">
      <p class="text-muted-foreground mb-1 text-xs">{{ label }}</p>
      <div
        class="flex flex-wrap items-center gap-1.5"
        :class="{ 'gap-2': editing }"
      >
        <component
          :is="editing ? 'div' : 'button'"
          v-for="(value, index) in values"
          :key="`${value}-${index}`"
          :type="editing ? undefined : 'button'"
          class="group/value inline-flex items-center gap-1 transition-colors"
          :class="[
            tagStyle && !editing
              ? getTagDisplayInfo({ name: value }).className
              : 'hover:bg-accent rounded-md px-2 py-1 text-sm',
            { 'px-3 py-2': editing, 'cursor-pointer': !editing },
          ]"
          @click="!editing && emit('activate', value)"
          @contextmenu.prevent="!editing && emit('search', value)"
        >
          <span>
            {{
              tagStyle && !editing
                ? getTagDisplayInfo({ name: value }).displayText
                : value
            }}
          </span>
          <button
            v-if="editing"
            type="button"
            class="text-destructive hover:bg-destructive/10 ml-0.5 inline-flex size-4 items-center justify-center rounded"
            :aria-label="`${value} 삭제`"
            @click.stop="emit('remove', index)"
          >
            <Icon icon="solar:close-circle-bold" class="size-3.5" />
          </button>
        </component>
        <span
          v-if="values.length === 0 && !editing"
          class="text-muted-foreground text-sm"
        >
          N/A
        </span>
        <input
          v-if="editing && adding"
          ref="input"
          v-model="newValue"
          class="bg-accent/60 focus:ring-ring min-w-28 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
          :aria-label="`${label} 추가`"
          @keydown.enter.prevent="submit"
          @keydown.escape.prevent="cancelAdd"
          @blur="submit"
        />
        <button
          v-else-if="editing && (multiple || values.length === 0)"
          type="button"
          class="hover:bg-accent inline-flex min-h-9 items-center rounded-md px-3 py-2 text-sm transition-colors"
          :aria-label="`${label} 추가`"
          @click="beginAdd"
        >
          <Icon icon="solar:add-circle-bold-duotone" class="size-4" />
        </button>
      </div>
    </div>
  </div>
</template>
