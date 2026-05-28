<script setup lang="ts">
	import { ref, computed, onBeforeUnmount, onMounted, TeleportProps, watch } from "vue";
	import { normalizeState, getPatternFromState } from "../../state/state";
	import { provideState } from "../../services/state";
	import { useRefWithOverride } from "../../utils";
	import { useI18n } from "../../services/i18n";
	import { getTuneOfTheYear } from "../../services/utils";
	import { stopAllPlayers } from "../../services/player";
	import config, { Instrument } from "../../config";
	import type { TrainerMode } from "../../services/trainerEngine";
	import { createTrainerEngine } from "../../services/trainerEngine";
	import { createMicPermission } from "../../services/mediaPermissions";
	import { createOnsetDetector } from "../../services/onsetDetector";
	import type { Verdict, Difficulty } from "../../services/trainerScorer";
	import { SILENT_STROKES } from "../../services/trainerScorer";
	import { normalizeTrainerSettings } from "../../state/trainerSettings";
	import { reactiveLocalStorage } from "../../services/localStorage";
	import HybridSidebar from "../utils/hybrid-sidebar.vue";
	import TuneList from "../listen/tune-list.vue";
	import CalibrationWizard from "./calibration-wizard.vue";
	import HeadphonesWarning from "./headphones-warning.vue";
	import PermissionDialog from "./permission-dialog.vue";
	import TrainerPartition from "./trainer-partition.vue";
	import TrainerScoreRail from "./trainer-score-rail.vue";
	import TrainerToolbar from "./trainer-toolbar.vue";

	const props = defineProps<{
		tuneName?: string;
		patternName?: string;
		sidebarToggleContainer?: TeleportProps['to'];
	}>();

	const emit = defineEmits<{
		"update:tuneName": [tuneName: string | undefined];
		"update:patternName": [patternName: string | undefined];
	}>();

	const i18n = useI18n();

	const tuneName = useRefWithOverride(undefined, () => props.tuneName, (v) => emit("update:tuneName", v));
	const patternName = useRefWithOverride(undefined, () => props.patternName, (v) => emit("update:patternName", v));

	// TuneList emits string | null | undefined; bridge to string | undefined
	const tuneNameForList = computed<string | null | undefined>({
		get: () => tuneName.value,
		set: (v) => { tuneName.value = v ?? undefined; }
	});

	const state = ref(normalizeState());
	provideState(state);

	const isSidebarExpanded = ref(false);

	watch(tuneName, () => {
		isSidebarExpanded.value = false;
		stopAllPlayers();
		if (!tuneName.value) tuneName.value = getTuneOfTheYear();
	}, { immediate: true });

	const tune = computed(() => tuneName.value ? state.value.tunes[tuneName.value] : undefined);
	const patternKeys = computed(() => tune.value ? Object.keys(tune.value.patterns) : []);

	// Auto-select first pattern when tune changes
	watch(patternKeys, () => {
		if (!patternName.value || !patternKeys.value.includes(patternName.value)) {
			patternName.value = patternKeys.value[0];
		}
	}, { immediate: true });

	const instrument = ref<Instrument>("sn");
	const mode = ref<TrainerMode>("instrument");
	const latencyMs = ref(0);
	const difficulty = ref<Difficulty>("easy");
	const speedBpm = ref(config.defaultSpeed);
	const calibrationOpen = ref(false);
	const permissionOpen = ref(false);
	const headphonesOpen = ref(false);

	const settings = computed({
		get: () => {
			const raw = reactiveLocalStorage.bbTrainerSettings;
			return normalizeTrainerSettings(raw ? JSON.parse(raw) : undefined);
		},
		set: (s) => { reactiveLocalStorage.bbTrainerSettings = JSON.stringify(s); },
	});

	const currentPattern = computed(() => tuneName.value && patternName.value
		? getPatternFromState(state.value, tuneName.value, patternName.value) ?? undefined
		: undefined);

	const hasHits = computed(() => {
		if (!currentPattern.value || !instrument.value) return false;
		return (currentPattern.value[instrument.value] ?? []).some((s) => !SILENT_STROKES.has(s ?? ""));
	});

	const micPermission = createMicPermission();
	const detector = createOnsetDetector();
	const engine = createTrainerEngine({ micPermission, detector });

	const trainerState = computed(() => engine.state.value);

	// Keep-if-overridden sync: on pattern/tune change, follow the new pattern's default ONLY IF
	// the user hasn't overridden speed (i.e. it still equals the previous pattern's default).
	// Mirrors src/ui/listen/tune-info.vue:47-53. MUST be declared before the configure watcher
	// so Vue runs it first in the same flush, ensuring engine.configure() sees the updated value.
	watch(currentPattern, (newPat, oldPat) => {
		if (!newPat) return;
		const prevDefault = oldPat?.speed ?? config.defaultSpeed;
		if (speedBpm.value === prevDefault) speedBpm.value = newPat.speed;
	}, { immediate: true });

	watch([currentPattern, instrument, mode, speedBpm, difficulty], () => {
		if (currentPattern.value && instrument.value) {
			engine.configure({
				pattern: currentPattern.value,
				instrument: instrument.value,
				speedBpm: speedBpm.value,
				mode: mode.value,
				difficulty: difficulty.value,
			});
		}
	}, { immediate: true });

	watch([instrument, mode, tuneName, patternName, latencyMs, difficulty], () => {
		settings.value = {
			...settings.value,
			lastInstrument: instrument.value,
			lastMode: mode.value,
			lastTuneName: tuneName.value,
			lastPatternName: patternName.value,
			latencyOffsetMs: latencyMs.value,
			difficulty: difficulty.value,
		};
	}, { deep: false });

	const s = settings.value;
	if (!props.tuneName && s.lastTuneName) tuneName.value = s.lastTuneName;
	if (!props.patternName && s.lastPatternName) patternName.value = s.lastPatternName;
	if (s.lastInstrument) instrument.value = s.lastInstrument;
	mode.value = s.lastMode;
	latencyMs.value = s.latencyOffsetMs;
	difficulty.value = s.difficulty;

	async function handleStart() {
		if (!settings.value.headphonesWarningAcked) {
			headphonesOpen.value = true;
			return;
		}
		if (!settings.value.micPromptAcked) {
			permissionOpen.value = true;
			return;
		}
		// eslint-disable-next-line no-console
		await engine.start().catch((err) => { console.error("Trainer engine failed to start:", err); });
	}

	function confirmHeadphones() {
		settings.value = { ...settings.value, headphonesWarningAcked: true };
		headphonesOpen.value = false;
		void handleStart();
	}

	function confirmPermission() {
		settings.value = { ...settings.value, micPromptAcked: true };
		permissionOpen.value = false;
		// eslint-disable-next-line no-console
		void engine.start().catch((err) => { console.error("Trainer engine failed to start:", err); });
	}

	async function handleStop() {
		await engine.stopGame();
	}

	function handleCalibrate() { calibrationOpen.value = true; }
	function applyCalibration(offsetMs: number) { latencyMs.value = offsetMs; }

	const stats = ref(engine.stats());
	// Throttled update via interval (~10 Hz) — could use a watcher on state but stats is non-reactive
	let statsTimer: number | null = null;
	watch(trainerState, (s) => {
		if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
		if (s === "gameOn" || s === "countIn") {
			statsTimer = window.setInterval(() => { stats.value = engine.stats(); }, 100);
		} else if (s === "results") {
			stats.value = engine.stats();
		}
	});

	const verdicts = ref<Map<number, Verdict>>(new Map());
	const recentHits = ref<{ delta: number; verdict: Verdict }[]>([]);

	function handleVerdict(e: { strokeIdx: number; verdict: Verdict; delta: number }) {
		const next = new Map(verdicts.value);
		next.set(e.strokeIdx, e.verdict);
		verdicts.value = next;
		recentHits.value = [...recentHits.value, { delta: e.delta, verdict: e.verdict }].slice(-5);
	}

	function handleLoopWrap() {
		verdicts.value = new Map();
	}

	watch(trainerState, (s, prev) => {
		if (s === "countIn" && prev !== "countIn") {
			verdicts.value = new Map();
			recentHits.value = [];
		}
	});

	onMounted(() => {
		engine.on("verdict", handleVerdict);
		engine.on("loopWrap", handleLoopWrap);
	});

	onBeforeUnmount(() => {
		engine.off("verdict", handleVerdict);
		engine.off("loopWrap", handleLoopWrap);
		if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
		void engine.stop();
	});
