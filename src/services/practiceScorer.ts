import { Instrument } from "../config";
import { Pattern } from "../state/pattern";

export const SILENT_STROKES = new Set<string>([" ", "", ".", "s"]);

export interface ExpectedHit {
  strokeIdx: number;
  /** ms from start of current loop iteration */
  t: number;
}

export interface ExpectedTimeline {
  expected: ExpectedHit[];
  loopLengthMs: number;
  toleranceMs: { good: number; off: number };
}

export interface DetectedHit {
  /** ms loop-relative, after latency offset applied by the engine */
  t: number;
  energy: number;
}

export type Verdict = "good" | "off" | "miss" | "extra";

export interface MatchResult {
  matched: Array<{ d: DetectedHit; e: ExpectedHit; delta: number; verdict: "good" | "off" }>;
  misses: ExpectedHit[];
  extras: DetectedHit[];
}

export interface LiveVerdicts {
  /** current in-progress loop, per stroke: good/off (with delta) or miss (delta null) */
  perStroke: Map<number, { verdict: "good" | "off" | "miss"; delta: number | null }>;
  /** current-loop detected hits that matched no stroke (for the extra markers — Task 2.4) */
  extras: DetectedHit[];
  /** rolling last-N matched hits across the session, for the timing-meter trail */
  recent: Array<{ delta: number; verdict: "good" | "off" }>;
}

export interface SessionStats {
  hits: number;
  misses: number;
  extras: number;
  expectedTotal: number;
  meanAbsDelta: number;
  drift: number;
  headlineScore: number;
}

export const DEFAULT_TOLERANCE = { good: 60, off: 150 } as const;

export type Difficulty = "easy" | "normal" | "hard";

// Lower difficulty widens the windows; "normal" is ×1 so it equals DEFAULT_TOLERANCE.
const DIFFICULTY_FACTOR: Record<Difficulty, number> = { easy: 1.75, normal: 1, hard: 0.6 };

export function toleranceForDifficulty(difficulty: Difficulty): { good: number; off: number } {
  const f = DIFFICULTY_FACTOR[difficulty];
  return {
    good: Math.round(DEFAULT_TOLERANCE.good * f),
    off: Math.round(DEFAULT_TOLERANCE.off * f),
  };
}

/**
 * Maps a signed timing delta (ms; + = late, − = early) to a marker position on the
 * timing meter. `percent` is 0 (left/late edge) … 50 (centre/on-time) … 100 (right/
 * early edge), clamped. `zone` is "good" within the good tolerance, else "off".
 */
export function deltaToPosition(
  delta: number,
  tolerance: { good: number; off: number } = DEFAULT_TOLERANCE,
): { percent: number; zone: "good" | "off" } {
  const percent = Math.max(0, Math.min(100, 50 - (delta / tolerance.off) * 50));
  const zone: "good" | "off" = Math.abs(delta) <= tolerance.good ? "good" : "off";
  return { percent, zone };
}

export function buildExpectedTimeline(
  pattern: Pattern,
  instrument: Instrument,
  speedBpm: number,
  tolerance: { good: number; off: number } = DEFAULT_TOLERANCE,
): ExpectedTimeline {
  const strokeMs = 60_000 / (speedBpm * pattern.time);
  // pattern[instrument] is [pickup(upbeat slots) … main(length*time slots)]; iterate the
  // FULL array so the last `upbeat` main strokes are scored, and so the played loop length
  // (which includes the pickup) matches.
  const slotCount = pattern.length * pattern.time + pattern.upbeat;
  const line = pattern[instrument] ?? [];
  const expected: ExpectedHit[] = [];
  for (let i = 0; i < slotCount; i++) {
    const stroke = line[i];
    if (!SILENT_STROKES.has(stroke ?? "")) {
      // strokeIdx matches PatternPlayer's cell label `stroke-i-${i - upbeat}`; t stays
      // raw-indexed because loopBaselinePerf is anchored at raw index 0, not the downbeat.
      expected.push({ strokeIdx: i - pattern.upbeat, t: i * strokeMs });
    }
  }
  return {
    expected,
    loopLengthMs: slotCount * strokeMs,
    toleranceMs: { ...tolerance },
  };
}

function classifyDelta(delta: number, tolerance: { good: number; off: number }): "good" | "off" {
  return Math.abs(delta) <= tolerance.good ? "good" : "off";
}

/**
 * Signed shortest-path delta between a hit and an expected stroke on the loop *circle*
 * (+ = late, − = early), in the range (−loopLen/2, loopLen/2]. Loop time wraps at the
 * downbeat (0 ≡ loopLen), so a hit a hair *before* the downbeat arrives as ≈loopLen after
 * the engine's modulo; this folds it back to a small negative instead of a near-full-loop gap.
 */
