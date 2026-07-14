/**
 * Shared countdown arithmetic for timed practice and (later) segmented test
 * pacing. Both features reduce to the same shape: a fixed limit minus a live
 * count-up elapsed, floored at zero. Kept pure so the timing logic is unit-tested
 * independently of any component; display formatting reuses `formatElapsed`
 * (`$lib/utils`).
 */

/** Milliseconds left on a countdown, never negative. */
export function countdownRemainingMs(limitMs: number, elapsedMs: number): number {
    return Math.max(0, Math.floor(limitMs - elapsedMs));
}

/** Whether the elapsed time has reached (or passed) the limit. */
export function countdownExpired(limitMs: number, elapsedMs: number): boolean {
    return elapsedMs >= limitMs;
}
