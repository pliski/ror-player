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
