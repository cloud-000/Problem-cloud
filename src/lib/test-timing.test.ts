import { describe, expect, test } from "bun:test";
import {
    formatDuration,
    resolveTimingRule,
    timingPacing,
    timingSummary,
    timingTotalSeconds,
} from "./test-timing";

describe("resolveTimingRule", () => {
    test("MATHCOUNTS Target is a per-pair slider (4 pairs from 8 problems)", () => {
        const rule = resolveTimingRule({
            seriesName: "MATHCOUNTS",
            format: "Target",
            problemCount: 8,
        });
        expect(rule.mode).toBe("per-pair-minutes");
        expect(rule.unitDefault).toBe(6);
        expect(rule.unitCount).toBe(4);
        // 4 pairs × 6 min = 24 min
        expect(timingTotalSeconds(rule, rule.unitDefault)).toBe(24 * 60);
    });

    test("odd Target problem count rounds pairs up", () => {
        const rule = resolveTimingRule({
            seriesName: "MATHCOUNTS",
            format: "Target",
            problemCount: 7,
        });
        expect(rule.unitCount).toBe(4);
    });

    test("MATHCOUNTS Countdown is a per-problem seconds slider", () => {
        const rule = resolveTimingRule({
            seriesName: "MATHCOUNTS",
            format: "Countdown",
            problemCount: 80,
        });
        expect(rule.mode).toBe("per-problem-seconds");
        expect(rule.unitDefault).toBe(45);
        expect(rule.unitCount).toBe(80);
        // 80 × 45s = 3600s = 60 min
        expect(timingTotalSeconds(rule, rule.unitDefault)).toBe(60 * 60);
    });

    test("MATHCOUNTS Sprint / Team are whole-test minute totals", () => {
        const sprint = resolveTimingRule({
            seriesName: "MATHCOUNTS",
            format: "Sprint",
            problemCount: 30,
        });
        expect(sprint.mode).toBe("total-minutes");
        expect(timingTotalSeconds(sprint, sprint.unitDefault)).toBe(40 * 60);

        const team = resolveTimingRule({
            seriesName: "MATHCOUNTS",
            format: "Team",
            problemCount: 10,
        });
        expect(timingTotalSeconds(team, team.unitDefault)).toBe(20 * 60);
    });

    test("AMC 8 → 40 min, AIME → 180 min", () => {
        const amc8 = resolveTimingRule({
            seriesName: "AMC 8",
            format: null,
            problemCount: 25,
        });
        expect(timingTotalSeconds(amc8, amc8.unitDefault)).toBe(40 * 60);

        const aime = resolveTimingRule({
            seriesName: "AIME",
            format: "I",
            problemCount: 15,
        });
        expect(timingTotalSeconds(aime, aime.unitDefault)).toBe(180 * 60);
    });

    test("unknown series falls back to a 75 min total", () => {
        const rule = resolveTimingRule({
            seriesName: "PUMAC",
            format: "Algebra",
            problemCount: 10,
        });
        expect(rule.mode).toBe("total-minutes");
        expect(rule.unitDefault).toBe(75);
        expect(timingTotalSeconds(rule, rule.unitDefault)).toBe(75 * 60);
    });

    test("matching is case-insensitive", () => {
        const rule = resolveTimingRule({
            seriesName: "mathcounts",
            format: "target",
            problemCount: 8,
        });
        expect(rule.mode).toBe("per-pair-minutes");
    });

    test("a populated DB time_limit_seconds overrides the default", () => {
        // 50-minute column on a Sprint (default 40) → slider seeds to 50.
        const total = resolveTimingRule({
            seriesName: "MATHCOUNTS",
            format: "Sprint",
            problemCount: 30,
            dbTimeLimitSeconds: 50 * 60,
        });
        expect(total.unitDefault).toBe(50);

        // Per-pair override: 32 min over 4 pairs → 8 min/pair.
        const pair = resolveTimingRule({
            seriesName: "MATHCOUNTS",
            format: "Target",
            problemCount: 8,
            dbTimeLimitSeconds: 32 * 60,
        });
        expect(pair.unitDefault).toBe(8);
    });

    test("default is clamped and snapped to the slider grid", () => {
        // Absurd override well past the max clamps to the total-minutes max.
        const rule = resolveTimingRule({
            seriesName: "PUMAC",
            format: null,
            problemCount: 10,
            dbTimeLimitSeconds: 9999 * 60,
        });
        expect(rule.unitDefault).toBe(rule.unitMax);
    });
});

describe("timingTotalSeconds", () => {
    test("clamps out-of-range slider values", () => {
        const rule = resolveTimingRule({
            seriesName: "MATHCOUNTS",
            format: "Countdown",
            problemCount: 10,
        });
        // Below unitMin (15) clamps up to 15.
        expect(timingTotalSeconds(rule, 0)).toBe(15 * 10);
    });
});

describe("timingPacing", () => {
    test("Target resolves to 2-problem segments of unitValue minutes", () => {
        const rule = resolveTimingRule({
            seriesName: "MATHCOUNTS",
            format: "Target",
            problemCount: 8,
        });
        expect(timingPacing(rule, 6)).toEqual({
            kind: "segmented",
            segmentSize: 2,
            secondsPerSegment: 6 * 60,
        });
    });

    test("Countdown resolves to 1-problem segments of unitValue seconds", () => {
        const rule = resolveTimingRule({
            seriesName: "MATHCOUNTS",
            format: "Countdown",
            problemCount: 80,
        });
        expect(timingPacing(rule, 45)).toEqual({
            kind: "segmented",
            segmentSize: 1,
            secondsPerSegment: 45,
        });
    });

    test("whole-test formats resolve to a pooled total", () => {
        const rule = resolveTimingRule({
            seriesName: "AMC 8",
            format: null,
            problemCount: 25,
        });
        expect(timingPacing(rule, 40)).toEqual({
            kind: "pooled",
            totalSeconds: 40 * 60,
        });
    });

    test("clamps out-of-range slider values like timingTotalSeconds", () => {
        const rule = resolveTimingRule({
            seriesName: "MATHCOUNTS",
            format: "Countdown",
            problemCount: 10,
        });
        // Below unitMin (15) clamps up to 15.
        expect(timingPacing(rule, 0)).toEqual({
            kind: "segmented",
            segmentSize: 1,
            secondsPerSegment: 15,
        });
    });
});

describe("formatDuration", () => {
    test("formats minutes, seconds, and mixed", () => {
        expect(formatDuration(24 * 60)).toBe("24 min");
        expect(formatDuration(45)).toBe("45 s");
        expect(formatDuration(90)).toBe("1 min 30 s");
    });
});

describe("timingSummary", () => {
    test("per-pair summary shows the pair math", () => {
        const rule = resolveTimingRule({
            seriesName: "MATHCOUNTS",
            format: "Target",
            problemCount: 8,
        });
        expect(timingSummary(rule, 6)).toBe("4 pairs × 6 min = 24 min total");
    });

    test("per-problem summary shows the problem math", () => {
        const rule = resolveTimingRule({
            seriesName: "MATHCOUNTS",
            format: "Countdown",
            problemCount: 80,
        });
        expect(timingSummary(rule, 45)).toBe("80 × 45s = 60 min total");
    });

    test("whole-test summary is just the total", () => {
        const rule = resolveTimingRule({
            seriesName: "AMC 8",
            format: null,
            problemCount: 25,
        });
        expect(timingSummary(rule, rule.unitDefault)).toBe("40 min total");
    });
});
