import { describe, expect, test } from "bun:test";
import {
    MIN_SAMPLE_SIZE,
    TARGETS,
    describeTarget,
    evaluateTarget,
    familyOf,
    targetOf,
    validateTarget,
} from "./registry";
import type {
    GoalTargetData,
    GoalTargetType,
    SetData,
    WindowData,
} from "./types";

const setData = (o: Partial<SetData> = {}): SetData => ({
    attempted: 0,
    solved: 0,
    eligibleTotal: 100,
    ...o,
});

const windowData = (o: Partial<WindowData> = {}): WindowData => ({
    freshSample: 0,
    freshCorrect: 0,
    gradedSample: 0,
    gradedCorrect: 0,
    timedSample: 0,
    timedTotalMs: 0,
    ...o,
});

describe("registry completeness", () => {
    test("every target type is registered in exactly one family", () => {
        const types = Object.keys(TARGETS) as GoalTargetType[];
        expect(types.length).toBe(8);
        for (const type of types) {
            expect(["set", "window", "accumulation", "period"]).toContain(
                TARGETS[type].family,
            );
        }
    });

    test("an unrecognised stored target reads as null rather than throwing", () => {
        expect(targetOf({ type: "mastery_percent", percentage: 80 })).toBeNull();
        expect(targetOf({ percentage: 80 })).toBeNull();
        expect(targetOf(null)).toBeNull();
        expect(targetOf("solved_count")).toBeNull();
    });

    test("a recognised target passes through", () => {
        const target = { type: "solved_count", count: 10 };
        expect(targetOf(target)).toBe(target as GoalTargetData);
        expect(familyOf(target as GoalTargetData)).toBe("set");
    });
});

describe("set family", () => {
    test("a count target measures progress toward the count, not the scope", () => {
        // The bug this pins: 50 of a 100-problem goal inside a 1,000-problem
        // scope is 50% done, not 5%.
        const result = evaluateTarget(
            { type: "attempted_count", count: 100 },
            setData({ attempted: 50, eligibleTotal: 1000 }),
        );
        expect(result.currentValue).toBe(50);
        expect(result.percentToTarget).toBe(50);
        expect(result.isTargetMet).toBe(false);
    });

    test("a count target is met on reaching the count", () => {
        const result = evaluateTarget(
            { type: "solved_count", count: 10 },
            setData({ solved: 10 }),
        );
        expect(result.isTargetMet).toBe(true);
        expect(result.percentToTarget).toBe(100);
    });

    test("overshooting does not exceed 100%", () => {
        const result = evaluateTarget(
            { type: "solved_count", count: 10 },
            setData({ solved: 40 }),
        );
        expect(result.percentToTarget).toBe(100);
        expect(result.currentValue).toBe(40);
    });

    test("a percent target divides by the eligible denominator", () => {
        const result = evaluateTarget(
            { type: "attempted_percent", percentage: 80 },
            setData({ attempted: 96, eligibleTotal: 240 }),
        );
        expect(result.currentValue).toBe(40);
        expect(result.unit).toBe("percent");
        expect(result.percentToTarget).toBe(50);
        expect(result.isTargetMet).toBe(false);
    });

    test("a percent target over an empty scope reports no data, not 0%", () => {
        const result = evaluateTarget(
            { type: "solved_percent", percentage: 50 },
            setData({ eligibleTotal: 0 }),
        );
        expect(result.status).toBe("insufficient_data");
        expect(result.isTargetMet).toBe(false);
    });

    test("solved is measured on solved, attempted on attempted", () => {
        const data = setData({ attempted: 60, solved: 20, eligibleTotal: 100 });
        expect(
            evaluateTarget({ type: "attempted_percent", percentage: 50 }, data)
                .currentValue,
        ).toBe(60);
        expect(
            evaluateTarget({ type: "solved_percent", percentage: 50 }, data)
                .currentValue,
        ).toBe(20);
    });
});

