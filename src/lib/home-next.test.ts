import { describe, expect, test } from "bun:test";
import { decideNextUp, homeProgressMetrics, type NextUpSession } from "./home-next";
import type { Goal, GoalProgressResult, GoalTargetData } from "./goals";
import type { PromotedGoal } from "./goals/promote";
import type { PlayerRating } from "./library";
import type { ProblemStateSummary } from "./progress";

function session(overrides: Partial<NextUpSession> = {}): NextUpSession {
    return {
        id: 11,
        name: "Mixed practice",
        times_seen: 3,
        times_correct: 2,
        last_submission_at: "2026-08-30T18:00:00.000Z",
        ...overrides,
    };
}

function goal(overrides: Partial<Goal> = {}): Goal {
    return {
        id: 7,
        userId: "u",
        title: "Solve 20 AMC 10 Geometry problems",
        scope: { topic: ["G"], seriesIds: [], seriesScopes: {} },
        target: { type: "solved_count", count: 20 } as GoalTargetData,
        deadline: null,
        achievedAt: null,
        archivedAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        ...overrides,
    };
}

function lead(overrides: Partial<PromotedGoal> = {}): PromotedGoal {
    return {
        goal: goal(),
        result: {
            status: "ok",
            direction: "at_least",
            currentValue: 3,
            targetValue: 20,
            unit: "problems",
            percentToTarget: 15,
            isTargetMet: false,
        } satisfies GoalProgressResult,
        reason: "remaining",
        ...overrides,
    };
}

function summary(overrides: Partial<ProblemStateSummary> = {}): ProblemStateSummary {
    return {
        total: 10,
        unseen: 5,
        seen: 5,
        attempted: 4,
        skipped_only: 1,
        review_due: 0,
        unassessed: 0,
        needs_work: 0,
        learning: 0,
        confident: 0,
        no_plan: 0,
        working: 0,
        revisit: 0,
        later: 0,
        ignored: 0,
        ...overrides,
    };
}

function rating(overrides: Partial<PlayerRating> = {}): PlayerRating {
    return {
        rating: 1420.4,
        rd: 62.2,
        matches: 12,
        last_match_at: "2026-08-30T18:00:00.000Z",
        ...overrides,
    };
}

describe("Next up without a goal", () => {
    test("an active session wins over due review", () => {
        const decision = decideNextUp({
            session: session(),
            reviewDue: 4,
            leadGoal: null,
            goalsReady: true,
        });
        expect(decision.action).toEqual({
            kind: "continue_session",
            label: "Continue",
            sessionId: 11,
        });
        expect(decision.work.title).toBe("Continue Mixed practice");
        expect(decision.work.detail).toBe("3 problems attempted · 2 correct");
        expect(decision.commitment).toEqual({ kind: "invitation" });
    });

    test("due review wins when there is no session", () => {
        const decision = decideNextUp({
            session: null,
            reviewDue: 4,
            leadGoal: null,
            goalsReady: true,
        });
        expect(decision.action).toEqual({
            kind: "review_due",
            label: "Open Review · 4 problems",
        });
        expect(decision.work.title).toBe("4 problems are ready to revisit.");
        expect(decision.work.detail).toBeNull();
    });

    test("ordinary practice is the fallback", () => {
        const decision = decideNextUp({
            session: null,
            reviewDue: 0,
            leadGoal: null,
            goalsReady: true,
        });
        expect(decision.action).toEqual({
            kind: "start_practice",
            label: "Start practicing",
        });
        expect(decision.work.title).toBe("Start practicing");
        expect(decision.commitment).toEqual({ kind: "invitation" });
    });

    test("goals still loading never flash a finish-line invitation", () => {
        const decision = decideNextUp({
            session: session(),
            reviewDue: 0,
            leadGoal: null,
            goalsReady: false,
        });
        expect(decision.commitment).toEqual({ kind: "pending" });
        expect(decision.action.kind).toBe("continue_session");
    });

    test("an unnamed session does not invent quotes", () => {
        const decision = decideNextUp({
            session: session({ name: "  ", times_seen: 0 }),
            reviewDue: 0,
            leadGoal: null,
            goalsReady: true,
        });
        expect(decision.work.title).toBe("Continue practice");
        expect(decision.work.detail).toBe("No problems attempted yet");
    });
});

describe("Next up with a lead goal", () => {
    test("the goal owns the action even when a session is in progress", () => {
        const entry = lead();
        const decision = decideNextUp({
            session: session(),
            reviewDue: 4,
            leadGoal: entry,
            goalsReady: true,
        });
        expect(decision.action).toEqual({
            kind: "goal_practice",
            label: "Practice unsolved problems",
            goal: entry.goal,
        });
        expect(decision.work.title).toBe("Continue Mixed practice");
        expect(decision.commitment).toEqual({ kind: "goal", entry });
    });

    test("due review does not steal the action from a lead goal", () => {
        const decision = decideNextUp({
            session: null,
            reviewDue: 6,
            leadGoal: lead(),
            goalsReady: true,
        });
        expect(decision.action.kind).toBe("goal_practice");
        expect(decision.work.title).toBe("Start practicing");
    });

    test("the action label follows the goal family, not a generic Continue", () => {
        const attempted = lead({
            goal: goal({ target: { type: "attempted_count", count: 20 } }),
        });
        expect(
            decideNextUp({
                session: null,
                reviewDue: 0,
                leadGoal: attempted,
                goalsReady: true,
            }).action.label,
        ).toBe("Practice what's left");
    });
});

describe("Progress on Home", () => {
    test("stays off until a graded submission exists", () => {
        expect(
            homeProgressMetrics({
                summary: summary({ attempted: 0, seen: 2, review_due: 1 }),
                rating: rating({ matches: 0, rd: 350 }),
                nextUpKind: "start_practice",
            }),
        ).toEqual([]);
    });

    test("omits a provisional rating and a zero review count", () => {
        expect(
            homeProgressMetrics({
                summary: summary({ review_due: 0 }),
                rating: rating({ matches: 0, rd: 350 }),
                nextUpKind: "start_practice",
            }),
        ).toEqual([
            { key: "problems_seen", label: "Problems seen", value: "5", caption: null },
        ]);
    });

    test("does not repeat review due when Next up already owns it", () => {
        const metrics = homeProgressMetrics({
            summary: summary({ review_due: 4 }),
            rating: rating(),
            nextUpKind: "review_due",
        });
        expect(metrics.map((metric) => metric.key)).toEqual(["rating", "problems_seen"]);
    });

    test("keeps review due when the primary action is something else", () => {
        const metrics = homeProgressMetrics({
            summary: summary({ review_due: 4 }),
            rating: rating(),
            nextUpKind: "goal_practice",
        });
        expect(metrics.map((metric) => metric.key)).toEqual([
            "rating",
            "review_due",
            "problems_seen",
        ]);
        expect(metrics[0]).toEqual({
            key: "rating",
            label: "Skill rating",
            value: "1420",
            caption: "±62 uncertainty",
        });
    });
});
