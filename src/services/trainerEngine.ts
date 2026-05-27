import { Ref, ref } from "vue";
import mitt, { Emitter } from "mitt";
import { MicPermission } from "./mediaPermissions";
import { OnsetDetector } from "./onsetDetector";
import { createScorer, ScorerHandle, buildExpectedTimeline, SessionStats, Verdict, toleranceForDifficulty, Difficulty } from "./trainerScorer";
import config, { Instrument } from "../config";
import { Pattern, normalizePattern } from "../state/pattern";
import type Beatbox from "beatbox.js";
import { patternToBeatbox, createBeatbox, getPlayerById, BeatboxReference } from "./player";
import { normalizePlaybackSettings } from "../state/playbackSettings";

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
  difficulty?: Difficulty;
}

export interface TrainerEngineDeps {
  micPermission: MicPermission;
  detector: OnsetDetector;
}

export interface TrainerEngineOpts {
  timer?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  finaliseDelayMs?: number;
  beatboxFactory?: (repeat: boolean) => { ref: BeatboxReference; player: Beatbox };
  latencyOffsetMs?: number;
}

export type TrainerEngineEvents = {
  verdict: { strokeIdx: number; verdict: Verdict; delta: number };
  loopWrap: object;
} & Record<string, unknown>;

export interface TrainerEngine {
  state: Ref<TrainerState>;
  start(): Promise<void>;
  stop(): Promise<void>;
  stopGame(): Promise<void>;
  advanceToGameOn(baselineOverride?: number): Promise<void>;
  configure(c: TrainerConfig): void;
  stats(): SessionStats;
  debugLoopBaseline(): number | null;
  on<K extends keyof TrainerEngineEvents>(ev: K, h: (e: TrainerEngineEvents[K]) => void): void;
  off<K extends keyof TrainerEngineEvents>(ev: K, h: (e: TrainerEngineEvents[K]) => void): void;
}

function buildCountInPattern(speedBpm: number) {
  return normalizePattern({
    length: 8,         // 8 beats total (2 bars at 4/4)
    time: 1,           // 1 stroke per beat (just on-beat events)
    speed: speedBpm,
    ot: [
      "w", "w", "w", "w",   // bar 1 — metronome clicks on each beat
      "Õ", " ", " ", " ",   // bar 2 — whistle-in on beat 1
    ],
  });
}

