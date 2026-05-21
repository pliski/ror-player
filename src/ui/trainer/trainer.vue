<script setup lang="ts">
	import { ref, computed, TeleportProps, watch } from "vue";
	import { normalizeState } from "../../state/state";
	import { provideState } from "../../services/state";
	import { useRefWithOverride } from "../../utils";
	import { useI18n } from "../../services/i18n";
	import { getTuneOfTheYear } from "../../services/utils";
	import { stopAllPlayers } from "../../services/player";
	import HybridSidebar from "../utils/hybrid-sidebar.vue";
	import TuneList from "../listen/tune-list.vue";
	import TrainerPartition from "./trainer-partition.vue";

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
			<div v-if="tuneName && patternName" class="bb-trainer-content">
				<div class="bb-trainer-controls p-2 d-flex align-items-center gap-2">
					<h4 class="mb-0 flex-grow-1">{{ tune?.displayName ?? tuneName }} · {{ patternName }}</h4>
					<label class="form-label visually-hidden" for="bb-trainer-pattern-select">{{ i18n.t("trainer.pattern-label") }}</label>
					<select id="bb-trainer-pattern-select" class="form-select" v-model="patternName">
						<option v-for="k in patternKeys" :key="k" :value="k">{{ k }}</option>
					</select>
				</div>
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
			min-height: 0;
			overflow: auto;

			.form-select {
				max-width: 240px;
			}
		}

		.bb-trainer-content {
			display: flex;
			flex-direction: column;
		}

		.bb-trainer-controls {
			flex-shrink: 0;
		}
	}
</style>
