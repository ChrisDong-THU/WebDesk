<script setup lang="ts" generic="T extends string | number">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import Icon from './Icon.vue';

const props = defineProps<{
  modelValue: T;
  label: string;
  options: readonly { label: string; value: T }[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: T]; open: [] }>();
const id = useId(),
  root = ref<HTMLElement>(),
  trigger = ref<HTMLButtonElement>(),
  list = ref<HTMLElement>();
const opened = ref(false),
  active = ref(0);
const menuLeft = ref(0);
const selected = computed(() => props.options.findIndex((option) => option.value === props.modelValue));
const currentLabel = computed(() => props.options[selected.value]?.label || '选择');
function open() {
  if (props.disabled) return;
  positionMenu();
  active.value = Math.max(0, selected.value);
  opened.value = true;
  emit('open');
}
function positionMenu() {
  if (!root.value || !list.value) return;
  const left = root.value.getBoundingClientRect().left;
  menuLeft.value = Math.max(12, Math.min(left, window.innerWidth - list.value.offsetWidth - 12)) - left;
}
function choose(index: number) {
  if (props.disabled || !props.options[index]) return;
  emit('update:modelValue', props.options[index].value);
  opened.value = false;
  trigger.value?.focus();
}
function keydown(event: KeyboardEvent) {
  if (props.disabled) return;
  if (event.key === 'Tab') {
    opened.value = false;
    return;
  }
  if (event.key === 'Escape') {
    if (opened.value) {
      opened.value = false;
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
    event.preventDefault();
    if (!opened.value) {
      open();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      choose(active.value);
      return;
    }
    if (event.key === 'Home') active.value = 0;
    else if (event.key === 'End') active.value = props.options.length - 1;
    else
      active.value =
        (active.value + (event.key === 'ArrowDown' ? 1 : -1) + props.options.length) % props.options.length;
  }
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) opened.value = false;
}
watch(
  () => props.disabled,
  (value) => {
    if (value) opened.value = false;
  },
);
onMounted(() => {
  document.addEventListener('pointerdown', outside);
  window.addEventListener('resize', positionMenu);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside);
  window.removeEventListener('resize', positionMenu);
});
</script>

<template>
  <div ref="root" class="quality-select">
    <button
      ref="trigger"
      type="button"
      class="quality-select-trigger"
      :class="{ expanded: opened }"
      role="combobox"
      :aria-label="label"
      aria-haspopup="listbox"
      :aria-expanded="opened"
      :aria-controls="id"
      :aria-activedescendant="opened ? `${id}-${active}` : undefined"
      :disabled="disabled"
      @click="opened ? (opened = false) : open()"
      @keydown="keydown"
      @blur="opened = false"
    >
      <span>{{ currentLabel }}</span
      ><Icon name="chevron" />
    </button>
    <div
      :id="id"
      ref="list"
      class="quality-options"
      :class="{ open: opened }"
      :style="{ left: `${menuLeft}px`, right: 'auto' }"
      role="listbox"
      :aria-label="label"
      :aria-hidden="!opened"
      :inert="!opened"
    >
      <div
        v-for="(option, index) in options"
        :id="`${id}-${index}`"
        :key="option.value"
        role="option"
        class="quality-option"
        :class="{ highlighted: active === index, selected: modelValue === option.value }"
        :aria-selected="modelValue === option.value"
        @pointermove="active = index"
        @pointerdown.prevent
        @click="choose(index)"
      >
        <span>{{ option.label }}</span
        ><Icon v-if="modelValue === option.value" name="check" />
      </div>
    </div>
  </div>
</template>
