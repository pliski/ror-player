<script setup lang="ts">
	import { ref, computed, onBeforeUnmount, onMounted, TeleportProps, watch } from "vue";
	import { normalizeState, getPatternFromState } from "../../state/state";
	import { provideState } from "../../services/state";
	import { useRefWithOverride } from "../../utils";
	import { useI18n } from "../../services/i18n";
	import { getTuneOfTheYear } from "../../services/utils";
	import { stopAllPlayers } from "../../services/player";
	import { Instrument } from "../../config";
	import type { TrainerMode } from "../../services/trainerEngine";
	import { createTrainerEngine } from "../../services/trainerEngine";
	import { createMicPermission } from "../../services/mediaPermissions";
	import { createOnsetDetector } from "../../services/onsetDetector";
	import type { Verdict } from "../../services/trainerScorer";
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

	const micPermission = createMicPermission();
	const detector = createOnsetDetector();
	const engine = createTrainerEngine({ micPermission, detector });

	const trainerState = computed(() => engine.state.value);

	watch([currentPattern, instrument, mode, () => currentPattern.value?.speed], () => {
		if (currentPattern.value && instrument.value) {
			engine.configure({
				pattern: currentPattern.value,
				instrument: instrument.value,
				speedBpm: currentPattern.value.speed,
				mode: mode.value,
			});
		}
	}, { immediate: true });

	watch([instrument, mode, tuneName, patternName, latencyMs], () => {
		settings.value = {
			...settings.value,
			lastInstrument: instrument.value,
			lastMode: mode.value,
			lastTuneName: tuneName.value,
			lastPatternName: patternName.value,
			latencyOffsetMs: latencyMs.value,
		};
	}, { deep: false });

	const s = settings.value;
	if (!props.tuneName && s.lastTuneName) tuneName.value = s.lastTuneName;
	if (!props.patternName && s.lastPatternName) patternName.value = s.lastPatternName;
	if (s.lastInstrument) instrument.value = s.lastInstrument;
	mode.value = s.lastMode;
	latencyMs.value = s.latencyOffsetMs;

	async function handleStart() {
		if (mode.value === "band" && !settings.value.headphonesWarningAcked) {
			headphonesOpen.value = true;
			return;
		}
		if (!settings.value.micPromptAcked) {
			permissionOpen.value = true;
			return;
		}
		await engine.start().catch(() => {});
	}

	function confirmHeadphones() {
		settings.value = { ...settings.value, headphonesWarningAcked: true };
		headphonesOpen.value = false;
		void handleStart();
	}

	function confirmPermission() {
		settings.value = { ...settings.value, micPromptAcked: true };
		permissionOpen.value = false;
		void engine.start().catch(() => {});
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

	function handleVerdict(e: { strokeIdx: number; verdict: Verdict }) {
		const next = new Map(verdicts.value);
		next.set(e.strokeIdx, e.verdict);
		verdicts.value = next;
	}

	function handleLoopWrap() {
		verdicts.value = new Map();
	}

	watch(trainerState, (s, prev) => {
		if (s === "countIn" && prev !== "countIn") verdicts.value = new Map();
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
			<TrainerScoreRail :stats="stats" :micActive="trainerState !== 'idle' && trainerState !== 'results'" :latencyMs="latencyMs" v-if="tuneName && patternName" />
			<div v-if="tuneName && patternName" class="bb-trainer-pane">
				<TrainerToolbar
					:pattern="currentPattern"
					v-model:instrument="instrument"
					v-model:mode="mode"
					v-model:latencyMs="latencyMs"
					:state="trainerState"
					@start="handleStart"
					@stop="handleStop"
					@calibrate="handleCalibrate"
				/>
				<TrainerPartition :tuneName="tuneName" :patternName="patternName" :verdicts="verdicts" />
			</div>
			<div v-else class="p-3 text-muted">{{ i18n.t("trainer.pick-tune") }}</div>
		</div>

		<CalibrationWizard
			:open="calibrationOpen"
			@update:open="calibrationOpen = $event"
			:speedBpm="currentPattern?.speed ?? 100"
			@apply="applyCalibration"
		/>
		<PermissionDialog v-model:open="permissionOpen" @confirm="confirmPermission" />
		<HeadphonesWarning v-model:open="headphonesOpen" @confirm="confirmHeadphones" />
	</div>
</template>

<style lang="scss">
	.bb-trainer {
		display: flex;
		flex-grow: 1;
		min-height: 0;

		.bb-trainer-main {
			flex-grow: 1;
			display: flex;
			flex-direction: row;
			min-height: 0;

			@media (max-width: 767.98px) {
				flex-direction: column;
			}

			.bb-trainer-pane {
				flex-grow: 1;
				display: flex;
				flex-direction: column;
				min-height: 0;
				overflow: auto;
				order: 1;
			}
		}
	}
</style>
