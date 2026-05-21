import { Ref, ref } from "vue";
import { MicPermission } from "./mediaPermissions";
import { OnsetDetector } from "./onsetDetector";
import { createScorer, ScorerHandle, buildExpectedTimeline, SessionStats } from "./trainerScorer";
import { Instrument } from "../config";
import { Pattern } from "../state/pattern";
import type Beatbox from "beatbox.js";

export type TrainerState =
  | "idle"
  | "requestingMic"
  | "countIn"
  | "gameOn"
  | "finalising"
  | "results";

export type TrainerMode = "instrument" | "band";

export interface TrainerConfig {
  pattern: Pattern;
  instrument: Instrument;
  speedBpm: number;
  mode: TrainerMode;
}

export interface TrainerEngineDeps {
  micPermission: MicPermission;
  detector: OnsetDetector;
}

export interface TrainerEngineOpts {
  timer?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  finaliseDelayMs?: number;
  beatboxFactory?: () => Beatbox;          // wired in Task 6.5
  latencyOffsetMs?: number;
}

export interface TrainerEngine {
  state: Ref<TrainerState>;
  start(): Promise<void>;
  stop(): Promise<void>;
  stopGame(): Promise<void>;
  advanceToGameOn(baselineOverride?: number): Promise<void>;
  configure(c: TrainerConfig): void;
  stats(): SessionStats;
  debugLoopBaseline(): number | null;
}

export function createTrainerEngine(deps: TrainerEngineDeps, opts: TrainerEngineOpts = {}): TrainerEngine {
  const state = ref<TrainerState>("idle");
  const finaliseDelayMs = opts.finaliseDelayMs ?? 500;
  const timer = opts.timer ?? { setTimeout, clearTimeout };
  let activeStream: MediaStream | null = null;

  let config: TrainerConfig | null = null;
  let scorer: ScorerHandle | null = null;
  let loopBaselinePerf: number | null = null;
  let onsetHandler: ((e: { t_perf: number; energy: number }) => void) | null = null;

  function configure(c: TrainerConfig) { config = c; }

  function setupScorerAndDetector() {
    if (!config) throw new Error("Trainer not configured");
    const timeline = buildExpectedTimeline(config.pattern, config.instrument, config.speedBpm);
    scorer = createScorer(timeline);

    onsetHandler = (e: { t_perf: number; energy: number }) => {
      if (state.value !== "gameOn" || loopBaselinePerf === null || !scorer) return;
      // Translate perf-time → loop-relative
      const tRel = (e.t_perf - (opts.latencyOffsetMs ?? 0)) - loopBaselinePerf;
      const loopLen = timeline.loopLengthMs;
      // Always-positive modulo (handles hits arriving before baseline)
      const tLoop = ((tRel % loopLen) + loopLen) % loopLen;
      scorer.acceptHit({ t: tLoop, energy: e.energy });
    };
    deps.detector.on("onset", onsetHandler);
  }

  function teardown() {
    if (onsetHandler) {
      deps.detector.off("onset", onsetHandler);
      onsetHandler = null;
    }
    scorer = null;
    loopBaselinePerf = null;
  }

  async function start() {
    if (state.value !== "idle" && state.value !== "results") return;
    if (!config) throw new Error("configure() must be called first");
    teardown();  // Defensive: clean up any leftover from prior session before re-setup
    state.value = "requestingMic";
    try {
      activeStream = await deps.micPermission.request();
      // stop() may have been called while we were awaiting the permission prompt
      if ((state.value as TrainerState) === "idle") {
        deps.micPermission.release(activeStream);
        activeStream = null;
        return;
      }
      await deps.detector.start(activeStream, {});
      // stop() may have been called while we were awaiting the detector
      if ((state.value as TrainerState) === "idle") return;
      setupScorerAndDetector();
      state.value = "countIn";
    } catch (err) {
      state.value = "idle";
      teardown();
      if (activeStream) {
        deps.micPermission.release(activeStream);
        activeStream = null;
      }
      throw err;
    }
  }

  async function advanceToGameOn(baselineOverride?: number) {
    if (state.value !== "countIn") return;
    loopBaselinePerf = baselineOverride ?? performance.now();
    state.value = "gameOn";
  }

  async function stopGame() {
    if (state.value !== "gameOn" && state.value !== "countIn") return;
    state.value = "finalising";
    await new Promise<void>((resolve) => timer.setTimeout(resolve, finaliseDelayMs));
    // stop() may have fired during the finalising delay
    if ((state.value as TrainerState) === "idle") return;
    scorer?.finalize();
    state.value = "results";
    if (activeStream) {
      deps.micPermission.release(activeStream);
      activeStream = null;
    }
    await deps.detector.stop();
  }

  async function stop() {
    state.value = "idle";
    teardown();
    if (activeStream) {
      deps.micPermission.release(activeStream);
      activeStream = null;
    }
    await deps.detector.stop();
  }

  function stats(): SessionStats {
    return scorer?.stats() ?? { hits: 0, misses: 0, extras: 0, expectedTotal: 0, meanAbsDelta: 0, drift: 0, headlineScore: 100 };
  }

  function debugLoopBaseline(): number | null { return loopBaselinePerf; }

  return { state, start, stop, stopGame, advanceToGameOn, configure, stats, debugLoopBaseline };
}
