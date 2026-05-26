export interface DetectorParams {
  multiplier: number;      // how many × noise-floor to trigger
  refractoryFrames: number; // minimum gap between triggers, in blocks
  noiseFloorInit?: number;
}

export interface DetectorState {
  params: DetectorParams;
  noiseFloor: number;
  lastFireFrame: number;
  armed: boolean;
}

export interface OnsetEvent {
  /** Frame index of the trigger */
  frame: number;
  /** RMS energy of the triggering block */
  energy: number;
}

// Minimum value the adaptive noise floor can decay to. Without this clamp the
// floor adapts down to ambient room RMS (~0.001) and the trigger threshold
// drops with it, firing on breathing/fan noise. Empirically chosen so the
// threshold (floor × multiplier) lands cleanly between observed ambient peaks
// (≤0.034) and the softest real percussion hits (≥0.05).
export const MIN_NOISE_FLOOR = 0.015;

// Ceiling (× noise floor) below which the floor is allowed to LEARN. Kept well
// under the trigger (floor × multiplier) so a hit's loud body or decay tail can
// never drag the floor — and thus the threshold — upward; that positive feedback
// is what silenced detection after a few loops. Capped at `multiplier` so it can
// never reach the trigger even at high user sensitivity (multiplier < 1.5).
export const LEARN_RATIO = 1.5;

export function rmsOfBlock(block: Float32Array): number {
  if (block.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < block.length; i++) sumSq += block[i] * block[i];
  return Math.sqrt(sumSq / block.length);
}

export function createDetectorState(params: DetectorParams): DetectorState {
  return {
    params,
    noiseFloor: Math.max(MIN_NOISE_FLOOR, params.noiseFloorInit ?? 0.001),
    lastFireFrame: -Infinity,
    armed: true,
  };
}

/**
 * Processes one audio block. Mutates `state` in place (noiseFloor, lastFireFrame).
 * `state` must not be shared across concurrent callers.
 */
export function processBlock(
  state: DetectorState,
  block: Float32Array,
  currentFrame: number,
): OnsetEvent | null {
  const rms = rmsOfBlock(block);
  const exceeds = rms > state.noiseFloor * state.params.multiplier;

  // Learn the floor only from genuinely-quiet blocks (see LEARN_RATIO).
  if (rms < state.noiseFloor * Math.min(LEARN_RATIO, state.params.multiplier)) {
    state.noiseFloor = Math.max(
      MIN_NOISE_FLOOR,
      state.noiseFloor * 0.995 + rms * 0.005,
    );
  }

  // Re-arm once energy leaves the fireable zone. One strike's sustained decay
  // stays above the trigger and so fires only once, but a genuine next stroke —
  // which only has to dip below the trigger, not all the way to ambient — re-arms.
  if (!exceeds) {
    state.armed = true;
  }

  const pastRefractory = (currentFrame - state.lastFireFrame) > state.params.refractoryFrames;
  if (exceeds && pastRefractory && state.armed) {
    state.lastFireFrame = currentFrame;
    state.armed = false;
    return { frame: currentFrame, energy: rms };
  }
  return null;
}
