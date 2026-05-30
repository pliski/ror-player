import { expect, test } from "vitest";
import { SILENT_STROKES, buildExpectedTimeline, matchHits, DEFAULT_TOLERANCE, scoreSession, createScorer, deltaToPosition, toleranceForDifficulty } from "../trainerScorer";
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

test("buildExpectedTimeline aligns strokeIdx with the upbeat-adjusted partition cells", () => {
  // upbeat=1 with an empty pickup slot (like real Low Surdo lines): the array is
  // [pickup, main…] so raw index 0 is the pickup and the main downbeat is raw index 1.
  // PatternPlayer labels the cell at raw index `i` as `stroke-i-${i - upbeat}`, and the
  // engine anchors loopBaselinePerf at raw index 0, so expected `t` stays raw-indexed.
  const pattern = normalizePattern({
    length: 1, time: 4, upbeat: 1, sn: [" ", "X", ".", ".", "X"]
  });
  const tl = buildExpectedTimeline(pattern, "sn", 120);
  const strokeMs = 60_000 / (120 * 4); // 125 ms
  expect(tl.expected).toEqual([
    { strokeIdx: 0, t: 1 * strokeMs },  // first main stroke: cell stroke-i-0, not stroke-i-1
    { strokeIdx: 3, t: 4 * strokeMs }   // last slot: scored at all (buggy loop dropped it)
  ]);
  expect(tl.loopLengthMs).toBe(5 * strokeMs); // full array incl. upbeat, not 4*strokeMs
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

test("matchHits: circular — early downbeat wrapping to the loop end matches stroke 0", () => {
  // A 20ms-early downbeat is converted by the engine to tLoop = loopLen - 20 = 980.
  // With a circular loop it must match stroke 0 (delta -20), not become a miss + extra.
  const e = [{ strokeIdx: 0, t: 0 }, { strokeIdx: 1, t: 500 }];
  const d = [{ t: 980, energy: 1 }];
  const r = matchHits(d, e, 200, DEFAULT_TOLERANCE, 1000);
  expect(r.matched).toHaveLength(1);
  expect(r.matched[0].e.strokeIdx).toBe(0);
  expect(r.matched[0].delta).toBe(-20);
  expect(r.matched[0].verdict).toBe("good");
  expect(r.misses).toHaveLength(1);   // stroke 1 (t=500) never hit
  expect(r.misses[0].strokeIdx).toBe(1);
  expect(r.extras).toEqual([]);
});

test("matchHits: circular — a late hit on a stroke near the loop end is NOT stolen by the wrap", () => {
  // Dense pattern: last stroke at t=875 (loopLen 1000), window 200. A 40ms-late hit at 915 is
  // nearer the last stroke (40) than the downbeat across the boundary (85) → must stay matched
  // to the last stroke, not be pulled around to stroke 0.
  const e = [{ strokeIdx: 0, t: 0 }, { strokeIdx: 1, t: 875 }];
  const d = [{ t: 915, energy: 1 }];
  const r = matchHits(d, e, 200, DEFAULT_TOLERANCE, 1000);
  expect(r.matched).toHaveLength(1);
  expect(r.matched[0].e.t).toBe(875);
  expect(r.matched[0].delta).toBe(40);
});

test("scoreSession: empty session", () => {
  const s = scoreSession({ matched: [], misses: [], extras: [] });
  expect(s).toEqual({
    hits: 0, misses: 0, extras: 0, expectedTotal: 0,
    meanAbsDelta: 0, drift: 0, headlineScore: 100,
  });
});

test("scoreSession: perfect 4-beat run → 100", () => {
  const matched = [0, 1, 2, 3].map((i) => ({
    d: { t: i * 125, energy: 0.5 },
    e: { strokeIdx: i, t: i * 125 },
    delta: 0,
    verdict: "good" as const,
  }));
  const s = scoreSession({ matched, misses: [], extras: [] });
  expect(s.headlineScore).toBe(100);
  expect(s.meanAbsDelta).toBe(0);
  expect(s.drift).toBe(0);
  expect(s.hits).toBe(4);
});

test("scoreSession: half-missed run", () => {
  const matched = [0, 1].map((i) => ({
    d: { t: i * 125, energy: 0.5 },
    e: { strokeIdx: i, t: i * 125 },
    delta: 0,
    verdict: "good" as const,
  }));
  const misses = [{ strokeIdx: 2, t: 250 }, { strokeIdx: 3, t: 375 }];
  const s = scoreSession({ matched, misses, extras: [] });
  expect(s.hits).toBe(2);
  expect(s.misses).toBe(2);
  expect(s.expectedTotal).toBe(4);
  // 60 * 0.5 + 40 * 1.0 = 70
  expect(s.headlineScore).toBe(70);
});

test("scoreSession: all-late drift indicator", () => {
  const matched = [0, 1, 2, 3].map((i) => ({
    d: { t: i * 125 + 30, energy: 0.5 },
    e: { strokeIdx: i, t: i * 125 },
    delta: 30,
    verdict: "good" as const,
  }));
  const s = scoreSession({ matched, misses: [], extras: [] });
  // all deltas are +30 → drift = meanAbsDelta = 30
  expect(s.drift).toBe(30);
  expect(s.meanAbsDelta).toBe(30);
});

test("createScorer accumulates hits across a single loop", () => {
  const timeline = {
    expected: [
      { strokeIdx: 0, t: 0 },
      { strokeIdx: 1, t: 125 },
    ],
    loopLengthMs: 500,
    toleranceMs: DEFAULT_TOLERANCE,
  };
  const s = createScorer(timeline);
  s.acceptHit({ t: 0, energy: 0.5 });
  s.acceptHit({ t: 125, energy: 0.5 });
  s.finalize();
  const stats = s.stats();
  expect(stats.hits).toBe(2);
  expect(stats.misses).toBe(0);
});

test("createScorer resets the matcher per loop", () => {
  const timeline = {
    expected: [{ strokeIdx: 0, t: 0 }],
    loopLengthMs: 500,
    toleranceMs: DEFAULT_TOLERANCE,
  };
  const s = createScorer(timeline);
  s.acceptHit({ t: 0, energy: 0.5 });   // matches loop 0 stroke 0
  s.onLoopWrap();
  s.acceptHit({ t: 0, energy: 0.5 });   // matches loop 1 stroke 0
  s.finalize();
  expect(s.stats().hits).toBe(2);
});

test("createScorer trims tail when finalize(tailMs) given", () => {
  const timeline = {
    expected: [
      { strokeIdx: 0, t: 0 },
      { strokeIdx: 1, t: 1000 }, // late hit in the tail
    ],
    loopLengthMs: 2000,
    toleranceMs: DEFAULT_TOLERANCE,
  };
  const s = createScorer(timeline);
  s.acceptHit({ t: 0, energy: 0.5 });
  // user pressed Stop at "now = 1100", tailMs = 500 → drop expected hits in [600..1100]
  s.finalize({ stopAtMs: 1100, tailMs: 500 });
  // The expected at t=1000 falls in the trim window and is dropped.
  expect(s.stats().misses).toBe(0);
  expect(s.stats().hits).toBe(1);
});

test("createScorer stats() before finalize returns live approximation", () => {
  const timeline = {
    expected: [{ strokeIdx: 0, t: 0 }],
    loopLengthMs: 500,
    toleranceMs: DEFAULT_TOLERANCE,
  };
  const s = createScorer(timeline);
  s.acceptHit({ t: 0, energy: 0.5 });
  const live = s.stats();          // pre-finalize: live path
  expect(live.hits).toBe(1);
  expect(live.misses).toBe(0);
  s.finalize();
  expect(s.stats().hits).toBe(1);  // finalize agrees
});

test("acceptHit returns a signed delta (late > 0, early < 0, on-time 0)", () => {
  const pattern = normalizePattern({ length: 1, time: 4, sn: ["X", "X", ".", "."] });
  const tl = buildExpectedTimeline(pattern, "sn", 120); // strokeMs 125; expected at t=0 and t=125
  const scorer = createScorer(tl);
  expect(scorer.acceptHit({ t: 125, energy: 0.5 })).toMatchObject({ strokeIdx: 1, verdict: "good", delta: 0 });
  expect(scorer.acceptHit({ t: 140, energy: 0.5 })).toMatchObject({ delta: 15 });  // 15 ms late
  expect(scorer.acceptHit({ t: 110, energy: 0.5 })).toMatchObject({ delta: -15 }); // 15 ms early
});

test("acceptHit: flags a boundary-crossing match as wrapped (and normal matches as not)", () => {
  const timeline = {
    expected: [{ strokeIdx: 0, t: 0 }, { strokeIdx: 1, t: 500 }],
    loopLengthMs: 1000,
    toleranceMs: DEFAULT_TOLERANCE,
  };
  const s = createScorer(timeline);
  // Early downbeat parked at the loop end → matched stroke 0 across the boundary.
  expect(s.acceptHit({ t: 980, energy: 1 })).toMatchObject({ strokeIdx: 0, delta: -20, wrapped: true });
  // A normal in-loop hit does not wrap.
  expect(s.acceptHit({ t: 510, energy: 1 })).toMatchObject({ strokeIdx: 1, delta: 10, wrapped: false });
});

test("acceptHit: a slightly-early downbeat (wrapped to the loop end) lights up stroke 0", () => {
  // This is the live-verdict path that highlights the partition cell. The engine converts a
  // 20ms-early downbeat to tLoop = loopLen - 20; bestGuess must attribute it to stroke 0.
  const timeline = {
    expected: [{ strokeIdx: 0, t: 0 }, { strokeIdx: 1, t: 500 }],
    loopLengthMs: 1000,
    toleranceMs: DEFAULT_TOLERANCE,
  };
  const s = createScorer(timeline);
  expect(s.acceptHit({ t: 980, energy: 1 })).toMatchObject({ strokeIdx: 0, verdict: "good", delta: -20 });
});

test("deltaToPosition: centre, zone boundary, edges, clamp, direction", () => {
  // on-time → centre, good zone
  expect(deltaToPosition(0)).toEqual({ percent: 50, zone: "good" });
  // late (+) leans left (<50); early (-) leans right (>50)
  expect(deltaToPosition(60).percent).toBeCloseTo(30, 5);   // +good → 20% left of centre
  expect(deltaToPosition(-60).percent).toBeCloseTo(70, 5);
  // zone flips just past the good tolerance
  expect(deltaToPosition(60).zone).toBe("good");
  expect(deltaToPosition(61).zone).toBe("off");
  // off tolerance lands at the edges
  expect(deltaToPosition(150)).toEqual({ percent: 0, zone: "off" });   // late edge (left)
  expect(deltaToPosition(-150)).toEqual({ percent: 100, zone: "off" }); // early edge (right)
  // beyond off is clamped
  expect(deltaToPosition(400).percent).toBe(0);
  expect(deltaToPosition(-400).percent).toBe(100);
});

test("toleranceForDifficulty scales DEFAULT_TOLERANCE per level", () => {
  expect(toleranceForDifficulty("normal")).toEqual(DEFAULT_TOLERANCE);   // ×1.0 → identical to today
  expect(toleranceForDifficulty("easy")).toEqual({ good: 105, off: 263 }); // ×1.75, rounded
  expect(toleranceForDifficulty("hard")).toEqual({ good: 36, off: 90 });   // ×0.6
});

// Live stats are monotonic: a stroke is only counted once its timing window has
// closed (t <= elapsed - windowMs). windowMs = 200 for DEFAULT_TOLERANCE.
const monoTimeline = {
  expected: [
    { strokeIdx: 0, t: 0 },
    { strokeIdx: 1, t: 100 },
    { strokeIdx: 2, t: 200 },
    { strokeIdx: 3, t: 300 },
  ],
  loopLengthMs: 400,
  toleranceMs: DEFAULT_TOLERANCE,
};

test("live stats: not-yet-reached strokes are not counted as misses", () => {
  const s = createScorer(monoTimeline);
  // elapsed 100 → cutoff = 100 - 200 = -100 → no stroke window closed yet.
  const st = s.stats({ currentLoopElapsedMs: 100 });
  expect(st.misses).toBe(0);
  expect(st.expectedTotal).toBe(0);
});

test("live stats: a stroke becomes a miss only after its window closes", () => {
  const s = createScorer(monoTimeline);
  // elapsed 250 → cutoff = 50 → only stroke t=0 is closed; nothing played → 1 miss.
  const st = s.stats({ currentLoopElapsedMs: 250 });
  expect(st.expectedTotal).toBe(1);
  expect(st.misses).toBe(1);
  expect(st.hits).toBe(0);
});

test("live stats: a played stroke counts as a hit once its window closes", () => {
  const s = createScorer(monoTimeline);
  s.acceptHit({ t: 0, energy: 1 }); // on stroke 0 → good
  const st = s.stats({ currentLoopElapsedMs: 250 }); // cutoff 50 → stroke 0 closed
  expect(st.hits).toBe(1);
  expect(st.misses).toBe(0);
  expect(st.expectedTotal).toBe(1);
});

test("live stats: misses are monotonic and do not jump at a loop wrap", () => {
  const s = createScorer(monoTimeline);
  const m1 = s.stats({ currentLoopElapsedMs: 250 }).misses; // cutoff 50  → stroke t=0 closed → 1
  const m2 = s.stats({ currentLoopElapsedMs: 399 }).misses; // cutoff 199 → strokes t=0,100 closed → 2 (loop tail not judged live yet)
  s.onLoopWrap();                                            // loop 1 completes → its full 4 strokes (no hits) lock as misses
  const m3 = s.stats({ currentLoopElapsedMs: 50 }).misses;  // new loop cutoff -150 → 0 closed; completed loop contributes 4
  expect(m1).toBeLessThanOrEqual(m2);
  expect(m2).toBeLessThanOrEqual(m3);
  expect(m3).toBe(4); // completed loop's 4 only; new loop adds nothing yet (was 8 before the fix)
});

test("live stats: an on-time hit is not transiently counted as an extra (no flicker)", () => {
  // windowMs = 200. Hit stroke 1 (t=1000) on time, then poll while elapsed ≈ 1000 — stroke 1's
  // window [800,1200] hasn't closed yet. The hit must read as a hit, never a fleeting extra.
  const timeline = {
    expected: [{ strokeIdx: 0, t: 0 }, { strokeIdx: 1, t: 1000 }],
    loopLengthMs: 2000,
    toleranceMs: DEFAULT_TOLERANCE,
  };
  const s = createScorer(timeline);
  s.acceptHit({ t: 1000, energy: 1 });
  const st = s.stats({ currentLoopElapsedMs: 1000 });
  expect(st.extras).toBe(0);
  expect(st.hits).toBe(1);
});

test("live stats: absent elapsed counts the whole current loop (regression guard)", () => {
  const s = createScorer(monoTimeline);
  s.acceptHit({ t: 0, energy: 1 }); // matches stroke 0
  const st = s.stats(); // no opts → legacy behaviour: match against the full timeline
  expect(st.hits).toBe(1);
  expect(st.misses).toBe(3); // strokes 1,2,3 unmatched
  expect(st.expectedTotal).toBe(4);
});