</script>

<template>
	<div class="bb-trainer">
		<HybridSidebar v-model:isExpanded="isSidebarExpanded" :toggleContainer="sidebarToggleContainer">
			<TuneList v-model:tuneName="tuneNameForList" />
			<template v-slot:toggle>
				<button type="button" class="btn btn-secondary" @click="isSidebarExpanded = !isSidebarExpanded">
					<fa icon="bars" />
				</button>
			</template>
		</HybridSidebar>

		<div class="bb-trainer-main">
			<TrainerScoreRail :stats="stats" :recentHits="recentHits" :micActive="trainerState !== 'idle' && trainerState !== 'results'" :latencyMs="latencyMs" :disabledReason="!hasHits ? i18n.t('trainer.no-hits') : undefined" v-if="tuneName && patternName" />
			<div v-if="tuneName && patternName" class="bb-trainer-pane">
				<TrainerToolbar
					:pattern="currentPattern"
					v-model:instrument="instrument"
					v-model:mode="mode"
					v-model:latencyMs="latencyMs"
					v-model:difficulty="difficulty"
					v-model:speedBpm="speedBpm"
					:state="trainerState"
					:disabled="!hasHits"
					@start="handleStart"
					@stop="handleStop"
					@calibrate="handleCalibrate"
				/>
				<TrainerPartition :tuneName="tuneName" :patternName="patternName" :instrument="instrument" :verdicts="verdicts" />
			</div>
			<div v-else class="p-3 text-muted">{{ i18n.t("trainer.pick-tune") }}</div>
		</div>

		<CalibrationWizard
			:open="calibrationOpen"
			@update:open="calibrationOpen = $event"
			:micPermission="micPermission"
			@apply="applyCalibration"
		/>
		<PermissionDialog v-model:open="permissionOpen" @confirm="confirmPermission" />
		<HeadphonesWarning v-model:open="headphonesOpen" @confirm="confirmHeadphones" />
		<div class="bb-trainer-rotate-overlay">
			<div class="bb-trainer-rotate-inner">
				<div class="bb-trainer-rotate-glyph">⟳</div>
				<h4>{{ i18n.t("trainer.rotate.title") }}</h4>
				<p>{{ i18n.t("trainer.rotate.hint") }}</p>
			</div>
		</div>
	</div>
</template>

<style lang="scss">
	.bb-trainer {
		display: flex;
		flex-grow: 1;
		min-height: 0;
		position: relative;

		.bb-tune-list {
			flex-grow: 1;
		}

		.bb-trainer-main {
			flex-grow: 1;
			display: flex;
			flex-direction: row;
			min-height: 0;

			.bb-trainer-pane {
				flex-grow: 1;
				display: flex;
				flex-direction: column;
				min-height: 0;
				overflow: auto;
			}
		}

		.bb-trainer-rotate-overlay { display: none; }
		@media (orientation: portrait) and (max-width: 767.98px) {
			.bb-trainer-rotate-overlay {
				display: flex;
				position: absolute;
				inset: 0;
				z-index: 50;
				align-items: center;
				justify-content: center;
				text-align: center;
				padding: 24px;
				background: var(--bs-body-bg);

				.bb-trainer-rotate-glyph { font-size: 44px; line-height: 1; margin-bottom: 12px; }
				p { color: var(--bs-secondary-color); font-size: 14px; max-width: 320px; }
			}
		}
	}
</style>
