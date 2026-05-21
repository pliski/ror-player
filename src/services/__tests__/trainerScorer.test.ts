import { expect, test } from "vitest";
import { SILENT_STROKES, buildExpectedTimeline, matchHits, DEFAULT_TOLERANCE } from "../trainerScorer";
import { normalizePattern } from "../../state/pattern";

test("SILENT_STROKES matches the documented set", () => {
  expect(SILENT_STROKES).toEqual(new Set([" ", "", ".", "s"]));
});

test("buildExpectedTimeline handles an empty pattern", () => {
  const pattern = normalizePattern({ length: 4, time: 4 });
  const tl = buildExpectedTimeline(pattern, "sn", 120);
  expect(tl.expected).toEqual([]);
  expect(tl.loopLengthMs).toBe(60_000 / 120 * 4); // 2000 ms
});

test("buildExpectedTimeline derives expected hits from snare line", () => {
  const pattern = normalizePattern({
    length: 1, time: 4, sn: ["X", ".", "X", "."]
  });
  const tl = buildExpectedTimeline(pattern, "sn", 120);
  const strokeMs = 60_000 / (120 * 4); // 125 ms
  expect(tl.expected).toEqual([
    { strokeIdx: 0, t: 0 },
    { strokeIdx: 2, t: 2 * strokeMs }
  ]);
});

test("matchHits with no hits and no expected", () => {
  const r = matchHits([], [], DEFAULT_TOLERANCE.off + 50);
  expect(r).toEqual({ matched: [], misses: [], extras: [] });
});

test("matchHits: single perfect on-time hit", () => {
  const e = [{ strokeIdx: 0, t: 100 }];
  const d = [{ t: 100, energy: 0.5 }];
  const r = matchHits(d, e, DEFAULT_TOLERANCE.off + 50);
  expect(r.matched).toHaveLength(1);
  expect(r.matched[0].delta).toBe(0);
  expect(r.matched[0].verdict).toBe("good");
  expect(r.misses).toEqual([]);
  expect(r.extras).toEqual([]);
});

test("matchHits: single off-but-attributable hit", () => {
  const e = [{ strokeIdx: 0, t: 100 }];
  const d = [{ t: 195, energy: 0.5 }]; // 95ms late → off
  const r = matchHits(d, e, DEFAULT_TOLERANCE.off + 50);
  expect(r.matched).toHaveLength(1);
  expect(r.matched[0].delta).toBe(95);
  expect(r.matched[0].verdict).toBe("off");
});

test("matchHits: missed expected, no detected", () => {
  const e = [{ strokeIdx: 0, t: 100 }];
  const r = matchHits([], e, DEFAULT_TOLERANCE.off + 50);
  expect(r.misses).toEqual(e);
});

test("matchHits: extra detection beyond window", () => {
  const e = [{ strokeIdx: 0, t: 100 }];
  const d = [{ t: 500, energy: 0.5 }];
  const r = matchHits(d, e, DEFAULT_TOLERANCE.off + 50);
  expect(r.matched).toEqual([]);
  expect(r.misses).toEqual(e);
  expect(r.extras).toEqual(d);
});

test("matchHits: two adjacent detections compete for one expected", () => {
  // expected at t=100, detections at 90 and 110 → 110 wins because |10|>|10|... actually both
  // are equidistant. We accept either, but in our greedy form the first one (t=90) wins.
  const e = [{ strokeIdx: 0, t: 100 }];
  const d = [{ t: 90, energy: 0.5 }, { t: 110, energy: 0.5 }];
  const r = matchHits(d, e, 200);
  expect(r.matched).toHaveLength(1);
  expect(r.matched[0].d.t).toBe(90);
  expect(r.extras).toHaveLength(1);
  expect(r.extras[0].t).toBe(110);
});

test("matchHits: detection prefers closer next-expected over current", () => {
  // detected at t=150, expected at t=100 (Δ=50) and t=200 (Δ=-50). Both within window.
  // We're walking forward, so we match d with the first expected (100, Δ=+50) and the
  // second expected becomes a miss.
  const e = [{ strokeIdx: 0, t: 100 }, { strokeIdx: 1, t: 200 }];
  const d = [{ t: 150, energy: 0.5 }];
  const r = matchHits(d, e, 200);
  expect(r.matched).toHaveLength(1);
  expect(r.matched[0].e.t).toBe(100);
  expect(r.misses).toHaveLength(1);
  expect(r.misses[0].t).toBe(200);
});

test("matchHits: perfect 4-beat run", () => {
  const e = Array.from({ length: 4 }, (_, i) => ({ strokeIdx: i, t: i * 125 }));
  const d = Array.from({ length: 4 }, (_, i) => ({ t: i * 125, energy: 0.5 }));
  const r = matchHits(d, e, 200);
  expect(r.matched).toHaveLength(4);
  expect(r.misses).toHaveLength(0);
  expect(r.extras).toHaveLength(0);
  expect(r.matched.every((m) => m.verdict === "good")).toBe(true);
});

test("matchHits: consistently 80ms late → all 'off'", () => {
  const e = Array.from({ length: 4 }, (_, i) => ({ strokeIdx: i, t: i * 125 }));
  const d = e.map((h) => ({ t: h.t + 80, energy: 0.5 }));
  const r = matchHits(d, e, 200);
  expect(r.matched).toHaveLength(4);
  expect(r.matched.every((m) => m.verdict === "off")).toBe(true);
  expect(r.matched.every((m) => m.delta === 80)).toBe(true);
});

test("matchHits: extra detection before all expected", () => {
  const e = [{ strokeIdx: 0, t: 500 }];
  const d = [{ t: 100, energy: 0.5 }];
  const r = matchHits(d, e, 200);
  expect(r.matched).toEqual([]);
  expect(r.misses).toEqual(e);
  expect(r.extras).toEqual(d);
});
