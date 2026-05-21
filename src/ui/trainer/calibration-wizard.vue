<script setup lang="ts">
	import { ref, onBeforeUnmount, watch } from "vue";
	import { useI18n } from "../../services/i18n";
	import { createCalibrationSession } from "../../services/latencyCalibrator";

	const props = defineProps<{
		open: boolean;
		speedBpm: number;
	}>();

	const emit = defineEmits<{
		"update:open": [v: boolean];
		"apply": [offsetMs: number];
	}>();

	const i18n = useI18n();
	const phase = ref<"idle" | "running" | "done">("idle");
	const result = ref<{ median: number; spread: number; count: number } | null>(null);
	const beats = ref<number[]>([]);
	const session = ref<ReturnType<typeof createCalibrationSession> | null>(null);
	// hoisted so close()/unmount can release scheduled oscillators
	let ctx: AudioContext | null = null;
	let tickHandle: number | null = null;

	function close() {
		if (tickHandle) clearTimeout(tickHandle);
		tickHandle = null;
		if (ctx) { void ctx.close(); ctx = null; }
		phase.value = "idle";
		result.value = null;
		session.value = null;
		emit("update:open", false);
	}

	function startSession() {
		phase.value = "running";
		const beatMs = 60_000 / props.speedBpm;
		const beatCount = 16;
		const start = performance.now();
		beats.value = Array.from({ length: beatCount }, (_, i) => start + i * beatMs);
		session.value = createCalibrationSession(beats.value);

		ctx = new AudioContext();
		for (const b of beats.value) {
			const t = (b - start) / 1000 + ctx.currentTime + 0.05;
			const osc = ctx.createOscillator();
			osc.frequency.value = 880;
			const gain = ctx.createGain();
			gain.gain.setValueAtTime(0.5, t);
			gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
			osc.connect(gain).connect(ctx.destination);
			osc.start(t);
			osc.stop(t + 0.1);
		}

		const endAt = start + (beatCount - 1) * beatMs + 500;
		tickHandle = window.setTimeout(() => {
			result.value = session.value!.finalize();
			phase.value = "done";
			if (ctx) { void ctx.close(); ctx = null; }
		}, endAt - performance.now());
	}

	function handleTap() {
		if (phase.value !== "running" || !session.value) return;
		session.value.recordTap(performance.now());
	}

	function onKey() {
		if (props.open) handleTap();
	}

	watch(() => props.open, (open) => {
		if (open) {
			window.addEventListener("keydown", onKey);
		} else {
			window.removeEventListener("keydown", onKey);
		}
	}, { immediate: true });

	onBeforeUnmount(() => {
		window.removeEventListener("keydown", onKey);
		if (tickHandle) clearTimeout(tickHandle);
		if (ctx) void ctx.close();
	});
</script>

<template>
	<div v-if="open" class="modal-backdrop show"></div>
	<div v-if="open" class="modal d-block" tabindex="-1" role="dialog">
		<div class="modal-dialog modal-dialog-centered">
			<div class="modal-content">
				<div class="modal-header">
					<h5 class="modal-title">{{ i18n.t("trainer.calibration.title") }}</h5>
					<button type="button" class="btn-close" @click="close"></button>
				</div>
				<div class="modal-body" @pointerdown="handleTap" style="cursor: pointer; user-select: none;">
					<p v-if="phase === 'idle'">{{ i18n.t("trainer.calibration.idle-instructions") }}</p>
					<p v-else-if="phase === 'running'">{{ i18n.t("trainer.calibration.running-instructions") }}</p>
					<p v-else>
						{{ i18n.t("trainer.calibration.result-median", { median: Math.round(result?.median ?? 0) }) }}<br>
						{{ i18n.t("trainer.calibration.result-spread", { spread: Math.round(result?.spread ?? 0) }) }}<br>
						<small v-if="(result?.spread ?? 0) > 30" class="text-warning">{{ i18n.t("trainer.calibration.spread-warning") }}</small>
					</p>
					<div v-if="phase === 'running'" class="bb-trainer-calibration-tap">
						{{ i18n.t("trainer.calibration.tap-target") }}
					</div>
				</div>
				<div class="modal-footer">
					<button type="button" class="btn btn-secondary" @click="close">{{ i18n.t("trainer.calibration.cancel") }}</button>
					<button v-if="phase === 'idle'" type="button" class="btn btn-primary" @click="startSession">{{ i18n.t("trainer.calibration.start") }}</button>
					<button v-if="phase === 'done'" type="button" class="btn btn-primary" @click="emit('apply', Math.round(result?.median ?? 0)); close();">
						{{ i18n.t("trainer.calibration.apply", { median: Math.round(result?.median ?? 0) }) }}
					</button>
				</div>
			</div>
		</div>
	</div>
</template>

<style lang="scss">
	.bb-trainer-calibration-tap {
		margin-top: 1em;
		padding: 2em;
		text-align: center;
		background: var(--bs-tertiary-bg);
		border-radius: 8px;
		font-size: 24px;
	}
</style>
