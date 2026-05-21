import { expect, test } from "vitest";
import { rmsOfBlock, createDetectorState, processBlock, MIN_NOISE_FLOOR } from "../onsetDetectorCore";

test("rmsOfBlock: silent block", () => {
  expect(rmsOfBlock(new Float32Array(128))).toBe(0);
});

test("rmsOfBlock: constant amplitude", () => {
  const block = new Float32Array(128).fill(0.5);
  expect(rmsOfBlock(block)).toBeCloseTo(0.5, 5);
});

test("processBlock: silent input never triggers", () => {
  const state = createDetectorState({ multiplier: 3, refractoryFrames: 50 });
  for (let i = 0; i < 100; i++) {
    expect(processBlock(state, new Float32Array(128), i)).toBeNull();
  }
});

test("processBlock: loud transient on quiet baseline triggers", () => {
  const state = createDetectorState({ multiplier: 3, refractoryFrames: 5 });

  // Warm noise floor with quiet noise
  const quiet = new Float32Array(128).fill(0.0001);
  for (let i = 0; i < 200; i++) processBlock(state, quiet, i);

  // Loud transient
  const loud = new Float32Array(128).fill(0.5);
  const trigger = processBlock(state, loud, 200);
  expect(trigger).not.toBeNull();
  expect(trigger!.energy).toBeGreaterThan(0.4);
});

test("processBlock: refractory blocks repeats", () => {
  const state = createDetectorState({ multiplier: 3, refractoryFrames: 100 });
  const quiet = new Float32Array(128).fill(0.0001);
  for (let i = 0; i < 50; i++) processBlock(state, quiet, i);
  const loud = new Float32Array(128).fill(0.5);
  expect(processBlock(state, loud, 50)).not.toBeNull();
  // Immediately after — within refractory
  expect(processBlock(state, loud, 51)).toBeNull();
  // After refractory
  expect(processBlock(state, loud, 151)).not.toBeNull();
});

test("processBlock: respects noiseFloorInit", () => {
  // Higher initial floor than default — the same quiet input that triggers with
  // the default 0.001 floor should now be sub-threshold.
  const state = createDetectorState({ multiplier: 3, refractoryFrames: 5, noiseFloorInit: 1.0 });
  const moderate = new Float32Array(128).fill(0.1);
  expect(processBlock(state, moderate, 0)).toBeNull();
});

test("createDetectorState: initial floor below MIN_NOISE_FLOOR is bumped up", () => {
  const state = createDetectorState({ multiplier: 3, refractoryFrames: 5, noiseFloorInit: 0.0001 });
  expect(state.noiseFloor).toBe(MIN_NOISE_FLOOR);
});

test("processBlock: adaptive floor stays clamped at MIN_NOISE_FLOOR under prolonged silence", () => {
  // Start the floor above the clamp; let it decay against very quiet input. Without the clamp
  // it would settle near the input RMS (~0.0001); with the clamp it should park at MIN_NOISE_FLOOR.
  const state = createDetectorState({ multiplier: 3, refractoryFrames: 5, noiseFloorInit: 0.1 });
  const silent = new Float32Array(128).fill(0.0001);
  for (let i = 0; i < 10000; i++) processBlock(state, silent, i);
  expect(state.noiseFloor).toBe(MIN_NOISE_FLOOR);
});
