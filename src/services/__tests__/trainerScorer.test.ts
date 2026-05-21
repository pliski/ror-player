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
