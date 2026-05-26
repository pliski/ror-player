<script setup lang="ts">
	import { ref, computed } from "vue";
	import { useI18n } from "../../services/i18n";
	import { type SessionStats, type Verdict, deltaToPosition } from "../../services/trainerScorer";

	const props = defineProps<{
		stats: SessionStats;
		recentHits?: { delta: number; verdict: Verdict }[];
		micActive: boolean;
		latencyMs: number;
		disabledReason?: string;
	}>();

	const i18n = useI18n();
	const detailsOpen = ref(false);

	// Oldest → newest; age 0 = newest (brightest + pulses).
	const markers = computed(() => {
		const hits = props.recentHits ?? [];
		return hits.map((h, i) => {
			// Position is geometric (delta → percent); colour uses the scorer's
			// authoritative verdict so it matches the partition and stays correct
			// when the difficulty tolerance changes.
			const { percent } = deltaToPosition(h.delta);
			const age = hits.length - 1 - i;
			return { percent, verdict: h.verdict, age, opacity: age === 0 ? 1 : Math.max(0.18, 0.7 - age * 0.14) };
		});
	});
</script>

<template>
	<aside class="bb-trainer-score-rail">
		<h5 class="m-0">{{ i18n.t("trainer.score.title") }}</h5>
		<div v-if="props.disabledReason" class="bb-trainer-disabled-reason">{{ props.disabledReason }}</div>
		<template v-else>
			<div class="bb-trainer-headline">{{ props.stats.headlineScore }}</div>

			<div class="bb-trainer-meter">
				<div class="bb-trainer-meter-zone"></div>
				<div class="bb-trainer-meter-center"></div>
				<div
					v-for="(m, idx) in markers"
					:key="idx"
					class="bb-trainer-meter-marker"
					:class="[`verdict-${m.verdict}`, { newest: m.age === 0 }]"
					:style="{ left: m.percent + '%', opacity: m.opacity }"
				>
					<span v-if="m.age === 0" class="bb-trainer-meter-pulse" :class="`verdict-${m.verdict}`"></span>
				</div>
			</div>
			<div class="bb-trainer-meter-labels">
				<span>{{ i18n.t("trainer.score.behind") }}</span>
				<span>{{ i18n.t("trainer.score.early") }}</span>
			</div>

			<button type="button" class="bb-trainer-details-toggle" :aria-expanded="detailsOpen" @click="detailsOpen = !detailsOpen">
				<fa icon="caret-down" class="caret" :class="{ open: detailsOpen }" /> {{ i18n.t("trainer.score.details") }}
			</button>
			<div v-if="detailsOpen" class="bb-trainer-details">
				<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.avgDelta") }}</span><strong>{{ Math.round(props.stats.meanAbsDelta) }} ms</strong></div>
				<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.drift") }}</span><strong>{{ props.stats.drift > 0 ? "+" : "" }}{{ Math.round(props.stats.drift) }} ms</strong></div>
				<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.hits") }}</span><strong>{{ props.stats.hits }}/{{ props.stats.expectedTotal }}</strong></div>
				<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.misses") }}</span><strong>{{ props.stats.misses }}</strong></div>
				<div class="bb-trainer-stat"><span>{{ i18n.t("trainer.score.extras") }}</span><strong>{{ props.stats.extras }}</strong></div>
			</div>
		</template>
		<hr>
		<div class="bb-trainer-mic">
			<fa :icon="props.micActive ? 'microphone' : 'microphone-slash'" :class="{ 'text-danger': props.micActive }" />
			{{ props.micActive ? i18n.t("trainer.mic.listening") : i18n.t("trainer.mic.stopped") }}
			<small class="text-muted ms-1">lag {{ props.latencyMs }} ms</small>
		</div>
	</aside>
</template>

<style lang="scss">
	.bb-trainer-score-rail {
		width: 150px;
		flex-shrink: 0;
		padding: 12px;
		background: var(--bs-tertiary-bg);
		border-right: 1px solid var(--bs-border-color);
		display: flex;
		flex-direction: column;
		gap: 8px;

		@media (max-width: 767.98px) {
			width: 120px;
			padding: 8px;
		}
	}
	.bb-trainer-headline {
		font-size: 36px;
		font-weight: bold;
		color: var(--bs-success);
		text-align: center;
		line-height: 1;
	}
	.bb-trainer-meter {
		position: relative;
		height: 16px;
		border-radius: 8px;
		background: var(--bs-secondary-bg);
		margin-top: 2px;

		.bb-trainer-meter-zone {
			position: absolute;
			left: 30%; width: 40%; top: 0; bottom: 0;
			background: color-mix(in srgb, var(--bs-success) 18%, transparent);
			border-left: 1px dashed var(--bs-success);
			border-right: 1px dashed var(--bs-success);
		}
		.bb-trainer-meter-center {
			position: absolute; left: 50%; top: -3px; bottom: -3px; width: 2px;
			background: var(--bs-secondary-color); transform: translateX(-50%);
		}
		.bb-trainer-meter-marker {
			position: absolute; top: 50%; width: 14px; height: 14px; border-radius: 50%;
			border: 2px solid var(--bs-body-bg); transform: translate(-50%, -50%); z-index: 2;
			&.verdict-good { background: var(--bs-success); }
			&.verdict-off  { background: var(--bs-warning); }
			&.newest { box-shadow: 0 1px 3px rgba(0, 0, 0, .35); z-index: 3; }
		}
		.bb-trainer-meter-pulse {
			position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; border-radius: 50%;
			transform: translate(-50%, -50%);
			animation: bb-trainer-pulse 1.1s ease-out infinite;
			&.verdict-good { background: var(--bs-success); }
			&.verdict-off  { background: var(--bs-warning); }
		}
	}
	@keyframes bb-trainer-pulse {
		0%   { transform: translate(-50%, -50%) scale(.5); opacity: .8; }
		100% { transform: translate(-50%, -50%) scale(2.6); opacity: 0; }
	}
	.bb-trainer-meter-labels {
		display: flex; justify-content: space-between;
		font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
		color: var(--bs-secondary-color);
	}
	.bb-trainer-details-toggle {
		background: none; border: none; padding: 2px 0; text-align: left;
		font-size: 12px; color: var(--bs-secondary-color); cursor: pointer;
		.caret { transition: transform .15s; }
		.caret.open { transform: rotate(0deg); }
		.caret:not(.open) { transform: rotate(-90deg); }
	}
	.bb-trainer-details { display: flex; flex-direction: column; gap: 4px; }
	.bb-trainer-stat { display: flex; justify-content: space-between; font-size: 12px; }
	.bb-trainer-mic { font-size: 12px; margin-top: auto; }
	.bb-trainer-disabled-reason {
		font-size: 13px; color: var(--bs-secondary-color); font-style: italic; text-align: center;
	}
</style>