function circularDelta(hitT: number, expT: number, loopLen: number): number {
  const d = (((hitT - expT) % loopLen) + loopLen) % loopLen; // [0, loopLen)
  return d > loopLen / 2 ? d - loopLen : d;
}

export function matchHits(
  detected: DetectedHit[],
  expected: ExpectedHit[],
  windowMs: number,
  tolerance: { good: number; off: number } = DEFAULT_TOLERANCE,
  loopLengthMs?: number,
): MatchResult {
  // When the loop length is known, treat time as circular: a hit whose shortest path to its
  // nearest expected wraps across the downbeat boundary is "unwrapped" (shifted by ±loopLen)
  // so the linear walking-pointer below sees it sitting beside that expected. This rescues
  // slightly-early downbeats, which the engine's modulo lands at ≈loopLen.
  if (loopLengthMs !== undefined && expected.length > 0) {
    detected = detected
      .map((d) => {
        let nearest = expected[0];
        let bestAbs = Infinity;
        for (const e of expected) {
          const abs = Math.abs(circularDelta(d.t, e.t, loopLengthMs));
          if (abs < bestAbs) { bestAbs = abs; nearest = e; }
        }
        return Math.abs(d.t - nearest.t) > loopLengthMs / 2
          ? { ...d, t: nearest.t + circularDelta(d.t, nearest.t, loopLengthMs) }
          : d;
      })
      .sort((a, b) => a.t - b.t);
  }

  // Walking-pointer greedy nearest-neighbour. Both arrays MUST be time-sorted.
  const matched: MatchResult["matched"] = [];
  const misses: ExpectedHit[] = [];
  const extras: DetectedHit[] = [];

  let ei = 0; // expected pointer
  let di = 0; // detected pointer

  while (ei < expected.length && di < detected.length) {
    const e = expected[ei];
    const d = detected[di];
    const delta = d.t - e.t;

    if (delta < -windowMs) {
      // Detected is too far before expected — it's an extra
      extras.push(d);
      di++;
    } else if (delta > windowMs) {
      // Expected is too far before detected — it's a miss
      misses.push(e);
      ei++;
    } else {
      // Within window. Greedy: check if the NEXT detected is closer to this expected.
      const dNext = detected[di + 1];
      if (dNext && Math.abs(dNext.t - e.t) < Math.abs(delta) && Math.abs(dNext.t - e.t) <= windowMs) {
        // Current d is a strictly worse match — it's an extra; advance.
        extras.push(d);
        di++;
      } else {
        matched.push({ d, e, delta, verdict: classifyDelta(delta, tolerance) });
        ei++;
        di++;
      }
    }
  }

  // Drain remainders
  while (ei < expected.length) misses.push(expected[ei++]);
  while (di < detected.length) extras.push(detected[di++]);

  return { matched, misses, extras };
}

export function scoreSession(
  match: MatchResult,
  tolerance: { good: number; off: number } = DEFAULT_TOLERANCE,
): SessionStats {
  const hits = match.matched.length;
  const misses = match.misses.length;
  const extras = match.extras.length;
  const expectedTotal = hits + misses;

  const meanAbsDelta = hits === 0
    ? 0
    : match.matched.reduce((s, m) => s + Math.abs(m.delta), 0) / hits;
  const drift = hits === 0
    ? 0
    : match.matched.reduce((s, m) => s + m.delta, 0) / hits;

  const hitRatio = expectedTotal === 0 ? 1 : hits / expectedTotal;
  const timingTightness = Math.max(0, Math.min(1, 1 - meanAbsDelta / tolerance.off));
  const headlineScore = Math.round(60 * hitRatio + 40 * timingTightness);

  return {
    hits, misses, extras, expectedTotal,
    meanAbsDelta, drift, headlineScore,
  };
}

export interface ScorerHandle {
  acceptHit(hit: DetectedHit): void;
  onLoopWrap(): void;
  finalize(opts?: { stopAtMs: number; tailMs: number }): void;
  stats(opts?: { currentLoopElapsedMs?: number | null }): SessionStats;
  liveVerdicts(opts?: { currentLoopElapsedMs?: number | null }): LiveVerdicts;
}

