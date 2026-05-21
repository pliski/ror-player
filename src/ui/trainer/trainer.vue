<script setup lang="ts">
	import { ref, computed, TeleportProps, watch } from "vue";
	import { normalizeState, getPatternFromState } from "../../state/state";
	import { provideState } from "../../services/state";
	import { useRefWithOverride } from "../../utils";
	import { useI18n } from "../../services/i18n";
	import { getTuneOfTheYear } from "../../services/utils";
	import { stopAllPlayers } from "../../services/player";
	import { Instrument } from "../../config";
	import type { TrainerMode, TrainerState } from "../../services/trainerEngine";
	import HybridSidebar from "../utils/hybrid-sidebar.vue";
	import TuneList from "../listen/tune-list.vue";
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

	const dummyStats = computed(() => ({
		hits: 0, misses: 0, extras: 0, expectedTotal: 0,
		meanAbsDelta: 0, drift: 0, headlineScore: 100,
	}));

	const instrument = ref<Instrument>("sn");
	const mode = ref<TrainerMode>("instrument");
	const trainerState = ref<TrainerState>("idle");
	const latencyMs = ref(0);

	const currentPattern = computed(() => tuneName.value && patternName.value
		? getPatternFromState(state.value, tuneName.value, patternName.value) ?? undefined
		: undefined);

	function handleStart() {}
	function handleStop() {}
	function handleCalibrate() {}
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
			<TrainerScoreRail :stats="dummyStats" :micActive="false" :latencyMs="0" v-if="tuneName && patternName" />
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
				<TrainerPartition :tuneName="tuneName" :patternName="patternName" />
			</div>
			<div v-else class="p-3 text-muted">{{ i18n.t("trainer.pick-tune") }}</div>
		</div>
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
