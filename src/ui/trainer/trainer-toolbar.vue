<script setup lang="ts">
	import { computed } from "vue";
	import config, { Instrument } from "../../config";
	import { useI18n } from "../../services/i18n";
	import { Pattern } from "../../state/pattern";
	import { SILENT_STROKES, type Difficulty } from "../../services/trainerScorer";
	import { TrainerState, TrainerMode } from "../../services/trainerEngine";
	import HybridPopoverButton from "../utils/hybrid-popover-button.vue";
	import LatencySlider from "./latency-slider.vue";
	import DifficultySelector from "./difficulty-selector.vue";
	import SpeedSlider from "./speed-slider.vue";

	const props = defineProps<{
		pattern: Pattern | undefined;
		instrument: Instrument;
		mode: TrainerMode;
		state: TrainerState;
		latencyMs: number;
		difficulty: Difficulty;
		speedBpm: number;
		disabled?: boolean;
	}>();

	const emit = defineEmits<{
		"update:instrument": [v: Instrument];
		"update:mode": [v: TrainerMode];
		"update:latencyMs": [v: number];
		"update:difficulty": [v: Difficulty];
		"update:speedBpm": [v: number];
		"start": [];
		"stop": [];
		"calibrate": [];
	}>();

	const i18n = useI18n();

	const instrumentEnabled = (instr: Instrument) => {
		if (!props.pattern) return false;
		const line = props.pattern[instr] ?? [];
		return line.some((s) => !SILENT_STROKES.has(s ?? ""));
	};

	const isRunning = computed(() => ["countIn", "gameOn", "finalising", "requestingMic"].includes(props.state));
	const buttonLabel = computed(() => isRunning.value
		? i18n.t("trainer.toolbar.stop")
		: i18n.t("trainer.toolbar.start"));
	const buttonClass = computed(() => isRunning.value ? "btn-danger" : "btn-success");
</script>

<template>
	<div class="bb-trainer-toolbar">
		<button
			type="button"
			class="btn btn-lg flex-grow-1 flex-md-grow-0"
			:class="buttonClass"
			:disabled="props.disabled && !isRunning"
			@click="isRunning ? emit('stop') : emit('start')"
		>
			<fa :icon="isRunning ? 'stop' : 'play'" /> {{ buttonLabel }}
		</button>

		<select id="bb-trainer-instrument-select" class="form-select form-select-sm bb-trainer-instrument-picker" :aria-label="i18n.t('trainer.toolbar.instrument')" :value="instrument" @change="emit('update:instrument', ($event.target as HTMLSelectElement).value as Instrument)">
			<option
				v-for="k in config.instrumentKeys"
				:key="k"
				:value="k"
				:disabled="!instrumentEnabled(k)"
			>{{ config.instruments[k].name() }}{{ !instrumentEnabled(k) ? ' (–)' : '' }}</option>
		</select>

		<div class="btn-group" role="group">
			<input type="radio" class="btn-check" id="mode-instr" :checked="mode === 'instrument'" @change="emit('update:mode', 'instrument')">
			<label class="btn btn-outline-secondary btn-sm" for="mode-instr">{{ i18n.t("trainer.toolbar.modeInstrument") }}</label>
			<input type="radio" class="btn-check" id="mode-band" :checked="mode === 'band'" @change="emit('update:mode', 'band')">
			<label class="btn btn-outline-secondary btn-sm" for="mode-band">{{ i18n.t("trainer.toolbar.modeBand") }}</label>
		</div>

		<HybridPopoverButton variant="outline-secondary" :title="i18n.t('trainer.settings.title')" class="btn-sm">
			<template #button><fa icon="cog" /></template>
			<SpeedSlider :modelValue="speedBpm" :defaultSpeed="pattern?.speed ?? config.defaultSpeed" @update:modelValue="emit('update:speedBpm', $event)" />
			<LatencySlider class="mt-2" :modelValue="latencyMs" @update:modelValue="emit('update:latencyMs', $event)" @calibrate="emit('calibrate')" />
			<DifficultySelector class="mt-2" :modelValue="difficulty" @update:modelValue="emit('update:difficulty', $event)" />
		</HybridPopoverButton>
	</div>
</template>

<style lang="scss">
	.bb-trainer-toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		padding: 8px;
		background: var(--bs-tertiary-bg);
		border-bottom: 1px solid var(--bs-border-color);

		// Wrap order: Start always first, ⚙ popover always last.
		// Middle children (instrument select, mode toggle) wrap between them.
		> :first-child { order: -1; }
		> :last-child  { order:  1; }
	}
	.bb-trainer-instrument-picker { width: auto; }
</style>
