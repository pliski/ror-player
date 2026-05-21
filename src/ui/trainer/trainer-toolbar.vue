<script setup lang="ts">
	import { computed } from "vue";
	import config, { Instrument } from "../../config";
	import { useI18n } from "../../services/i18n";
	import { Pattern } from "../../state/pattern";
	import { SILENT_STROKES } from "../../services/trainerScorer";
	import { TrainerState, TrainerMode } from "../../services/trainerEngine";

	const props = defineProps<{
		pattern: Pattern | undefined;
		instrument: Instrument;
		mode: TrainerMode;
		state: TrainerState;
	}>();

	const emit = defineEmits<{
		"update:instrument": [v: Instrument];
		"update:mode": [v: TrainerMode];
		"start": [];
		"stop": [];
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
			@click="isRunning ? emit('stop') : emit('start')"
		>
			<fa :icon="isRunning ? 'stop' : 'play'" /> {{ buttonLabel }}
		</button>

		<div class="bb-trainer-instrument-picker">
			<label for="bb-trainer-instrument-select" class="form-label small mb-0">{{ i18n.t("trainer.toolbar.instrument") }}</label>
			<select id="bb-trainer-instrument-select" class="form-select form-select-sm" :value="instrument" @change="emit('update:instrument', ($event.target as HTMLSelectElement).value as Instrument)">
				<option
					v-for="k in config.instrumentKeys"
					:key="k"
					:value="k"
					:disabled="!instrumentEnabled(k)"
				>{{ config.instruments[k].name() }}{{ !instrumentEnabled(k) ? ' (–)' : '' }}</option>
			</select>
		</div>

		<div class="btn-group" role="group">
			<input type="radio" class="btn-check" id="mode-instr" :checked="mode === 'instrument'" @change="emit('update:mode', 'instrument')">
			<label class="btn btn-outline-secondary btn-sm" for="mode-instr">{{ i18n.t("trainer.toolbar.modeInstrument") }}</label>
			<input type="radio" class="btn-check" id="mode-band" :checked="mode === 'band'" @change="emit('update:mode', 'band')">
			<label class="btn btn-outline-secondary btn-sm" for="mode-band">{{ i18n.t("trainer.toolbar.modeBand") }}</label>
		</div>
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

		@media (max-width: 575.98px) {
			gap: 6px;
		}
	}
	.bb-trainer-instrument-picker {
		display: flex;
		align-items: center;
		gap: 6px;
	}
</style>
