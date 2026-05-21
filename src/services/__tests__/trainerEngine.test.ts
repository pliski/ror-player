import { expect, test, vi } from "vitest";
import { createTrainerEngine } from "../trainerEngine";

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

test("start() transitions to requestingMic then countIn on grant", async () => {
  const deps = makeDeps(true);
  const engine = createTrainerEngine(deps);
  const promise = engine.start();
  expect(engine.state.value).toBe("requestingMic");
  await promise;
  expect(engine.state.value).toBe("countIn");
  expect(deps.detector.start).toHaveBeenCalled();
});

test("start() denied returns to idle", async () => {
  const deps = makeDeps(false);
  const engine = createTrainerEngine(deps);
  await engine.start().catch(() => {});
  expect(engine.state.value).toBe("idle");
});

test("stop() resets to idle and cleans up", async () => {
  const deps = makeDeps(true);
  const engine = createTrainerEngine(deps);
  await engine.start();
  await engine.stop();
  expect(engine.state.value).toBe("idle");
  expect(deps.micPermission.release).toHaveBeenCalled();
  expect(deps.detector.stop).toHaveBeenCalled();
});

test("start() is a no-op when not idle or results", async () => {
  const deps = makeDeps(true);
  const engine = createTrainerEngine(deps);
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
  const engine = createTrainerEngine(deps, { timer: fakeTimer as any });
  await engine.start();
  expect(engine.state.value).toBe("countIn");
  await engine.advanceToGameOn();
  expect(engine.state.value).toBe("gameOn");
});

test("stopGame() transitions from gameOn through finalising to results", async () => {
  const deps = makeDeps(true);
  const engine = createTrainerEngine(deps);
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
  const engine = createTrainerEngine(deps, { timer: fakeTimer as any });
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
  const engine = createTrainerEngine(deps);
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
