/**
 * What Home puts in front of the student, and why.
 *
 * One decision produces the primary card's three slots — current work, the
 * commitment (lead goal or a quiet invitation), and the single next action —
 * so the heading and the button cannot disagree. Ranking lives here rather
 * than in markup for the same reason `promote.ts` does: editorial policy
 * that sits inside a component rots the first time someone adds a card.
 *
 * Without a goal the action is continue-session, then due review, then
 * ordinary practice. With a lead goal the action is always that goal's
 * practice handoff; Home does not resume a prior session, because sessions
 * do not yet record goal provenance (`docs/onboarding-and-home.md` §3.3).
 */

import { playerRatingIsProvisional, type PlayerRating } from "$lib/library";
import { practiceActionLabel } from "$lib/goals/practice";
import type { Goal } from "$lib/goals";
import type { PromotedGoal } from "$lib/goals/promote";
import type { ProblemStateSummary } from "$lib/progress";

export type NextUpSession = {
    id: number;
    name: string | null;
    times_seen: number;
    times_correct: number;
    last_submission_at: string | null;
};

export type NextUpAction =
    | { kind: "continue_session"; label: string; sessionId: number }
    | { kind: "review_due"; label: string }
    | { kind: "start_practice"; label: string }
    | { kind: "goal_practice"; label: string; goal: Goal };

export type NextUpWork = {
    title: string;
    detail: string | null;
    lastActiveAt: string | null;
};

export type NextUpCommitment =
    | { kind: "goal"; entry: PromotedGoal }
    | { kind: "invitation" }
    | { kind: "pending" };

export type NextUpDecision = {
    work: NextUpWork;
    commitment: NextUpCommitment;
    action: NextUpAction;
};

export type NextUpInput = {
    session: NextUpSession | null;
    reviewDue: number;
    leadGoal: PromotedGoal | null;
    goalsReady: boolean;
};

function plural(value: number, singular: string, pluralForm = `${singular}s`) {
    return value === 1 ? singular : pluralForm;
}

function sessionTitle(session: NextUpSession): string {
    const name = session.name?.trim();
    return name ? `Continue ${name}` : "Continue practice";
}

function sessionDetail(session: NextUpSession): string {
    if (session.times_seen === 0) return "No problems attempted yet";
    return `${session.times_seen} ${plural(session.times_seen, "problem")} attempted · ${session.times_correct} correct`;
}

function workFromSession(session: NextUpSession | null): NextUpWork {
    if (session) {
        return {
            title: sessionTitle(session),
            detail: sessionDetail(session),
            lastActiveAt: session.last_submission_at,
        };
    }
    return { title: "Start practicing", detail: null, lastActiveAt: null };
}

function reviewWork(reviewDue: number): NextUpWork {
    return {
        title: `${reviewDue} ${plural(reviewDue, "problem")} ${reviewDue === 1 ? "is" : "are"} ready to revisit.`,
        detail: null,
        lastActiveAt: null,
    };
}

function reviewAction(reviewDue: number): NextUpAction {
    return {
        kind: "review_due",
        label:
            reviewDue === 1
                ? "Open Review"
                : `Open Review · ${reviewDue} problems`,
    };
}

function generalAction(session: NextUpSession | null, reviewDue: number): NextUpAction {
    if (session) {
        return { kind: "continue_session", label: "Continue", sessionId: session.id };
    }
    if (reviewDue > 0) return reviewAction(reviewDue);
    return { kind: "start_practice", label: "Start practicing" };
}

function generalWork(session: NextUpSession | null, reviewDue: number): NextUpWork {
    if (session) return workFromSession(session);
    if (reviewDue > 0) return reviewWork(reviewDue);
    return workFromSession(null);
}

/**
 * The one Next up decision Home may render. `leadGoal` is the stable
 * destination from `primaryGoal` — urgency belongs on Needs attention, not here.
 */
export function decideNextUp(input: NextUpInput): NextUpDecision {
    const { session, reviewDue, leadGoal, goalsReady } = input;

    if (goalsReady && leadGoal) {
        return {
            work: workFromSession(session),
            commitment: { kind: "goal", entry: leadGoal },
            action: {
                kind: "goal_practice",
                label: practiceActionLabel(leadGoal.goal),
                goal: leadGoal.goal,
            },
        };
    }

    return {
        work: generalWork(session, reviewDue),
        commitment: goalsReady ? { kind: "invitation" } : { kind: "pending" },
        action: generalAction(session, reviewDue),
    };
}

export type HomeProgressMetric = {
    key: "rating" | "review_due" | "problems_seen";
    label: string;
    value: string;
    caption: string | null;
};

export type HomeProgressInput = {
    summary: ProblemStateSummary | null;
    rating: PlayerRating | null;
    /** When Next up already owns review, Progress must not repeat it. */
    nextUpKind: NextUpAction["kind"];
};

/**
 * Compact Progress facts that add something the primary card does not already
 * say. Empty until the first graded submission; provisional ratings and zero
 * review counts are omitted rather than rendered as placeholders.
 */
export function homeProgressMetrics(input: HomeProgressInput): HomeProgressMetric[] {
    const attempted = input.summary?.attempted ?? 0;
    if (attempted <= 0) return [];

    const metrics: HomeProgressMetric[] = [];
    const rating = input.rating;
    if (rating && !playerRatingIsProvisional(rating)) {
        metrics.push({
            key: "rating",
            label: "Skill rating",
            value: String(Math.round(rating.rating)),
            caption: `±${Math.round(rating.rd)} uncertainty`,
        });
    }

    const reviewDue = input.summary?.review_due ?? 0;
    if (reviewDue > 0 && input.nextUpKind !== "review_due") {
        metrics.push({
            key: "review_due",
            label: "Review due",
            value: String(reviewDue),
            caption: null,
        });
    }

    const seen = input.summary?.seen ?? 0;
    if (seen > 0) {
        metrics.push({
            key: "problems_seen",
            label: "Problems seen",
            value: String(seen),
            caption: null,
        });
    }

    return metrics;
}