describe("accuracy", () => {
    test("below the sample size it reports no data, never a percentage", () => {
        const result = evaluateTarget(
            { type: "accuracy", percentage: 85, sampleSize: 30 },
            windowData({ freshSample: 7, freshCorrect: 7 }),
        );
        expect(result.status).toBe("insufficient_data");
        expect(result.sampleSize).toBe(7);
        expect(result.requiredSample).toBe(30);
        expect(result.percentToTarget).toBe(0);
        expect(result.isTargetMet).toBe(false);
    });

    test("at exactly the sample size it reports a percentage", () => {
        const result = evaluateTarget(
            { type: "accuracy", percentage: 85, sampleSize: 10 },
            windowData({ freshSample: 10, freshCorrect: 9 }),
        );
        expect(result.status).toBe("ok");
        expect(result.currentValue).toBe(90);
        expect(result.isTargetMet).toBe(true);
    });

    test("it reads the fresh window, so repeats cannot inflate it", () => {
        // A student who re-solved known problems 40 times has a full graded
        // window and a perfect record there; accuracy must ignore all of it.
        const result = evaluateTarget(
            { type: "accuracy", percentage: 85, sampleSize: 30 },
            windowData({
                freshSample: 5,
                freshCorrect: 1,
                gradedSample: 40,
                gradedCorrect: 40,
            }),
        );
        expect(result.status).toBe("insufficient_data");
    });
});

describe("speed", () => {
    const fastAndAccurate = windowData({
        timedSample: 10,
        timedTotalMs: 600_000, // 60s mean
        gradedSample: 10,
        gradedCorrect: 9,
    });

    test("lower is better, and the bar fills as the mean drops", () => {
        const result = evaluateTarget(
            { type: "speed", maxSeconds: 90, sampleSize: 10, minAccuracy: 80 },
            fastAndAccurate,
        );
        expect(result.direction).toBe("at_most");
        expect(result.unit).toBe("seconds");
        expect(result.currentValue).toBe(60);
        expect(result.isTargetMet).toBe(true);
        expect(result.percentToTarget).toBe(100);
    });

    test("a mean above the limit is partial progress, not zero", () => {
        const result = evaluateTarget(
            { type: "speed", maxSeconds: 60, sampleSize: 10, minAccuracy: 80 },
            windowData({
                timedSample: 10,
                timedTotalMs: 1_200_000, // 120s mean
                gradedSample: 10,
                gradedCorrect: 10,
            }),
        );
        expect(result.currentValue).toBe(120);
        expect(result.percentToTarget).toBe(50);
        expect(result.isTargetMet).toBe(false);
    });

    test("guessing fast does not meet the goal", () => {
        // The whole reason the floor is mandatory: fast and wrong must fail.
        const result = evaluateTarget(
            { type: "speed", maxSeconds: 90, sampleSize: 10, minAccuracy: 80 },
            windowData({
                timedSample: 10,
                timedTotalMs: 100_000, // 10s mean
                gradedSample: 40,
                gradedCorrect: 10, // 25% accuracy
            }),
        );
        expect(result.status).toBe("ok");
        expect(result.currentValue).toBe(10);
        expect(result.isTargetMet).toBe(false);
    });

    test("an unmeasurable floor is unmet, never satisfied by default", () => {
        const result = evaluateTarget(
            { type: "speed", maxSeconds: 90, sampleSize: 10, minAccuracy: 80 },
            windowData({
                timedSample: 10,
                timedTotalMs: 100_000,
                gradedSample: 0,
                gradedCorrect: 0,
            }),
        );
        expect(result.isTargetMet).toBe(false);
    });

    test("below the sample size it reports no data", () => {
        const result = evaluateTarget(
            { type: "speed", maxSeconds: 90, sampleSize: 30, minAccuracy: 80 },
            fastAndAccurate,
        );
        expect(result.status).toBe("insufficient_data");
        expect(result.sampleSize).toBe(10);
        expect(result.requiredSample).toBe(30);
    });
});

describe("volume and streak", () => {
    test("volume counts submissions", () => {
        const result = evaluateTarget(
            { type: "volume", count: 150, period: { kind: "since_creation" } },
            { gradedSubmissions: 75 },
        );
        expect(result.unit).toBe("submissions");
        expect(result.currentValue).toBe(75);
        expect(result.percentToTarget).toBe(50);
    });

    test("a streak is met at the target length", () => {
        const result = evaluateTarget(
            { type: "streak", days: 30, perDay: 3, timeZone: "UTC" },
            { streakDays: 30, todayCount: 3 },
        );
        expect(result.unit).toBe("days");
        expect(result.isTargetMet).toBe(true);
    });

    test("a lapsed streak reads zero without erasing the target", () => {
        const result = evaluateTarget(
            { type: "streak", days: 30, perDay: 3, timeZone: "UTC" },
            { streakDays: 0, todayCount: 0 },
        );
        expect(result.currentValue).toBe(0);
        expect(result.targetValue).toBe(30);
        expect(result.percentToTarget).toBe(0);
    });
});

