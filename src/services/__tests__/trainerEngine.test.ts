import { expect, test, vi } from "vitest";
import { createTrainerEngine, TrainerEngineOpts } from "../trainerEngine";
import { normalizePattern } from "../../state/pattern";
import type Beatbox from "beatbox.js";
import type { BeatboxReference } from "../player";

// Prevent player.ts module-level AudioContext side-effects from running in happy-dom.
// patternToBeatbox is replaced with a no-op stub; createBeatbox/getPlayerById are
// never called directly in tests since all tests inject beatboxFactory.
vi.mock("../player", () => ({
  createBeatbox: vi.fn(),
  getPlayerById: vi.fn(),
  patternToBeatbox: vi.fn(() => []),
  stopAllPlayers: vi.fn(),
}));

function makeFakeBeatbox(): { ref: BeatboxReference; player: Beatbox } {
  const player = {
    setPattern: vi.fn(),
    setBeatLength: vi.fn(),
    setRepeat: vi.fn(),
    on: vi.fn(),
    play: vi.fn(),
    stop: vi.fn(),
    getPosition: vi.fn(() => 0),
  } as unknown as Beatbox;
  const ref: BeatboxReference = { id: -1, playing: false, customPosition: false };
  return { ref, player };
}

function makeDefaultOpts(): TrainerEngineOpts {
  return {
    beatboxFactory: () => makeFakeBeatbox(),
  };
}

test("engine starts in Idle", () => {
  const engine = createTrainerEngine({
    micPermission: { state: { value: "unknown" } as any, request: async () => ({} as any), release: () => {} },
    detector: { start: async () => {}, stop: async () => {}, setSensitivity: () => {}, on: () => {}, off: () => {} },
  });
  expect(engine.state.value).toBe("idle");
});

function makeDeps(grant = true) {
  const stream = {} as MediaStream;
  return {
    micPermission: {
      state: { value: grant ? "granted" : "unknown" } as any,
      request: vi.fn(grant ? async () => stream : async () => { throw new Error("denied"); }),
      release: vi.fn(),
    } as any,
    detector: {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      setSensitivity: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    } as any,
  };
}

function makeDefaultConfig() {
  return {
    pattern: normalizePattern({ length: 1, time: 4, sn: ["X", ".", "X", "."] }),
    instrument: "sn" as const,
    speedBpm: 120,
    mode: "instrument" as const,
  };
}

test("start() transitions to requestingMic then countIn on grant", async () => {
  const deps = makeDeps(true);
  const engine = createTrainerEngine(deps, makeDefaultOpts());
  engine.configure(makeDefaultConfig());
  const promise = engine.start();
  expect(engine.state.value).toBe("requestingMic");
  await promise;
  expect(engine.state.value).toBe("countIn");
  expect(deps.detector.start).toHaveBeenCalled();
});

test("start() denied returns to idle", async () => {
  const deps = makeDeps(false);
  const engine = createTrainerEngine(deps, makeDefaultOpts());
  engine.configure(makeDefaultConfig());
  await engine.start().catch(() => {});
  expect(engine.state.value).toBe("idle");
});

test("stop() resets to idle and cleans up", async () => {
  const deps = makeDeps(true);
  const engine = createTrainerEngine(deps, makeDefaultOpts());
  engine.configure(makeDefaultConfig());
  await engine.start();
  await engine.stop();
  expect(engine.state.value).toBe("idle");
  expect(deps.micPermission.release).toHaveBeenCalled();
  expect(deps.detector.stop).toHaveBeenCalled();
});

test("start() is a no-op when not idle or results", async () => {
  const deps = makeDeps(true);
  const engine = createTrainerEngine(deps, makeDefaultOpts());
  engine.configure(makeDefaultConfig());
  await engine.start(); // → countIn
  expect(engine.state.value).toBe("countIn");
  await engine.start(); // guard should early-return
  // Mic was requested only once; second start() did not re-request
  expect(deps.micPermission.request).toHaveBeenCalledTimes(1);
});

