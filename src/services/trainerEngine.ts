import { Ref, ref } from "vue";
import { MicPermission } from "./mediaPermissions";
import { OnsetDetector } from "./onsetDetector";

export type TrainerState =
  | "idle"
  | "requestingMic"
  | "countIn"
  | "gameOn"
  | "finalising"
  | "results";

export interface TrainerEngineDeps {
  micPermission: MicPermission;
  detector: OnsetDetector;
}

export interface TrainerEngine {
  state: Ref<TrainerState>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createTrainerEngine(deps: TrainerEngineDeps): TrainerEngine {
  const state = ref<TrainerState>("idle");
  let activeStream: MediaStream | null = null;

  async function start() {
    if (state.value !== "idle" && state.value !== "results") return;
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
      state.value = "countIn";
    } catch (err) {
      state.value = "idle";
      if (activeStream) {
        deps.micPermission.release(activeStream);
        activeStream = null;
      }
      throw err;
    }
  }

  async function stop() {
    state.value = "idle";
    if (activeStream) {
      deps.micPermission.release(activeStream);
      activeStream = null;
    }
    await deps.detector.stop();
  }

  return { state, start, stop };
}
