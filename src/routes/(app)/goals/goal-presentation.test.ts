import { describe, expect, test } from "bun:test";
import type { Goal, GoalProgressResult } from "$lib/goals";
import {
    achievementNote,
    daysUntil,
    deadlineLabel,
    describeScope,
    formatMetric,
    goalSentence,
    isMaterialEdit,
    newlyAchieved,
    progressSummary,
    sampleNote,
    sortGoals,
    statusChip,
    unitNoun,
    type SeriesNames,
} from "./goal-presentation";

const NAMES: SeriesNames = new Map([
    ["7", "AMC 10"],
    ["9", "MATHCOUNTS"],
]);

function goal(overrides: Partial<Goal> = {}): Goal {
    return {
        id: 1,
        userId: "u",
        title: "Cover AMC 10 geometry",
        scope: { topic: [], seriesIds: [], seriesScopes: {} },
        target: { type: "attempted_count", count: 50 },
        deadline: null,
        achievedAt: null,
        archivedAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        ...overrides,
    };
}

function ok(overrides: Partial<GoalProgressResult> = {}): GoalProgressResult {
    return {
        status: "ok",
        direction: "at_least",
        currentValue: 20,
        targetValue: 50,
        unit: "problems",
        percentToTarget: 40,
        isTargetMet: false,
        ...overrides,
    };
}

describe("formatting", () => {
    test("rounds percentages and splits durations at a minute", () => {
        expect(formatMetric(78.4, "percent")).toBe("78%");
        expect(formatMetric(42.4, "seconds")).toBe("42s");
        expect(formatMetric(84.3, "seconds")).toBe("1m 24s");
        expect(formatMetric(95, "seconds")).toBe("1m 35s");
        expect(formatMetric(120, "seconds")).toBe("2m");
        expect(formatMetric(12.6, "problems")).toBe("13");
    });

    test("nouns are singular at one and absent for self-labelling units", () => {
        expect(unitNoun("problems", 1)).toBe("problem");
        expect(unitNoun("problems", 2)).toBe("problems");
        expect(unitNoun("submissions", 3)).toBe("attempts");
        expect(unitNoun("days", 1)).toBe("day");
        expect(unitNoun("percent", 80)).toBe("");
        expect(unitNoun("seconds", 90)).toBe("");
    });
});

describe("progress summary", () => {
    test("reads as x of y for an at_least target", () => {
        expect(progressSummary(ok())).toBe("20 of 50 problems");
        expect(
            progressSummary(
                ok({ unit: "percent", currentValue: 78.2, targetValue: 85 }),
            ),
        ).toBe("78% of 85%");
    });

    test("reads as a ceiling for an at_most target", () => {
        expect(
            progressSummary(
                ok({
                    direction: "at_most",
                    unit: "seconds",
                    currentValue: 104,
                    targetValue: 90,
                }),
            ),
        ).toBe("1m 44s · target at most 1m 30s");
    });

    test("never reports a percentage below the sample floor", () => {
        const summary = progressSummary(
            ok({
                status: "insufficient_data",
                unit: "percent",
                currentValue: 0,
                targetValue: 85,
                sampleSize: 7,
                requiredSample: 30,
            }),
        );
        expect(summary).toBe("7 of 30 attempts measured");
        expect(summary).not.toContain("%");
        expect(sampleNote({ ...ok(), status: "insufficient_data", requiredSample: 30 }))
            .toBe("Not enough data yet — measured once 30 attempts are in.");
    });
});

describe("scope description", () => {
    test("empty scope is the whole catalog", () => {
        expect(
            describeScope({ topic: [], seriesIds: [], seriesScopes: {} }, NAMES),
        ).toBe("the whole catalog");
    });

    test("per-series narrowing stays attached to its own series", () => {
        expect(
            describeScope(
                {
                    topic: ["G"],
                    seriesIds: ["7", "9"],
                    seriesScopes: {
                        "7": { divisions: ["12A"], formats: [] },
                        "9": { divisions: [], formats: ["Sprint"] },
                    },
                },
                NAMES,
            ),
        ).toBe("Geometry in AMC 10 (12A) · MATHCOUNTS (Sprint)");
    });

    test("an unknown series id still renders", () => {
        expect(
            describeScope(
                { topic: [], seriesIds: ["404"], seriesScopes: {} },
                NAMES,
            ),
        ).toBe("Series 404");
    });

    test("year range is appended when present", () => {
        expect(
            describeScope(
                {
                    topic: [],
                    seriesIds: ["7"],
                    seriesScopes: {},
                    yearRange: [2010, 2024],
                },
                NAMES,
            ),
        ).toBe("AMC 10, 2010–2024");
    });

    test("the commitment sentence joins target and scope", () => {
        expect(
            goalSentence(
                goal({
                    target: { type: "solved_percent", percentage: 80 },
                    scope: { topic: ["G"], seriesIds: ["7"], seriesScopes: {} },
                }),
                NAMES,
            ),
        ).toBe("Solve 80% of eligible problems in Geometry in AMC 10");
    });
});

