import { expect, test } from "vitest";
import { normalizePracticeSettings } from "../practiceSettings";

test("normalizePracticeSettings defaults", () => {
  expect(normalizePracticeSettings()).toEqual({
    latencyOffsetMs: 0,
    sensitivity: 1,
    micPromptAcked: false,
    headphonesWarningAcked: false,
    lastMode: "instrument",
    difficulty: "easy"
  });
});

test("normalizePracticeSettings clamps sensitivity", () => {
  expect(normalizePracticeSettings({ sensitivity: 10 }).sensitivity).toBe(3);
  expect(normalizePracticeSettings({ sensitivity: 0.01 }).sensitivity).toBe(0.3);
});

test("normalizePracticeSettings preserves last instrument and tune", () => {
  expect(normalizePracticeSettings({
    lastInstrument: "sn",
    lastTuneName: "Funk",
    lastPatternName: "Tune"
  })).toMatchObject({
    lastInstrument: "sn",
    lastTuneName: "Funk",
    lastPatternName: "Tune"
  });
});

test("normalizePracticeSettings preserves difficulty", () => {
  expect(normalizePracticeSettings({ difficulty: "hard" }).difficulty).toBe("hard");
});