export function createTrainerEngine(deps: TrainerEngineDeps, opts: TrainerEngineOpts = {}): TrainerEngine {
  const state = ref<TrainerState>("idle");
  const finaliseDelayMs = opts.finaliseDelayMs ?? 500;
  // Thunked to keep the window-method `this` binding — Firefox throws
  // "called on an object that does not implement interface Window" if these
  // globals are invoked as methods of a plain object.
  const timer = opts.timer ?? {
    setTimeout: (cb: () => void, ms: number) => window.setTimeout(cb, ms),
    clearTimeout: (id: number) => window.clearTimeout(id),
  };
  const events: Emitter<TrainerEngineEvents> = mitt();
  let activeStream: MediaStream | null = null;

  let cfg: TrainerConfig | null = null;
  let scorer: ScorerHandle | null = null;
  let loopBaselinePerf: number | null = null;
  let onsetHandler: ((e: { t_perf: number; energy: number }) => void) | null = null;

  let countIn: { ref: BeatboxReference; player: Beatbox } | null = null;
  let main: { ref: BeatboxReference; player: Beatbox } | null = null;

  function makeBeatboxPair(repeat: boolean): { ref: BeatboxReference; player: Beatbox } {
    if (opts.beatboxFactory) return opts.beatboxFactory(repeat);
    const ref = createBeatbox(repeat);
    return { ref, player: getPlayerById(ref.id) };
  }

  function configure(c: TrainerConfig) {
    const oldCfg = cfg;
    cfg = c;
    if (oldCfg && state.value !== "idle") {
      const changed =
        oldCfg.pattern !== c.pattern ||
        oldCfg.instrument !== c.instrument ||
        oldCfg.speedBpm !== c.speedBpm ||
        oldCfg.mode !== c.mode ||
        oldCfg.difficulty !== c.difficulty;
      if (changed) void stop();
    }
  }

  function setupScorerAndDetector() {
    if (!cfg) throw new Error("Trainer not configured");
    const timeline = buildExpectedTimeline(
      cfg.pattern, cfg.instrument, cfg.speedBpm,
      toleranceForDifficulty(cfg.difficulty ?? "normal"),
    );
    scorer = createScorer(timeline);

    onsetHandler = (e: { t_perf: number; energy: number }) => {
      if (state.value !== "gameOn" || loopBaselinePerf === null || !scorer) return;
      // Translate perf-time → loop-relative
      const tRel = (e.t_perf - (opts.latencyOffsetMs ?? 0)) - loopBaselinePerf;
      const loopLen = timeline.loopLengthMs;
      // Always-positive modulo (handles hits arriving before baseline)
      const tLoop = ((tRel % loopLen) + loopLen) % loopLen;
      const verdict = scorer.acceptHit({ t: tLoop, energy: e.energy });
      if (verdict && "strokeIdx" in verdict) {
        events.emit("verdict", { strokeIdx: verdict.strokeIdx, verdict: verdict.verdict, delta: verdict.delta });
      }
    };
    deps.detector.on("onset", onsetHandler);
  }

  function teardown() {
    if (onsetHandler) {
      deps.detector.off("onset", onsetHandler);
      onsetHandler = null;
    }
    if (countIn) { void countIn.player.stop(); countIn = null; }
    if (main)    { void main.player.stop();    main    = null; }
    scorer = null;
    loopBaselinePerf = null;
  }

  async function onCountInComplete() {
    if (state.value !== "countIn" || !cfg) return;
    const ps = normalizePlaybackSettings({
      speed: cfg.speedBpm,
      loop: true,
      headphones: cfg.mode === "instrument" ? [cfg.instrument] : [],
      mute: cfg.mode === "band" ? { [cfg.instrument]: true } : {},
    });
    const mainRaw = patternToBeatbox(cfg.pattern, ps);

    const mainPair = makeBeatboxPair(true);
    main = mainPair;
    const mainPlayer = mainPair.player;
    mainPlayer.setPattern(mainRaw);
    mainPlayer.setBeatLength(60_000 / cfg.speedBpm / config.playTime);
    mainPlayer.setRepeat(true);
    // Detect wraps via a position-decreased transition rather than `position === 0`:
    // Beatbox emits "beat" with the position captured at scheduling time, but
    // re-querying mainPlayer.getPosition() in the handler races against the
    // audio clock and may have advanced past 0 by the time we check.
    let lastBeatPosition = -1;
    mainPlayer.on("play", () => {
      loopBaselinePerf = performance.now();
      lastBeatPosition = -1;
    });
    mainPlayer.on("beat", (position: number) => {
      if (lastBeatPosition >= 0 && position < lastBeatPosition && loopBaselinePerf !== null) {
        loopBaselinePerf = performance.now();
        scorer?.onLoopWrap();
        events.emit("loopWrap", {});
      }
      lastBeatPosition = position;
    });
    mainPlayer.play();

    state.value = "gameOn";
  }

  async function start() {
    if (state.value !== "idle" && state.value !== "results") return;
    if (!cfg) throw new Error("configure() must be called first");
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

      // Build the count-in pattern + Beatbox
      const countInPattern = buildCountInPattern(cfg.speedBpm);
      const countInRaw = patternToBeatbox(
        countInPattern,
        normalizePlaybackSettings({ headphones: ["ot"], whistle: false })
      );
      const countInPair = makeBeatboxPair(false);
      countIn = countInPair;
      const countInPlayer = countInPair.player;
      countInPlayer.setPattern(countInRaw);
      countInPlayer.setBeatLength(60_000 / cfg.speedBpm / config.playTime);
      countInPlayer.on("stop", () => {
        void onCountInComplete();
      });
      countInPlayer.play();

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
    const stopAtMs = loopBaselinePerf === null ? 0 : performance.now() - loopBaselinePerf;
    state.value = "finalising";

    // Stop Beatboxes immediately so user doesn't hear audio during the finalising delay
    if (countIn) { void countIn.player.stop(); countIn = null; }
    if (main)    { void main.player.stop();    main    = null; }

    await new Promise<void>((resolve) => timer.setTimeout(resolve, finaliseDelayMs));
    // stop() may have fired during the finalising delay
    if ((state.value as TrainerState) === "idle") return;
    scorer?.finalize({ stopAtMs, tailMs: 500 });
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

  return {
    state, start, stop, stopGame, advanceToGameOn, configure, stats, debugLoopBaseline,
    on: events.on.bind(events),
    off: events.off.bind(events),
  };
}
