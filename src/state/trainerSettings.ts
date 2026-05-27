import * as z from "zod";
import { instrumentValidator } from "../config";

export const trainerSettingsValidator = z.object({
  latencyOffsetMs: z.number().default(0),
  latencyCalibratedAt: z.number().optional(),
  sensitivity: z.preprocess(
    (v) => typeof v === "number" ? Math.min(3, Math.max(0.3, v)) : v,
    z.number().default(1)
  ),
  difficulty: z.enum(["easy", "normal", "hard"]).default("easy"),
  micPromptAcked: z.boolean().default(false),
  headphonesWarningAcked: z.boolean().default(false),
  lastInstrument: instrumentValidator.optional(),
  lastMode: z.enum(["instrument", "band"]).default("instrument"),
  lastTuneName: z.string().optional(),
  lastPatternName: z.string().optional(),
}).default(() => ({}));

export type TrainerSettings = z.infer<typeof trainerSettingsValidator>;
export type TrainerSettingsOptional = z.input<typeof trainerSettingsValidator>;

export function normalizeTrainerSettings(data?: TrainerSettingsOptional): TrainerSettings {
  return trainerSettingsValidator.parse(data);
}
