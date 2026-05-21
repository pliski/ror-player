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
}

export function createTrainerEngine(deps: TrainerEngineDeps): TrainerEngine {
  const state = ref<TrainerState>("idle");
  return { state };
}
