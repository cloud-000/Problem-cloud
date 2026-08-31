import { describe, expect, test } from "bun:test";
import {
    attentionGoal,
    primaryGoal,
    promoteGoals,
    type GoalSnapshot,
} from "./promote";
import type { Goal, GoalProgressResult, GoalTargetData } from "./types";

const NOW = new Date("2026-08-10T18:00:00.000Z");

let nextId = 1;
function goal(overrides: Partial<Goal> = {}): Goal {
    return {
        id: nextId++,
        userId: "u",
        title: "a goal",
        scope: { topic: [], seriesIds: [], seriesScopes: {} },
        target: { type: "solved_count", count: 50 } as GoalTargetData,
        deadline: null,
        achievedAt: null,
        archivedAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        ...overrides,
    };
}

function result(overrides: Partial<GoalProgressResult> = {}): GoalProgressResult {
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

/** A streak goal plus its period row. */
function streak(
    days: number,
    perDay: number,
    todayCount: number,
    streakDays = days - 1,
): GoalSnapshot {
    return {
        goal: goal({ target: { type: "streak", days, perDay, timeZone: "UTC" } }),
        result: result({ unit: "days", currentValue: streakDays, targetValue: days }),
        period: { streakDays, todayCount },
    };
}

describe("what gets promoted", () => {
    test("an unfed streak outranks everything, because it expires at midnight", () => {
        const unfed = streak(14, 5, 2);
        const dueTomorrow: GoalSnapshot = {
            goal: goal({ deadline: "2026-08-11" }),
            result: result(),
        };
        const nearlyDone: GoalSnapshot = {
            goal: goal(),
            result: result({ currentValue: 49, percentToTarget: 98 }),
        };

        const order = promoteGoals([nearlyDone, dueTomorrow, unfed], NOW);
        expect(order.map((entry) => entry.reason)).toEqual([
            "streak_today",
            "deadline",
            "remaining",
        ]);
        expect(order[0].todayShortfall).toBe(3);
        expect(order[1].daysLeft).toBe(1);
    });

    test("a streak already fed today is just another goal", () => {
        const fed = streak(14, 5, 5);
        const [only] = promoteGoals([fed], NOW);
        expect(only.reason).toBe("remaining");
        expect(only.todayShortfall).toBeUndefined();
    });

    test("a distant deadline is not yet news", () => {
        const far: GoalSnapshot = {
            goal: goal({ deadline: "2026-12-01" }),
            result: result(),
        };
        expect(promoteGoals([far], NOW)[0].reason).toBe("remaining");
    });

    test("an overdue goal still counts as a deadline, not a failure", () => {
        const late: GoalSnapshot = {
            goal: goal({ deadline: "2026-08-06" }),
            result: result(),
        };
        const promoted = promoteGoals([late], NOW)[0];
        expect(promoted.reason).toBe("deadline");
        expect(promoted.daysLeft).toBe(-4);
    });
});

describe("stable destination and today's attention", () => {
    test("an explicit active primary stays ahead of a more urgent commitment", () => {
        const destination = goal({ isPrimary: true, createdAt: "2026-08-05T00:00:00.000Z" });
        const routine = streak(14, 5, 2);
        routine.goal.createdAt = "2026-08-01T00:00:00.000Z";

        expect(primaryGoal([routine.goal, destination])?.id).toBe(destination.id);
        expect(attentionGoal([{ goal: destination, result: result() }, routine], NOW)?.goal.id).toBe(
            routine.goal.id,
        );
    });

    test("the oldest active goal is the deterministic fallback until selected", () => {
        const older = goal({ createdAt: "2026-08-01T00:00:00.000Z" });
        const newer = goal({ createdAt: "2026-08-05T00:00:00.000Z" });
        const archived = goal({
            isPrimary: true,
            createdAt: "2026-07-01T00:00:00.000Z",
            archivedAt: "2026-08-09T00:00:00.000Z",
        });

        expect(primaryGoal([newer, archived, older])?.id).toBe(older.id);
    });

    test("an achieved primary becomes ineligible and falls forward", () => {
        const achieved = goal({
            isPrimary: true,
            createdAt: "2026-08-01T00:00:00.000Z",
            achievedAt: "2026-08-10T00:00:00.000Z",
        });
        const active = goal({ createdAt: "2026-08-02T00:00:00.000Z" });

        expect(primaryGoal([achieved, active])?.id).toBe(active.id);
    });
});

describe("what stays off the home page", () => {
    test("archived goals are never promoted", () => {
        const archived: GoalSnapshot = {
            goal: goal({ archivedAt: "2026-08-09T00:00:00.000Z" }),
            result: result(),
        };
        expect(promoteGoals([archived], NOW)).toEqual([]);
    });

    test("an achievement is a moment: shown briefly, then gone", () => {
        const fresh: GoalSnapshot = {
            goal: goal({ achievedAt: "2026-08-09T12:00:00.000Z" }),
            result: result({ isTargetMet: true }),
        };
        const stale: GoalSnapshot = {
            goal: goal({ achievedAt: "2026-07-01T12:00:00.000Z" }),
            result: result({ isTargetMet: true }),
        };
        expect(promoteGoals([fresh, stale], NOW).map((e) => e.reason)).toEqual([
            "achieved",
        ]);
    });

    test("an unreadable or unevaluated goal says nothing here", () => {
        const unreadable: GoalSnapshot = {
            goal: goal({ target: { type: "nope" } as unknown as GoalTargetData }),
            result: result(),
        };
        const unevaluated: GoalSnapshot = { goal: goal(), result: null };
        expect(promoteGoals([unreadable, unevaluated], NOW)).toEqual([]);
    });
});

describe("ordering inside a reason", () => {
    test("the longest streak has the most to lose", () => {
        const short = streak(30, 3, 0, 4);
        const long = streak(30, 3, 0, 21);
        expect(
            promoteGoals([short, long], NOW).map((e) => e.result?.currentValue),
        ).toEqual([21, 4]);
    });

    test("ordinary goals lead with momentum", () => {
        const early: GoalSnapshot = {
            goal: goal(),
            result: result({ percentToTarget: 10 }),
        };
        const late: GoalSnapshot = {
            goal: goal(),
            result: result({ percentToTarget: 88 }),
        };
        expect(
            promoteGoals([early, late], NOW).map((e) => e.result?.percentToTarget),
        ).toEqual([88, 10]);
    });

    test("identical stakes keep a stable order between renders", () => {
        const a: GoalSnapshot = { goal: goal(), result: result() };
        const b: GoalSnapshot = { goal: goal(), result: result() };
        expect(promoteGoals([b, a], NOW).map((e) => e.goal.id)).toEqual(
            promoteGoals([a, b], NOW).map((e) => e.goal.id),
        );
    });
});

describe("the cap", () => {
    test("home never becomes a second goals page", () => {
        const many = Array.from({ length: 8 }, (): GoalSnapshot => ({
            goal: goal(),
            result: result(),
        }));
        expect(promoteGoals(many, NOW)).toHaveLength(3);
        expect(promoteGoals(many, NOW, 1)).toHaveLength(1);
        expect(promoteGoals(many, NOW, 0)).toHaveLength(0);
    });
});