describe("validation", () => {
    test("count targets must be positive whole numbers", () => {
        expect(validateTarget({ type: "solved_count", count: 0 })).toBeTruthy();
        expect(validateTarget({ type: "solved_count", count: 2.5 })).toBeTruthy();
        expect(validateTarget({ type: "solved_count", count: 5 })).toBeNull();
    });

    test("a count target may not exceed the denominator when it is known", () => {
        expect(
            validateTarget({ type: "solved_count", count: 500 }, { eligibleTotal: 240 }),
        ).toBeTruthy();
        expect(
            validateTarget({ type: "solved_count", count: 200 }, { eligibleTotal: 240 }),
        ).toBeNull();
        // Unknown denominator skips the rule rather than guessing at it.
        expect(validateTarget({ type: "solved_count", count: 500 })).toBeNull();
    });

    test("percentages are 1–100", () => {
        expect(
            validateTarget({ type: "attempted_percent", percentage: 0 }),
        ).toBeTruthy();
        expect(
            validateTarget({ type: "attempted_percent", percentage: 101 }),
        ).toBeTruthy();
        expect(
            validateTarget({ type: "attempted_percent", percentage: 100 }),
        ).toBeNull();
    });

    test("a sample too small to read is rejected", () => {
        expect(
            validateTarget({
                type: "accuracy",
                percentage: 85,
                sampleSize: 3,
            }),
        ).toBeTruthy();
        expect(
            validateTarget({
                type: "accuracy",
                percentage: 85,
                sampleSize: MIN_SAMPLE_SIZE,
            }),
        ).toBeNull();
    });

    test("a speed target needs a usable accuracy floor", () => {
        expect(
            validateTarget({
                type: "speed",
                maxSeconds: 90,
                sampleSize: 30,
                minAccuracy: 0,
            }),
        ).toBeTruthy();
        expect(
            validateTarget({
                type: "speed",
                maxSeconds: 0,
                sampleSize: 30,
                minAccuracy: 80,
            }),
        ).toBeTruthy();
        expect(
            validateTarget({
                type: "speed",
                maxSeconds: 90,
                sampleSize: 30,
                minAccuracy: 80,
            }),
        ).toBeNull();
    });

    test("a streak needs a timezone and positive counts", () => {
        expect(
            validateTarget({ type: "streak", days: 30, perDay: 3, timeZone: "" }),
        ).toBeTruthy();
        expect(
            validateTarget({ type: "streak", days: 0, perDay: 3, timeZone: "UTC" }),
        ).toBeTruthy();
        expect(
            validateTarget({ type: "streak", days: 30, perDay: 3, timeZone: "UTC" }),
        ).toBeNull();
    });

    test("a rolling volume period needs a positive day count", () => {
        expect(
            validateTarget({
                type: "volume",
                count: 100,
                period: { kind: "rolling", days: 0 },
            }),
        ).toBeTruthy();
    });
});

describe("descriptions", () => {
    test("every target describes itself without throwing", () => {
        const targets: GoalTargetData[] = [
            { type: "attempted_count", count: 50 },
            { type: "attempted_percent", percentage: 80 },
            { type: "solved_count", count: 100 },
            { type: "solved_percent", percentage: 60 },
            {
                type: "volume",
                count: 150,
                period: { kind: "calendar", unit: "month", timeZone: "UTC" },
            },
            { type: "accuracy", percentage: 85, sampleSize: 30 },
            { type: "speed", maxSeconds: 90, sampleSize: 30, minAccuracy: 80 },
            { type: "streak", days: 30, perDay: 3, timeZone: "UTC" },
        ];
        for (const target of targets) {
            expect(describeTarget(target).length).toBeGreaterThan(0);
        }
    });
});
