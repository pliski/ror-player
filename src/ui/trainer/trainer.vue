<script setup lang="ts">
	import { TeleportProps } from "vue";
	import { useI18n } from "../../services/i18n";

	defineProps<{
		tuneName?: string;
		patternName?: string;
		sidebarToggleContainer?: TeleportProps['to'];
	}>();

	defineEmits<{
		"update:tuneName": [tuneName: string | undefined];
		"update:patternName": [patternName: string | undefined];
	}>();

	const i18n = useI18n();
</script>

<template>
	<div class="bb-trainer">
		<p class="p-3 text-muted">{{ i18n.t("trainer.placeholder") }}</p>
	</div>
</template>

<style lang="scss">
	.bb-trainer {
		display: flex;
		flex-grow: 1;
		min-height: 0;
	}
</style>
