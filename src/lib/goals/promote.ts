/**
 * Which goals the home page puts in front of the student, and why.
 *
 * This is editorial policy, not a query, and it is a pure function on purpose:
 * "which of my commitments matters right now" is exactly the kind of rule that
 * rots when it lives inside markup, because nobody can change it without
 * reading a component.
 *
 * The ranking answers **what can move today**, not what is closest to done. A
 * goal 95% complete with no deadline can wait a week; a streak that has not
 * been fed today is lost at midnight. That ordering is the whole reason home
 * shows goals at all — a list sorted by completion is just the goals page with
 * fewer rows.
 */

import { targetOf } from "./registry";
import { daysUntil } from "./presentation";
import { goalStatus, type Goal, type GoalProgressResult, type PeriodData } from "./types";

/** A deadline further out than this is not yet news. */
export const DEADLINE_HORIZON_DAYS = 14;
/** How long a finished goal keeps its place on the home page. */
export const CELEBRATION_DAYS = 3;
export const HOME_GOAL_LIMIT = 3;

/**
 * What a surface knows about one goal: the evaluated result, plus — for the
 * period family only — the raw row. `todayCount` deliberately never reaches
 * `GoalProgressResult` (`types.ts`), and this is the surface the type comment
 * meant: "how many more today" is the single most actionable number in the app
 * and cannot be derived from a streak length.
 */
export type GoalSnapshot = {
    goal: Goal;
    result: GoalProgressResult | null;
    period?: PeriodData | null;
};

/**
 * Why a goal was promoted. The surface renders one line from this rather than
 * inventing its own urgency copy, so two cards can never disagree about what is
 * urgent.
 */
export type PromotionReason =
    | "streak_today"
    | "deadline"
    | "achieved"
    | "remaining";

export type PromotedGoal = GoalSnapshot & {
    reason: PromotionReason;
    /** `streak_today` only: how many more problems today. Always ≥ 1. */
    todayShortfall?: number;
    /** `deadline` only: whole days left; negative when overdue. */
    daysLeft?: number;
};

const RANK: Record<PromotionReason, number> = {
    streak_today: 0,
    deadline: 1,
    achieved: 2,
    remaining: 3,
};

function classify(
    snapshot: GoalSnapshot,
    now: Date,
): PromotedGoal | null {
    const { goal, result } = snapshot;
    const status = goalStatus(goal);
    // Archived goals are readable but no longer promoted (`docs/goals.md` §7).
    if (status === "archived") return null;

    if (status === "achieved") {
        // A finished goal is a moment, not a fixture: it earns a few days on the
        // home page and then gets out of the way.
        const days = daysSince(goal.achievedAt, now);
        if (days === null || days > CELEBRATION_DAYS) return null;
        return { ...snapshot, reason: "achieved" };
    }

    // An unreadable or unevaluated goal has nothing to say here. The goals page
    // shows it as unreadable and offers to fix it; home is not the place to
    // learn that something is broken.
    const target = targetOf(goal.target);
    if (!target || !result) return null;

    if (target.type === "streak" && snapshot.period) {
        const shortfall = target.perDay - snapshot.period.todayCount;
        if (shortfall > 0) {
            return { ...snapshot, reason: "streak_today", todayShortfall: shortfall };
        }
    }

    const daysLeft = daysUntil(goal.deadline, now);
    if (daysLeft !== null && daysLeft <= DEADLINE_HORIZON_DAYS) {
        return { ...snapshot, reason: "deadline", daysLeft };
    }

    return { ...snapshot, reason: "remaining" };
}

function daysSince(iso: string | null, now: Date): number | null {
    if (!iso) return null;
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return null;
    const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
    return days < 0 ? 0 : days;
}

/**
 * Rank within a reason. Each tiebreak is the "most at stake" reading of its own
 * bucket: the longest streak has the most to lose, the nearest deadline the
 * least room, the newest achievement the most to celebrate, and among ordinary
 * goals the one furthest along has the most momentum to spend.
 */
function tiebreak(a: PromotedGoal, b: PromotedGoal): number {
    switch (a.reason) {
        case "streak_today":
            return (b.result?.currentValue ?? 0) - (a.result?.currentValue ?? 0);
        case "deadline":
            return (a.daysLeft ?? 0) - (b.daysLeft ?? 0);
        case "achieved":
            return (b.goal.achievedAt ?? "").localeCompare(a.goal.achievedAt ?? "");
        case "remaining":
            return (
                (b.result?.percentToTarget ?? 0) - (a.result?.percentToTarget ?? 0)
            );
    }
}

/**
 * The goals home should show, most urgent first, capped.
 *
 * The cap is not a layout detail: a home page listing every goal is a second
 * goals page, and the student stops reading either.
 */
export function promoteGoals(
    snapshots: GoalSnapshot[],
    now: Date,
    limit: number = HOME_GOAL_LIMIT,
): PromotedGoal[] {
    const promoted = snapshots
        .map((snapshot) => classify(snapshot, now))
        .filter((entry): entry is PromotedGoal => entry !== null);

    promoted.sort((a, b) => {
        const byReason = RANK[a.reason] - RANK[b.reason];
        if (byReason !== 0) return byReason;
        const byStake = tiebreak(a, b);
        if (byStake !== 0) return byStake;
        // Stable and deterministic: two goals with identical stakes must not
        // swap places between renders.
        return a.goal.id - b.goal.id;
    });

    return promoted.slice(0, Math.max(0, limit));
}