export function createScorer(timeline: ExpectedTimeline): ScorerHandle {
  // Per-loop pending matchers. We don't run matchHits() incrementally; instead we
  // bucket detected hits per-loop and run matchHits() at finalize(). For *live*
  // verdict emission we eagerly classify each hit against the nearest expected
  // (best-effort; final score uses the canonical matchHits at finalize time).
  let currentLoopDetected: DetectedHit[] = [];
  const completedLoops: DetectedHit[][] = [];
  let finalized = false;
  let finalMatch: MatchResult = { matched: [], misses: [], extras: [] };
  const windowMs = timeline.toleranceMs.off + 50;

  // Single source of truth for turning the bucketed detections into a MatchResult — shared by
  // live stats() and finalize(), so the totals can never disagree between the two. COMPLETED
  // loops are always scored in full: every loop the metronome finished is fully judged ("keep
  // counting every loop"). The IN-PROGRESS loop always matches against the full timeline (so a
  // just-landed on-time hit binds to its stroke immediately instead of flickering as an "extra"
  // until its window closes), but a stroke only becomes a MISS once its window has closed by
  // `currentMissCutoffMs`; strokes the metronome has not yet reached are never misses. Pass
  // Infinity to judge the whole in-progress loop.
  function buildSessionMatch(currentMissCutoffMs: number): MatchResult {
    const merged: MatchResult = { matched: [], misses: [], extras: [] };
    for (const loopDet of completedLoops) {
      const r = matchHits(loopDet, timeline.expected, windowMs, timeline.toleranceMs, timeline.loopLengthMs);
      merged.matched.push(...r.matched);
      merged.misses.push(...r.misses);
      merged.extras.push(...r.extras);
    }
    const rCur = matchHits(currentLoopDetected, timeline.expected, windowMs, timeline.toleranceMs, timeline.loopLengthMs);
    merged.matched.push(...rCur.matched);
    merged.extras.push(...rCur.extras);
    merged.misses.push(...rCur.misses.filter((e) => e.t <= currentMissCutoffMs));
    return merged;
  }

  const RECENT_TRAIL = 5;

  function liveVerdicts(opts?: { currentLoopElapsedMs?: number | null }): LiveVerdicts {
    // A miss only lights once its window has PROVABLY closed. finalize() judges the whole loop
    // (Infinity); while playing we derive the cutoff from elapsed; but with no elapsed yet (e.g.
    // before gameOn anchors the loop baseline) we cannot know what has closed, so show NO misses
    // (−Infinity) rather than flashing every unplayed stroke as missed.
    const cutoff = finalized
      ? Infinity
      : (opts?.currentLoopElapsedMs == null ? -Infinity : opts.currentLoopElapsedMs - windowMs);
    // Current in-progress loop only — the partition shows the loop being played; it clears when
    // currentLoopDetected resets at the wrap. (After finalize this shows the last loop in full;
    // the finalize() tail-trim that gates the COUNTS is not applied to the highlight — results-
    // state polish is downstream in 2.3/2.4.)
    const cur = matchHits(currentLoopDetected, timeline.expected, windowMs, timeline.toleranceMs, timeline.loopLengthMs);
    const perStroke = new Map<number, { verdict: "good" | "off" | "miss"; delta: number | null }>();
    for (const m of cur.matched) perStroke.set(m.e.strokeIdx, { verdict: m.verdict, delta: m.delta });
    for (const e of cur.misses) {
      if (e.t <= cutoff && !perStroke.has(e.strokeIdx)) perStroke.set(e.strokeIdx, { verdict: "miss", delta: null });
    }
    // Rolling meter trail: last N matched across all loops (completed are fixed; current can
    // reassign). Ordered by loop then within-loop stroke order, not strictly by hit-arrival time.
    // (buildSessionMatch re-matches the current loop a second time here — deterministic and cheap at
    // real session lengths, so accepted rather than threading `cur` through buildSessionMatch.)
    const all = buildSessionMatch(Infinity).matched;
    const recent = all.slice(-RECENT_TRAIL).map((m) => ({ delta: m.delta, verdict: m.verdict }));
    return { perStroke, extras: cur.extras, recent };
  }

  return {
    acceptHit(hit) {
      if (finalized) return;
      currentLoopDetected.push(hit);
    },
    onLoopWrap() {
      if (finalized) return;
      completedLoops.push(currentLoopDetected);
      currentLoopDetected = [];
    },
    finalize(opts) {
      if (finalized) return;
      finalized = true;
      // Stop grace: a stroke within tailMs before the stop isn't judged (the user stopped
      // mid-flow), and strokes after the stop never played — both fall outside the cutoff at
      // stopAtMs - tailMs. No opts → judge the whole in-progress loop.
      finalMatch = buildSessionMatch(opts ? opts.stopAtMs - opts.tailMs : Infinity);
    },
    stats(opts) {
      if (finalized) return scoreSession(finalMatch, timeline.toleranceMs);
      // Live: a stroke is a miss only once its full timing window has closed (elapsed - windowMs).
      // Absent elapsed (e.g. not in gameOn) → judge the whole loop (legacy guard).
      const elapsed = opts?.currentLoopElapsedMs ?? null;
      const cutoff = elapsed === null ? Infinity : elapsed - windowMs;
      return scoreSession(buildSessionMatch(cutoff), timeline.toleranceMs);
    },
    liveVerdicts,
  };
}
