<script setup lang="ts">
	import { ref } from "vue";
	import { useI18n } from "../../services/i18n";
	import { type SessionStats } from "../../services/trainerScorer";

	const props = defineProps<{
		stats: SessionStats;
		micActive: boolean;
		latencyMs: number;
	}>();

	const i18n = useI18n();
	const sheetOpen = ref(false);
</script>

<template>
	<!-- Desktop right rail -->
	<aside class="bb-trainer-score-rail d-none d-md-flex">
		<h5 class="m-0">{{ i18n.t("trainer.score.title") }}</h5>
		<div class="bb-trainer-headline">{{ props.stats.headlineScore }}</div>
		<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.avgDelta") }}</span><strong>{{ Math.round(props.stats.meanAbsDelta) }} ms</strong></div>
		<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.drift") }}</span><strong>{{ props.stats.drift > 0 ? "+" : "" }}{{ Math.round(props.stats.drift) }} ms</strong></div>
		<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.hits") }}</span><strong>{{ props.stats.hits }}/{{ props.stats.expectedTotal }}</strong></div>
		<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.misses") }}</span><strong>{{ props.stats.misses }}</strong></div>
		<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.extras") }}</span><strong>{{ props.stats.extras }}</strong></div>
		<hr>
		<div class="bb-trainer-mic">
			<fa :icon="props.micActive ? 'microphone' : 'microphone-slash'" :class="{ 'text-danger': props.micActive }" />
			{{ props.micActive ? i18n.t("trainer.mic.listening") : i18n.t("trainer.mic.stopped") }}
			<small class="text-muted ms-1">lag {{ props.latencyMs }} ms</small>
		</div>
	</aside>

	<!-- Mobile top strip -->
	<header class="bb-trainer-score-strip d-md-none" @click="sheetOpen = !sheetOpen">
		<div class="bb-trainer-headline-sm">{{ props.stats.headlineScore }}</div>
		<div class="bb-trainer-strip-summary">
			<small>{{ i18n.t("trainer.score.avgDelta") }} {{ Math.round(props.stats.meanAbsDelta) }} ms · {{ props.stats.hits }}/{{ props.stats.expectedTotal }}</small>
		</div>
		<fa :icon="props.micActive ? 'microphone' : 'microphone-slash'" :class="{ 'text-danger': props.micActive }" />
		<fa icon="caret-down" />
	</header>

	<!-- Mobile expanded sheet -->
	<div class="bb-trainer-score-sheet" v-if="sheetOpen">
		<div class="bb-trainer-headline">{{ props.stats.headlineScore }}</div>
		<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.avgDelta") }}</span><strong>{{ Math.round(props.stats.meanAbsDelta) }} ms</strong></div>
		<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.drift") }}</span><strong>{{ props.stats.drift > 0 ? "+" : "" }}{{ Math.round(props.stats.drift) }} ms</strong></div>
		<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.hits") }}</span><strong>{{ props.stats.hits }}/{{ props.stats.expectedTotal }}</strong></div>
		<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.misses") }}</span><strong>{{ props.stats.misses }}</strong></div>
		<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.extras") }}</span><strong>{{ props.stats.extras }}</strong></div>
	</div>
</template>

<style lang="scss">
	.bb-trainer-score-rail {
		width: 140px;
		padding: 12px;
		background: var(--bs-tertiary-bg);
		border-left: 1px solid var(--bs-border-color);
		flex-direction: column;
		gap: 6px;

		@media (max-width: 991.98px) {
			width: 90px;
			padding: 8px;
			.bb-trainer-stat span { display: none; }
		}
	}
	.bb-trainer-headline {
		font-size: 36px;
		font-weight: bold;
		color: var(--bs-success);
		text-align: center;
		line-height: 1;
	}
	.bb-trainer-stat {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
	}
	.bb-trainer-mic {
		font-size: 12px;
	}
	.bb-trainer-score-strip {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		background: var(--bs-tertiary-bg);
		border-bottom: 1px solid var(--bs-border-color);
		cursor: pointer;

		.bb-trainer-headline-sm {
			font-size: 24px;
			font-weight: bold;
			color: var(--bs-success);
		}
		.bb-trainer-strip-summary { flex: 1; }
	}
	.bb-trainer-score-sheet {
		position: absolute;
		top: 48px;
		left: 0;
		right: 0;
		z-index: 10;
		padding: 12px;
		background: var(--bs-body-bg);
		border-bottom: 2px solid var(--bs-border-color);
		box-shadow: 0 4px 12px rgba(0,0,0,0.1);
	}
</style>
