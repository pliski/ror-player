import { expect, test } from "vitest";
import { normalizeTrainerSettings } from "../trainerSettings";

test("normalizeTrainerSettings defaults", () => {
  expect(normalizeTrainerSettings()).toEqual({
    latencyOffsetMs: 0,
    sensitivity: 1,
    micPromptAcked: false,
    headphonesWarningAcked: false,
    lastMode: "instrument"
  });
});

test("normalizeTrainerSettings clamps sensitivity", () => {
  expect(normalizeTrainerSettings({ sensitivity: 10 }).sensitivity).toBe(3);
  expect(normalizeTrainerSettings({ sensitivity: 0.01 }).sensitivity).toBe(0.3);
});

test("normalizeTrainerSettings preserves last instrument and tune", () => {
  expect(normalizeTrainerSettings({
    lastInstrument: "sn",
    lastTuneName: "Funk",
    lastPatternName: "Tune"
  })).toMatchObject({
    lastInstrument: "sn",
    lastTuneName: "Funk",
    lastPatternName: "Tune"
  });
});
