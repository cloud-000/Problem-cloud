/**
 * Pure controller for segmented Test pacing (MATHCOUNTS Target / Countdown).
 *
 * A segmented test splits its problems into fixed-size, independently-timed
 * *segments* worked strictly in order: time does not carry between segments, and
 * once a segment is left (submitted or expired) you cannot navigate back into it.
 * Target = 2-problem segments; Countdown = 1-problem segments (so `segmentSize
 * === 1` collapses to one segment per problem). Grading is unaffected — a segment
 * boundary only *locks* (freezes) the problems behind it; the whole test is still
 * graded once at the end.
 *
 * This module owns the "no time transfer / no backtrack" arithmetic so the
 * runner component stays thin and the rules are unit-tested in isolation. It is
 * pure (no Svelte, no Supabase); per-segment remaining time reuses
 * {@link countdownRemainingMs}.
 */

import { countdownRemainingMs } from "./countdown";

/** Number of segments covering `problemCount` problems at `segmentSize` each. */
export function segmentCount(problemCount: number, segmentSize: number): number {
    if (problemCount <= 0) return 0;
    if (segmentSize <= 0) return 1;
    return Math.ceil(problemCount / segmentSize);
}

/** The segment a problem index belongs to (0-based). */
export function segmentOf(problemIndex: number, segmentSize: number): number {
    if (segmentSize <= 0) return 0;
    return Math.floor(problemIndex / segmentSize);
}

/**
 * The half-open `[start, end)` problem-index range of a segment, clamped to
 * `problemCount` so the final (possibly short) segment doesn't overrun.
 */
export function segmentRange(
    seg: number,
    segmentSize: number,
    problemCount: number,
): [number, number] {
    const size = segmentSize <= 0 ? problemCount : segmentSize;
    const start = Math.min(Math.max(0, seg * size), problemCount);
    const end = Math.min(start + size, problemCount);
    return [start, end];
}

/**
 * Whether a problem is locked given the current segment: true when it belongs to
 * an earlier segment (already submitted/expired — no backtracking). Problems in
 * the current segment, or (defensively) any later one, are not locked.
 */
export function isLocked(
    problemIndex: number,
    currentSegment: number,
    segmentSize: number,
): boolean {
    return segmentOf(problemIndex, segmentSize) < currentSegment;
}

/** Whether `seg` is the last segment of the test. */
export function isLastSegment(
    seg: number,
    problemCount: number,
    segmentSize: number,
): boolean {
    return seg >= segmentCount(problemCount, segmentSize) - 1;
}

/**
 * Total elapsed time accrued within a segment, summing its problems' elapsed
 * times via `elapsedOf`. The caller substitutes the live count for the on-screen
 * problem so an in-progress segment's clock ticks.
 */
export function segmentElapsedMs(
    seg: number,
    segmentSize: number,
    problemCount: number,
    elapsedOf: (problemIndex: number) => number,
): number {
    const [start, end] = segmentRange(seg, segmentSize, problemCount);
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += Math.max(0, elapsedOf(i));
    return sum;
}

/** Milliseconds left in a segment given its per-segment limit and elapsed. */
export function segmentRemainingMs(
    secondsPerSegment: number,
    elapsedMs: number,
): number {
    return countdownRemainingMs(secondsPerSegment * 1000, elapsedMs);
}
