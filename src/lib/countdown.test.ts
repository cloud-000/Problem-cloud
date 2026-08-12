import { describe, expect, test } from "bun:test";
import {
    COUNTDOWN_RESTART_MARGIN_MS,
    countdownExpired,
    countdownRemainingMs,
    rebaseCountdownBaseline,
} from "./countdown";

describe("countdownRemainingMs", () => {
    test("returns time left before the limit", () => {
        expect(countdownRemainingMs(45_000, 10_000)).toBe(35_000);
    });

    test("floors at zero once the limit is passed", () => {
        expect(countdownRemainingMs(45_000, 45_000)).toBe(0);
        expect(countdownRemainingMs(45_000, 60_000)).toBe(0);
    });

    test("floors fractional milliseconds", () => {
        expect(countdownRemainingMs(1_000, 250.7)).toBe(749);
    });
});

describe("countdownExpired", () => {
    test("false before the limit, true at or after it", () => {
        expect(countdownExpired(45_000, 44_999)).toBe(false);
        expect(countdownExpired(45_000, 45_000)).toBe(true);
        expect(countdownExpired(45_000, 45_001)).toBe(true);
    });
});

describe("rebaseCountdownBaseline", () => {
    // Time left on the clock, the way the trainer computes it.
    const remaining = (limitMs: number, elapsedMs: number, baselineMs: number) =>
        countdownRemainingMs(limitMs, elapsedMs - baselineMs);

    test("keeps the baseline when the new limit still leaves a usable margin", () => {
        // 40s spent, limit lowered 180s -> 60s: 20s left is plenty, so the clock
        // simply picks up the new limit where it stands.
        expect(rebaseCountdownBaseline(60_000, 40_000, 0)).toBe(0);
        expect(remaining(60_000, 40_000, 0)).toBe(20_000);
    });

    test("restarts the window when the new limit is already spent", () => {
        // 40s spent, limit lowered to 35s. Taking that literally expires the
        // problem on the spot (grading or skipping it) purely because of time
        // spent under the old limit — so the window restarts from now instead.
        expect(rebaseCountdownBaseline(35_000, 40_000, 0)).toBe(40_000);
        expect(remaining(35_000, 40_000, 40_000)).toBe(35_000);
    });

    test("restarts when the new limit would leave less than the margin", () => {
        // Just inside the margin: 9.999s left is not a usable allotment.
        expect(rebaseCountdownBaseline(50_000, 40_001, 0)).toBe(40_001);
        // Exactly at the margin is kept — the boundary belongs to "usable".
        expect(rebaseCountdownBaseline(50_000, 40_000, 0)).toBe(0);
        expect(remaining(50_000, 40_000, 0)).toBe(COUNTDOWN_RESTART_MARGIN_MS);
    });

    test("switching a timer on mid-problem never expires it retroactively", () => {
        // The moment you reach for a timer is while stuck on a long problem, so
        // seeding the 45s default at 60s elapsed must not finish it instantly.
        expect(rebaseCountdownBaseline(45_000, 60_000, 0)).toBe(60_000);
        expect(remaining(45_000, 60_000, 60_000)).toBe(45_000);
    });

    test("measures against the current baseline, not raw elapsed", () => {
        // Already restarted once at 40s; a further drop to 30s still leaves 25s of
        // *that* window, so it is adopted rather than restarting again.
        expect(rebaseCountdownBaseline(30_000, 45_000, 40_000)).toBe(40_000);
        expect(remaining(30_000, 45_000, 40_000)).toBe(25_000);
    });

    test("a slider drag never expires the problem it is dragged over", () => {
        // The range slider writes on pointermove, so dragging 180s -> 15s applies
        // every step in between — including the ones below the elapsed count, which
        // is how the drag used to grade or skip the problem mid-gesture. No step
        // may reach zero.
        const elapsedMs = 40_000;
        let baselineMs = 0;
        for (let seconds = 180; seconds >= 15; seconds -= 5) {
            baselineMs = rebaseCountdownBaseline(
                seconds * 1000,
                elapsedMs,
                baselineMs,
            );
            expect(
                remaining(seconds * 1000, elapsedMs, baselineMs),
            ).toBeGreaterThan(0);
        }
        // Settling at the 15s floor: the drag dipped past the elapsed count on the
        // way down, so the window restarted and the full allotment is on the clock.
        expect(remaining(15_000, elapsedMs, baselineMs)).toBe(15_000);
    });
});
