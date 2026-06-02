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

test("stats during countIn reports zero misses (no loop baseline yet)", async () => {
  // Regression for Bug: the score rail showed a full loop's worth of misses the
  // instant a session started. During count-in loopBaselinePerf is still null, so
  // the engine must report 0 elapsed (loop not started) — not "unknown", which the
  // scorer treats as "count the whole loop". With no hits and no time elapsed,
  // nothing can yet be missed.
  const deps = makeDeps(true);
  const engine = createTrainerEngine(deps, makeDefaultOpts());
  engine.configure(makeDefaultConfig()); // pattern has 2 strokes (X . X .)
  await engine.start();
  expect(engine.state.value).toBe("countIn");
  expect(engine.stats().hits).toBe(0);
  expect(engine.stats().misses).toBe(0);
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

test("engine emits 'verdict' when the scorer matches a hit", async () => {
  const deps = makeDeps(true);
  let onsetSub: ((e: any) => void) | null = null;
  deps.detector.on = vi.fn((ev: string, cb: any) => { if (ev === "onset") onsetSub = cb; });

  const pattern = normalizePattern({ length: 1, time: 4, sn: ["X", ".", "X", "."] });
  const engine = createTrainerEngine(deps, makeDefaultOpts());
  engine.configure({ pattern, instrument: "sn", speedBpm: 120, mode: "instrument" });
  await engine.start();

  const verdictSpy = vi.fn();
  engine.on("verdict", verdictSpy);

  const baselinePerf = 1000;
  await engine.advanceToGameOn(baselinePerf);

  // Hit aligned to second expected stroke (t=250ms) → "good" verdict on strokeIdx 2
  onsetSub!({ t_perf: baselinePerf + 250, energy: 0.5 });

  expect(verdictSpy).toHaveBeenCalledTimes(1);
  const arg = verdictSpy.mock.calls[0][0];
  expect(typeof arg.strokeIdx).toBe("number");
  expect(["good", "off"]).toContain(arg.verdict);
  // Hit at t=250 aligns exactly to the expected stroke at t=250 → delta 0.
  expect(arg.delta).toBe(0);
});

test("difficulty scales the scoring tolerance threaded into the timeline", async () => {
  const deps = makeDeps(true);
  let onsetSub: ((e: any) => void) | null = null;
  deps.detector.on = vi.fn((ev: string, cb: any) => { if (ev === "onset") onsetSub = cb; });

  const pattern = normalizePattern({ length: 1, time: 4, sn: ["X", ".", "X", "."] });
  const engine = createTrainerEngine(deps, makeDefaultOpts());
  engine.configure({ pattern, instrument: "sn", speedBpm: 120, mode: "instrument", difficulty: "hard" });
  await engine.start();

  const verdictSpy = vi.fn();
  engine.on("verdict", verdictSpy);

  const baselinePerf = 1000;
  await engine.advanceToGameOn(baselinePerf);

  // Stroke at t=250ms; hit is 50ms late. Normal good=60 → "good"; Hard good=36 → "off".
  onsetSub!({ t_perf: baselinePerf + 300, energy: 0.5 });

  expect(verdictSpy).toHaveBeenCalledTimes(1);
  expect(verdictSpy.mock.calls[0][0].verdict).toBe("off");
  expect(verdictSpy.mock.calls[0][0].delta).toBe(50);
});

test("changing difficulty during gameOn resets to idle", async () => {
  const deps = makeDeps(true);
  const engine = createTrainerEngine(deps, makeDefaultOpts());
  const cfg = {
    pattern: normalizePattern({ length: 1, time: 4, sn: ["X"] }),
    instrument: "sn" as const, speedBpm: 120, mode: "instrument" as const, difficulty: "easy" as const,
  };
  engine.configure(cfg);
  await engine.start();
  await engine.advanceToGameOn();
  engine.configure({ ...cfg, difficulty: "hard" });
  expect(engine.state.value).toBe("idle");
});

function makePositionedBeatboxFactory() {
  // Beatbox factory that captures `on(ev, cb)` per instance, allowing tests to
  // drive "play"/"beat"/"stop" with explicit arguments (notably beat positions).
  type Handlers = {
    play?: () => void;
    beat?: (position: number) => void;
    stop?: () => void;
  };
  const beatboxes: Array<{
    handlers: Handlers;
    player: Beatbox;
    ref: BeatboxReference;
  }> = [];
  const factory = (_repeat: boolean) => {
    const handlers: Handlers = {};
    const player = {
      setPattern: vi.fn(),
      setBeatLength: vi.fn(),
      setRepeat: vi.fn(),
      on: vi.fn((ev: keyof Handlers, cb: never) => { handlers[ev] = cb; }),
      play: vi.fn(),
      stop: vi.fn(),
      getPosition: vi.fn(() => 0),
    } as unknown as Beatbox;
    const ref: BeatboxReference = { id: -1, playing: false, customPosition: false };
    beatboxes.push({ handlers, player, ref });
    return { ref, player };
  };
  return { factory, beatboxes };
}

test("does not wrap on a warm-up beat with a garbage position before a full loop elapses", async () => {
  // Regression: a brand-new AudioContext can report a garbage-large beat position before its
  // output clock settles (live trace observed 7373, then a snap back to 0, ~15ms into the
  // session). Position-decrease wrap detection misread that snap-back as a loop boundary and
  // pushed a full empty loop into the scorer → a loop's worth of phantom misses with zero input.
  // The wrap must be driven by elapsed time, not beat position.
  const deps = makeDeps(true);
  const { factory, beatboxes } = makePositionedBeatboxFactory();
  let mockNow = 1000;
  const engine = createTrainerEngine(deps, { beatboxFactory: factory, now: () => mockNow });
  engine.configure(makeDefaultConfig()); // loopLengthMs = 500 (120bpm × 4 strokes/beat × 1 beat)

  const loopWrapSpy = vi.fn();
  engine.on("loopWrap", loopWrapSpy);

  await engine.start();
  beatboxes[0].handlers.stop?.();   // count-in done → onCountInComplete builds the main player
  await Promise.resolve();
  expect(beatboxes.length).toBeGreaterThanOrEqual(2);

  beatboxes[1].handlers.play?.();   // loop baseline anchored at mockNow = 1000
  mockNow = 1015;                   // 15ms in — audio clock still warming up
  beatboxes[1].handlers.beat?.(7373); // garbage warm-up position
  mockNow = 1019;
  beatboxes[1].handlers.beat?.(0);  // clock settles, position snaps to 0 (looks like a decrease)

  expect(loopWrapSpy).not.toHaveBeenCalled();
  expect(engine.stats().misses).toBe(0);
});

test("engine emits 'loopWrap' once elapsed reaches a loop length", async () => {
  // Wrap detection is time-based: a beat fired before one loopLengthMs has elapsed is still
  // inside the first iteration (no wrap); the first beat at/after the loop length is the wrap.
  // Beat *position* is irrelevant and deliberately not driven here.
  const deps = makeDeps(true);
  const { factory, beatboxes } = makePositionedBeatboxFactory();
  let mockNow = 1000;
  const engine = createTrainerEngine(deps, { beatboxFactory: factory, now: () => mockNow });
  engine.configure(makeDefaultConfig()); // loopLengthMs = 500

  const loopWrapSpy = vi.fn();
  engine.on("loopWrap", loopWrapSpy);

  await engine.start();
  beatboxes[0].handlers.stop?.();  // count-in done → onCountInComplete builds main
  await Promise.resolve();
  expect(beatboxes.length).toBeGreaterThanOrEqual(2);

  beatboxes[1].handlers.play?.();             // loop baseline = 1000
  mockNow = 1200; beatboxes[1].handlers.beat?.(0);
  mockNow = 1499; beatboxes[1].handlers.beat?.(0);
  expect(loopWrapSpy).not.toHaveBeenCalled(); // still < 500ms elapsed
  mockNow = 1500; beatboxes[1].handlers.beat?.(0);
  expect(loopWrapSpy).toHaveBeenCalledTimes(1); // exactly one loop length elapsed → wrap
});

test("re-anchors the baseline after a wrap so it fires once per loop, not on every beat", async () => {
  const deps = makeDeps(true);
  const { factory, beatboxes } = makePositionedBeatboxFactory();
  let mockNow = 1000;
  const engine = createTrainerEngine(deps, { beatboxFactory: factory, now: () => mockNow });
  engine.configure(makeDefaultConfig()); // loopLengthMs = 500

  const loopWrapSpy = vi.fn();
  engine.on("loopWrap", loopWrapSpy);

  await engine.start();
  beatboxes[0].handlers.stop?.();
  await Promise.resolve();

  beatboxes[1].handlers.play?.();             // baseline = 1000
  mockNow = 1500; beatboxes[1].handlers.beat?.(0);
  expect(loopWrapSpy).toHaveBeenCalledTimes(1); // wrap #1; baseline re-anchored to 1500
  // Later beats still inside the second iteration must not re-wrap.
  mockNow = 1700; beatboxes[1].handlers.beat?.(0);
  mockNow = 1999; beatboxes[1].handlers.beat?.(0);
  expect(loopWrapSpy).toHaveBeenCalledTimes(1);
  mockNow = 2000; beatboxes[1].handlers.beat?.(0);
  expect(loopWrapSpy).toHaveBeenCalledTimes(2); // next loop boundary → wrap #2
});

test("engine.off() removes the listener", async () => {
  const deps = makeDeps(true);
  let onsetSub: ((e: any) => void) | null = null;
  deps.detector.on = vi.fn((ev: string, cb: any) => { if (ev === "onset") onsetSub = cb; });

  const pattern = normalizePattern({ length: 1, time: 4, sn: ["X", ".", "X", "."] });
  const engine = createTrainerEngine(deps, makeDefaultOpts());
  engine.configure({ pattern, instrument: "sn", speedBpm: 120, mode: "instrument" });
  await engine.start();

  const spy = vi.fn();
  engine.on("verdict", spy);
  engine.off("verdict", spy);

  const baselinePerf = 1000;
  await engine.advanceToGameOn(baselinePerf);
  onsetSub!({ t_perf: baselinePerf + 250, energy: 0.5 });

  expect(spy).not.toHaveBeenCalled();
});

test("verdict event flags an early downbeat (wrapped to loop end) as nextLoop", async () => {
  const deps = makeDeps(true);
  let onsetSub: ((e: any) => void) | null = null;
  deps.detector.on = vi.fn((ev: string, cb: any) => { if (ev === "onset") onsetSub = cb; });

  // strokeMs 125, loopLen 500; strokes at t=0 (idx 0) and t=250 (idx 2).
  const pattern = normalizePattern({ length: 1, time: 4, sn: ["X", ".", "X", "."] });
  const engine = createTrainerEngine(deps, makeDefaultOpts());
  engine.configure({ pattern, instrument: "sn", speedBpm: 120, mode: "instrument" });
  await engine.start();

  const spy = vi.fn();
  engine.on("verdict", spy);

  const baselinePerf = 1000;
  await engine.advanceToGameOn(baselinePerf);

  // 20ms before the downbeat → tLoop ≈ loopLen-20, matched to stroke 0 across the wrap.
  onsetSub!({ t_perf: baselinePerf - 20, energy: 0.5 });
  expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ strokeIdx: 0, nextLoop: true }));

  // A plain in-loop hit on stroke 2 is not a boundary crossing.
  onsetSub!({ t_perf: baselinePerf + 250, energy: 0.5 });
  expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ strokeIdx: 2, nextLoop: false }));
});

test("configure() during gameOn forces a reset to idle", async () => {
  const deps = makeDeps(true);
  const engine = createTrainerEngine(deps, makeDefaultOpts());
  engine.configure({
    pattern: normalizePattern({ length: 1, time: 4, sn: ["X"] }),
    instrument: "sn", speedBpm: 120, mode: "instrument",
  });
  await engine.start();
  await engine.advanceToGameOn();
  engine.configure({
    pattern: normalizePattern({ length: 1, time: 4, sn: ["X"] }),
    instrument: "ls", speedBpm: 120, mode: "instrument",
  });
  expect(engine.state.value).toBe("idle");
});
