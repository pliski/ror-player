import { expect, test } from "vitest";
import { computeMedianAndSpread } from "../latencyCalibrator";

test("computeMedianAndSpread: empty input", () => {
  expect(computeMedianAndSpread([])).toEqual({ median: 0, spread: 0, count: 0 });
});

test("computeMedianAndSpread: single value", () => {
  expect(computeMedianAndSpread([42])).toEqual({ median: 42, spread: 0, count: 1 });
});

test("computeMedianAndSpread: odd count", () => {
  expect(computeMedianAndSpread([10, 20, 30])).toEqual({
    median: 20, spread: 10, count: 3, // spread = MAD: median of |v − 20| = median([10, 0, 10]) = 10
  });
});

test("computeMedianAndSpread: even count averages middle two", () => {
  expect(computeMedianAndSpread([10, 20, 30, 40])).toEqual({
    median: 25, spread: 10, count: 4,
  });
});
