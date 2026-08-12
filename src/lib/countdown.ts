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

/**
 * The least time a freshly applied limit must leave on the clock before the
 * countdown restarts instead of adopting it. Below this, taking the new limit
 * literally would expire (or all but expire) the problem on the spot purely
 * because of time already spent under the *old* limit.
 */
export const COUNTDOWN_RESTART_MARGIN_MS = 10_000;

/**
 * Where a countdown window starts, when its limit changes mid-problem.
 *
 * A limit is otherwise measured against time the user spent under a *different*
 * limit, so lowering it (or switching a timer on) can retroactively expire the
 * problem on screen — dragging a slider from 180s to 60s passes through every
 * value in between, and any one of them below the elapsed count would fire the
 * expiry. Hence a baseline: the elapsed value the current limit began counting
 * from. `elapsedMs` itself is never rewound, so the recorded time on the problem
 * stays true no matter how often the limit is retuned.
 *
 * A new limit is adopted as-is whenever it still leaves a usable margin. When it
 * would not, the window restarts from now and the user gets the full allotment.
 * Call this only when the limit actually changed — on every tick it would keep
 * pushing the baseline forward and the clock would never run down.
 */
export function rebaseCountdownBaseline(
    limitMs: number,
    elapsedMs: number,
    baselineMs: number,
    restartMarginMs: number = COUNTDOWN_RESTART_MARGIN_MS,
): number {
    const remaining = countdownRemainingMs(limitMs, elapsedMs - baselineMs);
    return remaining < restartMarginMs ? elapsedMs : baselineMs;
}
