import { describe, expect, test } from "bun:test";
import {
    createTrackValue,
    type TrackValue,
} from "../../routes/(app)/practice/practice-settings";
import {
    evaluateGoals,
    planGoalRequests,
    requestedFamilies,
    scopeKey,
} from "./plan";
import { createGoalScope } from "./types";
import type { Goal, GoalScope, GoalTargetData } from "./types";

const NOW = new Date("2026-08-10T12:00:00Z");

const scope = (o: Partial<GoalScope> = {}): GoalScope => ({
    ...createGoalScope(),
    ...o,
});

let nextId = 1;
const goal = (target: GoalTargetData, goalScope = scope()): Goal => ({
    id: nextId++,
    userId: "u1",
    title: "a goal",
    scope: goalScope,
    target,
    deadline: null,
    achievedAt: null,
    archivedAt: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
});

/**
 * `GoalScope` is re-declared in `$lib` rather than imported from the route
 * module, so this is the assertion that keeps the two honest: scope ≡ Track is
 * what makes "practice what remains" free, and if they drift the trainer would
 * silently draw from a different pool than the goal measures.
 */
type Assert<T extends true> = T;
type TrackIsAScope = TrackValue extends Omit<GoalScope, "yearRange">
    ? true
    : false;
type ScopeIsATrack = Omit<GoalScope, "yearRange"> extends TrackValue
    ? true
    : false;
type _scopeMatchesTrack = Assert<TrackIsAScope>;
type _trackMatchesScope = Assert<ScopeIsATrack>;

describe("scope ≡ Track", () => {
    test("an empty Track and an empty scope are the same request", () => {
        const track: TrackValue = createTrackValue();
        expect(scopeKey(track)).toBe(scopeKey(createGoalScope()));
    });
});

describe("scopeKey", () => {
    test("key order and selection order do not change the key", () => {
        const a = scope({
            topic: ["geometry", "algebra"],
            seriesIds: ["7", "3"],
            seriesScopes: {
                "7": { divisions: ["State", "National"], formats: ["Sprint"] },
                "3": { divisions: [], formats: [] },
            },
        });
        const b = scope({
            topic: ["algebra", "geometry"],
            seriesIds: ["3", "7"],
            seriesScopes: {
                "3": { divisions: [], formats: [] },
                "7": { divisions: ["National", "State"], formats: ["Sprint"] },
            },
        });
        expect(scopeKey(a)).toBe(scopeKey(b));
    });

    test("a real difference still changes the key", () => {
        expect(scopeKey(scope({ seriesIds: ["3"] }))).not.toBe(
            scopeKey(scope({ seriesIds: ["4"] })),
        );
        expect(
            scopeKey(
                scope({
                    seriesIds: ["3"],
                    seriesScopes: { "3": { divisions: ["State"], formats: [] } },
                }),
            ),
        ).not.toBe(scopeKey(scope({ seriesIds: ["3"] })));
    });
});

