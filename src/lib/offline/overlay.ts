/**
 * Snapshot plus overlay equals effective state (`docs/offline-contracts.md` §5).
 *
 * ```text
 * downloaded server snapshot
 *           +
 * pending local submissions and organization changes
 *           =
 * effective offline state
 * ```
 *
 * The downloaded personal state is a **frozen base** and is never edited in
 * place. Everything a query reads is derived by folding unacknowledged local
 * work over it in `sequence` order, which is what lets one sync response replace
 * the base wholesale and have every overlapping package agree again — and what
 * makes a local write visible to New mode's "never offer this twice" rule the
 * instant it lands, without a round trip.
 *
 * V1 deliberately does **not** invent provisional `next_review_at` (or the SM-2
 * fields behind it). Those stay frozen and are flagged stale, because a made-up
 * schedule is worse than a visibly old one — and Review mode, which is the only
 * consumer that would read it, is out of v1 for exactly that reason.
 */

import type { Engagement, Mastery, ProblemProgress } from "$lib/progress";
import type { LocalSubmissionV1 } from "./types";

/** A pending mastery/engagement change, newest intent per axis. */
export type OrganizationOverride = {
    canonicalId: number;
    axis: "mastery" | "engagement";
    value: Mastery | Engagement | null;
    sequence: number;
};

export type EffectiveProgress = {
    progress: ProblemProgress | null;
    /** True once any unsynced local work has folded into `progress`. */
    provisional: boolean;
    /** True once a local graded submission invalidated the frozen schedule. */
    scheduleStale: boolean;
};

function blankProgress(): ProblemProgress {
    return {
        times_seen: 0,
        times_correct: 0,
        times_reviewed: 0,
        times_skipped: 0,
        last_correct: null,
        last_reviewed_at: null,
        last_submission_at: null,
        next_review_at: null,
        solved: false,
        mastery: null,
        engagement: null,
    };
}

/**
 * Fold one canonical's pending work over its frozen base.
 *
 * `submissions` and `overrides` must be this canonical's own, and are sorted by
 * `sequence` here rather than trusted to arrive ordered — outbox sequence, not
 * wall time, is what orders local work, and a caller reading through an index
 * gets storage order, not sequence order.
 */
export function effectiveProgress(
    base: ProblemProgress | null,
    submissions: LocalSubmissionV1[],
    overrides: OrganizationOverride[] = [],
): EffectiveProgress {
    if (submissions.length === 0 && overrides.length === 0) {
        return { progress: base, provisional: false, scheduleStale: false };
    }

    const progress: ProblemProgress = base ? { ...base } : blankProgress();
    let scheduleStale = false;

    for (const submission of [...submissions].sort((a, b) => a.sequence - b.sequence)) {
        progress.times_seen += 1;
        progress.last_submission_at = submission.occurredAt;
        if (submission.skipped) {
            progress.times_skipped += 1;
            continue;
        }
        if (submission.isCorrect === null) continue; // ungraded: seen, nothing more
        progress.times_reviewed += 1;
        progress.last_reviewed_at = submission.occurredAt;
        progress.last_correct = submission.isCorrect;
        if (submission.isCorrect) progress.times_correct += 1;
        // The frozen SM-2 schedule no longer describes this problem; it is
        // marked stale rather than guessed at.
        scheduleStale = true;
    }

    progress.solved = progress.times_correct > 0;

    // The last local intent wins on each axis, and wins over the frozen value:
    // an explicit offline change applies in outbox sequence at sync receipt.
    for (const override of [...overrides].sort((a, b) => a.sequence - b.sequence)) {
        if (override.axis === "mastery") {
            progress.mastery = override.value as Mastery | null;
        } else {
            progress.engagement = override.value as Engagement | null;
        }
    }

    return { progress, provisional: true, scheduleStale };
}

/** Group a user's local submissions by canonical id. */
export function groupByCanonical<T extends { canonicalId: number }>(
    items: T[],
): Map<number, T[]> {
    const map = new Map<number, T[]>();
    for (const item of items) {
        const list = map.get(item.canonicalId);
        if (list) list.push(item);
        else map.set(item.canonicalId, [item]);
    }
    return map;
}

/**
 * Whether a canonical has any *factual* activity — the New-mode exclusion.
 * Personal organization (mastery, engagement) is not activity; a problem you
 * labelled but never attempted is still new.
 */
export function hasPriorActivity(progress: ProblemProgress | null): boolean {
    return (progress?.times_seen ?? 0) > 0;
}
