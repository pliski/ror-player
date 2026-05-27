<script setup lang="ts">
	import { computed } from "vue";
	import { useI18n } from "../../services/i18n";
	import type { Difficulty } from "../../services/trainerScorer";

	defineProps<{
		modelValue: Difficulty;
	}>();

	const emit = defineEmits<{
		"update:modelValue": [v: Difficulty];
	}>();

	const i18n = useI18n();
	const levels: Difficulty[] = ["easy", "normal", "hard"];
	const label = computed(() => i18n.t("trainer.difficulty.label"));
</script>

<template>
	<div class="bb-trainer-difficulty-selector">
		<label class="form-label">{{ label }}</label>
		<div class="btn-group d-flex" role="group" :aria-label="label">
			<template v-for="lvl in levels" :key="lvl">
				<input
					type="radio"
					class="btn-check"
					name="bb-trainer-difficulty"
					:id="`bb-trainer-difficulty-${lvl}`"
					:checked="modelValue === lvl"
					@change="emit('update:modelValue', lvl)"
				>
				<label class="btn btn-outline-secondary btn-sm" :for="`bb-trainer-difficulty-${lvl}`">
					{{ i18n.t(`trainer.difficulty.${lvl}`) }}
				</label>
			</template>
		</div>
	</div>
</template>

<style lang="scss">
	.bb-trainer-difficulty-selector {
		min-width: 180px;
	}
</style>