describe("planning", () => {
    test("goals in the same family over the same scope fetch once", () => {
        const shared = scope({ seriesIds: ["3"] });
        const goals = [
            goal({ type: "attempted_count", count: 50 }, shared),
            goal({ type: "solved_percent", percentage: 60 }, shared),
        ];
        const plan = planGoalRequests(goals, { now: NOW });

        expect(plan.requests.set.length).toBe(1);
        expect(plan.slots.get(goals[0].id)).toEqual({ family: "set", index: 0 });
        expect(plan.slots.get(goals[1].id)).toEqual({ family: "set", index: 0 });
    });

    test("different scopes in one family are separate requests", () => {
        const goals = [
            goal({ type: "solved_count", count: 10 }, scope({ seriesIds: ["3"] })),
            goal({ type: "solved_count", count: 10 }, scope({ seriesIds: ["4"] })),
        ];
        const plan = planGoalRequests(goals, { now: NOW });
        expect(plan.requests.set.length).toBe(2);
        expect(plan.slots.get(goals[1].id)?.index).toBe(1);
    });

    test("window goals dedupe on scope AND sample size", () => {
        const shared = scope({ seriesIds: ["3"] });
        const goals = [
            goal({ type: "accuracy", percentage: 85, sampleSize: 30 }, shared),
            goal(
                { type: "speed", maxSeconds: 90, sampleSize: 30, minAccuracy: 80 },
                shared,
            ),
            goal({ type: "accuracy", percentage: 90, sampleSize: 50 }, shared),
        ];
        const plan = planGoalRequests(goals, { now: NOW });

        // Accuracy and speed at the same sample size share one window fetch —
        // that sharing is why the RPC returns all three windows at once.
        expect(plan.requests.window.length).toBe(2);
        expect(plan.slots.get(goals[0].id)?.index).toBe(0);
        expect(plan.slots.get(goals[1].id)?.index).toBe(0);
        expect(plan.slots.get(goals[2].id)?.index).toBe(1);
    });

    test("eight goals across four families cost four requests, not eight", () => {
        const shared = scope({ seriesIds: ["3"] });
        const goals = [
            goal({ type: "attempted_count", count: 50 }, shared),
            goal({ type: "attempted_percent", percentage: 80 }, shared),
            goal({ type: "solved_count", count: 20 }, shared),
            goal({ type: "solved_percent", percentage: 40 }, shared),
            goal({ type: "accuracy", percentage: 85, sampleSize: 30 }, shared),
            goal(
                { type: "speed", maxSeconds: 90, sampleSize: 30, minAccuracy: 80 },
                shared,
            ),
            goal(
                { type: "volume", count: 150, period: { kind: "since_creation" } },
                shared,
            ),
            goal({ type: "streak", days: 30, perDay: 3, timeZone: "UTC" }, shared),
        ];
        const plan = planGoalRequests(goals, { now: NOW });

        expect(requestedFamilies(plan)).toEqual([
            "set",
            "window",
            "accumulation",
            "period",
        ]);
        const total = requestedFamilies(plan).reduce(
            (n, family) => n + plan.requests[family].length,
            0,
        );
        expect(total).toBe(4);
    });

    test("only families with work are requested", () => {
        const plan = planGoalRequests(
            [goal({ type: "streak", days: 30, perDay: 3, timeZone: "UTC" })],
            { now: NOW },
        );
        expect(requestedFamilies(plan)).toEqual(["period"]);
    });

    test("a volume period becomes a range, and identical ranges dedupe", () => {
        const shared = scope({ seriesIds: ["3"] });
        const goals = [
            goal(
                { type: "volume", count: 100, period: { kind: "rolling", days: 7 } },
                shared,
            ),
            goal(
                { type: "volume", count: 200, period: { kind: "rolling", days: 7 } },
                shared,
            ),
            goal(
                { type: "volume", count: 300, period: { kind: "rolling", days: 30 } },
                shared,
            ),
        ];
        const plan = planGoalRequests(goals, { now: NOW });

        expect(plan.requests.accumulation.length).toBe(2);
        expect(plan.requests.accumulation[0].from).toBe("2026-08-03T12:00:00.000Z");
        expect(plan.requests.accumulation[0].to).toBeNull();
    });

    test("two since-creation goals created at different times do not share", () => {
        const shared = scope({ seriesIds: ["3"] });
        const first = goal(
            { type: "volume", count: 100, period: { kind: "since_creation" } },
            shared,
        );
        const second = {
            ...goal(
                { type: "volume", count: 100, period: { kind: "since_creation" } },
                shared,
            ),
            createdAt: "2026-08-01T00:00:00Z",
        };
        const plan = planGoalRequests([first, second], { now: NOW });
        expect(plan.requests.accumulation.length).toBe(2);
    });

    test("a goal with an unreadable target is set aside, not planned", () => {
        const broken = goal({ type: "mastery_percent" } as unknown as GoalTargetData);
        const fine = goal({ type: "solved_count", count: 10 });
        const plan = planGoalRequests([broken, fine], { now: NOW });

        expect(plan.unreadable).toEqual([broken.id]);
        expect(plan.slots.has(broken.id)).toBe(false);
        expect(plan.requests.set.length).toBe(1);
        // The readable goal must still land on index 0 — a skipped goal cannot
        // be allowed to shift anyone else's slot.
        expect(plan.slots.get(fine.id)?.index).toBe(0);
    });
});

describe("evaluation", () => {
    test("goals read their own slot's data", () => {
        const a = goal({ type: "solved_count", count: 10 }, scope({ seriesIds: ["3"] }));
        const b = goal({ type: "solved_count", count: 10 }, scope({ seriesIds: ["4"] }));
        const plan = planGoalRequests([a, b], { now: NOW });

        const results = evaluateGoals([a, b], plan, {
            set: [
                { attempted: 5, solved: 2, eligibleTotal: 50 },
                { attempted: 9, solved: 9, eligibleTotal: 50 },
            ],
        });

        expect(results.get(a.id)?.currentValue).toBe(2);
        expect(results.get(b.id)?.currentValue).toBe(9);
        expect(results.get(b.id)?.isTargetMet).toBe(false);
    });

    test("two goals sharing one fetch both render from it", () => {
        const shared = scope({ seriesIds: ["3"] });
        const a = goal({ type: "attempted_count", count: 100 }, shared);
        const b = goal({ type: "solved_count", count: 100 }, shared);
        const plan = planGoalRequests([a, b], { now: NOW });

        const results = evaluateGoals([a, b], plan, {
            set: [{ attempted: 80, solved: 30, eligibleTotal: 200 }],
        });

        expect(results.get(a.id)?.currentValue).toBe(80);
        expect(results.get(b.id)?.currentValue).toBe(30);
    });

    test("a family that failed to load leaves its goals unevaluated, not at zero", () => {
        // Zero is a claim about the student; absence is not.
        const g = goal({ type: "solved_count", count: 10 });
        const plan = planGoalRequests([g], { now: NOW });
        expect(evaluateGoals([g], plan, {}).get(g.id)).toBeNull();
    });

    test("an unreadable goal evaluates to null", () => {
        const broken = goal({ type: "nope" } as unknown as GoalTargetData);
        const plan = planGoalRequests([broken], { now: NOW });
        expect(evaluateGoals([broken], plan, { set: [] }).get(broken.id)).toBeNull();
    });
});
