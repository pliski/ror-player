export interface DetectorParams {
  multiplier: number;      // how many × noise-floor to trigger
  refractoryFrames: number; // minimum gap between triggers, in blocks
  noiseFloorInit?: number;
}

export interface DetectorState {
  params: DetectorParams;
  noiseFloor: number;
  lastFireFrame: number;
}

export interface OnsetEvent {
  /** Frame index of the trigger */
  frame: number;
  /** RMS energy of the triggering block */
  energy: number;
}

export function rmsOfBlock(block: Float32Array): number {
  if (block.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < block.length; i++) sumSq += block[i] * block[i];
  return Math.sqrt(sumSq / block.length);
}

export function createDetectorState(params: DetectorParams): DetectorState {
  return {
    params,
    noiseFloor: params.noiseFloorInit ?? 0.001,
    lastFireFrame: -Infinity,
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

  // Adaptive floor: only learn when block is below 4× current floor
  if (rms < state.noiseFloor * 4) {
    state.noiseFloor = state.noiseFloor * 0.995 + rms * 0.005;
  }

  const exceeds = rms > state.noiseFloor * state.params.multiplier;
  const pastRefractory = (currentFrame - state.lastFireFrame) > state.params.refractoryFrames;
  if (exceeds && pastRefractory) {
    state.lastFireFrame = currentFrame;
    return { frame: currentFrame, energy: rms };
  }
  return null;
}
