<script setup lang="ts">
	import { ref, watch } from "vue";
	import PatternPlayer from "../pattern-player/pattern-player.vue";
	import { type Verdict } from "../../services/trainerScorer";
	import { Instrument } from "../../config";

	const props = defineProps<{
		tuneName: string;
		patternName: string;
		instrument: Instrument;
		verdicts?: Map<number, Verdict>;
	}>();

	const containerRef = ref<HTMLDivElement>();

	function applyVerdicts() {
		const el = containerRef.value;
		if (!el) return;
		el.querySelectorAll(".stroke.verdict-good, .stroke.verdict-off, .stroke.verdict-miss")
			.forEach((n) => n.classList.remove("verdict-good", "verdict-off", "verdict-miss"));
		if (!props.verdicts) return;
		const row = el.querySelector(`tr[data-instrument="${props.instrument}"]`);
		if (!row) return;
		for (const [strokeIdx, v] of props.verdicts) {
			const cell = row.querySelector(`.stroke-i-${strokeIdx}`);
			if (cell) cell.classList.add(`verdict-${v}`);
		}
	}

	watch([() => props.verdicts && [...props.verdicts], () => props.instrument], applyVerdicts, { immediate: true });
</script>

<template>
	<div class="bb-trainer-partition" ref="containerRef">
		<PatternPlayer :tuneName="tuneName" :patternName="patternName" :readonly="true" :onlyInstrument="instrument" hidePlaybackControls />
	</div>
</template>

<style lang="scss">
	.bb-trainer-partition {
		.bb-pattern-editor-toolbar {
			display: none;
		}

		.stroke {
			&.verdict-good { background-color: color-mix(in srgb, var(--bs-success) 15%, transparent); }
			&.verdict-off  { background-color: color-mix(in srgb, var(--bs-warning) 15%, transparent); }
			&.verdict-miss { background-color: color-mix(in srgb, var(--bs-danger) 15%, transparent); text-decoration: line-through; }
		}
	}
</style>