test("countIn completes and transitions to gameOn after configured ms", async () => {
  const deps = makeDeps(true);
  const fakeTimer = {
    setTimeout: (cb: () => void, _ms: number) => { queueMicrotask(cb); return 0 as any; },
    clearTimeout: () => {},
  };
  const engine = createTrainerEngine(deps, { timer: fakeTimer as any, beatboxFactory: () => makeFakeBeatbox() });
  engine.configure(makeDefaultConfig());
  await engine.start();
  expect(engine.state.value).toBe("countIn");
  await engine.advanceToGameOn();
  expect(engine.state.value).toBe("gameOn");
});

test("stopGame() transitions from gameOn through finalising to results", async () => {
  const deps = makeDeps(true);
  const engine = createTrainerEngine(deps, makeDefaultOpts());
  engine.configure(makeDefaultConfig());
  await engine.start();
  await engine.advanceToGameOn();
  await engine.stopGame();
  expect(engine.state.value).toBe("results");
});

test("stop() during finalising cancels stopGame's transition to results", async () => {
  const deps = makeDeps(true);
  let resolveDelay!: () => void;
  const fakeTimer = {
    setTimeout: (cb: () => void, _ms: number) => {
      resolveDelay = cb;
      return 0 as any;
    },
    clearTimeout: () => {},
  };
  const engine = createTrainerEngine(deps, { timer: fakeTimer as any, beatboxFactory: () => makeFakeBeatbox() });
  engine.configure(makeDefaultConfig());
  await engine.start();
  await engine.advanceToGameOn();
  const stopGamePromise = engine.stopGame(); // enters finalising, awaits delay
  await engine.stop();                       // → idle (during finalising)
  resolveDelay();                            // delay fires AFTER stop()
  await stopGamePromise;
  expect(engine.state.value).toBe("idle");   // guard prevented overwrite to "results"
});

test("advanceToGameOn() is a no-op from non-countIn states", async () => {
  const deps = makeDeps(true);
  const engine = createTrainerEngine(deps, makeDefaultOpts());
  engine.configure(makeDefaultConfig());
  // From idle — should not transition
  await engine.advanceToGameOn();
  expect(engine.state.value).toBe("idle");
  // After full lifecycle: idle → countIn → gameOn → already gameOn, second call no-op
  await engine.start();
  await engine.advanceToGameOn();
  expect(engine.state.value).toBe("gameOn");
  await engine.advanceToGameOn();           // second call from gameOn
  expect(engine.state.value).toBe("gameOn"); // unchanged
});

test("engine pipes detected hits into the scorer after gameOn", async () => {
  const deps = makeDeps(true);
  // Capture the onset subscriber to drive it manually
  let onsetSub: ((e: any) => void) | null = null;
  deps.detector.on = vi.fn((ev: string, cb: any) => { if (ev === "onset") onsetSub = cb; });

  const pattern = normalizePattern({ length: 1, time: 4, sn: ["X", ".", "X", "."] });

  const engine = createTrainerEngine(deps, makeDefaultOpts());
  engine.configure({ pattern, instrument: "sn", speedBpm: 120, mode: "instrument" });
  await engine.start();

  // The fake Beatbox's "stop" handler is a vi.fn() — registered but never invoked.
  // So onCountInComplete never fires and the main Beatbox isn't created.
  // Inject an explicit loop baseline directly to drive the scorer.
  const baselinePerf = 1000; // arbitrary
  await engine.advanceToGameOn(baselinePerf);

  // Strokes are at t=0 and t=250ms in loop-relative time (120 bpm × 4 strokes/beat → 125ms/stroke).
  // Send an onset at baseline + 250ms — should land on the second expected hit.
  onsetSub!({ t_perf: baselinePerf + 250, energy: 0.5 });

  await engine.stopGame();
  expect(engine.stats().hits).toBeGreaterThanOrEqual(1);
});
