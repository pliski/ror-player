import { expect, test } from "vitest";
import { createTrainerEngine } from "../trainerEngine";

test("engine starts in Idle", () => {
  const engine = createTrainerEngine({
    micPermission: { state: { value: "unknown" } as any, request: async () => ({} as any), release: () => {} },
    detector: { start: async () => {}, stop: async () => {}, setSensitivity: () => {}, on: () => {}, off: () => {} },
  });
  expect(engine.state.value).toBe("idle");
});