describe("dates and status", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");

    test("deadline distance is counted in calendar days", () => {
        expect(daysUntil("2026-08-10", now)).toBe(0);
        expect(daysUntil("2026-08-13", now)).toBe(3);
        expect(daysUntil("2026-08-06", now)).toBe(-4);
        expect(daysUntil(null, now)).toBeNull();
    });

    test("a passed deadline reads as overdue, never as failed", () => {
        const label = deadlineLabel(goal({ deadline: "2026-08-06" }), now);
        expect(label?.overdue).toBe(true);
        expect(label?.text).toContain("4 days past due");
        expect(statusChip(goal({ deadline: "2026-08-06" }), now).tone).toBe(
            "overdue",
        );
    });

    test("a finished goal's deadline stops applying pressure", () => {
        const finished = goal({
            deadline: "2026-08-06",
            achievedAt: "2026-08-05T00:00:00.000Z",
        });
        expect(deadlineLabel(finished, now)?.overdue).toBe(false);
        expect(statusChip(finished, now)).toEqual({
            label: "Achieved",
            tone: "achieved",
        });
    });

    test("archived wins over achieved", () => {
        expect(
            statusChip(
                goal({
                    achievedAt: "2026-08-05T00:00:00.000Z",
                    archivedAt: "2026-08-07T00:00:00.000Z",
                }),
                now,
            ).tone,
        ).toBe("archived");
    });

    test("achievement and a current dip are shown together", () => {
        const note = achievementNote(
            goal({ achievedAt: "2026-07-08T10:00:00.000Z" }),
            ok({ unit: "percent", currentValue: 78, targetValue: 85 }),
        );
        expect(note).toContain("Achieved");
        expect(note).toContain("currently 78%");
    });

    test("no second line when achievement and the live number agree", () => {
        expect(
            achievementNote(
                goal({ achievedAt: "2026-07-08T10:00:00.000Z" }),
                ok({ isTargetMet: true, currentValue: 60 }),
            ),
        ).not.toContain("currently");
        expect(achievementNote(goal(), ok())).toBeNull();
    });
});

describe("material edits", () => {
    const streak = goal({
        // Key order as Postgres returns jsonb: sorted by (length, bytes), which
        // is NOT the order the form builds the object in.
        target: {
            days: 14,
            type: "streak",
            perDay: 5,
            timeZone: "Europe/London",
        } as unknown as Goal["target"],
        scope: { topic: ["G"], seriesIds: ["7"], seriesScopes: {} },
    });

    test("a re-serialised identical target is not a material change", () => {
        expect(
            isMaterialEdit(streak, {
                scope: { topic: ["G"], seriesIds: ["7"], seriesScopes: {} },
                target: {
                    type: "streak",
                    days: 14,
                    perDay: 5,
                    timeZone: "Europe/London",
                },
            }),
        ).toBe(false);
    });

    test("scope order does not count, but a scope change does", () => {
        expect(
            isMaterialEdit(
                goal({
                    scope: {
                        topic: ["G", "A"],
                        seriesIds: ["9", "7"],
                        seriesScopes: {},
                    },
                }),
                {
                    scope: {
                        topic: ["A", "G"],
                        seriesIds: ["7", "9"],
                        seriesScopes: {},
                    },
                    target: { type: "attempted_count", count: 50 },
                },
            ),
        ).toBe(false);
        expect(
            isMaterialEdit(streak, {
                scope: { topic: [], seriesIds: ["7"], seriesScopes: {} },
                target: {
                    type: "streak",
                    days: 14,
                    perDay: 5,
                    timeZone: "Europe/London",
                },
            }),
        ).toBe(true);
    });

    test("moving the finish line is a material change", () => {
        expect(
            isMaterialEdit(streak, {
                scope: { topic: ["G"], seriesIds: ["7"], seriesScopes: {} },
                target: {
                    type: "streak",
                    days: 21,
                    perDay: 5,
                    timeZone: "Europe/London",
                },
            }),
        ).toBe(true);
    });
});

describe("achievement stamping", () => {
    test("stamps only met, unstamped, unarchived, measurable goals", () => {
        const goals = [
            goal({ id: 1 }),
            goal({ id: 2 }),
            goal({ id: 3, achievedAt: "2026-08-01T00:00:00.000Z" }),
            goal({ id: 4, archivedAt: "2026-08-01T00:00:00.000Z" }),
            goal({ id: 5 }),
            goal({ id: 6 }),
        ];
        const results = new Map<number, GoalProgressResult | null>([
            [1, ok({ isTargetMet: true })],
            [2, ok({ isTargetMet: false })],
            [3, ok({ isTargetMet: true })],
            [4, ok({ isTargetMet: true })],
            // A family that failed to load: absence is not achievement.
            [5, null],
            // Met by an unmeasurable window: also not achievement.
            [
                6,
                ok({
                    status: "insufficient_data",
                    direction: "at_most",
                    isTargetMet: true,
                }),
            ],
        ]);

        expect(newlyAchieved(goals, results)).toEqual([1]);
    });
});

describe("list order", () => {
    test("unfinished first, then achieved, then archived; newest inside each", () => {
        const goals = [
            goal({ id: 1, createdAt: "2026-08-01T00:00:00.000Z" }),
            goal({
                id: 2,
                createdAt: "2026-08-03T00:00:00.000Z",
                achievedAt: "2026-08-04T00:00:00.000Z",
            }),
            goal({
                id: 3,
                createdAt: "2026-08-02T00:00:00.000Z",
                archivedAt: "2026-08-05T00:00:00.000Z",
            }),
            goal({ id: 4, createdAt: "2026-08-06T00:00:00.000Z" }),
        ];
        expect(sortGoals(goals).map((g) => g.id)).toEqual([4, 1, 2, 3]);
    });
});
