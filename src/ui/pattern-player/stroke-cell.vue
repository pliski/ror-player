<script setup lang="ts">
	import { Instrument } from "../../config";
	import vTooltip from "../utils/tooltip";

	defineProps<{
		rawIdx: number;
		instrumentKey: Instrument;
		readonly: boolean;
		char: string;
		cellClass: string[];
		tooltip: string;
	}>();

	defineEmits<{ strokeClick: [] }>();
</script>

<template>
	<td class="stroke" :class="cellClass" v-tooltip="tooltip">
		<span v-if="readonly" class="stroke-inner">{{ char }}</span>
		<a v-else href="javascript:" class="stroke-inner" :id="`bb-pattern-player-stroke-${instrumentKey}-${rawIdx}`" draggable="false" @click="$emit('strokeClick')">{{ char }}</a>
	</td>
</template>
