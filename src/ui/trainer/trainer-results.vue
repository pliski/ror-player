<script setup lang="ts">
	import { useI18n } from "../../services/i18n";
	import type { SessionStats } from "../../services/trainerScorer";

	defineProps<{
		stats: SessionStats;
	}>();

	const i18n = useI18n();
</script>

<template>
	<div class="card bb-trainer-results">
		<div class="card-body">
			<h5 class="card-title">{{ i18n.t("trainer.results.title") }}</h5>
			<div class="bb-trainer-results-headline">{{ stats.headlineScore }}</div>
			<table class="table table-sm mt-2">
				<tbody>
					<tr><th>{{ i18n.t("trainer.score.avgDelta") }}</th><td>{{ Math.round(stats.meanAbsDelta) }} ms</td></tr>
					<tr><th>{{ i18n.t("trainer.score.drift") }}</th><td>{{ stats.drift > 0 ? "+" : "" }}{{ Math.round(stats.drift) }} ms</td></tr>
					<tr><th>{{ i18n.t("trainer.score.hits") }}</th><td>{{ stats.hits }} / {{ stats.expectedTotal }}</td></tr>
					<tr><th>{{ i18n.t("trainer.score.misses") }}</th><td>{{ stats.misses }}</td></tr>
					<tr><th>{{ i18n.t("trainer.score.extras") }}</th><td>{{ stats.extras }}</td></tr>
				</tbody>
			</table>
		</div>
	</div>
</template>

<style lang="scss">
	.bb-trainer-results {
		margin: 12px;
		.bb-trainer-results-headline {
			font-size: 56px;
			font-weight: bold;
			color: var(--bs-success);
			text-align: center;
			line-height: 1;
		}
	}
</style>
