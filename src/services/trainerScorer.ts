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
  const totalStrokes = pattern.length * pattern.time;
  const line = pattern[instrument] ?? [];
  const expected: ExpectedHit[] = [];
  for (let i = 0; i < totalStrokes; i++) {
    const stroke = line[i];
    if (!SILENT_STROKES.has(stroke ?? "")) {
      expected.push({ strokeIdx: i, t: i * strokeMs });
    }
  }
  return {
    expected,
    loopLengthMs: totalStrokes * strokeMs,
    toleranceMs: { ...tolerance },
  };
}

function classifyDelta(delta: number, tolerance: { good: number; off: number }): "good" | "off" {
  return Math.abs(delta) <= tolerance.good ? "good" : "off";
}

export function matchHits(
  detected: DetectedHit[],
  expected: ExpectedHit[],
  windowMs: number,
  tolerance: { good: number; off: number } = DEFAULT_TOLERANCE,
): MatchResult {
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
  acceptHit(hit: DetectedHit): { strokeIdx: number; verdict: "good" | "off"; delta: number } | { verdict: "extra" } | null;
  onLoopWrap(): void;
  finalize(opts?: { stopAtMs: number; tailMs: number }): void;
  stats(): SessionStats;
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

  function bestGuess(hit: DetectedHit): { strokeIdx: number; verdict: "good" | "off"; delta: number } | { verdict: "extra" } {
    let bestI = -1;
    let bestAbs = Infinity;
    for (let i = 0; i < timeline.expected.length; i++) {
      const d = Math.abs(timeline.expected[i].t - hit.t);
      if (d < bestAbs) { bestAbs = d; bestI = i; }
    }
    if (bestI < 0 || bestAbs > windowMs) return { verdict: "extra" };
    const v: "good" | "off" = bestAbs <= timeline.toleranceMs.good ? "good" : "off";
    return { strokeIdx: timeline.expected[bestI].strokeIdx, verdict: v, delta: hit.t - timeline.expected[bestI].t };
  }

  return {
    acceptHit(hit) {
      if (finalized) return null;
      currentLoopDetected.push(hit);
      return bestGuess(hit);
    },
    onLoopWrap() {
      if (finalized) return;
      completedLoops.push(currentLoopDetected);
      currentLoopDetected = [];
    },
    finalize(opts) {
      if (finalized) return;
      finalized = true;

      const trimmedExpected = opts
        ? timeline.expected.filter((e) => !(e.t > opts.stopAtMs - opts.tailMs && e.t <= opts.stopAtMs))
        : timeline.expected;
      const trimmedCurrentLoop = opts
        ? currentLoopDetected.filter((d) => !(d.t > opts.stopAtMs - opts.tailMs && d.t <= opts.stopAtMs))
        : currentLoopDetected;

      // Completed loops played to completion — match against full expected.
      const merged: MatchResult = { matched: [], misses: [], extras: [] };
      for (const loopDet of completedLoops) {
        const r = matchHits(loopDet, timeline.expected, windowMs, timeline.toleranceMs);
        merged.matched.push(...r.matched);
        merged.misses.push(...r.misses);
        merged.extras.push(...r.extras);
      }
      // Current (possibly trimmed) loop — match against trimmed expected.
      const rFinal = matchHits(trimmedCurrentLoop, trimmedExpected, windowMs, timeline.toleranceMs);
      merged.matched.push(...rFinal.matched);
      merged.misses.push(...rFinal.misses);
      merged.extras.push(...rFinal.extras);

      finalMatch = merged;
    },
    stats() {
      if (!finalized) {
        // Approximate live stats by running matchHits on completed loops + current loop.
        const merged: MatchResult = { matched: [], misses: [], extras: [] };
        for (const loopDet of [...completedLoops, currentLoopDetected]) {
          const r = matchHits(loopDet, timeline.expected, windowMs, timeline.toleranceMs);
          merged.matched.push(...r.matched);
          merged.misses.push(...r.misses);
          merged.extras.push(...r.extras);
        }
        return scoreSession(merged, timeline.toleranceMs);
      }
      return scoreSession(finalMatch, timeline.toleranceMs);
    },
  };
}
