/**
 * Phase one and phase three: turning goals into batched data requests, and
 * results back into progress.
 *
 * The whole point is stated in `docs/goals.md` §8: a goals list costs one round
 * trip per FAMILY, not per goal. Two goals over the same scope in the same
 * family fetch once, and a goal card renders from data it did not fetch itself.
 * Evaluating per goal would make a list of eight goals eight round trips and
 * get slower with every goal a student keeps.
 */

import { evaluateTarget, requestFor, targetOf } from "./registry";
import type {
    DataRequest,
    FamilyData,
    FamilyRequest,
    Goal,
    GoalFamily,
    GoalProgressResult,
    GoalScope,
    RequestContext,
    SeriesScope,
} from "./types";

export const GOAL_FAMILIES: GoalFamily[] = [
    "set",
    "window",
    "accumulation",
    "period",
];

/**
 * Requests per family, deduped, plus where each goal's answer will be found.
 * `slots` maps a goal id to its position in its family's request array — the
 * same index the RPCs echo back as `idx`.
 */
export type GoalRequestPlan = {
    requests: { [F in GoalFamily]: FamilyRequest[F][] };
    slots: Map<number, { family: GoalFamily; index: number }>;
    /** Goals whose stored target we could not read (see `targetOf`). */
    unreadable: number[];
};

export type GoalFamilyResults = {
    [F in GoalFamily]?: FamilyData[F][];
};

/**
 * A stable string for a scope, independent of key order and of the order the
 * student happened to pick series or topics in. Without the canonicalization,
 * two identical scopes authored in different orders would miss each other in
 * the dedupe and quietly double the work.
 */
export function scopeKey(scope: GoalScope): string {
    const scopes: Record<string, SeriesScope> = {};
    for (const id of Object.keys(scope.seriesScopes ?? {}).sort()) {
        const entry = scope.seriesScopes[id];
        scopes[id] = {
            divisions: [...(entry?.divisions ?? [])].sort(),
            formats: [...(entry?.formats ?? [])].sort(),
        };
    }
    return JSON.stringify({
        topic: [...(scope.topic ?? [])].sort(),
        seriesIds: [...(scope.seriesIds ?? [])].sort(),
        seriesScopes: scopes,
        yearRange: scope.yearRange ?? null,
    });
}

function requestKey(request: DataRequest): string {
    const { family } = request;
    const scope = scopeKey(request.request.scope);
    switch (family) {
        case "set":
            return `set|${scope}`;
        case "window":
            return `window|${scope}|${request.request.sampleSize}`;
        case "accumulation":
            return `accumulation|${scope}|${request.request.from ?? ""}|${request.request.to ?? ""}`;
        case "period":
            return `period|${scope}|${request.request.timeZone}|${request.request.perDay}`;
    }
}

/**
 * Phase one. `ctx.now` is passed rather than read so that a plan is
 * reproducible in a test, and so every goal in one render shares a single
 * notion of "now" — two volume goals whose rolling windows started a
 * millisecond apart would defeat the dedupe for no reason.
 */
export function planGoalRequests(
    goals: Goal[],
    ctx: { now: Date },
): GoalRequestPlan {
    const plan: GoalRequestPlan = {
        requests: { set: [], window: [], accumulation: [], period: [] },
        slots: new Map(),
        unreadable: [],
    };
    const seen = new Map<string, number>();

    for (const goal of goals) {
        const target = targetOf(goal.target);
        if (!target) {
            plan.unreadable.push(goal.id);
            continue;
        }

        const requestContext: RequestContext = {
            now: ctx.now,
            createdAt: goal.createdAt,
        };
        const request = requestFor(target, goal.scope, requestContext);
        const key = requestKey(request);

        let index = seen.get(key);
        if (index === undefined) {
            const bucket = plan.requests[request.family] as unknown[];
            index = bucket.length;
            bucket.push(request.request);
            seen.set(key, index);
        }
        plan.slots.set(goal.id, { family: request.family, index });
    }

    return plan;
}

/** The families a plan actually needs, so no empty round trip is issued. */
export function requestedFamilies(plan: GoalRequestPlan): GoalFamily[] {
    return GOAL_FAMILIES.filter((family) => plan.requests[family].length > 0);
}

/**
 * Phase three. A goal whose slot has no data — a family that failed to load, or
 * a target we could not read — maps to null, which surfaces render as an
 * unreadable card rather than as zero progress. Zero is a claim; absence is not.
 */
export function evaluateGoals(
    goals: Goal[],
    plan: GoalRequestPlan,
    results: GoalFamilyResults,
): Map<number, GoalProgressResult | null> {
    const out = new Map<number, GoalProgressResult | null>();

    for (const goal of goals) {
        const target = targetOf(goal.target);
        const slot = plan.slots.get(goal.id);
        if (!target || !slot) {
            out.set(goal.id, null);
            continue;
        }
        const data = results[slot.family]?.[slot.index];
        out.set(goal.id, data ? evaluateTarget(target, data) : null);
    }

    return out;
}

/**
 * Goals whose finish line is met but whose `achieved_at` is still null — the
 * ones a surface should stamp on load (`stampAchievedGoals`, which is
 * idempotent and first-writer-wins).
 *
 * Phase three's other half, and it lives here rather than in a surface because
 * every surface that evaluates must reach the same verdict. An unevaluated goal
 * (a family that failed to load) is never stamped: absence of data is not
 * evidence of achievement. Neither is an archived goal, which is no longer
 * promoted, nor an `insufficient_data` result.
 */
export function newlyAchieved(
    goals: Goal[],
    results: Map<number, GoalProgressResult | null>,
): number[] {
    const out: number[] = [];
    for (const goal of goals) {
        if (goal.achievedAt || goal.archivedAt) continue;
        const result = results.get(goal.id);
        if (!result || result.status !== "ok" || !result.isTargetMet) continue;
        out.push(goal.id);
    }
    return out;
}
